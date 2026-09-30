/**
 * 工作组件：github（官方 GitHub MCP 托管端点）
 * @see ../../../docs/component-module.md
 * 上游：https://github.com/github/github-mcp-server
 */
import { http, OFF } from '../shared.mjs'
import { mcpNotReady, result } from '../../connect-lib.mjs'

export const id = 'github'

export const app = { name: 'GitHub（托管 MCP）', exe: '—', match: /$^/ }

export const meta = {
  id: 'github',
  title: 'GitHub',
  group: '工作组件',
  url: 'https://github.com/github/github-mcp-server',
  serverName: 'github',
  summary: '官方 GitHub MCP（托管 streamable-http）。Token 优先读设置里的 githubToken，否则读环境变量 GITHUB_MCP_PAT；不会写入仓库。',
}

const DEFAULT_URL = 'https://api.githubcopilot.com/mcp/'

function resolvePat(cfg) {
  const fromCfg = String(cfg.githubToken || '').trim()
  if (fromCfg) return fromCfg.replace(/^Bearer\s+/i, '')
  const fromEnv = String(process.env.GITHUB_MCP_PAT || '').trim()
  if (fromEnv) return fromEnv.replace(/^Bearer\s+/i, '')
  return ''
}

/** @type {import('../shared.mjs').ComponentModule} */
export const component = {
  id: 'github',
  label: 'GitHub',
  url: 'https://github.com/github/github-mcp-server',
  serverName: 'github',
  summary: '官方 GitHub MCP（托管 HTTP + PAT）。',
  keys: ['githubEnabled', 'githubUrl', 'githubToken'],
  installed() { return true },
  launch(cfg) {
    if (!cfg.githubEnabled) return OFF
    const url = String(cfg.githubUrl || DEFAULT_URL).trim()
    let u
    try { u = new URL(url) } catch { return { ok: false, reason: `地址无效：${url}` } }
    if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: `只支持 http(s)：${url}` }
    const pat = resolvePat(cfg)
    const headers = {}
    if (pat) headers.Authorization = `Bearer ${pat}`
    return { ok: true, source: 'remote', config: http('github', url, { headers }) }
  },
  note(cfg) {
    if (!resolvePat(cfg)) {
      return '未配置 PAT：在设置填写 githubToken，或设置用户环境变量 GITHUB_MCP_PAT（classic / fine-grained，需 repo 等权限）。'
    }
    return 'Token 只存在设置 / 环境变量，不会写入插件仓库。'
  },
}

export async function probe(ctx) {
  if (!resolvePat(ctx.cfg)) {
    return result('unreachable', '未配置 GitHub PAT（设置 githubToken 或环境变量 GITHUB_MCP_PAT）', 'auth')
  }
  const nr = mcpNotReady(ctx, this); if (nr) return nr
  return result('connected', 'GitHub MCP 已挂载（托管端点）', 'mcp')
}

export default component
