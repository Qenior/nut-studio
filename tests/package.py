"""Compatibility entry point; release packaging lives in scripts/package.py."""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parent.parent / "scripts" / "package.py"), run_name="__main__")
