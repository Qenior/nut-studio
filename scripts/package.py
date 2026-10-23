"""Build deterministic public assets from an explicit source list, with privacy checks."""
from io import BytesIO
from pathlib import Path, PurePosixPath
from zipfile import BadZipFile, ZipFile, ZipInfo, ZIP_DEFLATED
import argparse
import hashlib
import os
import re
import stat
import struct
import tempfile

ROOT = Path(__file__).resolve().parent.parent
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 2000
FORBIDDEN_PARTS = frozenset({
    ".git", ".publish-tools", ".codex", ".agents", ".aws", ".vs", ".vscode",
    "dist", "artifacts", "data", "backups", "node_modules", "__pycache__",
})
FORBIDDEN_FILES = frozenset({
    "session.json", "profiles.json", "strip-shortcut.json", "credentials.json",
    "credentials", "id_rsa", "id_ed25519",
})


def validate_member_name(name):
    """Do not let an edited manifest or a nested ZIP bypass the public file policy."""
    if not name or "\\" in name or ":" in name or "\x00" in name:
        raise ValueError("Invalid public member name")
    parts = name.split("/")
    if (any(part in ("", ".", "..") or part.endswith((" ", "."))
            or any(ord(char) < 32 or char in '<>"|?*' for char in part) for part in parts)
            or PurePosixPath(name).is_absolute()):
        raise ValueError("Invalid public member name")
    lowered = [part.casefold() for part in parts]
    base = lowered[-1]
    if (any(part in FORBIDDEN_PARTS for part in lowered)
            or base in FORBIDDEN_FILES or base.startswith(".env")
            or Path(base).suffix in {".log", ".pem", ".key", ".pfx", ".p12", ".pyc", ".pyo"}):
        raise ValueError("Private or generated files are forbidden in public assets")


def load_source_files(root):
    root = Path(root).resolve()
    manifest = root / "scripts" / "source-files.txt"
    if not manifest.is_file() or manifest.is_symlink():
        raise ValueError("Required explicit source list is missing")
    if manifest.stat().st_size > 64 * 1024:
        raise ValueError("Source list is too large")
    members, seen, total = {}, set(), 0
    for raw in manifest.read_text(encoding="utf-8-sig").splitlines():
        name = raw.strip()
        if not name or name.startswith("#"):
            continue
        validate_member_name(name)
        if name.casefold() in seen:
            raise ValueError("Duplicate source list entry")
        seen.add(name.casefold())
        path = root.joinpath(*name.split("/"))
        # Reject links to files and directories, including paths escaping the root.
        if not path.resolve().is_relative_to(root) or any(
                part.is_symlink() or getattr(part, "is_junction", lambda: False)()
                for part in (path, *path.parents) if part != root):
            raise ValueError("Source list entry resolves outside the source tree")
        if not path.is_file():
            raise ValueError(f"Required source file missing: {name}")
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            raise ValueError(f"Source file is too large: {name}")
        total += size
        if total > MAX_ARCHIVE_BYTES or len(members) >= MAX_ARCHIVE_MEMBERS:
            raise ValueError("Source list total size or member limit exceeded")
        members[name] = path.read_bytes()
    required = {"VERSION", "LICENSE", "docs/THIRD-PARTY-NOTICES.md", "scripts/source-files.txt",
                "scripts/package.py", "src/AssemblyInfo.cs", "docs/QUICKSTART.md"}
    if not required.issubset(members):
        raise ValueError("Source list omits required release files")
    return members


def binary_versions(blob):
    versions = set()
    for match in re.finditer(re.escape(bytes.fromhex("bd04effe")), blob):
        offset = match.start()
        if offset + 16 > len(blob):
            continue
        signature_version, high, low = struct.unpack_from("<III", blob, offset + 4)
        if signature_version == 0x00010000:
            versions.add((high >> 16, high & 65535, low >> 16, low & 65535))
    return versions


