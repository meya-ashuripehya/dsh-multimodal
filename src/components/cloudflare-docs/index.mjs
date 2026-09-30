/**
 * 工作组件：cloudflare-docs（公开 Cloudflare 文档 MCP，无需登录）
 * @see ../../../docs/component-module.md
 * 上游：https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-catalog/
 */
import { http, OFF } from '../shared.mjs'
import { mcpNotReady, result } from '../../connect-lib.mjs'

export const id = 'cloudflare-docs'

export const app = { name: 'Cloudflare Docs（公开 MCP）', exe: '—', match: /$^/ }

export const meta = {
  id: 'cloudflare-docs',
  title: 'Cloudflare Docs',
  group: '工作组件',
  url: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-catalog/',
  serverName: 'cloudflare-docs',
  summary: 'Cloudflare 文档 MCP（公开，无需登录）。查文档不必等 API 授权。',
}

const DEFAULT_URL = 'https://docs.mcp.cloudflare.com/mcp'

/** @type {import('../shared.mjs').ComponentModule} */
export const component = {
  id: 'cloudflare-docs',
  label: 'Cloudflare Docs',
  url: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-catalog/',
  serverName: 'cloudflare-docs',
  summary: 'Cloudflare 文档 MCP（公开 HTTP，无需登录）。',
  keys: ['cloudflare-docsEnabled', 'cloudflare-docsUrl'],
  installed() { return true },
  launch(cfg) {
    if (!cfg['cloudflare-docsEnabled']) return OFF
    const url = String(cfg['cloudflare-docsUrl'] || DEFAULT_URL).trim()
    let u
    try { u = new URL(url) } catch { return { ok: false, reason: `地址无效：${url}` } }
    if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: `只支持 http(s)：${url}` }
    return { ok: true, source: 'remote', config: http('cloudflare-docs', url) }
  },
  note() {
    return '远程公开端点，无需下载安装。与「Cloudflare」API 组件互补：文档查询走这里。'
  },
}

export async function probe(ctx) {
  const nr = mcpNotReady(ctx, this); if (nr) return nr
  return result('connected', 'Cloudflare Docs MCP 已挂载', 'mcp')
}

export default component
