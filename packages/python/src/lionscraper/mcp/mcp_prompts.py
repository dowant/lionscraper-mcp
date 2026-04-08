from __future__ import annotations

import mcp.types as types
from mcp.shared.exceptions import McpError
from mcp.types import INVALID_PARAMS, ErrorData

from lionscraper.i18n.lang import SupportedLang, interpolate, mcp_context_bundle


def _fill(template: str, vars: dict[str, str]) -> str:
    return interpolate(template, vars)


def _lang_hint_fragment(locale: SupportedLang, lang: str | None) -> str:
    if lang == "zh-CN":
        return "（可传 `lang: \"zh-CN\"`）" if locale == "zh-CN" else ' (pass `lang: "zh-CN"` for Chinese errors)'
    if lang == "en-US":
        return "（可传 `lang: \"en-US\"`）" if locale == "zh-CN" else ' (pass `lang: "en-US"`)'
    return ""


def thin_mcp_list_prompts(locale: SupportedLang) -> list[types.Prompt]:
    c = mcp_context_bundle(locale)
    lang_arg = types.PromptArgument(
        name="lang",
        description='Error message language for subsequent tool calls ("en-US" or "zh-CN")',
        required=False,
    )
    url_arg = types.PromptArgument(
        name="url",
        description="Target page URL",
        required=False,
    )
    return [
        types.Prompt(
            name="ping_then_scrape",
            title=c["promptPingThenScrapeTitle"],
            description=c["promptPingThenScrapeDescription"],
            arguments=[lang_arg],
        ),
        types.Prompt(
            name="scrape_article",
            title=c["promptScrapeArticleTitle"],
            description=c["promptScrapeArticleDescription"],
            arguments=[url_arg, lang_arg],
        ),
        types.Prompt(
            name="multi_url_scrape",
            title=c["promptMultiUrlTitle"],
            description=c["promptMultiUrlDescription"],
            arguments=[lang_arg],
        ),
        types.Prompt(
            name="troubleshoot_extension",
            title=c["promptTroubleshootTitle"],
            description=c["promptTroubleshootDescription"],
        ),
        types.Prompt(
            name="prefer_lionscraper_scraping",
            title=c["promptPreferLionscraperTitle"],
            description=c["promptPreferLionscraperDescription"],
            arguments=[lang_arg],
        ),
    ]


def thin_mcp_get_prompt(
    locale: SupportedLang,
    name: str,
    arguments: dict[str, str] | None,
) -> types.GetPromptResult:
    c = mcp_context_bundle(locale)
    args = arguments or {}

    def user_text(text: str) -> types.GetPromptResult:
        return types.GetPromptResult(
            messages=[
                types.PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text=text),
                )
            ]
        )

    if name == "ping_then_scrape":
        lang = args.get("lang")
        return user_text(
            _fill(
                c["promptPingThenScrapeUser"],
                {"langHint": _lang_hint_fragment(locale, lang)},
            )
        )
    if name == "scrape_article":
        lang = args.get("lang")
        url = args.get("url")
        url_line = ""
        if url:
            url_line = f"\n目标 URL：**{url}**\n" if locale == "zh-CN" else f"\nTarget URL: **{url}**\n"
        return user_text(
            _fill(
                c["promptScrapeArticleUser"],
                {"urlLine": url_line, "langHint": _lang_hint_fragment(locale, lang)},
            )
        )
    if name == "multi_url_scrape":
        lang = args.get("lang")
        return user_text(_fill(c["promptMultiUrlUser"], {"langHint": _lang_hint_fragment(locale, lang)}))
    if name == "troubleshoot_extension":
        return user_text(c["promptTroubleshootUser"])
    if name == "prefer_lionscraper_scraping":
        lang = args.get("lang")
        return user_text(
            _fill(
                c["promptPreferLionscraperUser"],
                {"langHint": _lang_hint_fragment(locale, lang)},
            )
        )
    raise McpError(ErrorData(code=INVALID_PARAMS, message=f"Unknown prompt: {name}"))
