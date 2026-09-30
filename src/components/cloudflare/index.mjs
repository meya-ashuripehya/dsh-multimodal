/**
 * 工作组件：cloudflare（官方 Cloudflare API MCP，经 mcp-remote OAuth 桥）
 * @see ../../../docs/component-module.md
 * 上游：https://github.com/cloudflare/mcp-server-cloudflare · 桥接 https://github.com/geelen/mcp-remote
 *
 * mcp.cloudflare.com 不公布 scopes_supported，mcp-remote 0.14.3 会回退申请 openid email profile，
 * 授权页直接拒绝。只申请 offline_access，同意页才会出现，由用户自己勾选权限。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { installNpmTool, managedNpmEntry, mcpRemoteLaunch, OFF } from '../shared.mjs'
import { mcpNotReady, result } from '../../connect-lib.mjs'

export const id = 'cloudflare'

export const app = { name: 'Cloudflare（云端 API MCP）', exe: '—', match: /$^/ }

export const meta = {
  id: 'cloudflare',
  title: 'Cloudflare',
  group: '工作组件',
  url: 'https://github.com/cloudflare/mcp-server-cloudflare',
  serverName: 'cloudflare',
  summary: '官方 Cloudflare API MCP（OAuth / Code Mode）。经 mcp-remote stdio 桥；工具含 docs / search / execute，覆盖整站 API。',
}

const DEFAULT_URL = 'https://mcp.cloudflare.com/mcp'
const REMOTE_ARGS = [
  '--host', '127.0.0.1',
  '--auth-timeout', '180',
  '--static-oauth-client-metadata',
  '{"scope":"offline_access"}',
]

/** @type {import('../shared.mjs').ComponentModule} */
export const component = {
  id: 'cloudflare',
  label: 'Cloudflare',
  url: 'https://github.com/cloudflare/mcp-server-cloudflare',
  serverName: 'cloudflare',
  runtime: 'node',
  summary: '官方 Cloudflare API MCP（OAuth，经 mcp-remote 桥；scope=offline_access）。',
  keys: ['cloudflareEnabled', 'cloudflareUrl', 'cloudflarePackage', 'nodePath'],
  spec: (cfg) => cfg.cloudflarePackage || 'mcp-remote',
  bin: 'mcp-remote',
  installed(cfg) {
    if (managedNpmEntry('cloudflare', this.spec(cfg))) return true
    const home = process.env.USERPROFILE || process.env.HOME || homedir()
    return existsSync(join(home, '.dsh', 'mcp-remote', 'node_modules', 'mcp-remote', 'dist', 'proxy.js'))
  },
  install(cfg, task, hooks) { return installNpmTool(this, cfg, task, hooks) },
  launch(cfg) {
    if (!cfg.cloudflareEnabled) return OFF
    const url = String(cfg.cloudflareUrl || DEFAULT_URL).trim()
    return mcpRemoteLaunch(this, cfg, url, REMOTE_ARGS)
  },
  note() {
    return '首次连接会打开 Cloudflare 授权页；请在同意页自行勾选所需权限（插件只预申请 offline_access）。Token 在 %USERPROFILE%\.mcp-auth。'
  },
}

export async function probe(ctx) {
  const nr = mcpNotReady(ctx, this); if (nr) return nr
  return result('connected', 'Cloudflare API MCP 已挂载（OAuth 经 mcp-remote）', 'mcp')
}

export default component
