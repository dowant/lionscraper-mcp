# LionScraper MCP Server

本仓库为 **雄狮采集器（LionScraper）** 的独立 **MCP Server** 项目，与 Chrome 扩展仓库分离。Server 负责在 **MCP Client**（如 Cursor、Trae）与 **浏览器扩展** 之间做 **协议转换与数据透传**，不包含页面采集等业务逻辑（业务在扩展侧完成）。

## 架构概览

```
MCP Client  ←─ stdio (MCP) ─→  薄 MCP 子进程 (lionscraper-mcp / mcp.js)
                                    │ HTTP http://127.0.0.1:PORT（与 WS 同端口，默认 13808）
                                    ▼
                          守护进程 (lionscraper daemon)
                                    │ 同端口：HTTP + WebSocket 127.0.0.1:PORT
                                    ▼
                          Extension (background)
```

- **守护进程**：`lionscraper daemon` 在 **同一 `PORT`**（默认 `13808`）上同时提供 **HTTP 控制面**（`/v1/health`、`/v1/tools/call`）与 **WebSocket** 扩展桥；写入 `~/.lionscraper/port`。
- **薄 MCP**：Trae/Cursor 子进程仅 `StdioServerTransport`，把 `tools/call` **转发**到 **`http://127.0.0.1:${PORT}`**（与守护进程及 MCP 子进程环境里的 **`PORT`** 一致）。
- **终端 CLI**：`lionscraper scrape` / `ping` 同样走 HTTP，**不**与守护进程抢端口。
- **扩展**：仍只连 `ws://127.0.0.1:{bridgePort}`，与守护进程 `PORT` 及 `bridgePort` 对齐；桥接载荷见 [docs/mcp.md](docs/mcp.md)。

**重要**：Cursor 能列出 MCP Tools、调用 `scrape_*` 只说明 **第一段** 正常；**第二段**（扩展与当前 MCP 进程之间的 WebSocket + `register`）必须单独建立。插件弹窗里「能采集」通常只说明扩展业务可用，**不**等同于已连上本 Server 的桥。

### 流式进度（`bridgeProgress` → MCP `notifications/progress`）

- **扩展**：在 `register` 的 `capabilities` 中声明 `bridgeProgress` 后，可在单次桥接请求完成前，按 [docs/mcp.md](docs/mcp.md) **§4.6** 发送 **无 `id`** 的 JSON-RPC 通知 `bridgeProgress`（兼容旧方法名 `jobProgress`）。**最终业务结果**仍须通过 **一条** 带相同请求 `id` 的 JSON-RPC **响应**返回。
- **本 Server**：将合法的 `bridgeProgress` 映射为 MCP **`notifications/progress`**，但仅当 MCP Client 在本次 `tools/call` 的 **`params._meta.progressToken`** 中提供了 token 时才会发出（否则仅完成工具结果，不发进度）。
- **MCP Client**：是否在 UI 中展示进度取决于 Cursor / Trae 等宿主是否传入 `progressToken` 并渲染通知；**与扩展是否发 `bridgeProgress` 独立**。
- **手工验证 Cursor**：在支持进度 token 的 Client 版本下，对长耗时工具发起带 `progressToken` 的调用，并确认 stderr（`--debug`）或 MCP 日志中是否出现转发行为；若宿主不传 token，属预期，工具最终结果不受影响。

详细协议、Tool 定义、错误码与连接规则见 [docs/mcp.md](docs/mcp.md)。

## 仓库结构

| 路径 | 说明 |
|------|------|
| [packages/node/](packages/node/) | **Node.js MCP Server** 实现（TypeScript） |
| [packages/python/](packages/python/) | Python 版占位（规划中） |
| [docs/](docs/) | 需求与说明（含 `mcp.md`） |
| [spec/](spec/) | 规范占位目录 |

## 环境要求

- **Node.js** ≥ 18

## 快速开始（Node 包）

```bash
cd packages/node
npm install
npm run build
```

构建产物位于 `packages/node/dist/`。

可先手动启动守护进程，也可依赖 **薄 MCP / `lionscraper scrape|ping`** 在需要时 **自动后台拉起** `lionscraper daemon`（可用环境变量 `LIONSCRAPER_AUTO_DAEMON=0` 关闭自动拉起）：

```bash
node packages/node/dist/lionscraper.js daemon
# 或 npm run start（等同 daemon）
```

