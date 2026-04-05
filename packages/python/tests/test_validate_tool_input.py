from lionscraper.mcp.validate_tool_input import validate_tool_input


def test_validate_ping_empty() -> None:
    assert validate_tool_input("ping", {}, "en-US") is None


def test_validate_scrape_requires_url() -> None:
    msg = validate_tool_input("scrape", {}, "en-US")
    assert msg
    assert "url" in msg.lower()


def test_validate_delay_type() -> None:
    msg = validate_tool_input("scrape", {"url": "https://a.com", "delay": "x"}, "en-US")  # type: ignore[arg-type]
    assert msg
