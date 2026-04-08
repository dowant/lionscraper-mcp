from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Literal, Protocol

from lionscraper.constants.extension_store import EXTENSION_STORE_URL_CHROME, EXTENSION_STORE_URL_EDGE

BrowserKind = Literal["chrome", "edge"]


class BrowserEnv(Protocol):
    async def detect_chrome_install(self) -> str | None: ...
    async def detect_edge_install(self) -> str | None: ...
    async def is_browser_running(self, kind: BrowserKind) -> bool: ...
    def launch_browser(self, executable_path: str, kind: BrowserKind) -> int | None: ...
    async def quit_launched_browser(self, pid: int) -> None: ...


def _win_path_var(name: str) -> str | None:
    v = os.environ.get(name)
    return v if v else None


def _win_chrome_candidates() -> list[str]:
    pf = _win_path_var("ProgramFiles")
    pf86 = _win_path_var("ProgramFiles(x86)")
    local = _win_path_var("LocalAppData")
    out: list[str] = []
    tail = r"\Google\Chrome\Application\chrome.exe"
    if pf:
        out.append(pf + tail)
    if pf86:
        out.append(pf86 + tail)
    if local:
        out.append(local + r"\Google\Chrome\Application\chrome.exe")
    return out


def _win_edge_candidates() -> list[str]:
    pf = _win_path_var("ProgramFiles")
    pf86 = _win_path_var("ProgramFiles(x86)")
    tail = r"\Microsoft\Edge\Application\msedge.exe"
    out: list[str] = []
    if pf86:
        out.append(pf86 + tail)
    if pf:
        out.append(pf + tail)
    return out


def _first_existing(paths: list[str]) -> str | None:
    for p in paths:
        if p and Path(p).is_file():
            return p
    return None


async def _win_reg_app_path(exe_name: str) -> str | None:
    keys = [
        rf"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}",
        rf"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}",
    ]
    for key in keys:
        try:
            r = subprocess.run(
                ["reg", "query", key, "/ve"],
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            m = re.search(r"REG_SZ\s+(.+)", r.stdout)
            if m:
                candidate = m.group(1).strip()
                if candidate and Path(candidate).is_file():
                    return candidate
        except Exception:
            pass
    return None


async def _which_first_unix(commands: list[str]) -> str | None:
    for c in commands:
        try:
            r = subprocess.run(
                ["sh", "-c", f'command -v "{c.replace(chr(34), chr(92)+chr(34))}" 2>/dev/null'],
                capture_output=True,
                text=True,
                timeout=10,
            )
            line = (r.stdout.strip().split("\n")[0] or "").strip()
            if line and Path(line).is_file():
                return line
        except Exception:
            pass
    return None


async def detect_chrome_install_impl() -> str | None:
    plat = sys.platform
    if plat == "win32":
        r = await _win_reg_app_path("chrome.exe")
        if r:
            return r
        return _first_existing(_win_chrome_candidates())
    if plat == "darwin":
        return _first_existing(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"])
    return await _which_first_unix(["google-chrome-stable", "google-chrome", "chromium-browser", "chromium"])


async def detect_edge_install_impl() -> str | None:
    plat = sys.platform
    if plat == "win32":
        r = await _win_reg_app_path("msedge.exe")
        if r:
            return r
        return _first_existing(_win_edge_candidates())
    if plat == "darwin":
        return _first_existing(["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"])
    return await _which_first_unix(["microsoft-edge-stable", "microsoft-edge", "msedge"])


async def win_tasklist_has(image_name: str) -> bool:
    try:
        r = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {image_name}", "/NH"],
            capture_output=True,
            text=True,
            timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return image_name.lower() in r.stdout.lower()
    except Exception:
        return False


async def darwin_pgrep_exact(process_name: str) -> bool:
    try:
        r = subprocess.run(
            ["pgrep", "-x", process_name],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return bool(r.stdout.strip())
    except Exception:
        return False


async def linux_pgrep_pattern(pattern: str) -> bool:
    try:
        r = subprocess.run(
            ["pgrep", "-c", pattern],
            capture_output=True,
            text=True,
            timeout=10,
        )
        n = int(r.stdout.strip() or "0")
        return n > 0
    except Exception:
        return False


async def is_browser_running_impl(kind: BrowserKind) -> bool:
    plat = sys.platform
    if plat == "win32":
        return await win_tasklist_has("chrome.exe") if kind == "chrome" else await win_tasklist_has("msedge.exe")
    if plat == "darwin":
        return await darwin_pgrep_exact("Google Chrome") if kind == "chrome" else await darwin_pgrep_exact("Microsoft Edge")
    if kind == "chrome":
        if await linux_pgrep_pattern("chrome"):
            return True
        return await linux_pgrep_pattern("chromium")
    return await linux_pgrep_pattern("msedge") or await linux_pgrep_pattern("microsoft-edge")


def _popen_browser_kwargs() -> dict:
    kwargs: dict = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "stdin": subprocess.DEVNULL}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | getattr(subprocess, "DETACHED_PROCESS", 0)
    return kwargs


def launch_browser_impl(executable_path: str, _kind: BrowserKind) -> int | None:
    try:
        proc = subprocess.Popen([executable_path], **_popen_browser_kwargs())  # noqa: S603
        return proc.pid or None
    except OSError:
        return None


def open_browser_url_impl(executable_path: str, url: str) -> bool:
    try:
        proc = subprocess.Popen([executable_path, url], **_popen_browser_kwargs())  # noqa: S603
        return proc.pid is not None
    except OSError:
        return False


async def try_open_extension_store_install_page(
    browser_env: BrowserEnv,
) -> dict[str, str] | None:
    chrome_path = await browser_env.detect_chrome_install()
    if chrome_path and open_browser_url_impl(chrome_path, EXTENSION_STORE_URL_CHROME):
        return {"browser": "chrome", "url": EXTENSION_STORE_URL_CHROME}
    edge_path = await browser_env.detect_edge_install()
    if edge_path and open_browser_url_impl(edge_path, EXTENSION_STORE_URL_EDGE):
        return {"browser": "edge", "url": EXTENSION_STORE_URL_EDGE}
    return None


async def quit_launched_browser_impl(pid: int) -> None:
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                timeout=30,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except Exception:
            pass
        return
    try:
        os.kill(pid, 15)
    except OSError:
        pass


class _DefaultBrowserEnv:
    detect_chrome_install = staticmethod(detect_chrome_install_impl)
    detect_edge_install = staticmethod(detect_edge_install_impl)
    is_browser_running = staticmethod(is_browser_running_impl)
    launch_browser = staticmethod(launch_browser_impl)
    quit_launched_browser = staticmethod(quit_launched_browser_impl)


default_browser_env: BrowserEnv = _DefaultBrowserEnv()
