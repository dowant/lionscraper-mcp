import pytest

from lionscraper.bridge.protocol import PendingRequestManager


@pytest.mark.asyncio
async def test_pending_progress_until_resolve() -> None:
    mgr = PendingRequestManager()
    prog_calls: list[dict] = []

    def on_progress(p: dict) -> None:
        prog_calls.append(p)

    fut = mgr.begin_request("req-1", "scrape", 60_000, "en-US", on_progress)
    assert mgr.dispatch_progress("req-1", {"requestId": "req-1", "phase": "auto_identify"}) is True
    assert len(prog_calls) == 1
    mgr.resolve("req-1", {"ok": True})
    assert await fut == {"ok": True}
    assert mgr.dispatch_progress("req-1", {"requestId": "req-1"}) is False


def test_dispatch_progress_no_match() -> None:
    mgr = PendingRequestManager()
    assert mgr.dispatch_progress("missing", {"requestId": "missing"}) is False


@pytest.mark.asyncio
async def test_pending_progress_only_then_resolve() -> None:
    mgr = PendingRequestManager()
    prog_calls: list[dict] = []

    def on_progress(p: dict) -> None:
        prog_calls.append(p)

    fut = mgr.begin_request("r2", "scrape", 60_000, "en-US", on_progress)
    mgr.dispatch_progress("r2", {"requestId": "r2", "progress": 1, "total": 3})
    assert prog_calls and prog_calls[0].get("progress") == 1 and prog_calls[0].get("total") == 3
    mgr.resolve("r2", 42)
    assert await fut == 42
