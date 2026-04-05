from __future__ import annotations

from pydantic import AnyUrl

import mcp.types as types

from lionscraper.i18n.lang import SupportedLang, mcp_context_bundle

MCP_RESOURCE_URIS = {
    "connection": "lionscraper://guide/connection",
    "when_to_use_tools": "lionscraper://guide/when-to-use-tools",
    "cli": "lionscraper://guide/cli",
    "tools": "lionscraper://reference/tools",
    "common_params": "lionscraper://reference/common-params",
}


def get_thin_mcp_server_instructions(locale: SupportedLang) -> str:
    return str(mcp_context_bundle(locale)["serverInstructions"])


def build_thin_mcp_resources(
    locale: SupportedLang,
) -> tuple[list[types.Resource], dict[str, str]]:
    c = mcp_context_bundle(locale)
    rows: list[tuple[str, str, str, str]] = [
        ("guide_connection", MCP_RESOURCE_URIS["connection"], c["resourceConnectionTitle"], c["resourceConnectionBody"]),
        (
            "guide_when_to_use_tools",
            MCP_RESOURCE_URIS["when_to_use_tools"],
            c["resourceWhenToUseToolsTitle"],
            c["resourceWhenToUseToolsBody"],
        ),
        ("guide_cli", MCP_RESOURCE_URIS["cli"], c["resourceCliTitle"], c["resourceCliBody"]),
        ("reference_tools", MCP_RESOURCE_URIS["tools"], c["resourceToolsTitle"], c["resourceToolsBody"]),
        (
            "reference_common_params",
            MCP_RESOURCE_URIS["common_params"],
            c["resourceCommonParamsTitle"],
            c["resourceCommonParamsBody"],
        ),
    ]
    resources: list[types.Resource] = []
    bodies: dict[str, str] = {}
    for name, uri, title, body in rows:
        resources.append(
            types.Resource(
                name=name,
                title=title,
                uri=AnyUrl(uri),
                description=title,
                mimeType="text/markdown",
            )
        )
        bodies[uri] = body
    return resources, bodies
