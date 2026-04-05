try:
    from importlib.metadata import version

    PACKAGE_VERSION = version("lionscraper")
except Exception:  # pragma: no cover
    PACKAGE_VERSION = "1.0.2"
