# LionScraper 雄狮采集器 MCP + CLI 服务

## 这是什么？

**LionScraper 雄狮采集器**是一款浏览器扩展，可以在网页里做列表、文章、链接、图片等采集。本仓库提供的是配套的 **MCP 服务**：把它连到你使用的 **AI 软件**（例如 Cursor）之后，你就可以在对话里请 AI 帮你调用扩展去完成采集，而不必自己点遍每个菜单。

可以把它理解成一座「小桥」：AI 软件在一边，浏览器扩展在另一边，中间由本服务负责传话。**真正的采集逻辑在扩展里完成**，本服务只做连接与转发。

## 使用前请准备好

1. **浏览器**：Chrome 或 Edge（以扩展实际支持的浏览器为准）。
2. **雄狮采集器扩展**：从浏览器扩展商店安装并启用（名称以商店展示为准）。
3. **Node.js**：电脑需安装 **18 或更高版本**。若尚未安装，可到 [Node.js 官网](https://nodejs.org/) 下载安装包，按提示下一步即可。
4. **支持 MCP 的 AI 软件**：例如 Cursor、Trae 等（以各软件是否支持 MCP 为准）。

## 安装 MCP 服务（npm 市场包）

本服务已发布在 npm，包名为 **[lionscraper](https://www.npmjs.com/package/lionscraper)**。你可以打开该链接查看说明与版本信息。

在电脑打开终端（Windows 上可以是「命令提示符」或 PowerShell），执行：

```bash
npm install -g lionscraper
```

安装成功后，系统里会多出两个常用命令：**`lionscraper-mcp`**（给 AI 软件连 MCP 用）和 **`lionscraper`**（终端 CLI）。二者都依赖同一套本地守护进程与扩展桥接，**`PORT`**（默认 **13808**）须与扩展里的**桥接端口**一致。

若你**不想**全局安装，也可以在 AI 软件的 MCP 配置里用 `npx` 临时拉取并运行（需已安装 Node.js）。示例思路：把启动命令设为 `npx`，参数依次为 `-y`、`-p`、`lionscraper`、`lionscraper-mcp`（具体 JSON 格式见你所用软件的 MCP 配置说明）。

## CLI（终端）

在已全局安装的前提下，可在终端使用 **`lionscraper`** 做脚本化采集或与 MCP **并行**使用（共用 **`lionscraper daemon`** 与 **`PORT`**）：

- **`lionscraper daemon`**：常驻运行，在同一端口上提供 HTTP（CLI / 薄 MCP 调用）与 WebSocket（扩展连接）。
- **`lionscraper stop`**：停止当前配置端口上的守护进程。
- **`lionscraper ping`**：检查扩展是否已在桥上注册（不经过 MCP 对话）。
- **`lionscraper scrape`**：发起采集；可用 **`--method`** 选择列表/正文/邮箱/电话/链接/图片等模式，与 MCP 工具能力对应。

示例：

```bash
lionscraper daemon
lionscraper ping
lionscraper scrape -u https://www.example.com
```

更完整的参数说明、多 URL、分页与过滤等，见本仓库 [packages/node/README_cn.md](packages/node/README_cn.md)；英文与 npm 展示页一致，见 [npm 上的 lionscraper 包](https://www.npmjs.com/package/lionscraper)。

## 在 AI 软件里添加 MCP

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

- **`PORT`**：本服务和扩展用来通信的端口号，默认 **13808**。请与扩展设置里的 **桥接端口** 填成**同一个数字**。
- **`TIMEOUT`、`LANG`**：可按需调整；不懂可以先用上面的值。

保存配置后，按软件要求**重启 MCP 或重启软件**，使新配置生效。

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

## 许可证

MIT（与 npm 包 [lionscraper](https://www.npmjs.com/package/lionscraper) 声明一致）。
