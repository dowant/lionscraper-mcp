from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Literal, TypedDict, cast

SupportedLang = Literal["en-US", "zh-CN"]

_LOCALE_DIR = Path(__file__).resolve().parent.parent / "locale"


def _load_bundle(lang: SupportedLang) -> dict[str, Any]:
    path = _LOCALE_DIR / ("zh-CN.json" if lang == "zh-CN" else "en-US.json")
    with path.open(encoding="utf-8") as f:
        return cast(dict[str, Any], json.load(f))


def normalize_lang(raw: Any) -> SupportedLang:
    if raw == "zh-CN":
        return "zh-CN"
    if raw == "en-US":
        return "en-US"
    return "en-US"


def supported_lang_from_lang_env(raw: str | None) -> SupportedLang:
    if raw is None:
        return "en-US"
    s = raw.strip()
    if not s:
        return "en-US"
    lower = s.lower()
    if lower in ("c", "posix"):
        return "en-US"
    if re.match(r"^zh([_.-]|$)", s, re.I):
        return "zh-CN"
    if re.match(r"^en([_.-]|$)", s, re.I):
        return "en-US"
    return "en-US"


def get_tool_metadata_locale() -> SupportedLang:
    return supported_lang_from_lang_env(os.environ.get("LANG"))


def port_lang() -> SupportedLang:
    return supported_lang_from_lang_env(os.environ.get("LANG"))


def interpolate(template: str, vars: dict[str, str | int] | None = None) -> str:
    if not vars:
        return template
    s = template
    for k, v in vars.items():
        s = str(v).join(s.split(f"{{{{{k}}}}}"))
    return s


class _ServerFlat(TypedDict, total=False):
    browser_not_installed_message: str
    browser_not_installed_hint: str
    extension_not_connected_message: str
    extension_not_connected_hint: str
    extension_not_connected_troubleshoot_1: str
    extension_not_connected_troubleshoot_2: str
    extension_not_connected_troubleshoot_3: str
    extension_not_connected_troubleshoot_4: str
    extension_not_connected_troubleshoot_5: str
    server_draining_requests: str
    server_draining_new_tasks: str
    bridge_timeout: str
    disconnect_replaced: str
    disconnect_extension_gone: str
    disconnect_server_shutdown: str
    mcp_tool_response_truncated_after_limit: str
    daemon_unreachable_message: str
    daemon_unreachable_hint: str


def _flatten_server_messages(sm: dict[str, Any]) -> dict[str, str]:
    enc = sm["extensionNotConnected"]["troubleshoot"]
    return {
        "browser_not_installed.message": sm["browserNotInstalled"]["message"],
        "browser_not_installed.hint": sm["browserNotInstalled"]["hint"],
        "extension_not_connected.message": sm["extensionNotConnected"]["message"],
        "extension_not_connected.hint": sm["extensionNotConnected"]["hint"],
        "extension_not_connected.troubleshoot.1": enc["1"],
        "extension_not_connected.troubleshoot.2": enc["2"],
        "extension_not_connected.troubleshoot.3": enc["3"],
        "extension_not_connected.troubleshoot.4": enc["4"],
        "extension_not_connected.troubleshoot.5": enc["5"],
        "server_draining.requests": sm["serverDraining"]["requests"],
        "server_draining.new_tasks": sm["serverDraining"]["new_tasks"],
        "bridge_timeout": sm["bridge"]["timeout"],
        "disconnect.replaced": sm["disconnect"]["replaced"],
        "disconnect.extension_gone": sm["disconnect"]["extension_gone"],
        "disconnect.server_shutdown": sm["disconnect"]["server_shutdown"],
        "mcp_tool.response_truncated_after_limit": sm["mcpTool"]["responseTruncatedAfterLimit"],
        "daemon_unreachable.message": sm["daemonUnreachable"]["message"],
        "daemon_unreachable.hint": sm["daemonUnreachable"]["hint"],
    }


MessageId = str
_by_lang: dict[SupportedLang, dict[str, str]] = {
    "en-US": _flatten_server_messages(_load_bundle("en-US")["serverMessages"]),
    "zh-CN": _flatten_server_messages(_load_bundle("zh-CN")["serverMessages"]),
}

_bundles: dict[SupportedLang, dict[str, Any]] = {
    "en-US": _load_bundle("en-US"),
    "zh-CN": _load_bundle("zh-CN"),
}


def t(lang: SupportedLang, id: str, vars: dict[str, str | int] | None = None) -> str:
    table = _by_lang.get(lang) or _by_lang["en-US"]
    template = table.get(id) or _by_lang["en-US"].get(id) or id
    return interpolate(template, vars)


PortMessageKey = str


def port_t(lang: SupportedLang, key: str, vars: dict[str, str | int] | None = None) -> str:
    bundle = _bundles.get(lang) or _bundles["en-US"]
    template = bundle["port"][key]
    return interpolate(template, vars)


BridgeProtocolKey = str


def bridge_t(lang: SupportedLang, key: str, vars: dict[str, str | int] | None = None) -> str:
    bundle = _bundles.get(lang) or _bundles["en-US"]
    row = bundle["bridgeProtocol"]
    template = row[key]
    return interpolate(template, vars)


LogMessageKey = str


def log_t(lang: SupportedLang, key: str, vars: dict[str, str | int] | None = None) -> str:
    bundle = _bundles.get(lang) or _bundles["en-US"]
    template = bundle["logMessages"][key]
    return interpolate(template, vars)


def tools_bundle(locale: SupportedLang) -> dict[str, Any]:
    b = _bundles.get(locale) or _bundles["en-US"]
    return cast(dict[str, Any], b["tools"])


def mcp_context_bundle(locale: SupportedLang) -> dict[str, Any]:
    b = _bundles.get(locale) or _bundles["en-US"]
    return cast(dict[str, Any], b["mcpContext"])
