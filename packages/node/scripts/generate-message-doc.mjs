import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_ROOT = join(__dirname, '..');
const REPO_ROOT = join(NODE_ROOT, '..', '..');
const ZH_PATH = join(NODE_ROOT, 'src', 'locale', 'zh-CN.json');
const EN_PATH = join(NODE_ROOT, 'src', 'locale', 'en-US.json');
const OUT_PATH = join(REPO_ROOT, 'docs', 'message.md');

function fence(s) {
  return '```text\n' + String(s).replace(/\n```/g, '\n\\`\\`\\`') + '\n```\n';
}

function sectionPair(title, zh, en) {
  return `### ${title}\n\n**中文（zh-CN）**\n\n${fence(zh)}**English（en-US）**\n\n${fence(en)}`;
}

function readLocale(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function emitTools(toolsZh, toolsEn) {
  const lines = ['## 一、工具元数据（MCP `tools/list`）', ''];
  lines.push(
    '本节内容由 `packages/node/src/locale/*.json` 的 `tools` 字段生成，经 `mcp/tools.ts` 注册为工具 `description` 与 Zod `describe`（`inputSchema`）。',
    '',
  );

  lines.push('### 公共前缀 `scrapeSharedPrefix`', '');
  lines.push(sectionPair('scrapeSharedPrefix', toolsZh.scrapeSharedPrefix, toolsEn.scrapeSharedPrefix));
  lines.push('');

  const descKeys = Object.keys(toolsZh.descriptions);
  lines.push('### 各工具 `descriptions`', '');
  for (const k of descKeys) {
    lines.push(sectionPair(`\`${k}\``, toolsZh.descriptions[k], toolsEn.descriptions[k]));
    lines.push('');
  }

  const schemaKeys = Object.keys(toolsZh.schema);
  lines.push('### 参数说明 `tools.schema`（与 inputSchema 字段对应）', '');
  for (const k of schemaKeys) {
    lines.push(sectionPair(`\`${k}\``, toolsZh.schema[k], toolsEn.schema[k]));
    lines.push('');
  }

  return lines.join('\n');
}

function emitServerMessages(smZh, smEn) {
  const lines = ['## 二、工具调用结果中的服务端固定文案（`serverMessages`）', ''];
  lines.push(
    '以下字符串经 `i18n/lang.ts` 的 `t()` 注入错误体或 `details`（如 `hint`、`troubleshoot`），出现在 MCP `tools/call` 返回的 JSON 文本中。模板中的 `{{var}}` 为运行时插值。',
    '',
  );

  lines.push(
    sectionPair(
      '`browserNotInstalled.message`',
      smZh.browserNotInstalled.message,
      smEn.browserNotInstalled.message,
    ),
    '',
  );
  lines.push(
    sectionPair(
      '`browserNotInstalled.hint`',
      smZh.browserNotInstalled.hint,
      smEn.browserNotInstalled.hint,
    ),
    '',
  );

  lines.push(
    sectionPair(
      '`extensionNotConnected.message`',
      smZh.extensionNotConnected.message,
      smEn.extensionNotConnected.message,
    ),
    '',
  );
  lines.push(
    sectionPair(
      '`extensionNotConnected.hint`',
      smZh.extensionNotConnected.hint,
      smEn.extensionNotConnected.hint,
    ),
    '',
  );

  const tKeys = ['1', '2', '3', '4', '5'];
  lines.push('### `extensionNotConnected.troubleshoot`', '');
  for (const tk of tKeys) {
    lines.push(
      sectionPair(
        `\`troubleshoot.${tk}\``,
        smZh.extensionNotConnected.troubleshoot[tk],
        smEn.extensionNotConnected.troubleshoot[tk],
      ),
      '',
    );
  }

  lines.push(
    sectionPair(
      '`serverDraining.requests`',
      smZh.serverDraining.requests,
      smEn.serverDraining.requests,
    ),
    '',
  );
  lines.push(
    sectionPair(
      '`serverDraining.new_tasks`',
      smZh.serverDraining.new_tasks,
      smEn.serverDraining.new_tasks,
    ),
    '',
  );
  lines.push(
    sectionPair('`bridge.timeout`', smZh.bridge.timeout, smEn.bridge.timeout),
    '',
  );

  lines.push(
    sectionPair('`disconnect.replaced`', smZh.disconnect.replaced, smEn.disconnect.replaced),
    '',
  );
  lines.push(
    sectionPair(
      '`disconnect.extension_gone`',
      smZh.disconnect.extension_gone,
      smEn.disconnect.extension_gone,
    ),
    '',
  );
  lines.push(
    sectionPair(
      '`disconnect.server_shutdown`',
      smZh.disconnect.server_shutdown,
      smEn.disconnect.server_shutdown,
    ),
    '',
  );
  lines.push(
    sectionPair(
      '`mcpTool.responseTruncatedAfterLimit`',
      smZh.mcpTool.responseTruncatedAfterLimit,
      smEn.mcpTool.responseTruncatedAfterLimit,
    ),
    '',
  );

  return lines.join('\n');
}

function emitAppendix(zh, en) {
  const lines = [
    '## 附录：非 MCP 工具结果路径（stderr / WebSocket）',
    '',
    '以下文案**不**随 `tools/call` 的 JSON 返回给 MCP 客户端；仅供运维与扩展联调备查。`bridgeProtocol` 主要作为 WebSocket 关闭原因；`logMessages`、`port` 主要写入 **stderr**。',
    '',
  ];

  const ap = (title, objZh, objEn, keys) => {
    const out = [`### ${title}`, ''];
    for (const k of keys) {
      out.push(sectionPair(`\`${k}\``, objZh[k], objEn[k]), '');
    }
    return out.join('\n');
  };

  const bpKeys = Object.keys(zh.bridgeProtocol);
  lines.push(ap('`bridgeProtocol`', zh.bridgeProtocol, en.bridgeProtocol, bpKeys));
  lines.push('');

  const logKeys = Object.keys(zh.logMessages);
  lines.push(ap('`logMessages`', zh.logMessages, en.logMessages, logKeys));
  lines.push('');

  const portKeys = Object.keys(zh.port);
  lines.push(ap('`port`', zh.port, en.port, portKeys));

  return lines.join('\n');
}

function preamble() {
  return `# LionScraper MCP 客户端可见文案归档

本文档由 \`packages/node\` 内脚本生成，**请勿手工编辑正文中的对照段落**；修改文案请编辑 \`packages/node/src/locale/zh-CN.json\` 与 \`en-US.json\`，然后在仓库根目录执行：

\`\`\`bash
cd packages/node && npm run docs:messages
\`\`\`

（Windows PowerShell：先 \`cd packages/node\`，再 \`npm run docs:messages\`）

## 范围说明

| 类别 | 是否进入 MCP 客户端 | 来源 |
|------|---------------------|------|
| 工具 \`description\`、Zod \`describe\`（\`inputSchema\`） | 是（\`tools/list\`） | \`locale/*.json\` → \`tools\`；\`mcp/tools.ts\` |
| 工具结果中的服务端错误 / 截断提示 | 是（\`tools/call\` 返回的 JSON） | \`serverMessages\` → \`t()\`；\`mcp/handler.ts\` |
| 扩展返回的成功体、每条 URL 的 \`error.message\`、\`summary\` 等 | 是 | **不在本仓库**（浏览器扩展工程）；见下文第三节 |
| \`notifications/progress\` 的 \`message\` | 是（若客户端支持） | 扩展经桥转发，**动态** |
| \`EXTENSION_INTERNAL_ERROR\` 的 \`message\` | 可能 | 常为运行时 \`Error.message\`，非 locale 固定文案 |
| \`port\`、\`logMessages\` | 否 | 主要走 **stderr** |
| \`bridgeProtocol\` | 基本否 | WebSocket **close reason**，面向扩展 |

错误码枚举（英文常量，非翻译文案）见源码：\`packages/node/src/types/errors.ts\`。

`;
}

function extensionPlaceholder() {
  return `## 三、扩展与运行时动态内容（待补充）

以下内容会出现在 MCP 客户端可见的 JSON 或进度通知中，但**字符串来源在浏览器扩展或其它运行时**，本仓库的 locale JSON **不包含**完整列表：

- 采集成功时 \`MultiUrlResult\` 内各 URL 的 \`data\`、\`meta\`、\`summary\` 等字段中可能包含人读提示或反爬说明。
- 单条失败时的 \`error.message\`（扩展侧 i18n 或硬编码）。
- \`notifications/progress\` 的 \`message\` / \`phase\`（桥接透传）。

协议与返回形状说明见：[docs/mcp.md](./mcp.md)。

`;
}

function main() {
  const zh = readLocale(ZH_PATH);
  const en = readLocale(EN_PATH);

  const parts = [
    preamble(),
    emitTools(zh.tools, en.tools),
    '\n',
    emitServerMessages(zh.serverMessages, en.serverMessages),
    '\n',
    extensionPlaceholder(),
    '\n',
    emitAppendix(zh, en),
    '\n',
  ];

  const body = parts.join('\n');
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, body, 'utf8');
  console.log('Wrote', OUT_PATH);
}

main();
