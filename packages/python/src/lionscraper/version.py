from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

_FALLBACK = "0.0.0+local"


def _version_from_repo_root() -> str | None:
    # .../packages/python/src/lionscraper/version.py -> parents[2] == packages/python
    root = Path(__file__).resolve().parents[2]
    vf = root / "VERSION"
    if not vf.is_file():
        return None
    text = vf.read_text(encoding="utf-8").strip()
    return text or None


def _resolve_package_version() -> str:
    try:
        return version("lionscraper")
    except PackageNotFoundError:
        pass
    from_file = _version_from_repo_root()
    if from_file is not None:
        return from_file
    return _FALLBACK


PACKAGE_VERSION: str = _resolve_package_version()
