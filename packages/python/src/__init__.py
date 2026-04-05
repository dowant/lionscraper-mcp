try:
    from importlib.metadata import version

    __version__ = version("lionscraper")
except Exception:  # pragma: no cover
    __version__ = "1.0.2"
