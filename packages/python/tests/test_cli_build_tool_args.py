from lionscraper.cli.build_tool_args import (
    build_invocation_from_argv,
    parse_api_url,
    parse_output_flags,
    validate_cli_numeric_tool_args,
)


def test_build_invocation_scrape_single_url() -> None:
    r = build_invocation_from_argv(["--url", "https://a.com"], "scrape")
    assert r["name"] == "scrape"
    assert r["arguments"] == {"url": "https://a.com"}


def test_build_invocation_multiple_url() -> None:
    r = build_invocation_from_argv(["-u", "https://a.com", "--url", "https://b.com"], "scrape")
    assert r["name"] == "scrape"
    assert r["arguments"]["url"] == ["https://a.com", "https://b.com"]


def test_build_invocation_method_article() -> None:
    r = build_invocation_from_argv(["--method", "article", "-u", "https://x.com"], "scrape")
    assert r["name"] == "scrape_article"


def test_build_invocation_ping() -> None:
    r = build_invocation_from_argv(["--lang", "zh-CN"], "ping")
    assert r["name"] == "ping"
    assert r["arguments"] == {"lang": "zh-CN"}


def test_build_invocation_wait_and_filter() -> None:
    r = build_invocation_from_argv(
        [
            "-u",
            "https://x.com",
            "--wait-scroll-speed",
            "80",
            "--scroll-container",
            "#main",
            "--email-domain",
            "ex.com",
            "--email-limit",
            "10",
        ],
        "scrape",
    )
    assert r["arguments"]["url"] == "https://x.com"
    assert r["arguments"]["waitForScroll"] == {"scrollSpeed": 80, "scrollContainerSelector": "#main"}
    assert r["arguments"]["filter"] == {"domain": "ex.com", "limit": 10}


def test_parse_output_flags_defaults() -> None:
    assert parse_output_flags([]) == {"format": "json", "raw": False, "outputPath": None}


def test_parse_output_flags_pretty() -> None:
    assert parse_output_flags(["--format", "pretty", "-o", "out.json"]) == {
        "format": "pretty",
        "raw": False,
        "outputPath": "out.json",
    }


def test_parse_api_url() -> None:
    assert parse_api_url(["--api-url", "http://127.0.0.1:9999"]) == "http://127.0.0.1:9999"


def test_validate_cli_numeric_delay_non_finite() -> None:
    r = build_invocation_from_argv(["--url", "https://a.com", "--delay", "nan"], "scrape")
    err = validate_cli_numeric_tool_args(r["arguments"])
    assert err is not None
    assert "delay" in err.lower()


def test_validate_cli_numeric_ok() -> None:
    r = build_invocation_from_argv(["--url", "https://a.com", "--delay", "500"], "scrape")
    assert validate_cli_numeric_tool_args(r["arguments"]) is None