守护进程 **stderr** 输出 WebSocket / HTTP 日志；**薄 MCP 子进程**的 **stdout** 仍为 MCP 协议专用。

WebSocket 监听端口会写入 `~/.lionscraper/port`（Windows：`%USERPROFILE%\.lionscraper\port`）。

### 在 Cursor / Trae 中配置 MCP（薄 stdio）

将路径换为你本机 **绝对路径**。在 MCP 配置的 `env` 中设置 **`PORT`**（及 `TIMEOUT`、`LANG` 等），**自动拉起**的子进程会继承同一环境，与扩展 **桥接端口**（`bridgePort`）对齐。

```json
{
  "mcpServers": {
    "lionscraper": {
      "command": "node",
      "args": ["D:/path/to/mcp/packages/node/dist/mcp.js"],
      "env": {
        "PORT": "13808",
        "TIMEOUT": "120000",
        "LANG": "zh-CN"
      }
    }
  }
}
```

全局安装包时也可将 `command` 设为 `lionscraper-mcp`（见 `package.json` 的 `bin`）。

**守护进程**环境变量（在运行 `lionscraper daemon` 的终端、MCP `env` 或启动脚本中设置）：`PORT`（HTTP + WebSocket **共用**，默认 `13808`）、`TIMEOUT`（端口接管等待毫秒）、`AUTO_PING`、`LANG`、`DAEMON_AUTH_TOKEN`（可选，设置后 HTTP 与 MCP 转发均需 `Authorization: Bearer …`）。

### 终端采集（无需配置 MCP）

在守护进程已运行或可自动拉起的前提下：

```bash
node packages/node/dist/lionscraper.js scrape -u https://www.example.com
node packages/node/dist/lionscraper.js scrape --method article -u https://www.example.com
node packages/node/dist/lionscraper.js ping
```

支持 `--api-url`、`--format json|pretty`、`-o` 输出到文件等（`lionscraper --help`）。

### 调试日志

```bash
node packages/node/dist/lionscraper.js daemon --debug
node packages/node/dist/mcp.js --debug
```

（`--debug` 提高 stderr 详细程度；薄 MCP 的 **stdout** 仍为协议通道。）

## 排障：`EXTENSION_NOT_CONNECTED`

含义：当前 MCP Server 进程内**没有**已注册且仍打开的扩展 WebSocket 会话（扩展未连到**本进程**或已断开）。`registeredSessionCount: 0` 即本进程内尚无完成 `register` 的扩展会话。

**不依赖模型**的人工核对（推荐）：

| 步骤 | 做法 |
|------|------|
| 1 | 查看 MCP Server **stderr**：应有 `WebSocket server listening on ws://127.0.0.1:PORT`；扩展连上并注册成功后应有 **`Session registered: ...`**。若出现 **`Connection did not register within ...ms`**，说明有 TCP/WebSocket 连入但未在时限内发送合法 `register`（查扩展后台与协议版本）。 |
| 2 | **端口对齐**：① **守护进程** stderr 中的端口；② `~/.lionscraper/port` 中的数字；③ 扩展选项页 **桥接端口**（`bridgePort`，与 **`PORT`** 一致，默认 `13808`）；④ 薄 MCP 通过 **`http://127.0.0.1:${PORT}`** 访问守护进程（与 WS 同端口）。 |
| 3 | 确认 **守护进程** 在跑且仅 **一个** WebSocket 监听实例；薄 MCP 可多开，勿再跑第二个 `lionscraper daemon`（避免端口与 port 文件冲突）。 |
| 4 | **Service Worker**：`chrome://extensions` → LionScraper → **Service Worker**（或「检查视图」）→ Console：是否连到 `ws://127.0.0.1:PORT`、是否有 `[Bridge] Registered successfully` 或注册失败日志。 |
| 5 | 选项页 **「重新连接」** 会断开并重建 WebSocket + `register`；若仍失败，尝试 **重新加载扩展** 或重启浏览器。 |

工具返回的 `error.details` 中若含 **`bridge.listeningPort`**、**`registeredSessionCount`**，可与 stderr 与 port 文件对照（见 [docs/mcp.md](docs/mcp.md) §3.3）。

**AI 侧**：`ping` 与各采集工具的 `description` 已强调「新会话或 `EXTENSION_NOT_CONNECTED` 后先 ping」；实际调用顺序仍由 MCP Client 内大模型决定。

