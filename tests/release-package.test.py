"""Release policy tests. Fixtures are synthetic and never launch the application."""
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo
import hashlib
import importlib.util
import struct
import sys
import unittest
from unittest import mock
import warnings

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("release_package", Path(__file__).resolve().parents[1] / "scripts" / "package.py")
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)


def pe_fixture(version=(1, 1, 5, 0)):
    blob = bytearray(1024)
    blob[:2] = b"MZ"
    struct.pack_into("<I", blob, 60, 128)
    blob[128:132] = b"PE\0\0"
    struct.pack_into("<HH", blob, 132, 0x8664, 1)
    struct.pack_into("<H", blob, 148, 240)
    struct.pack_into("<H", blob, 152, 0x20b)
    struct.pack_into("<II", blob, 392 + 16, 512, 512)
    struct.pack_into("<IIII", blob, 600, 0xfeef04bd, 0x10000,
                     version[0] << 16 | version[1], version[2] << 16 | version[3])
    return bytes(blob)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[1] / "artifacts"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = TemporaryDirectory(prefix="nut-release-test-", dir=scratch)
        self.root = Path(self.temp.name)
        self.assertTrue(self.root.resolve().is_relative_to(scratch.resolve()))
        self.addCleanup(self.temp.cleanup)
        self.files = {
            "VERSION": b"1.1.5\n", "LICENSE": b"MIT fixture\n",
            "docs/THIRD-PARTY-NOTICES.md": b"Third party fixture\n",
            "docs/QUICKSTART.md": b"Quickstart fixture\n",
            "scripts/package.py": b"# synthetic fixture\n",
            "src/AssemblyInfo.cs": b'[assembly: AssemblyVersion("1.1.5.0")]\n[assembly: AssemblyFileVersion("1.1.5.0")]\n',
            "ui/app.js": b"// synthetic UI fixture\n",
        }
        for name, data in self.files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.manifest = self.root / "scripts" / "source-files.txt"
        self.write_manifest()
        self.executable = self.root / "fixture.exe"
        self.executable.write_bytes(pe_fixture())

    def write_manifest(self, extra=()):
        names = sorted([*self.files, "scripts/source-files.txt", *extra])
        self.manifest.write_text("\n".join(names) + "\n", encoding="utf-8")

    def test_deterministic_assets_preserve_layout_licenses_and_executable(self):
        # Private files may exist beside source; the explicit list excludes them.
        private = self.root / "data" / "backups"
        private.mkdir(parents=True)
        (private / "personal.json").write_bytes(b"private backup fixture")
        first = P.build_assets(self.root, self.executable)
        self.assertEqual(first, P.build_assets(self.root, self.executable))
        self.assertEqual(set(first), {"NUT-Studio-Win11-v1.1.5.zip", "NUT-Studio-v1.1.5.exe",
                                      "NUT-Studio-Source-v1.1.5.zip", "SHA256SUMS.txt"})
        self.assertEqual(first["NUT-Studio-v1.1.5.exe"], pe_fixture())
        with ZipFile(BytesIO(first["NUT-Studio-Win11-v1.1.5.zip"])) as archive:
            self.assertEqual(set(archive.namelist()), {"NUT-Studio/NUT-Studio.exe", "NUT-Studio/README.md",
                                                      "NUT-Studio/LICENSE", "NUT-Studio/THIRD-PARTY-NOTICES.md"})
            self.assertEqual(archive.read("NUT-Studio/NUT-Studio.exe"), pe_fixture())
            self.assertTrue(all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in archive.infolist()))
        with ZipFile(BytesIO(first["NUT-Studio-Source-v1.1.5.zip"])) as archive:
            expected = {f"NUT-Studio/{name}" for name in [*self.files, "scripts/source-files.txt"]}
            self.assertEqual(set(archive.namelist()), expected)
            self.assertEqual(archive.read("NUT-Studio/LICENSE"), self.files["LICENSE"])
        for line in first["SHA256SUMS.txt"].decode().splitlines():
            digest, name = line.split("  ")
            self.assertEqual(digest, hashlib.sha256(first[name]).hexdigest())
        self.assertEqual((private / "personal.json").read_bytes(), b"private backup fixture")

    def test_wrong_versions_and_malformed_executables_fail(self):
        with self.assertRaisesRegex(ValueError, "--version"):
            P.build_assets(self.root, self.executable, "1.1.4")
        with self.assertRaisesRegex(ValueError, "Executable version"):
            P.validate_executable(pe_fixture((1, 1, 4, 0)), "1.1.5")
        for blob in [b"", b"MZ" + bytes(150), pe_fixture()[:500]]:
            with self.subTest(size=len(blob)), self.assertRaises(ValueError):
                P.validate_executable(blob, "1.1.5")
        invalid = bytearray(pe_fixture())
        struct.pack_into("<H", invalid, 132, 0x14c)
        with self.assertRaisesRegex(ValueError, "x64"):
            P.validate_executable(invalid, "1.1.5")
        invalid = bytearray(pe_fixture())
        struct.pack_into("<I", invalid, 392 + 20, 5000)
        with self.assertRaisesRegex(ValueError, "section bounds"):
            P.validate_executable(invalid, "1.1.5")
        (self.root / "src/AssemblyInfo.cs").write_bytes(self.files["src/AssemblyInfo.cs"].replace(b"1.1.5", b"1.1.4"))
        with self.assertRaisesRegex(ValueError, "Source assembly version"):
            P.build_assets(self.root, self.executable)

    def test_invalid_version_numbers_and_missing_executable_fail(self):
        for version in ["1.2", "01.1.5", "65536.1.5", "1.1.5-extra"]:
            (self.root / "VERSION").write_text(version)
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "VERSION"):
                P.build_assets(self.root, self.executable)
        (self.root / "VERSION").write_bytes(self.files["VERSION"])
        self.executable.unlink()
        with self.assertRaisesRegex(ValueError, "Executable not found"):
            P.build_assets(self.root, self.executable)

    def test_allowlist_is_required_and_missing_files_never_silently_disappear(self):
        self.manifest.unlink()
        with self.assertRaisesRegex(ValueError, "source list is missing"):
            P.load_source_files(self.root)
        self.write_manifest(["ui/missing.js"])
        with self.assertRaisesRegex(ValueError, "Required source file missing"):
            P.load_source_files(self.root)
        self.manifest.write_text("VERSION\n")
        with self.assertRaisesRegex(ValueError, "omits required"):
            P.load_source_files(self.root)

    def test_member_policy_rejects_traversal_private_data_logs_and_credentials(self):
        names = ["../escape.txt", "/absolute.txt", "folder/./file", "folder//file", "folder\\file",
                 "X:/file", "data/backups/profile.json", ".publish-tools/helper.py", ".git/config",
                 "artifacts/test.exe", "dist/test.exe", "ui/session.json", "debug.log", ".env",
                 "id_rsa", "private.pem", "keys/signing.pfx", "backups/saved.json", "data./file", "file?name"]
        for name in names:
            with self.subTest(name=name), self.assertRaises(ValueError):
                P.create_archive({name: b"fixture"})
        self.write_manifest(["data/backups/profile.json"])
        with self.assertRaisesRegex(ValueError, "forbidden"):
            P.load_source_files(self.root)

    def test_duplicate_manifest_and_archive_names_are_rejected(self):
        self.write_manifest(["VERSION"])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            P.load_source_files(self.root)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            P.create_archive({"LICENSE": b"a", "license": b"b"})

    def test_paths_with_both_slashes_and_binary_string_encodings_are_rejected(self):
        for separator in ["/", "\\"]:
            path = chr(67) + ":" + separator + "Users" + separator + "SyntheticPerson" + separator + "private.txt"
            for encoding in ["utf-8", "utf-16-le", "utf-16-be"]:
                for prefix in [b"", b"\0"]:
                    with self.subTest(separator=separator, encoding=encoding, prefix=prefix), self.assertRaisesRegex(ValueError, "personal Windows path") as error:
                        P.scan_blob("fixture.bin", prefix + path.encode(encoding))
                    self.assertNotIn("SyntheticPerson", str(error.exception))
        with self.assertRaisesRegex(ValueError, "local username"):
            P.scan_blob("fixture.txt", b"Created by SyntheticLocalName", ["SyntheticLocalName"])

    def test_email_token_private_key_and_unique_device_paths_are_rejected(self):
        samples = [
            ("email address", "private" + "@" + "mailhost.example"),
            ("assigned secret", "token=" + "a" * 64),
            ("assigned credential", 'password="' + 'synthetic123' + '"'),
            ("credential token", "ghp_" + "a" * 30),
            ("private key", "-----" + "BEGIN PRIVATE KEY" + "-----"),
            ("unique HID path", "hid#" + "vid_342d&pid_e545#" + "unique-device-instance"),
            ("session URL token", "http://127.0.0.1:43210/" + "b" * 64 + "/"),
        ]
        for category, value in samples:
            with self.subTest(category=category), self.assertRaisesRegex(ValueError, category) as error:
                P.scan_blob("fixture.txt", value.encode())
            self.assertNotIn(value, str(error.exception))

    def test_documented_email_placeholders_and_protocol_identifiers_remain_allowed(self):
        P.scan_blob("docs/example.md", ("person" + "@" + "example.com").encode())
        P.scan_blob("docs/PUBLISH.md", ("publishOwner" + "@" + "users.noreply.github.com").encode())
        P.scan_blob("source.js", b"X-Nut-Token: TOKEN; VID 342D PID E545; __NUT_TOKEN__")
        with self.assertRaisesRegex(ValueError, "email address"):
            P.scan_blob("source.js", ("person" + "@" + "example.com").encode())

    def test_recursive_archive_privacy_and_unsafe_members_fail(self):
        path = chr(67) + ":/" + "Users/" + "SyntheticPerson/private.txt"
        archive = P.create_archive({"safe/fixture.txt": path.encode("utf-16-le")})
        with self.assertRaisesRegex(ValueError, "personal Windows path"):
            P.scan_blob("outer.zip", P.create_archive({"inner.zip": archive}))
        for name in ["../escape", "data/private.json", "folder/"]:
            buffer = BytesIO()
            with ZipFile(buffer, "w") as raw:
                raw.writestr(name, b"fixture")
            with self.subTest(name=name), self.assertRaises(ValueError):
                P.scan_blob("raw.zip", buffer.getvalue())
        buffer = BytesIO()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with ZipFile(buffer, "w") as raw:
                raw.writestr("same.txt", b"a")
                raw.writestr("same.txt", b"b")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            P.scan_blob("raw.zip", buffer.getvalue())
        with self.assertRaisesRegex(ValueError, "Invalid public ZIP"):
            P.scan_blob("broken.zip", b"invalid")
        buffer = BytesIO()
        with ZipFile(buffer, "w") as raw:
            link = ZipInfo("link.txt")
            link.create_system = 3
            link.external_attr = 0o120777 << 16
            raw.writestr(link, "../outside")
        with self.assertRaisesRegex(ValueError, "unexpected"):
            P.scan_blob("links.zip", buffer.getvalue())

    def test_archive_limits_block_excessive_expansion_and_nesting(self):
        archive = P.create_archive({"fixture.txt": bytes(1024)})
        with mock.patch.object(P, "MAX_FILE_BYTES", 512), self.assertRaisesRegex(ValueError, "archive size"):
            P.scan_blob("fixture.zip", archive)
        for _ in range(3):
            archive = P.create_archive({"nested.zip": archive})
        with self.assertRaisesRegex(ValueError, "nesting"):
            P.scan_blob("fixture.zip", archive)

    def test_sensitive_source_and_executable_stop_asset_creation(self):
        secret = ("token=" + "b" * 64).encode()
        (self.root / "ui/app.js").write_bytes(secret)
        with self.assertRaisesRegex(ValueError, "Privacy scan rejected ui/app.js"):
            P.build_assets(self.root, self.executable)
        (self.root / "ui/app.js").write_bytes(self.files["ui/app.js"])
        self.executable.write_bytes(pe_fixture() + secret)
        with self.assertRaisesRegex(ValueError, "Privacy scan rejected NUT-Studio.exe"):
            P.build_assets(self.root, self.executable)


if __name__ == "__main__":
    unittest.main(verbosity=2)
