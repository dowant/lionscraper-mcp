import pytest

from lionscraper.utils.port import DEFAULT_PORT, acquire_port, can_bind_port, get_configured_port


@pytest.mark.asyncio
async def test_can_bind_free_port() -> None:
    assert await can_bind_port(45678) is True


@pytest.mark.asyncio
async def test_can_bind_false_when_in_use() -> None:
    import socket

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.listen(1)
    try:
        assert await can_bind_port(port) is False
    finally:
        sock.close()


def test_get_configured_port_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PORT", raising=False)
    assert get_configured_port() == DEFAULT_PORT
    monkeypatch.setenv("PORT", "20000")
    assert get_configured_port() == 20000


@pytest.mark.asyncio
async def test_acquire_port_when_free(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PORT", raising=False)
    port = await acquire_port(45680)
    assert port == 45680
