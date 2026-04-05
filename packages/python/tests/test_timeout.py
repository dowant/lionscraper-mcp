from lionscraper.bridge.timeout import (
    DEFAULT_PER_TASK_TIMEOUT_MS,
    MAX_BRIDGE_TIMEOUT_MS,
    count_urls,
    params_for_extension,
    resolve_bridge_timeout_ms,
)


def test_count_urls_array() -> None:
    assert count_urls(["a", "b"]) == 2


def test_count_urls_scalar() -> None:
    assert count_urls("https://x.com") == 1


def test_resolve_default_single_url() -> None:
    assert resolve_bridge_timeout_ms({"url": "https://a.com"}) == DEFAULT_PER_TASK_TIMEOUT_MS


def test_resolve_scales_url_count() -> None:
    assert resolve_bridge_timeout_ms({"url": ["a", "b", "c"], "timeoutMs": 10_000}) == 30_000


def test_resolve_max_pages() -> None:
    assert (
        resolve_bridge_timeout_ms({"url": "https://list.example", "maxPages": 10, "timeoutMs": 60_000}) == 600_000
    )


def test_resolve_urls_and_max_pages() -> None:
    assert (
        resolve_bridge_timeout_ms({"url": ["https://a.com", "https://b.com"], "maxPages": 3, "timeoutMs": 10_000})
        == 60_000
    )


def test_resolve_scrape_interval_stagger() -> None:
    assert (
        resolve_bridge_timeout_ms(
            {
                "url": ["a", "b"],
                "timeoutMs": 60_000,
                "scrapeInterval": 5_000,
            }
        )
        == 125_000
    )


def test_resolve_explicit_bridge_timeout() -> None:
    assert (
        resolve_bridge_timeout_ms(
            {
                "url": ["a", "b", "c"],
                "bridgeTimeoutMs": 999_000,
                "timeoutMs": 10_000,
            }
        )
        == 999_000
    )


def test_resolve_caps_explicit_bridge() -> None:
    assert (
        resolve_bridge_timeout_ms({"url": "x", "bridgeTimeoutMs": MAX_BRIDGE_TIMEOUT_MS + 1_000_000})
        == MAX_BRIDGE_TIMEOUT_MS
    )


def test_resolve_caps_derived() -> None:
    urls = [f"https://e.com/{i}" for i in range(100)]
    assert resolve_bridge_timeout_ms({"url": urls, "timeoutMs": 120_000}) == MAX_BRIDGE_TIMEOUT_MS


def test_params_for_extension_strips_bridge_timeout() -> None:
    p = params_for_extension({"url": "x", "bridgeTimeoutMs": 99_000, "timeoutMs": 5_000})
    assert "bridgeTimeoutMs" not in p
    assert p.get("timeoutMs") == 5_000
