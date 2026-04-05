from __future__ import annotations

from typing import Any, Literal, TypedDict

PROTOCOL_VERSION = 1

BRIDGE_PROGRESS_METHOD = "bridgeProgress"

BridgeMethod = Literal[
    "probe",
    "register",
    "ping",
    "pong",
    "scrape",
    "scrape_article",
    "scrape_emails",
    "scrape_phones",
    "scrape_urls",
    "scrape_images",
]


class BridgeJsonRpcError(TypedDict, total=False):
    code: int
    message: str
    data: dict[str, Any]


class BridgeRequest(TypedDict, total=False):
    jsonrpc: str
    id: str
    method: str
    params: dict[str, Any]


class BridgeResponse(TypedDict, total=False):
    jsonrpc: str
    id: str
    result: Any
    error: BridgeJsonRpcError


class RegisterParams(TypedDict, total=False):
    protocolVersion: int
    browser: str
    extensionVersion: str
    deviceId: str
    capabilities: list[str]


class BridgeProgressParams(TypedDict, total=False):
    requestId: str
    phase: str
    message: str
    progress: float
    total: float
    data: dict[str, Any]


class BridgeProgressNotification(TypedDict, total=False):
    jsonrpc: str
    method: str
    params: BridgeProgressParams


def is_bridge_response(msg: Any) -> bool:
    if msg is None or not isinstance(msg, dict):
        return False
    m = msg
    if m.get("jsonrpc") != "2.0":
        return False
    if not isinstance(m.get("id"), str):
        return False
    if isinstance(m.get("method"), str):
        return False
    return m.get("result") is not None or m.get("error") is not None


def is_extension_bridge_request(msg: Any) -> bool:
    if msg is None or not isinstance(msg, dict):
        return False
    m = msg
    if m.get("jsonrpc") != "2.0":
        return False
    if not isinstance(m.get("id"), str):
        return False
    return isinstance(m.get("method"), str)


def is_bridge_progress_notification(msg: Any) -> bool:
    if msg is None or not isinstance(msg, dict):
        return False
    m = msg
    if m.get("jsonrpc") != "2.0":
        return False
    if m.get("method") != BRIDGE_PROGRESS_METHOD:
        return False
    if m.get("id") is not None:
        return False
    return True
