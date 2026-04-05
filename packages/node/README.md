# LionScraper MCP + CLI service

[简体中文](./README_cn.md)

## What is this?

**LionScraper** is a browser extension that can collect lists, articles, links, images, and more from web pages. This npm package provides the companion **bridge** to that extension in two ways:

- **MCP** (`lionscraper-mcp`): connect your **AI app** (e.g. Cursor) so the model can call scraping tools in chat.
- **CLI** (`lionscraper`): run **daemon**, **scrape**, and **ping** from a terminal over the same local HTTP/WebSocket port as the extension.

**The real scraping logic runs in the extension**; this package connects and forwards.

## Before you start

1. **Browser**: Chrome or Edge (follow what the extension actually supports).
2. **LionScraper extension**: Install and enable it from your browser’s store (the listing title may vary by storefront).
   - **Chrome**: [Chrome Web Store — LionScraper](https://chromewebstore.google.com/detail/godiccfjpjdapemodajccjjjcdcccimf)
   - **Microsoft Edge**: [Edge Add-ons — LionScraper](https://microsoftedge.microsoft.com/addons/detail/llfpnjbphhfkgbgljpngbjpjpnljkijk)
3. **Node.js**: **Version 18 or newer** on your machine. If you do not have it yet, download an installer from the [Node.js website](https://nodejs.org/) and follow the prompts.
4. **For MCP only**: an AI app that supports MCP (e.g. Cursor, Trae).

## Install (npm)

This package is published on npm as **[lionscraper](https://www.npmjs.com/package/lionscraper)**.

```bash
npm install -g lionscraper
```

You get two commands:

| Command | Role |
|--------|------|
| **`lionscraper-mcp`** | Thin MCP server (stdio) for AI apps |
| **`lionscraper`** | CLI: `daemon`, `stop`, `scrape`, `ping`, … |

Without a global install, MCP can still use `npx` (e.g. `npx` with `-y`, `-p`, `lionscraper`, `lionscraper-mcp`—see your app’s MCP docs for the exact JSON).

---

## MCP (AI applications)

### Add MCP in your AI app

Example JSON (UIs differ):

**After global install (recommended)**

```json
{
  "mcpServers": {
    "lionscraper": {
      "command": "lionscraper-mcp",
      "env": {
        "PORT": "13808",
        "TIMEOUT": "120000",
        "LANG": "zh-CN"
      }
    }
  }
}
```

- **`PORT`**: Same as the extension **bridge port**; default **13808**.
- **`TIMEOUT`, `LANG`**: Optional; the values above are fine to start.

Restart MCP or the app so the config applies.

### Match the port in the browser extension

1. Open LionScraper **settings / options**.
2. Set **bridge port** to the **same** value as **`PORT`** (e.g. `13808`).
3. If needed, use **Reconnect** in the extension, or reload the extension / restart the browser.

### Day-to-day use (MCP)

1. Keep the extension **enabled** and target pages **open** as required.
2. Ask in natural language, e.g. “Check if LionScraper is connected” or “Scrape lists / article / emails / phones / links / images from this page.”
3. If you see not connected or timeout, retry a connection check and confirm **PORT** matches.

### MCP tools (summary)

The server registers tools that mirror extension capabilities. Names and shapes are what your MCP client shows to the model.

| Tool | Purpose (short) |
|------|------------------|
| `ping` | Check that the extension is connected and registered |
| `scrape` | Auto-detect structure (lists, tables, …); supports pagination |
| `scrape_article` | Article body (e.g. Markdown) and metadata |
| `scrape_emails` | Email addresses on the page |
| `scrape_phones` | Phone numbers (structured) |
| `scrape_urls` | Hyperlink URLs |
| `scrape_images` | Image URLs and basic metadata |

**Parameters:** A full JSON schema for every field belongs in the tool definitions your client displays and in release-accurate docs; duplicating it here goes stale quickly. Use the **tool list / descriptions in the AI app** when calling MCP.

### MCP Resources / Prompts

The thin MCP process (`lionscraper-mcp`) exposes **Resources** and **Prompts** in addition to **Tools**:

- **Resources**: static Markdown at stable URIs, e.g. `lionscraper://guide/connection` (PORT alignment, `ping` troubleshooting), `lionscraper://guide/when-to-use-tools` (prefer LionScraper over WebFetch/curl/wget by scenario), `lionscraper://guide/cli` (terminal CLI), `lionscraper://reference/tools`, `lionscraper://reference/common-params`. Clients **list/read** them into context; they are served **inside the stdio process** and do **not** require the daemon HTTP path (works even if the extension is offline).
- **Prompts**: workflow templates (e.g. ping-then-scrape, multi-URL, `scrape_article`, `prefer_lionscraper_scraping`, extension troubleshooting). Clients **list/get** prompts; UI varies by host (Cursor, Trae, …).

Copy follows **`LANG`** (e.g. `zh-CN`), same as tool metadata.

---

## CLI (terminal)

The **`lionscraper`** binary is the **terminal front-end** to the same stack as MCP: **`lionscraper daemon`** listens on **`PORT`** (default **13808**) for **HTTP** (used by the CLI and by the thin `lionscraper-mcp` process) and **WebSocket** (used by the extension). Set **`PORT`** (and optional **`DAEMON_AUTH_TOKEN`**) to match the extension bridge port and any MCP config. Use the CLI for **scripts, CI, or quick one-off runs** without opening an AI chat.

The CLI talks to the **daemon HTTP API** on `http://127.0.0.1:$PORT` (default port **13808**, same as the extension). If you do **not** pass `--api-url`, a local daemon is **auto-started** when possible when you run `scrape` or `ping`.

Common commands:

```bash
lionscraper --help
lionscraper daemon              # keep running; HTTP + WebSocket on PORT
lionscraper stop                # stop daemon on configured PORT
lionscraper ping
lionscraper scrape -u https://www.example.com
lionscraper scrape --method article -u https://www.example.com
# Shorthand: lionscraper -u https://www.example.com   → same as scrape
```

**`--method`** selects which tool the daemon runs (default `scrape`): `scrape`, `article`, `emails`, `phones`, `urls`, `images`. Repeat **`-u` / `--url`** to pass several URLs in one run.

Set **`PORT`** (and optional **`DAEMON_AUTH_TOKEN`**) in the environment so the CLI matches the extension and MCP. Use **`--api-url http://127.0.0.1:PORT`** if the daemon is not on the default base URL. Run **`lionscraper --help`** for every flag the binary accepts.

### Scrape: parameters and richer examples

Below flags are forwarded to the extension (except **`--bridge-timeout-ms`**, which only caps how long the CLI waits on the bridge). Actual behavior still depends on the extension version.

**Output and connection**

| Flag | Meaning |
|------|---------|
| `--format json` or `pretty` | JSON one-line vs. indented (default `json`) |
| `--raw` | Print the tool’s text block as returned, without re-formatting |
| `-o` / `--output <file>` | Write the result to a file instead of stdout |

**Timing and load**

| Flag | Meaning |
|------|---------|
| `--delay <ms>` | Wait after page load before scraping (dynamic content) |
| `--timeout-ms <ms>` | Per-URL timeout on the **extension** side |
| `--bridge-timeout-ms <ms>` | Max wait for this **CLI → daemon** call |
| `--scrape-interval <ms>` | Delay between starting multiple URLs |
| `--concurrency <n>` | Concurrency hint for multi-URL runs |
| `--scroll-speed <px>` | Global scroll speed (extension semantics) |
| `--max-pages <n>` | Pagination cap for list-style **`scrape`** |

**Lazy-loaded / infinite scroll** (maps to `waitForScroll` in the tool payload)

| Flag | Meaning |
|------|---------|
| `--wait-scroll-speed <px>` | Pixels per step while scrolling |
| `--wait-scroll-interval <ms>` | Delay between scroll steps |
| `--wait-max-scroll-height <px>` | Optional max scroll distance |
| `--scroll-container <selector>` | Optional scrollable container selector |

**Locale**

| Flag | Meaning |
|------|---------|
| `--lang zh-CN` or `en-US` | Language hint for messages / extension UI strings |

**Extra payload**

| Flag | Meaning |
|------|---------|
| `--include-html` + `true` / `false` | Ask for full-page HTML in meta when supported |
| `--include-text` + `true` / `false` | Ask for full-page plain text in meta when supported |

**Method-specific filters** (examples; see `--help` for the full set)

- **Emails** (`--method emails`): `--email-domain`, `--email-keyword`, `--email-limit`
- **Phones** (`--method phones`): `--phone-type`, `--phone-area-code`, `--phone-keyword`, `--phone-limit`
- **URLs** (`--method urls`): `--url-domain`, `--url-keyword`, `--url-pattern`, `--url-limit`
- **Images** (`--method images`): `--img-min-width`, `--img-min-height`, `--img-format`, `--img-keyword`, `--img-limit`

**Optional browser automation hints** (when the extension supports them): `--auto-launch-browser`, `--no-auto-launch-browser`, `--post-launch-wait-ms`.

---

**Example A — List / table scrape with pagination, delays, and scroll assist**

```bash
lionscraper scrape \
  -u https://www.example.com/items \
  --max-pages 5 \
  --delay 800 \
  --timeout-ms 90000 \
  --bridge-timeout-ms 180000 \
  --wait-scroll-speed 400 \
  --wait-scroll-interval 350 \
  --lang zh-CN \
  --format pretty \
  -o items.json
```

- **`--max-pages`**: stop after at most five “pages” of list accumulation for this job.
- **`--delay`**: give the page extra time after load before extraction.
- **`--timeout-ms` / `--bridge-timeout-ms`**: extension vs. CLI-side waits; raise both for slow sites or heavy pages.
- **`--wait-scroll-*`**: gentle scrolling so lazy-loaded rows can appear before scraping.
- **`-o` / `--format pretty`**: save a human-readable JSON file for inspection.

---

**Example B — Article body with optional HTML snapshot**

```bash
lionscraper scrape --method article \
  -u https://www.example.com/blog/post-1 \
  --include-html true \
  --timeout-ms 120000 \
  --format json
```

- **`--method article`**: maps to the **`scrape_article`** tool (Markdown-style body + metadata when the extension provides it).
- **`--include-html true`**: requests additional HTML in the result meta where supported (larger payload).

---

**Example C — Emails and URLs with filters, multiple pages**

```bash
lionscraper scrape --method emails \
  -u https://www.example.com/contact \
  --email-domain example.com \
  --email-keyword support \
  --email-limit 30 \
  --format pretty

lionscraper scrape --method urls \
  -u https://www.example.com \
  -u https://www.example.com/docs \
  --url-domain example.com \
  --url-limit 200 \
  --scrape-interval 500
```

- **Email flags**: narrow to addresses in a domain, matching a keyword, and cap the count.
- **Two `-u` values**: two URLs processed in one invocation; **`--scrape-interval`** spaces out task starts.

---

**Example D — Images with size / format filters**

```bash
lionscraper scrape --method images \
  -u https://www.example.com/gallery \
  --img-min-width 240 \
  --img-min-height 240 \
  --img-format webp \
  --img-limit 40 \
  -o gallery-images.json
```

- Filters out small thumbnails and non-WebP assets when the extension honors these fields; **`--img-limit`** caps how many entries are returned.

---

## FAQ (plain language)

**Q: Extension not connected or scraping fails?**

- Extension enabled?
- **PORT** in MCP (or env for CLI) **exactly** matches the extension **bridge port**?
- Avoid multiple conflicting MCP/CLI setups on one machine.

**Q: Many “tools” visible in the AI app—does that mean the extension is connected?**

Not necessarily. Tools only confirm **AI → MCP server**; the extension must still connect on the same port and register.

**Q: CLI says it cannot reach the daemon?**

Start **`lionscraper daemon`** in another terminal, or fix **`PORT`** / **`--api-url`**.

## License

MIT (same as the [lionscraper](https://www.npmjs.com/package/lionscraper) npm package).