## 开发调试（MCP Server 与扩展）

### MCP Server（本仓库 `packages/node`）

| 手段 | 说明 |
|------|------|
| 日志 | `lionscraper daemon --debug` 或 `mcp.js --debug`，输出在 **stderr**。 |
| 桥接 | 守护进程 stderr 中 WebSocket 端口与 `Session registered`；与 `~/.lionscraper/port` 对齐。 |
| 单守护 | 本机只保留一个 `lionscraper daemon`；MCP 使用薄 `mcp.js`，勿回到「stdio 进程自带桥」的旧模式。 |
| 测试 | `npm test`（Vitest）。 |

### 浏览器扩展（代码通常在扩展仓库）

| 手段 | 说明 |
|------|------|
| Service Worker | `chrome://extensions` → LionScraper → **Service Worker** / Inspector，查看 Console：WebSocket 是否连到 `ws://127.0.0.1:PORT`、是否有 `[Bridge] Registered successfully` 或注册失败日志。 |
| 重载 / 重连 | 扩展代码改后 **重新加载扩展**；选项页 **重新连接** 会调用 `forceReconnect()`（断开并完整重建连接 + `register`）。 |

## 开发命令（packages/node）

| 命令 | 说明 |
|------|------|
| `npm run build` | TypeScript 编译到 `dist/` |
| `npm run dev` | `tsc --watch` |
| `npm test` | 运行 Vitest 单元测试 |
| `npm run start` | 运行 `dist/lionscraper.js daemon`（也可由薄 MCP / CLI 自动拉起） |

## 提供的 MCP Tools（汇总）

与 [docs/mcp.md](docs/mcp.md) 第 5 节一致，当前 Node 实现共注册 **7** 个工具：

| 工具名 | 作用概要 |
|--------|----------|
| `ping` | 检测 MCP Server 与已连接扩展是否就绪（不经由扩展业务链路） |
| `scrape` | 自动识别页面结构并提取结构化数据（列表/表格等），支持分页累采 |
| `scrape_article` | 提取单页正文（Markdown）及标题、作者等元数据 |
| `scrape_emails` | 从页面提取邮箱地址列表 |
| `scrape_phones` | 从页面提取电话号码（含类型等结构化信息） |
| `scrape_urls` | 从页面提取超链接 URL 列表 |
| `scrape_images` | 从页面提取图片 URL 及尺寸、格式等信息 |

> **未实现**：`smartscrape` 等为 Phase 2 规划项，见 [docs/mcp.md](docs/mcp.md) 第 5.9 节。

### MCP 调用结果如何呈现

Server 使用 `@modelcontextprotocol/sdk` 的 `registerTool` 返回标准 **`CallToolResult`**：

- 成功或业务错误时，结构化结果放在 **`content[0].text`** 中，值为 **JSON 字符串**（需 `JSON.parse`）。
- 成功时扩展返回体通常含 **`ok: true`** 与 **`data` / `meta`**；失败时为 **`ok: false`** 与 **`error`**（见下文「错误约定」）。
- 单条响应默认不超过 **2MB**；超出时 Server 可能截断 `data` 并在 `meta.truncated` 标记（见 [packages/node/src/mcp/handler.ts](packages/node/src/mcp/handler.ts)）。

### 公共参数（多数采集类 Tool）

