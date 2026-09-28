/**
 * 工作组件：控制其他工作软件的 MCP 服务器。
 *
 * 每个组件描述自己怎么启动（launch 返回 dsh-mcp-client 的 stdio 配置，或说明为什么不启动），
 * 运行时统一由 createComponentManager 以 dsh-mcp-client 子插件的形式挂载：不写进 profile，
 * 随本插件卸载，设置改了就只重挂受影响的那个组件。
 *
 * 新增组件：在 COMPONENTS 里加一项，在 SettingsSchema 里加它的设置键，前端 FIELDS 加对应字段。
 */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function pluginRoot() {
  // 构建后本文件被打进 lib/index.mjs；profile 里是 junction，realpath 后才是真实仓库目录。
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  try { return realpathSync(dir) } catch { return dir }
}

function wingetLink(file) {
  const local = process.env.LOCALAPPDATA
  if (!local) return null
  const p = join(local, 'Microsoft', 'WinGet', 'Links', file)
  return existsSync(p) ? p : null
}

/** uv 可执行文件：设置里填了就用设置，否则找 WinGet 安装的 uv，最后退回 PATH。 */
export function findUv(cfg) {
  return cfg.uvPath || wingetLink('uv.exe') || 'uv'
}

/** uvx：与 uv 同目录的 uvx，找不到就退回 PATH。 */
export function findUvx(cfg) {
  if (cfg.uvPath) {
    const sibling = join(dirname(cfg.uvPath), process.platform === 'win32' ? 'uvx.exe' : 'uvx')
    if (existsSync(sibling)) return sibling
  }
  return wingetLink('uvx.exe') || 'uvx'
}

const RECONNECT = { enabled: true, initialDelayMs: 2000, maxDelayMs: 15000, maxAttempts: 40 }

function stdio(serverName, command, args, extra = {}) {
  return {
    transport: 'stdio',
    serverName,
    command,
    args,
    toolCallTimeoutMs: 180000,
    failOnStartupError: false,
    reconnect: RECONNECT,
    ...extra,
    // 代理慢时 uv 默认 30 秒的下载超时不够，首次拉依赖会反复失败。
    env: { UV_HTTP_TIMEOUT: '600', ...(extra.env ?? {}) },
  }
}

export const COMPONENTS = [
  {
    id: 'office',
    label: 'Office',
    serverName: 'officemcp',
    summary: '经 COM 控制本机的 Word / Excel / PowerPoint（OfficeMCP）。',
    keys: ['officeEnabled', 'officeRepo', 'officeFolder', 'uvPath'],
    launch(cfg) {
      if (!cfg.officeEnabled) return { ok: false, reason: '已在设置里关闭' }
      if (process.platform !== 'win32') return { ok: false, reason: 'OfficeMCP 依赖 Windows COM，只在 Windows 上启动' }
      const root = pluginRoot()
      const repo = resolve(cfg.officeRepo || join(root, '..', 'officemcp'))
      if (!existsSync(join(repo, 'pyproject.toml'))) return { ok: false, reason: `找不到 OfficeMCP 仓库：${repo}` }
      const launcher = join(root, 'office', 'launch.py')
      if (!existsSync(launcher)) return { ok: false, reason: `找不到启动脚本：${launcher}` }
      const args = ['run', '--quiet', '--directory', repo, '--with', 'pillow', 'python', launcher]
      if (cfg.officeFolder) args.push('--folder', cfg.officeFolder)
      return {
        ok: true,
        config: stdio('officemcp', findUv(cfg), args, {
          cwd: repo,
          env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
          reconnect: { enabled: true, initialDelayMs: 2000, maxDelayMs: 60000, maxAttempts: 5 },
        }),
      }
    },
  },
  {
    id: 'blender',
    label: 'Blender',
    serverName: 'blender',
    summary: '控制正在打开的 Blender（mcp-for-blender），Blender 里需要启用对应插件。',
    keys: ['blenderEnabled', 'blenderPackage', 'uvPath'],
    launch(cfg) {
      if (!cfg.blenderEnabled) return { ok: false, reason: '已在设置里关闭' }
      return { ok: true, config: stdio('blender', findUvx(cfg), [cfg.blenderPackage || 'mcp-for-blender']) }
    },
  },
  {
    id: 'unity',
    label: 'Unity',
    serverName: 'unity',
    summary: '控制 Unity 编辑器（Coplay mcp-for-unity），编辑器需装 MCP for Unity 包并开着工程。',
    keys: ['unityEnabled', 'unityPackage', 'uvPath'],
    launch(cfg) {
      if (!cfg.unityEnabled) return { ok: false, reason: '已在设置里关闭' }
      return {
        ok: true,
        config: stdio('unity', findUvx(cfg), ['--from', cfg.unityPackage || 'mcpforunityserver', 'mcp-for-unity', '--transport', 'stdio']),
      }
    },
  },
]

export function componentById(id) {
  return COMPONENTS.find((c) => c.id === id)
}

/**
 * 管理所有组件的挂载。getConfig 返回当前设置；每次 sync() 只重挂设置键变化了的组件。
 */
export function createComponentManager(ctx, getConfig) {
  const state = new Map(COMPONENTS.map((c) => [c.id, { key: null, fork: null, status: 'off', detail: '尚未启动', command: null, generation: 0 }]))
  let mcpClient = null

  async function loadMcpClient() {
    if (mcpClient) return mcpClient
    const loader = ctx.get('loader')
    if (!loader || typeof loader.import !== 'function') throw new Error('宿主没有 loader 服务，无法挂载 dsh-mcp-client')
    const mod = await loader.import('@deepseek-ai/dsh-mcp-client')
    mcpClient = typeof loader.unwrapExports === 'function' ? loader.unwrapExports(mod) : (mod.default ?? mod)
    return mcpClient
  }

  function stop(s) {
    s.generation++
    try { s.fork?.dispose?.() } catch {}
    s.fork = null
    s.command = null
  }

  async function syncOne(component) {
    const cfg = getConfig()
    const s = state.get(component.id)
    const key = JSON.stringify(component.keys.map((k) => cfg[k]))
    if (key === s.key) return
    s.key = key
    stop(s)
    const generation = s.generation
    const plan = component.launch(cfg)
    if (!plan.ok) {
      s.status = 'off'
      s.detail = plan.reason
      return
    }
    try {
      const plugin = await loadMcpClient()
      if (generation !== s.generation) return
      s.fork = ctx.plugin(plugin, plan.config)
      s.status = 'on'
      s.command = [plan.config.command, ...plan.config.args].join(' ')
      s.detail = `已挂载，工具名前缀 mcp__${component.serverName}__`
    } catch (error) {
      if (generation !== s.generation) return
      s.status = 'error'
      s.detail = String(error?.message ?? error)
      ctx.logger?.warn?.(`dsh-workbench: failed to start ${component.id}`, error)
    }
  }

  return {
    sync: () => Promise.all(COMPONENTS.map(syncOne)),
    dispose() { for (const s of state.values()) stop(s) },
    list() {
      const cfg = getConfig()
      return COMPONENTS.map((c) => {
        const s = state.get(c.id)
        return { id: c.id, label: c.label, summary: c.summary, serverName: c.serverName, enabled: !!cfg[`${c.id}Enabled`], status: s.status, detail: s.detail, command: s.command }
      })
    },
  }
}