def validate_executable(blob, version):
    if len(blob) < 128 or len(blob) > MAX_FILE_BYTES or blob[:2] != b"MZ":
        raise ValueError("Executable is not a Windows PE file")
    pe = struct.unpack_from("<I", blob, 60)[0]
    if pe < 64 or pe + 24 > len(blob) or blob[pe:pe + 4] != b"PE\0\0":
        raise ValueError("Invalid PE header")
    machine, sections = struct.unpack_from("<HH", blob, pe + 4)
    optional_size = struct.unpack_from("<H", blob, pe + 20)[0]
    optional, section_table = pe + 24, pe + 24 + optional_size
    if machine != 0x8664:
        raise ValueError("Only Windows x64 builds are released")
    if (not 1 <= sections <= 96 or optional_size < 112
            or section_table + sections * 40 > len(blob)
            or struct.unpack_from("<H", blob, optional)[0] != 0x20b):
        raise ValueError("Invalid x64 PE optional header or section table")
    for section in range(sections):
        size, offset = struct.unpack_from("<II", blob, section_table + section * 40 + 16)
        if size and (offset < section_table + sections * 40 or offset + size > len(blob)):
            raise ValueError("Invalid PE section bounds")
    if tuple(map(int, version.split("."))) + (0,) not in binary_versions(blob):
        raise ValueError("Executable version does not match VERSION")


