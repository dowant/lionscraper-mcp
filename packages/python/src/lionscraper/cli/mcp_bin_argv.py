from __future__ import annotations


def is_thin_mcp_stdio_argv(argv: list[str]) -> bool:
    return len(argv) == 0
