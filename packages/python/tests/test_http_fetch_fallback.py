"""Light tests for HTTP fetch fallback helpers (no network)."""

from lionscraper.core import http_fetch_fallback as hfb


def test_extract_emails_dedupes() -> None:
    html = "<p>a@b.com and a@b.com</p>"
    assert hfb._extract_emails(html) == ["a@b.com"]


def test_strip_tags_removes_script() -> None:
    html = "<script>x</script><p>Hi</p>"
    assert hfb._strip_tags(html) == "Hi"