def privacy_patterns(usernames):
    # Match paths independently of this machine's name and slash convention.
    patterns = [
        ("personal Windows path", re.compile(r"(?i)\b[a-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s\"<>|\x00]+")),
        ("personal home path", re.compile(r"/(?:" + "home|Users" + r")/[^/\s\"<>|\x00]+")),
        ("email address", re.compile(r"(?i)\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b")),
        ("private key", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----")),
        ("credential token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b")),
        ("JWT credential", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
        ("assigned secret", re.compile(r"(?i)\b(?:token|password|secret|api[_-]?key|access[_-]?token)[\"']?\s*[:=]\s*[\"']?[a-z0-9_+/=.-]{20,}")),
        ("assigned credential", re.compile(r"(?i)\b(?:password|api[_-]?key|client[_-]?secret)[\"']?\s*[:=]\s*[\"'][^\"'\s]{8,}[\"']")),
        ("session URL token", re.compile(r"(?i)https?://(?:localhost|127\.0\.0\.1):[0-9]+/[a-f0-9]{32,}")),
        ("unique HID path", re.compile(r"(?i)hid#vid_[0-9a-f]{4}&pid_[0-9a-f]{4}[^#\s\x00\"']*#[^#\s\x00\"']{3,}")),
    ]
    for username in usernames:
        if username and len(username) >= 3 and username.casefold() not in {"user", "users", "public", "default", "root"}:
            patterns.append(("local username", re.compile(r"(?i)(?<![\w])" + re.escape(username) + r"(?![\w])")))
    return patterns


def is_public_email_example(value, label):
    # Only documented placeholders are exempt; real noreply addresses still fail.
    if not label.lower().endswith(".md"):
        return False
    domain = value.rsplit("@", 1)[-1].casefold()
    return (domain in {"example.com", "example.net", "example.org"}
            or (label.endswith("docs/PUBLISH.md")
                and value == "publishOwner" + "@" + "users.noreply.github.com"))


def scan_blob(label, blob, usernames=(), depth=0):
    """Scan source, binaries and nested ZIPs without printing any matched secret."""
    if len(blob) > MAX_ARCHIVE_BYTES:
        raise ValueError(f"Privacy scan size limit: {label}")
    texts = [blob.decode("utf-8", errors="ignore")]
    # Managed PE strings are UTF-16; both offsets cover strings in binary sections.
    for encoding in ("utf-16-le", "utf-16-be"):
        for offset in (0, 1):
            texts.append(blob[offset:].decode(encoding, errors="ignore"))
    for kind, pattern in privacy_patterns(usernames):
        for text in texts:
            for match in pattern.finditer(text):
                if kind == "email address" and is_public_email_example(match.group(), label):
                    continue
                raise ValueError(f"Privacy scan rejected {label}: {kind}")
    if blob.startswith(b"PK\x03\x04") or label.lower().endswith(".zip"):
        if depth >= 3:
            raise ValueError("Privacy scan archive nesting limit")
        try:
            with ZipFile(BytesIO(blob)) as archive:
                entries, seen, total = archive.infolist(), set(), 0
                if len(entries) > MAX_ARCHIVE_MEMBERS:
                    raise ValueError("Privacy scan archive member limit")
                for entry in entries:
                    validate_member_name(entry.filename)
                    mode = stat.S_IFMT(entry.external_attr >> 16)
                    if (entry.filename.casefold() in seen or entry.is_dir()
                            or (entry.create_system == 3 and mode not in (0, stat.S_IFREG))):
                        raise ValueError("Duplicate or unexpected directory in public archive")
                    seen.add(entry.filename.casefold())
                    total += entry.file_size
                    if total > MAX_ARCHIVE_BYTES or entry.file_size > MAX_FILE_BYTES or entry.flag_bits & 1:
                        raise ValueError("Privacy scan archive size or encryption limit")
                    scan_blob(f"{label}!{entry.filename}", archive.read(entry), usernames, depth + 1)
        except BadZipFile as error:
            raise ValueError("Invalid public ZIP archive") from error


def create_archive(members):
    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        seen = set()
        for name, data in sorted(members.items()):
            validate_member_name(name)
            if name.casefold() in seen:
                raise ValueError("Duplicate public archive member")
            seen.add(name.casefold())
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
    blob = buffer.getvalue()
    with ZipFile(BytesIO(blob)) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != set(members):
            raise ValueError("Public archive verification failed")
        if any(archive.read(name) != data for name, data in members.items()):
            raise ValueError("Public archive member changed")
    return blob


def build_assets(root, executable, requested_version=None, usernames=()):
    root = Path(root)
    sources = load_source_files(root)
    version = sources["VERSION"].decode("utf-8-sig").strip()
    if not re.fullmatch(r"(?:0|[1-9][0-9]{0,4})\.(?:0|[1-9][0-9]{0,4})\.(?:0|[1-9][0-9]{0,4})", version) or any(int(v) > 65535 for v in version.split(".")):
        raise ValueError("VERSION must contain a three-part numeric Windows version")
    if requested_version is not None and requested_version != version:
        raise ValueError("--version does not match VERSION")
    assembly = sources["src/AssemblyInfo.cs"].decode("utf-8-sig")
    for field in ("AssemblyVersion", "AssemblyFileVersion"):
        if not re.search(field + r'\("' + re.escape(version + ".0") + r'"\)', assembly):
            raise ValueError("Source assembly version does not match VERSION")
    executable = Path(executable)
    if not executable.is_file() or executable.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("Executable not found or too large; run build.ps1 or supply --executable")
    blob = executable.read_bytes()
    validate_executable(blob, version)
    for name, data in sources.items():
        scan_blob(name, data, usernames)
    scan_blob("NUT-Studio.exe", blob, usernames)
    portable_members = {
        "NUT-Studio/NUT-Studio.exe": blob,
        "NUT-Studio/README.md": sources["docs/QUICKSTART.md"],
        "NUT-Studio/LICENSE": sources["LICENSE"],
        "NUT-Studio/THIRD-PARTY-NOTICES.md": sources["docs/THIRD-PARTY-NOTICES.md"],
    }
    assets = {
        f"NUT-Studio-Win11-v{version}.zip": create_archive(portable_members),
        f"NUT-Studio-v{version}.exe": blob,
        f"NUT-Studio-Source-v{version}.zip": create_archive({f"NUT-Studio/{name}": data for name, data in sources.items()}),
    }
    for name, data in assets.items():
        scan_blob(name, data, usernames)
    assets["SHA256SUMS.txt"] = ("\n".join(
        hashlib.sha256(data).hexdigest() + "  " + name
        for name, data in sorted(assets.items())) + "\n").encode("ascii")
    return assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", help="Must match VERSION.")
    parser.add_argument("--executable", type=Path, default=ROOT / "dist" / "NUT-Studio.exe")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    try:
        names = {Path.home().name, os.environ.get("USERNAME", "")}
        assets = build_assets(ROOT, args.executable, args.version, names)
        output = args.output_dir.resolve()
        output.mkdir(parents=True, exist_ok=True)
        for name, data in assets.items():
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=output, prefix=".release-", delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(data)
                temporary.replace(output / name)
            finally:
                if temporary is not None and temporary.exists():
                    temporary.unlink()
            print(f"{name}: {len(data)} bytes")
        print("Verified source allowlist, x64 version, archive contents and recursive privacy scan; no user data included")
    except (OSError, ValueError, UnicodeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()

