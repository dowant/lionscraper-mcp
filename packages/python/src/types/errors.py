from __future__ import annotations

from enum import Enum
from typing import Any, Literal, TypedDict

from lionscraper.constants.extension_store import EXTENSION_STORE_URL_CHROME, EXTENSION_STORE_URL_EDGE
from lionscraper.i18n.lang import SupportedLang, t


class BridgeErrorCode(str, Enum):
    BRIDGE_VERSION_MISMATCH = "BRIDGE_VERSION_MISMATCH"
    BRIDGE_DISCONNECTED = "BRIDGE_DISCONNECTED"
    BRIDGE_TIMEOUT = "BRIDGE_TIMEOUT"
    BRIDGE_NOT_CONNECTED = "BRIDGE_NOT_CONNECTED"
    EXTENSION_NOT_CONNECTED = "EXTENSION_NOT_CONNECTED"
    BROWSER_NOT_INSTALLED = "BROWSER_NOT_INSTALLED"
    SERVER_DRAINING = "SERVER_DRAINING"


class PageErrorCode(str, Enum):
    PAGE_LOAD_TIMEOUT = "PAGE_LOAD_TIMEOUT"
    PAGE_LOAD_FAILED = "PAGE_LOAD_FAILED"
    PAGE_NOT_ACCESSIBLE = "PAGE_NOT_ACCESSIBLE"
    PAGE_HTTP_ERROR = "PAGE_HTTP_ERROR"


class ExtractErrorCode(str, Enum):
    EXTRACT_NO_DATA = "EXTRACT_NO_DATA"
    EXTRACT_FAILED = "EXTRACT_FAILED"
    CONTENT_SCRIPT_INJECT_FAILED = "CONTENT_SCRIPT_INJECT_FAILED"
    CONTENT_SCRIPT_TIMEOUT = "CONTENT_SCRIPT_TIMEOUT"


class SystemErrorCode(str, Enum):
    TAB_CREATE_FAILED = "TAB_CREATE_FAILED"
    EXTENSION_INTERNAL_ERROR = "EXTENSION_INTERNAL_ERROR"
    QUEUE_FULL = "QUEUE_FULL"
    SW_RESTARTED = "SW_RESTARTED"


class ConfigErrorCode(str, Enum):
    INVALID_URL = "INVALID_URL"
    INVALID_PARAMS = "INVALID_PARAMS"
    TEMPLATE_NOT_FOUND = "TEMPLATE_NOT_FOUND"
    TEMPLATE_AMBIGUOUS = "TEMPLATE_AMBIGUOUS"


class ClientErrorCode(str, Enum):
    DAEMON_UNREACHABLE = "DAEMON_UNREACHABLE"
    DAEMON_INVALID_RESPONSE = "DAEMON_INVALID_RESPONSE"


class LionScraperError(Exception):
    __slots__ = ("code", "message", "details")

    def __init__(self, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


def is_lion_scraper_error(err: Any) -> bool:
    return isinstance(err, LionScraperError)


def create_error(code: BridgeErrorCode | str, message: str, details: Any = None) -> LionScraperError:
    c = code.value if isinstance(code, Enum) else code
    return LionScraperError(c, message, details)


class ExtensionNotConnectedContext(TypedDict, total=False):
    bridgePort: int
    sessionCount: int


class ExtensionStoreLaunchInfo(TypedDict):
    browser: Literal["chrome", "edge"]
    url: str


class ExtensionNotConnectedOptions(TypedDict, total=False):
    browserProbe: dict[str, Any]
    extensionStoreLaunch: ExtensionStoreLaunchInfo | None


def create_extension_not_connected_error(
    context: ExtensionNotConnectedContext | None,
    lang: SupportedLang,
    options: ExtensionNotConnectedOptions | None = None,
) -> LionScraperError:
    troubleshooting = [
        t(lang, "extension_not_connected.troubleshoot.1"),
        t(lang, "extension_not_connected.troubleshoot.2"),
        t(lang, "extension_not_connected.troubleshoot.3"),
        t(lang, "extension_not_connected.troubleshoot.4"),
        *(
            [t(lang, "extension_not_connected.troubleshoot.5", {"port": context["bridgePort"]})]
            if context is not None
            else []
        ),
    ]

    details: dict[str, Any] = {
        "install": {
            "chrome": EXTENSION_STORE_URL_CHROME,
            "edge": EXTENSION_STORE_URL_EDGE,
        },
        "troubleshooting": troubleshooting,
    }

    if context is not None:
        bp = int(context.get("bridgePort", 0))
        sc = int(context.get("sessionCount", 0))
        details["bridge"] = {
            "wsUrl": f"ws://127.0.0.1:{bp}",
            "listeningPort": bp,
            "registeredSessionCount": sc,
        }
        hint = t(lang, "extension_not_connected.hint")
        if bp > 0:
            details["daemonReachable"] = True

        launch = options.get("extensionStoreLaunch") if options else None
        if launch:
            details["extensionStoreOpened"] = True
            details["extensionStoreBrowser"] = launch["browser"]
            details["extensionStoreUrl"] = launch["url"]
            browser_label = "Chrome" if launch["browser"] == "chrome" else "Microsoft Edge"
            hint = f"{hint} {t(lang, 'extension_not_connected.store_opened_hint', {'browser': browser_label})}"
        details["hint"] = hint
    elif options is not None and options.get("extensionStoreLaunch") is not None:
        launch = options["extensionStoreLaunch"]
        details["extensionStoreOpened"] = True
        details["extensionStoreBrowser"] = launch["browser"]
        details["extensionStoreUrl"] = launch["url"]

    if options and options.get("browserProbe") is not None:
        details["browserProbe"] = options["browserProbe"]

    return create_error(
        BridgeErrorCode.EXTENSION_NOT_CONNECTED,
        t(lang, "extension_not_connected.message"),
        details,
    )


def create_browser_not_installed_error(lang: SupportedLang) -> LionScraperError:
    return create_error(
        BridgeErrorCode.BROWSER_NOT_INSTALLED,
        t(lang, "browser_not_installed.message"),
        {
            "install": {
                "chrome": "https://www.google.com/chrome/",
                "edge": "https://www.microsoft.com/edge",
            },
            "extension": {
                "chrome": EXTENSION_STORE_URL_CHROME,
                "edge": EXTENSION_STORE_URL_EDGE,
            },
            "hint": t(lang, "browser_not_installed.hint"),
        },
    )
