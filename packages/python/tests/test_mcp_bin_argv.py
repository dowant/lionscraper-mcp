from lionscraper.cli.mcp_bin_argv import is_thin_mcp_stdio_argv


def test_is_thin_mcp_stdio_argv() -> None:
    assert is_thin_mcp_stdio_argv([]) is True
    assert is_thin_mcp_stdio_argv(["scrape"]) is False
    assert is_thin_mcp_stdio_argv(["scrape", "-u", "https://x.com"]) is False
