# LionScraper 雄狮采集器 MCP + CLI + HTTP API 桥接服务

[English](README.md)

- **官网**：[lionscraper.com](https://www.lionscraper.com/)
- **npm**：[包 `lionscraper`](https://www.npmjs.com/package/lionscraper)
- **PyPI**：[项目 `lionscraper`](https://pypi.org/project/lionscraper/)

## 这是什么？

**LionScraper 雄狮采集器**是一款浏览器扩展，可以在网页里做列表、文章、链接、图片等采集。本仓库提供的是与扩展配套的**桥接**实现，通过三种方式连接你的工具与扩展：

- **MCP**（`lionscraper-mcp`）：接入 **AI 软件**（例如 Cursor），在对话里通过 stdio 调用采集相关工具。
- **CLI**（`lionscraper`）：在终端运行 **daemon**、**scrape**、**ping** 等，与扩展共用同一本地 HTTP/WebSocket 端口。
- **HTTP API**：守护进程运行时，通过 **本机 JSON HTTP**（如 `/v1/...`）调用相同能力，便于脚本或任意 HTTP 客户端使用，无需 MCP 或 CLI 外壳。

可以把它理解成一座「小桥」：工具在一边，浏览器扩展在另一边，中间由本服务传话。**真正的采集逻辑在扩展里完成**，本仓库只做连接与转发。

## 使用前请准备好

1. **浏览器**：Chrome 或 Edge（以扩展实际支持的浏览器为准）。
2. **雄狮采集器扩展**：从浏览器扩展商店安装并启用。
   - **Chrome**：[Chrome 应用商店 — LionScraper](https://chromewebstore.google.com/detail/godiccfjpjdapemodajccjjjcdcccimf)
   - **Microsoft Edge**：[Edge 加载项 — LionScraper](https://microsoftedge.microsoft.com/addons/detail/llfpnjbphhfkgbgljpngbjpjpnljkijk)
3. **运行环境**（可按需只装一种或两种实现）：
   - **Node.js** **18 或更高**，用于 npm 包 — [Node.js 官网](https://nodejs.org/)
   - **Python** **3.10 或更高**，用于 PyPI 包 — [Python 官网](https://www.python.org/downloads/)
4. **若使用 MCP**：需安装支持 MCP 的 AI 软件（例如 Cursor、Trae 等）。
5. **若使用 HTTP API**：与 CLI 相同，需要浏览器、扩展与守护进程；路径与示例见各子包 README。

**无 Chrome/Edge 时的 HTTP 兜底**：若标准路径下检测不到两种浏览器且扩展未连接，MCP 仍可启动；`ping` 会返回成功并标明 **http_fetch** 模式，`scrape*` 由服务端做简单 HTTP 抓取（不执行 JavaScript）。已安装浏览器但未连扩展时，仍会走扩展连接引导。Node 在 Linux/Docker 全局安装下已修复自动拉起守护进程时 **`lionscraper.js` 路径丢失根 `/`** 的问题。Python 包对守护进程的 HTTP/WebSocket 出站统一使用 **aiohttp**。

## 两种实现

| | **Node.js（npm）** | **Python（pip）** |
|--|-------------------|------------------|
| **Registry** | `io.github.dowant/lionscraper-node` | `io.github.dowant/lionscraper-python` |
| **文档（英）** | [packages/node/README.md](packages/node/README.md) | [packages/python/README.md](packages/python/README.md) |
| **文档（中）** | [packages/node/README_cn.md](packages/node/README_cn.md) | [packages/python/README_cn.md](packages/python/README_cn.md) |

可同时安装两者；二者为不同发行包，命令名相同。

### 安装（npm）

本服务已发布在 npm，包名为 **[lionscraper](https://www.npmjs.com/package/lionscraper)**。

```bash
npm install -g lionscraper
```

若**不想**全局安装，可在 MCP 配置里使用 **`npx`**；完整 JSON 示例见下文 [在 AI 软件里添加 MCP](#在-ai-软件里添加-mcp) 中的 **npx** 小节。

### 安装（pip）

本服务已发布在 PyPI，包名为 **[lionscraper](https://pypi.org/project/lionscraper/)**。

```bash
pip install -U lionscraper
```

建议使用 **虚拟环境**，或使用 `pip install -U --user lionscraper` 安装到用户目录。

### 命令说明（两种包一致）

| 命令 | 作用 |
|------|------|
| **`lionscraper-mcp`** | 薄 MCP 服务（stdio），供 AI 软件连接 |
| **`lionscraper`** | CLI：`daemon`、`stop`、`scrape`、`ping` 等（并在同一端口提供 **HTTP API**） |

在 **`pip install -U lionscraper`** 之后，若 `lionscraper-mcp` 不在 `PATH` 上，可使用 **`python -m lionscraper`** 且**不要跟额外参数**，即走 MCP stdio（详见 [packages/python/README.md](packages/python/README.md)）。

**`PORT`**（默认 **13808**）须与扩展里的**桥接端口**一致（任意模式均如此）。

## CLI 快速示例

```bash
lionscraper daemon
lionscraper ping
lionscraper scrape -u https://www.example.com
```

更完整的参数、多 URL、分页、过滤以及 **HTTP API** 说明，见 [packages/node/README_cn.md](packages/node/README_cn.md) 与 [packages/python/README_cn.md](packages/python/README_cn.md)（英文与 npm/PyPI 展示一致见子包英文 README）。

## 在 AI 软件里添加 MCP

以下示例假定 **`lionscraper-mcp`** 已在 `PATH` 中（来自 npm 或 pip）。MCP 里 **`env` 的值均为字符串**。

**简单配置**（不写 `env` 时 **`PORT` 默认 13808**，须与扩展桥接端口一致）：

```json
{
  "mcpServers": {
    "lionscraper": {
      "command": "lionscraper-mcp"
    }
  }
}
```

**详细配置**（可按需删减键；空字符串与省略该键含义接近）：

```json
{
  "mcpServers": {
    "lionscraper": {
      "command": "lionscraper-mcp",
      "env": {
        "PORT": "13808",
        "TIMEOUT": "120000",
        "LANG": "zh-CN",
        "TOKEN": "",
        "DAEMON": ""
      }
    }
  }
}
```

**使用 npx（无需全局安装）** — 需已安装 Node.js；首次运行可能会下载 npm 包。npm **包名**为 `lionscraper`，要执行的 **命令**为 `lionscraper-mcp`。将 `command` 设为 **`npx`**，在 `args` 中依次传入 `-y`、`lionscraper`、`lionscraper-mcp`。

**简单配置（npx）：**

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

**详细配置（npx，`env` 可按需删减）：**

```json
{
  "mcpServers": {
    "lionscraper": {
      "command": "npx",
      "args": ["-y", "lionscraper", "lionscraper-mcp"],
      "env": {
        "PORT": "13808",
        "TIMEOUT": "120000",
        "LANG": "zh-CN",
        "TOKEN": "",
        "DAEMON": ""
      }
    }
  }
}
```

若要固定版本，可将 `args` 中的 `lionscraper` 改为例如 `lionscraper@1.0.1`。

- **`PORT`**：**HTTP + WebSocket** 监听端口，默认 **13808**，须与扩展 **桥接端口** 一致。
- **`TIMEOUT`**：占口接管时等待上一实例退出的毫秒数，默认 **120000**；**`0`** 表示尽快强制接管。
- **`LANG`**：工具说明与 stderr 日志语言（如 **`zh-CN`**、**`en-US`**）。
- **`TOKEN`**：与守护进程一致的 Bearer；**留空**表示不带鉴权。
- **`DAEMON`**：仅 **`0`** 禁止薄 MCP 自动拉起守护进程；留空或其它值与省略相同。

保存配置后，按软件要求**重启 MCP 或重启软件**，使新配置生效。

### Python：通过 `python -m` 连接 MCP

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

请使用安装该包时所用的 **`python`** 可执行文件（部分系统上为 `python3`）。

## 在浏览器扩展里对齐端口

1. 打开雄狮采集器的**设置或选项页**。
2. 找到 **桥接端口**（或类似名称），设为与上一步 MCP 配置里 **`PORT`** 相同的数字（例如 `13808`）。
3. 若曾改端口或连接异常，可在扩展里使用 **「重新连接」**；仍不行时可尝试 **重新加载扩展** 或重启浏览器。

## 怎样日常使用？

1. 保持扩展**已启用**，并尽量让需要采集的页面在浏览器里**打开着**（或按扩展要求操作）。
2. 在 AI 对话里用自然语言说明需求，例如：
   - 「先检查一下雄狮采集器扩展有没有连上。」
   - 「帮我采集这个网页上的列表数据 / 文章正文 / 邮箱 / 电话 / 链接 / 图片。」
3. AI 会通过 MCP 调用扩展；若提示未连接或超时，可先请 AI **再执行一次连接检查**，并确认端口一致、扩展已开启。

## 常见问题（白话）

**问：提示扩展未连接、或采集失败？**

- 扩展是否已打开且未被禁用？
- AI 里配置的 **端口** 与扩展里的 **桥接端口** 是否**完全一致**？
- 同一台电脑上，后台一般只需要**一组**本服务与扩展的桥接；若你同时开了多种 MCP 配置或重复安装，可能造成冲突。

**问：AI 里已经能看到很多「工具」，是不是就一定连好了？**

不一定。能看到工具只说明 **AI 到本服务**这一段通了；扩展还必须连上同一端口并完成注册。

## MCP Registry 与第三方目录收录

本仓库在 **官方 MCP Registry** 上按双包登记（元数据文件名均为 `server.json`）：

| 目录 | Registry 名称 | 说明 |
|------|----------------|------|
| [`packages/node/server.json`](packages/node/server.json) | `io.github.dowant/lionscraper-node` | 对应 npm 包 [`lionscraper`](https://www.npmjs.com/package/lionscraper)，`package.json` 内含 `mcpName` 校验字段 |
| [`packages/python/server.json`](packages/python/server.json) | `io.github.dowant/lionscraper-python` | 对应 PyPI 包 [`lionscraper`](https://pypi.org/project/lionscraper/)，英文 `README.md` 内含 PyPI 描述所需的 `mcp-name` 注释 |

**发布到 Registry 的步骤概要**（需本机安装官方 CLI，见 [Quickstart](https://modelcontextprotocol.io/registry/quickstart)）：

1. 将 **npm / PyPI** 发布到与各自 `server.json` 中 **`version`** 一致的版本。
2. 在仓库根下进入 **`packages/node`**，执行 `mcp-publisher login github`（只需一次），再执行 `mcp-publisher publish`。
3. 再进入 **`packages/python`**，同样执行 `mcp-publisher publish`（登录可沿用）。

**第三方目录**无统一入口，常见做法包括：在 [Glama](https://glama.ai/mcp/servers) 使用 **Add Server** 按站点流程提交；[Smithery](https://smithery.ai/docs/build/publish) 主要面向 **公网 HTTPS + Streamable HTTP**，与本仓库以 **stdio + npm/pip 安装**为主的形态不同，需另备托管方案后再考虑。

## 第三方目录（Glama）与评分说明

项目在 Glama 上的条目示例：[LionScraper on Glama](https://glama.ai/mcp/servers/dowant/lionscraper-mcp)。若页面提示 **不可安装**、**未找到许可证** 或 **security/quality 未测试**，常见对应关系如下：

- **license - not found**：仓库根目录需提供可被识别的 **`LICENSE`** 文件（本仓库已包含 [LICENSE](LICENSE)）。
- **不可安装 / 不可检视**：通常需在 Glama 上对服务 **Claim**（GitHub 验证）；组织仓库宜在根目录提供 **`glama.json`** 并填写可认领成员的 GitHub 用户名（见 [glama.json](glama.json)；若认领失败，请将 `maintainers` 改为实际维护者用户名）。
- **security / quality 未测试**：多表示尚未完成 Glama 侧的 **Docker 构建与 Release** 流程；若仅需本地使用，**官方安装方式**仍是 **`npm install -g lionscraper`** 与 **`pip install -U lionscraper`**。

评分细则可参考：[Glama Score 页面](https://glama.ai/mcp/servers/dowant/lionscraper-mcp/score)。

## 许可证

[MIT](LICENSE)（与 npm 及 PyPI 包 [lionscraper](https://www.npmjs.com/package/lionscraper) 声明一致）。
