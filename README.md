# LionScraper MCP + CLI + HTTP API bridge

[简体中文](README_cn.md)

- **Website**: [lionscraper.com](https://www.lionscraper.com/)
- **npm**: [package `lionscraper`](https://www.npmjs.com/package/lionscraper)
- **PyPI**: [project `lionscraper`](https://pypi.org/project/lionscraper/)

## What is this?

**LionScraper** is a browser extension that can collect lists, articles, links, images, and more from web pages. This repository provides the companion **bridge** between your tools and that extension in three ways:

- **MCP** (`lionscraper-mcp`): connect an **AI app** (e.g. Cursor) so the model can call scraping tools over stdio.
- **CLI** (`lionscraper`): run **daemon**, **scrape**, **ping**, and more from a terminal on the same local HTTP/WebSocket port as the extension.
- **HTTP API**: when the daemon is running, call the same capabilities over **loopback JSON HTTP** (e.g. `/v1/...`) from scripts or any HTTP client—no MCP or CLI front-end required.

**The real scraping logic runs in the extension**; these packages connect and forward.

## Before you start

1. **Browser**: Chrome or Edge (follow what the extension supports).
2. **LionScraper extension**: install and enable from the store.
   - **Chrome**: [Chrome Web Store — LionScraper](https://chromewebstore.google.com/detail/godiccfjpjdapemodajccjjjcdcccimf)
   - **Microsoft Edge**: [Edge Add-ons — LionScraper](https://microsoftedge.microsoft.com/addons/detail/llfpnjbphhfkgbgljpngbjpjpnljkijk)
3. **Runtime** (pick one or both implementations):
   - **Node.js** **18+** for the npm package — [Node.js](https://nodejs.org/)
   - **Python** **3.10+** for the PyPI package — [Python](https://www.python.org/downloads/)
4. **For MCP**: an AI app that supports MCP (e.g. Cursor, Trae).
5. **For the HTTP API**: same browser, extension, and daemon as the CLI; see the package READMEs for paths and examples.

## Two implementations

| | **Node.js (npm)** | **Python (pip)** |
|--|-------------------|------------------|
| **Registry** | `io.github.dowant/lionscraper-node` | `io.github.dowant/lionscraper-python` |
| **Docs (EN)** | [packages/node/README.md](packages/node/README.md) | [packages/python/README.md](packages/python/README.md) |
| **Docs (ZH)** | [packages/node/README_cn.md](packages/node/README_cn.md) | [packages/python/README_cn.md](packages/python/README_cn.md) |

Install one or both; they are separate packages with the same CLI command names.

### Install (npm)

Published as **[lionscraper](https://www.npmjs.com/package/lionscraper)** on npm.

```bash
npm install -g lionscraper
```

Without a global install, MCP can use **`npx`**; see the **npx** JSON examples under [Add MCP in your AI app](#add-mcp-in-your-ai-app).

### Install (pip)

Published as **[lionscraper](https://pypi.org/project/lionscraper/)** on PyPI.

```bash
pip install lionscraper
```

A **virtual environment** is recommended, or `pip install --user lionscraper` if you prefer not to install into the system interpreter.

### Commands (both packages)

| Command | Role |
|--------|------|
| **`lionscraper-mcp`** | Thin MCP server (stdio) for AI apps |
| **`lionscraper`** | CLI: `daemon`, `stop`, `scrape`, `ping`, … (also serves the **HTTP API** on the same port) |

After **`pip install`**, if `lionscraper-mcp` is not on your `PATH`, use **`python -m lionscraper`** with **no extra arguments** for MCP stdio (see [packages/python/README.md](packages/python/README.md)).

**`PORT`** (default **13808**) must match the extension **bridge port** in all modes.

## CLI quick start

```bash
lionscraper daemon
lionscraper ping
lionscraper scrape -u https://www.example.com
```

Full flags, multiple URLs, pagination, and **HTTP API** details: [packages/node/README.md](packages/node/README.md) / [packages/python/README.md](packages/python/README.md).

## Add MCP in your AI app

Examples assume **`lionscraper-mcp`** is on your `PATH` (from npm or pip). In MCP JSON, every **`env` value is a string**.

**Minimal config** (`PORT` defaults to **13808**; must match the extension bridge port):

```json
{
  "mcpServers": {
    "lionscraper": {
      "command": "lionscraper-mcp"
    }
  }
}
```

**Full `env` example** (omit keys you do not need):

```json
{
  "mcpServers": {
    "lionscraper": {
      "command": "lionscraper-mcp",
      "env": {
        "PORT": "13808",
        "TIMEOUT": "120000",
        "LANG": "en-US",
        "TOKEN": "",
        "DAEMON": ""
      }
    }
  }
}
```

**npx (no global install)** — requires Node.js; the first run may download the package. The npm **package name** is `lionscraper`; the executable is `lionscraper-mcp`. Use `command` **`npx`** and pass **`lionscraper`** then **`lionscraper-mcp`** in `args` (after `-y`).

**Minimal config (npx):**

```json
{
  "mcpServers": {
    "lionscraper": {
      "command": "npx",
      "args": ["-y", "lionscraper", "lionscraper-mcp"]
    }
  }
}
```

**Full `env` example (npx):**

```json
{
  "mcpServers": {
    "lionscraper": {
      "command": "npx",
      "args": ["-y", "lionscraper", "lionscraper-mcp"],
      "env": {
        "PORT": "13808",
        "TIMEOUT": "120000",
        "LANG": "en-US",
        "TOKEN": "",
        "DAEMON": ""
      }
    }
  }
}
```

To pin a version, use e.g. `"lionscraper@1.0.5"` in place of `"lionscraper"` inside `args`.

- **`PORT`**: HTTP + WebSocket listen port; default **13808**; must match the extension **bridge port**.
- **`TIMEOUT`**: ms to wait for a previous instance to release the port; default **120000**; **`0`** forces takeover quickly.
- **`LANG`**: tool descriptions and stderr language (**`en-US`**, **`zh-CN`**, or POSIX forms).
- **`TOKEN`**: Bearer token shared with the daemon; empty means no auth.
- **`DAEMON`**: only **`0`** disables auto-starting `lionscraper daemon` from thin MCP.

Restart MCP or the host app after changing config.

### Python: MCP via `python -m`

```json
{
  "mcpServers": {
    "lionscraper": {
      "command": "python",
      "args": ["-m", "lionscraper"]
    }
  }
}
```

Use the same **`python`** you used to install the package (or `python3` on some systems).

## Match the port in the browser extension

1. Open LionScraper **settings / options**.
2. Set **bridge port** to the same value as **`PORT`** (e.g. `13808`).
3. If needed, use **Reconnect**, reload the extension, or restart the browser.

## Day-to-day use

1. Keep the extension **enabled** and target pages **open** as required.
2. Ask in natural language (e.g. check connection, scrape lists / article / emails / phones / links / images).
3. If you see “not connected” or timeouts, retry a connection check and confirm **PORT** matches.

## FAQ

**Extension not connected or scrape fails?**

- Is the extension enabled?
- Does **PORT** in the AI app match the extension **bridge port** exactly?
- One bridge per machine is usually enough; duplicate MCP configs can conflict.

**Seeing MCP tools in the client means everything works?**

Not necessarily. Tools only prove **AI → bridge**; the extension must also register on the same port.

## MCP Registry and directories

Official MCP Registry entries (both use `server.json`):

| Path | Registry name | Package |
|------|----------------|---------|
| [packages/node/server.json](packages/node/server.json) | `io.github.dowant/lionscraper-node` | [npm: lionscraper](https://www.npmjs.com/package/lionscraper) (`mcpName` in `package.json`) |
| [packages/python/server.json](packages/python/server.json) | `io.github.dowant/lionscraper-python` | [PyPI: lionscraper](https://pypi.org/project/lionscraper/) (`mcp-name` comment in English `README.md`) |

**Publish outline** (install the official CLI, see [Quickstart](https://modelcontextprotocol.io/registry/quickstart)):

1. Publish **npm / PyPI** at the version in each `server.json`.
2. In **`packages/node`**: `mcp-publisher login github`, then `mcp-publisher publish`.
3. In **`packages/python`**: `mcp-publisher publish` (login reused).

Third-party listings (e.g. [Glama](https://glama.ai/mcp/servers)) have their own rules; [Smithery](https://smithery.ai/docs/build/publish) targets public HTTPS/streaming setups rather than local stdio + npm/pip by default.

## Third-party directory (Glama)

This project is listed on Glama (e.g. [LionScraper on Glama](https://glama.ai/mcp/servers/dowant/lionscraper-mcp)). If the page shows **cannot be installed** or **license not found**, typical fixes are: add a root **`LICENSE`** (this repo includes [LICENSE](LICENSE)), add **`glama.json`** with maintainer **GitHub usernames** for org-owned repos ([glama.json](glama.json)—edit `maintainers` if claim fails), **claim** the server on Glama, and optionally complete Glama’s **Docker / release** flow if you need their install and security/quality checks—official install remains **`npm install -g lionscraper`** and **`pip install lionscraper`**. See also the [score / checklist page](https://glama.ai/mcp/servers/dowant/lionscraper-mcp/score).

## License

[MIT](LICENSE) (same as the npm and PyPI packages).
