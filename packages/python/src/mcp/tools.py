from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model

from lionscraper.i18n.lang import SupportedLang, tools_bundle

LangEnum = Literal["en-US", "zh-CN"]


def _schema_strings(locale: SupportedLang) -> dict[str, str]:
    return tools_bundle(locale)["schema"]


def _descriptions(locale: SupportedLang) -> dict[str, str]:
    return tools_bundle(locale)["descriptions"]


def _prefix(locale: SupportedLang) -> str:
    return tools_bundle(locale)["scrapeSharedPrefix"]


def _wait_model(locale: SupportedLang) -> type[BaseModel]:
    s = _schema_strings(locale)
    return create_model(
        "WaitForScroll",
        scroll_speed=(float, Field(alias="scrollSpeed", description=s["scrollSpeed"])),
        scroll_interval=(float, Field(alias="scrollInterval", description=s["scrollInterval"])),
        max_scroll_height=(float | None, Field(None, alias="maxScrollHeight", description=s["maxScrollHeight"])),
        scroll_container_selector=(
            str | None,
            Field(None, alias="scrollContainerSelector", description=s["scrollContainerSelector"]),
        ),
        __config__=ConfigDict(populate_by_name=True),
        __doc__=s["waitForScrollGroup"],
    )


def _email_filter(locale: SupportedLang) -> type[BaseModel]:
    s = _schema_strings(locale)
    return create_model(
        "EmailFilter",
        domain=(str | None, Field(None, description=s["emailDomain"])),
        keyword=(str | None, Field(None, description=s["emailKeyword"])),
        limit=(float | None, Field(None, description=s["emailLimit"])),
        __config__=ConfigDict(populate_by_name=True),
    )


def _phone_filter(locale: SupportedLang) -> type[BaseModel]:
    s = _schema_strings(locale)
    return create_model(
        "PhoneFilter",
        type=(str | None, Field(None, description=s["phoneType"])),
        area_code=(str | None, Field(None, alias="areaCode", description=s["phoneAreaCode"])),
        keyword=(str | None, Field(None, description=s["phoneKeyword"])),
        limit=(float | None, Field(None, description=s["phoneLimit"])),
        __config__=ConfigDict(populate_by_name=True),
    )


def _url_filter(locale: SupportedLang) -> type[BaseModel]:
    s = _schema_strings(locale)
    return create_model(
        "UrlFilter",
        domain=(str | None, Field(None, description=s["urlDomain"])),
        keyword=(str | None, Field(None, description=s["urlKeyword"])),
        pattern=(str | None, Field(None, description=s["urlPattern"])),
        limit=(float | None, Field(None, description=s["urlLimit"])),
        __config__=ConfigDict(populate_by_name=True),
    )


def _img_filter(locale: SupportedLang) -> type[BaseModel]:
    s = _schema_strings(locale)
    return create_model(
        "ImgFilter",
        min_width=(float | None, Field(None, alias="minWidth", description=s["imgMinWidth"])),
        min_height=(float | None, Field(None, alias="minHeight", description=s["imgMinHeight"])),
        format=(str | None, Field(None, description=s["imgFormat"])),
        keyword=(str | None, Field(None, description=s["imgKeyword"])),
        limit=(float | None, Field(None, description=s["imgLimit"])),
        __config__=ConfigDict(populate_by_name=True),
    )


def _common_fields(locale: SupportedLang) -> dict[str, Any]:
    s = _schema_strings(locale)
    W = _wait_model(locale)
    return {
        "url": (str | list[str], Field(description=s["url"])),
        "lang": (LangEnum | None, Field(None, description=s["lang"])),
        "delay": (float | None, Field(None, ge=0, description=s["delay"])),
        "wait_for_scroll": (W | None, Field(None, alias="waitForScroll")),
        "timeout_ms": (float | None, Field(None, ge=1000, description=s["timeoutMs"])),
        "bridge_timeout_ms": (float | None, Field(None, ge=1000, alias="bridgeTimeoutMs", description=s["bridgeTimeoutMs"])),
        "include_html": (bool | None, Field(None, alias="includeHtml", description=s["includeHtml"])),
        "include_text": (bool | None, Field(None, alias="includeText", description=s["includeText"])),
        "scrape_interval": (float | None, Field(None, alias="scrapeInterval", description=s["scrapeInterval"])),
        "concurrency": (float | None, Field(None, description=s["concurrency"])),
        "scroll_speed": (float | None, Field(None, alias="scrollSpeed", description=s["scrollSpeedTop"])),
    }


def build_tool_definitions(locale: SupportedLang) -> dict[str, Any]:
    s = _schema_strings(locale)
    d = _descriptions(locale)
    pre = _prefix(locale)
    common = _common_fields(locale)

    Ping = create_model(
        "PingArgs",
        lang=(LangEnum | None, Field(None, description=s["lang"])),
        auto_launch_browser=(bool | None, Field(None, alias="autoLaunchBrowser", description=s["autoLaunchBrowser"])),
        post_launch_wait_ms=(
            float | None,
            Field(None, ge=3000, le=60000, alias="postLaunchWaitMs", description=s["postLaunchWaitMs"]),
        ),
        __config__=ConfigDict(populate_by_name=True),
    )

    Scrape = create_model(
        "ScrapeArgs",
        **common,
        max_pages=(float | None, Field(None, ge=1, alias="maxPages", description=s["maxPages"])),
        __config__=ConfigDict(populate_by_name=True),
    )

    ScrapeArticle = create_model("ScrapeArticleArgs", **common, __config__=ConfigDict(populate_by_name=True))

    EF = _email_filter(locale)
    ScrapeEmails = create_model(
        "ScrapeEmailsArgs",
        **common,
        filter=(
            EF | None,
            Field(None, description=s["filterEmails"]),
        ),
        __config__=ConfigDict(populate_by_name=True),
    )

    PF = _phone_filter(locale)
    ScrapePhones = create_model(
        "ScrapePhonesArgs",
        **common,
        filter=(PF | None, Field(None, description=s["filterPhones"])),
        __config__=ConfigDict(populate_by_name=True),
    )

    UF = _url_filter(locale)
    ScrapeUrls = create_model(
        "ScrapeUrlsArgs",
        **common,
        filter=(UF | None, Field(None, description=s["filterUrls"])),
        __config__=ConfigDict(populate_by_name=True),
    )

    IF = _img_filter(locale)
    ScrapeImages = create_model(
        "ScrapeImagesArgs",
        **common,
        filter=(IF | None, Field(None, description=s["filterImages"])),
        __config__=ConfigDict(populate_by_name=True),
    )

    return {
        "ping": {"name": "ping", "description": d["ping"], "model": Ping},
        "scrape": {"name": "scrape", "description": f"{pre}{d['scrape']}", "model": Scrape},
        "scrape_article": {"name": "scrape_article", "description": f"{pre}{d['scrape_article']}", "model": ScrapeArticle},
        "scrape_emails": {"name": "scrape_emails", "description": f"{pre}{d['scrape_emails']}", "model": ScrapeEmails},
        "scrape_phones": {"name": "scrape_phones", "description": f"{pre}{d['scrape_phones']}", "model": ScrapePhones},
        "scrape_urls": {"name": "scrape_urls", "description": f"{pre}{d['scrape_urls']}", "model": ScrapeUrls},
        "scrape_images": {"name": "scrape_images", "description": f"{pre}{d['scrape_images']}", "model": ScrapeImages},
    }


def tool_input_schema(model: type[BaseModel]) -> dict[str, Any]:
    return model.model_json_schema()


tool_definitions = build_tool_definitions("en-US")