以下字段在 `scrape`、`scrape_article`、`scrape_emails`、`scrape_phones`、`scrape_urls`、`scrape_images` 中通用（Zod 定义见 [packages/node/src/mcp/tools.ts](packages/node/src/mcp/tools.ts)）。**除 `bridgeTimeoutMs` 仅由 MCP Server 用于 WebSocket 桥接等待、不会下发给扩展外**，其余参数会转发给扩展；Server 侧不做 URL 格式校验、条数上限或采集数值的业务校验；具体限制与默认值见 [docs/mcp.md](docs/mcp.md) §5.1、§9 及 LionScraper 插件配置。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | `string \| string[]` | 是 | 单个或多个目标页面地址（多 URL 语义与结果见 docs §5.x） |
| `delay` | `number` | 否 | 页面加载后延迟（毫秒），默认 `0`，用于动态渲染 |
| `waitForScroll` | 对象 | 否 | 懒加载滚动：`scrollSpeed`（每步像素）、`scrollInterval`；可选 `maxScrollHeight`、`scrollContainerSelector` |
| `timeoutMs` | `number`（≥1000） | 否 | **扩展侧**单 URL 任务超时（毫秒），默认 `60000`，会原样转发给扩展 |
| `bridgeTimeoutMs` | `number`（≥1000） | 否 | **Server 侧**单次工具调用的 WebSocket 最长等待（毫秒），有上限（见 docs）。不传时由 `timeoutMs` × `max(1, url 条数) × max(1, maxPages)`（`maxPages` 仅 `scrape`）及可选 `scrapeInterval` 间隔估算自动推导 |
| `includeHtml` | `boolean` | 否 | 为 `true` 时在结果 `meta` 中附带整页 HTML |
| `includeText` | `boolean` | 否 | 为 `true` 时在结果 `meta` 中附带整页纯文本 |
| `scrapeInterval` | `number` | 否 | 可选：多 URL 时任务启动间隔（毫秒）；不传则用扩展/插件默认 |
| `concurrency` | `number` | 否 | 可选：并发度；不传则用扩展/插件默认 |
| `scrollSpeed` | `number` | 否 | 可选：全局滚动速度（像素）；与 `waitForScroll.scrollSpeed` 不同含义；不传则用扩展默认 |

#### MCP 客户端超时与 `BRIDGE_TIMEOUT`

`BRIDGE_TIMEOUT` 由本 Server 在 **WebSocket 桥接层**判定：扩展在一次工具调用内未在 `bridgeTimeoutMs`（或上述推导值）内返回完整结果即报错。即使已增大 `bridgeTimeoutMs`，若 **MCP 客户端**（如 Cursor、Claude Desktop）对单次 `callTool` 仍使用默认约 **60 秒**的 RPC 超时（与 `@modelcontextprotocol/sdk` 的 `DEFAULT_REQUEST_TIMEOUT_MSEC` 一致），客户端会先断开，表现仍像「一分钟失败」。请在所用客户端的 MCP / 工具请求超时设置中一并放宽（以客户端文档为准）。

#### 修改本仓库并 `npm run build` 后如何生效

MCP Server 是 **独立 Node 进程**，`build` 只会更新 `packages/node/dist/`。需要让 **正在跑 MCP 的客户端重新拉起该进程** 才会加载新 `dist`：

1. 确认 MCP 配置指向 **`dist/mcp.js`**（或全局命令 `lionscraper-mcp`）；该入口为薄 stdio，与包 `main` 一致。守护进程可手动运行或依赖自动拉起。
2. 在客户端中 **关闭再开启该 MCP**（或 **完全重启 Cursor**），以结束旧薄进程并加载新 `dist`。
3. 若使用全局安装，需重新 `npm link` / 重新安装，或把 `args` 改为直接指向本地 `dist/mcp.js`，否则会一直跑旧全局包。

### 错误约定

当扩展未连接、桥接超时或扩展返回失败时，`content[0].text` 解析后形如：

```json
{
  "ok": false,
  "error": {
    "code": "EXTENSION_NOT_CONNECTED",
    "message": "人类可读说明",
    "details": {
      "install": { "chrome": "…", "edge": "…" },
      "troubleshooting": ["…"],
      "bridge": {
        "wsUrl": "ws://127.0.0.1:13808",
        "listeningPort": 13808,
        "registeredSessionCount": 0
      },
      "hint": "…"
    }
  }
}
```

`bridge` 与 `hint` 由本 Server 在已知监听端口时附加，便于与 stderr 及 `~/.lionscraper/port` 对齐。`code` 枚举与排障说明见 [docs/mcp.md](docs/mcp.md) 第 8 节。

---

### `ping`

**简介**：在 **Server 进程内**读取当前已注册扩展会话信息，用于确认扩展已连接并完成 `register`，**不**向扩展再发 WebSocket 业务请求。

**入参**：无（空对象 `{}`）。

**返回**（`content[0].text` 解析后）：

```typescript
{
  ok: true;
  browser: string;           // 如 "chrome" | "edge"
  extensionVersion: string;  // 扩展版本号
}
```

扩展未连接时走统一错误结构（无上述 `ok: true` 体）。

---

### `scrape`

**简介**：对应扩展「简洁采集」——自动识别列表/表格等结构，返回带字段定义的 **`DataGroup[]`**；`maxPages > 1` 时可自动检测分页并翻页累采。

