from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_package_version_readable_without_distribution_metadata() -> None:
    """Simulate PYTHONPATH-only: no site-packages, so importlib.metadata has no lionscraper wheel."""
    src = Path(__file__).resolve().parents[1] / "src"
    script = (
        "import sys; sys.path.insert(0, sys.argv[1]); "
        "from lionscraper.version import PACKAGE_VERSION; "
        "assert PACKAGE_VERSION; print(PACKAGE_VERSION)"
    )
    r = subprocess.run(
        [sys.executable, "-S", "-c", script, str(src)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert r.returncode == 0, (r.stdout, r.stderr)
    assert r.stdout.strip()
