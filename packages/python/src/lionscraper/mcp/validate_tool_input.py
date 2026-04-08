from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from lionscraper.i18n.lang import SupportedLang
from lionscraper.mcp.tools import build_tool_definitions


def validate_tool_input(name: str, args: dict[str, Any], locale: SupportedLang) -> str | None:
    defs = build_tool_definitions(locale)
    entry = defs.get(name)
    if not entry:
        return "Unknown tool name"
    model = entry["model"]
    try:
        model.model_validate(args)
        return None
    except ValidationError as e:
        parts: list[str] = []
        for err in e.errors():
            loc = err.get("loc") or ()
            path = ".".join(str(x) for x in loc) if loc else "root"
            parts.append(f"{path}: {err.get('msg', 'invalid')}")
        return "; ".join(parts)