**入参**：公共参数 + 下表：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `maxPages` | `number`（≥1） | 否 | 最大采集页数，默认 `1`；大于 `1` 时启用分页检测与多页合并 |

**返回**（成功时，字段语义以扩展实现为准，与 [docs/mcp.md](docs/mcp.md) 第 5.3 节一致）：

```typescript
{
  ok: true;
  data: DataGroup[];  // 含 fields、dataList、container 等
  meta: ResultMeta & {
    title: string;
    pagesScraped?: number;
  };
}
```

---

### `scrape_article`

**简介**：提取单篇文章/文档页的正文与元数据，正文多为 **Markdown**。

**入参**：仅公共参数（`url` 必填）。

**返回**（成功时，见 [docs/mcp.md](docs/mcp.md) 第 5.4 节）：

```typescript
{
  ok: true;
  data: {
    body: string;       // Markdown 正文
    title: string;
    author?: string;
    time?: string;
    source?: string;
    description?: string;
    keywords?: string[];
    method: string;
    quality: 'high' | 'medium' | 'low';
  };
  meta: ResultMeta;
}
```

---

### `scrape_emails`

**简介**：从页面 HTML 中匹配邮箱并去重，支持按域名/关键词/条数筛选（筛选在扩展侧执行）。

**入参**：公共参数 + 可选 `filter`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `filter.domain` | `string` | 按邮箱域名筛选，如 `gmail.com` |
| `filter.keyword` | `string` | 地址中包含的关键词 |
| `filter.limit` | `number`（≥1） | 最大返回条数 |

**返回**（成功时）：

```typescript
{
  ok: true;
  data: string[];  // 去重后的邮箱列表
  meta: ResultMeta;
}
```

---

### `scrape_phones`

**简介**：从页面提取电话号码，返回号码字符串与类型等结构化信息。

**入参**：公共参数 + 可选 `filter`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `filter.type` | `string` | 如 `mobile`、`landline` |
| `filter.areaCode` | `string` | 区号/国家码，如 `+86`、`010` |
| `filter.keyword` | `string` | 号码中包含的数字片段 |
| `filter.limit` | `number`（≥1） | 最大返回条数 |

**返回**（成功时）：

```typescript
{
  ok: true;
  data: Array<{ number: string; type: string }>;
  meta: ResultMeta;
}
```

---

### `scrape_urls`

**简介**：提取页面中的超链接，去重后可按域名、关键词、正则模式、条数筛选。

**入参**：公共参数 + 可选 `filter`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `filter.domain` | `string` | 域名（含子域） |
| `filter.keyword` | `string` | URL 中包含的关键词 |
| `filter.pattern` | `string` | URL 正则匹配模式 |
| `filter.limit` | `number`（≥1） | 最大返回条数 |

**返回**（成功时）：

```typescript
{
  ok: true;
  data: string[];  // 去重后的 URL 列表
  meta: ResultMeta;
}
```

---

### `scrape_images`

**简介**：收集页面图片的 URL、可选 alt、宽高、大小、格式等；大图/懒加载场景可配合 `delay`、`waitForScroll`。

**入参**：公共参数 + 可选 `filter`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `filter.minWidth` | `number`（≥0） | 最小宽度（像素），过滤小图标 |
| `filter.minHeight` | `number`（≥0） | 最小高度（像素） |
| `filter.format` | `string` | 如 `jpg`、`png`、`webp` |
| `filter.keyword` | `string` | alt 或 URL 中包含的关键词 |
| `filter.limit` | `number`（≥1） | 最大返回条数 |

**返回**（成功时）：

```typescript
{
  ok: true;
  data: Array<{
    url: string;
    alt?: string;
    width?: number;
    height?: number;
    size?: number;
    format?: string;
  }>;
  meta: ResultMeta;
}
```

### `ResultMeta` 补充说明

当使用 `includeHtml` / `includeText` 时，`meta` 可能额外包含 `html`、`text` 等字段；成功时通常还有 `url`、`elapsed` 等。完整类型见 [docs/mcp.md](docs/mcp.md) 第 5.1～5.10 节。

## 许可证

MIT（见 [packages/node/package.json](packages/node/package.json) 中 `license` 字段）。

## 相关文档

- [docs/mcp.md](docs/mcp.md) — MCP / 桥接协议与 Tool 的权威说明
- [docs/task.md](docs/task.md) — 仓库用途简述
