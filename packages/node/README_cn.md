# LionScraper 雄狮采集器 MCP 服务

[English](README.md)

## 这是什么？

**LionScraper 雄狮采集器**是一款浏览器扩展，可以在网页里做列表、文章、链接、图片等采集。本 npm 包提供与扩展配套的**桥接能力**，有两种用法：

- **MCP**（`lionscraper-mcp`）：接到 **AI 软件**（例如 Cursor），在对话里让模型调用采集相关工具。
- **CLI**（`lionscraper`）：在终端里使用 **守护进程**、**scrape**、**ping** 等，与扩展共用同一本地 HTTP/WebSocket 端口。

**真正的采集逻辑在扩展里完成**，本包负责连接与转发。

## 使用前请准备好

1. **浏览器**：Chrome 或 Edge（以扩展实际支持的浏览器为准）。
2. **雄狮采集器扩展**：从对应浏览器的应用市场安装并启用（商店中的名称以页面展示为准）。
   - **Chrome**：[Chrome 网上应用店 — LionScraper](https://chromewebstore.google.com/detail/godiccfjpjdapemodajccjjjcdcccimf)
   - **Microsoft Edge**：[Edge 加载项 — LionScraper](https://microsoftedge.microsoft.com/addons/detail/llfpnjbphhfkgbgljpngbjpjpnljkijk)
3. **Node.js**：电脑需安装 **18 或更高版本**。若尚未安装，可到 [Node.js 官网](https://nodejs.org/) 下载安装包，按提示下一步即可。
4. **若只用 MCP**：需要支持 MCP 的 AI 软件（例如 Cursor、Trae 等）。

## 安装（npm）

本包发布在 npm，包名为 **[lionscraper](https://www.npmjs.com/package/lionscraper)**。

```bash
npm install -g lionscraper
```

安装后会得到两个命令：

| 命令 | 作用 |
|------|------|
| **`lionscraper-mcp`** | 面向 AI 软件的薄 MCP（stdio） |
| **`lionscraper`** | 终端 CLI：`daemon`、`stop`、`scrape`、`ping` 等 |

若不全局安装，仍可在 MCP 配置里用 `npx`（例如参数依次为 `-y`、`-p`、`lionscraper`、`lionscraper-mcp`，具体 JSON 以所用软件的 MCP 说明为准）。

---

## MCP（AI 软件）

### 在 AI 软件里添加 MCP

以下以常见 JSON 配置为例（软件界面可能不同，但含义相同）：

**方式 A：已执行过全局安装（推荐）**

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

- **`PORT`**：与扩展 **桥接端口** 一致；默认 **13808**。
- **`TIMEOUT`、`LANG`**：可按需调整；不懂可以先用上面的值。

保存配置后，按软件要求**重启 MCP 或重启软件**，使新配置生效。

### 在浏览器扩展里对齐端口

1. 打开雄狮采集器的**设置或选项页**。
2. 找到 **桥接端口**（或类似名称），设为与上一步 MCP 配置里 **`PORT`** 相同的数字（例如 `13808`）。
3. 若曾改端口或连接异常，可在扩展里使用 **「重新连接」**；仍不行时可尝试 **重新加载扩展** 或重启浏览器。

### 怎样日常使用？（MCP）

1. 保持扩展**已启用**，并尽量让需要采集的页面在浏览器里**打开着**（或按扩展要求操作）。
2. 在 AI 对话里用自然语言说明需求，例如：
   - 「先检查一下雄狮采集器扩展有没有连上。」
   - 「帮我采集这个网页上的列表数据 / 文章正文 / 邮箱 / 电话 / 链接 / 图片。」
3. AI 会通过 MCP 调用扩展；若提示未连接或超时，可先请 AI **再执行一次连接检查**，并确认端口一致、扩展已开启。

### MCP 工具（概要）

服务器注册的工具与扩展能力对应；具体名称与字段以你所用的 **MCP 客户端展示给模型的内容**为准。

| 工具 | 简要说明 |
|------|----------|
| `ping` | 检测扩展是否已连接并完成注册 |
| `scrape` | 自动识别页面结构（列表/表格等），支持分页累采 |
| `scrape_article` | 提取文章正文（如 Markdown）及元数据 |
| `scrape_emails` | 提取页面中的邮箱 |
| `scrape_phones` | 提取电话号码（结构化信息） |
| `scrape_urls` | 提取超链接 URL |
| `scrape_images` | 提取图片 URL 及尺寸、格式等简要信息 |

**关于参数：** 每个字段的完整 JSON 约定应以**客户端里的工具定义**和**随版本更新的权威文档**为准；在 npm 说明里逐条罗列容易过时。**请在 AI 软件中查看工具列表与描述**后再通过 MCP 调用。

---

## CLI（终端）

CLI 通过本机 **`http://127.0.0.1:$PORT`** 访问守护进程的 HTTP 接口（默认端口 **13808**，与扩展一致）。若不指定 **`--api-url`**，执行 **`scrape`** 或 **`ping`** 时通常会**自动尝试拉起**本地守护进程（若环境允许）。

常用命令：

```bash
lionscraper --help
lionscraper daemon              # 常驻运行；同一 PORT 上 HTTP + WebSocket
lionscraper stop                # 停止当前配置端口上的守护进程
lionscraper ping
lionscraper scrape -u https://www.example.com
lionscraper scrape --method article -u https://www.example.com
# 简写：lionscraper -u https://www.example.com   等同于 scrape
```

**`--method`** 指定守护进程调用的采集类型（默认 `scrape`）：`scrape`、`article`、`emails`、`phones`、`urls`、`images`。可多次使用 **`-u` / `--url`** 在一次命令里传入多个地址。

请设置环境变量 **`PORT`**（以及按需 **`DAEMON_AUTH_TOKEN`**），使 CLI 与扩展、MCP 一致。若守护进程不在默认地址，使用 **`--api-url http://127.0.0.1:端口`**。完整开关列表以 **`lionscraper --help`** 为准。

### 采集参数说明与较完整示例

下列参数会转发给扩展（**`--bridge-timeout-ms`** 仅约束本 CLI 等待守护进程/桥接的最长时间）。具体效果仍以**当前扩展版本**为准。

**输出与连接**

| 参数 | 含义 |
|------|------|
| `--format json` 或 `pretty` | 单行 JSON 与缩进美化（默认 `json`） |
| `--raw` | 按工具返回的文本块原样输出，不做二次 JSON 排版 |
| `-o` / `--output <文件>` | 将结果写入文件而非 stdout |

**时间与加载**

| 参数 | 含义 |
|------|------|
| `--delay <毫秒>` | 页面加载后再等待一段时间再采集（适合动态渲染） |
| `--timeout-ms <毫秒>` | **扩展侧**单 URL 任务超时 |
| `--bridge-timeout-ms <毫秒>` | **CLI → 守护进程**本次调用的最长等待 |
| `--scrape-interval <毫秒>` | 多个 URL 时，任务启动间隔 |
| `--concurrency <n>` | 多 URL 时的并发度提示 |
| `--scroll-speed <像素>` | 全局滚动速度（由扩展解释） |
| `--max-pages <n>` | 列表类 **`scrape`** 的分页累加上限 |

**懒加载 / 无限滚动**（对应工具里的 `waitForScroll`）

| 参数 | 含义 |
|------|------|
| `--wait-scroll-speed <像素>` | 每次滚动的步长（像素） |
| `--wait-scroll-interval <毫秒>` | 滚动步之间的间隔 |
| `--wait-max-scroll-height <像素>` | 可选：最多滚动高度 |
| `--scroll-container <选择器>` | 可选：在指定可滚动容器内滚动 |

**语言**

| 参数 | 含义 |
|------|------|
| `--lang zh-CN` 或 `en-US` | 提示扩展/文案语言 |

**附加内容**

| 参数 | 含义 |
|------|------|
| `--include-html` + `true` / `false` | 在支持时于 meta 中附带整页 HTML |
| `--include-text` + `true` / `false` | 在支持时于 meta 中附带整页纯文本 |

**按采集类型的过滤**（示例；完整列表见 `--help`）

- **邮箱**（`--method emails`）：`--email-domain`、`--email-keyword`、`--email-limit`
- **电话**（`--method phones`）：`--phone-type`、`--phone-area-code`、`--phone-keyword`、`--phone-limit`
- **链接**（`--method urls`）：`--url-domain`、`--url-keyword`、`--url-pattern`、`--url-limit`
- **图片**（`--method images`）：`--img-min-width`、`--img-min-height`、`--img-format`、`--img-keyword`、`--img-limit`

**可选浏览器相关**（扩展支持时生效）：`--auto-launch-browser`、`--no-auto-launch-browser`、`--post-launch-wait-ms`。

---

**示例 A — 列表/表格：分页、延时与滚动辅助**

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

- **`--max-pages`**：列表累采最多翻/采 5「页」（语义由扩展决定）。
- **`--delay`**：加载后再等一段时间，减少动态内容未就绪就采集的问题。
- **`--timeout-ms` / `--bridge-timeout-ms`**：分别放宽扩展侧与 CLI 等待；慢站、大页面可适当加大。
- **`--wait-scroll-*`**：缓慢滚动，便于懒加载内容出现后再提取。
- **`-o` 与 `--format pretty`**：输出到文件并缩进，便于人工查看。

---

**示例 B — 文章正文，并请求附带 HTML 快照**

```bash
lionscraper scrape --method article \
  -u https://www.example.com/blog/post-1 \
  --include-html true \
  --timeout-ms 120000 \
  --format json
```

- **`--method article`**：对应 MCP 侧的 **`scrape_article`**（正文多为 Markdown 风格，元数据视扩展而定）。
- **`--include-html true`**：在支持时于 meta 中附带整页 HTML（体积更大）。

---

**示例 C — 邮箱与链接：过滤条件、多 URL**

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

- **邮箱相关参数**：按域名、关键词缩小范围，并用 **`--email-limit`** 限制条数。
- **两个 `-u`**：一次命令处理两个页面；**`--scrape-interval`** 控制任务启动间隔，减轻瞬时压力。

---

**示例 D — 图片：尺寸与格式过滤**

```bash
lionscraper scrape --method images \
  -u https://www.example.com/gallery \
  --img-min-width 240 \
  --img-min-height 240 \
  --img-format webp \
  --img-limit 40 \
  -o gallery-images.json
```

- 在扩展支持时过滤过小缩略图、限定图片格式，并用 **`--img-limit`** 限制返回条数。

---

## 常见问题（白话）

**问：提示扩展未连接、或采集失败？**

- 扩展是否已打开且未被禁用？
- MCP 配置或 CLI 环境里的 **端口** 与扩展里的 **桥接端口** 是否**完全一致**？
- 同一台电脑上尽量避免多套 MCP/CLI 配置冲突。

**问：AI 里已经能看到很多「工具」，是不是就一定连好了？**

不一定。能看到工具只说明 **AI 到本服务**这一段通了；扩展还必须连上同一端口并完成注册。

**问：CLI 提示连不上守护进程？**

可在另一个终端先执行 **`lionscraper daemon`**，或检查 **`PORT`** / **`--api-url`** 是否正确。

## 许可证

MIT（与 npm 包 [lionscraper](https://www.npmjs.com/package/lionscraper) 声明一致）。
