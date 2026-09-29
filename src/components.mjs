/**
 * 工作组件：控制其他工作软件的 MCP 服务器。
 *
 * 每个组件描述自己怎么启动（launch 返回 dsh-mcp-client 的 stdio 配置，或说明为什么不启动），
 * 怎么装进插件的 tools/ 目录（install），运行时统一由 createComponentManager 以 dsh-mcp-client
 * 子插件的形式挂载：不写进 profile，随本插件卸载，设置改了就只重挂受影响的那个组件。
 *
 * 启动时的查找顺序：插件 tools/ 里的安装 → 设置里填的路径（uvPath / officeRepo）→ 旧的兜底
 * （WinGet、PATH、插件旁边的 ../officemcp）。都找不到时状态是「未安装」。
 *
 * 两类组件：Python 组件（Office / Blender / Unity / Godot，runtime 缺省）用 uv 安装；npm 组件（Chrome / Figma /
 * Photoshop，runtime: 'node'）用 npm 装进 tools/<id>，启动时用 `node <入口脚本>`。Node 的查找顺序：
 * tools/node → 设置 nodePath → PATH 里的 node → DSH 自带运行时（Electron 以 Node 模式运行，只能运行不能安装）。
 * 找不到带 npm 的 Node.js 时，安装 npm 组件会先把 Node.js LTS 下载到 tools/node。
 * Figma 还可以改连官方 Figma 桌面版 MCP（streamable-http，不需要安装）。
 * Godot（godot-ai）只从 tools/godot 启动 `godot-ai attach`（stdio 桥），不用 uvx 临时运行：Godot 项目里的插件版本必须和服务器一致，
 * 安装时一并下载同版本、签名校验过的 Godot 插件，installAddon() 把它装进用户指定的 Godot 项目。
 *
 * 状态：未安装（missing）/ 未启动（off）/ 已启动（on：MCP 服务器已挂载）/ 已连接（connected：已启动，且对应程序在运行、
 * MCP 真的够得着它，探测方式见 ./connect.mjs）/ 出错（error）。list() 里的 connection 字段给出探测细节。
 *
 * 新增组件：在 COMPONENTS 里加一项，在 SettingsSchema 里加它的设置键，前端 FIELDS 加对应字段；要支持「已连接」再在 connect.mjs 里加探测。
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  GODOT_MIN_VERSION, MARKER, fetchGodotAddon, godotAddonReady, installGodotAddonToProject, installNode, installNpmPackage, installOffice,
  installUv, installVenvTool, killInstallProcesses, killProcessesUnder, managedPaths, nodeSatisfies, nodeVersion, npmCliNear, npxCliNear,
  packageName, pluginRoot, readMarker, removeDir, resolveGodotProject, venvBin, which,
} from './tools.mjs'
import { PROBE_TTL_MS, appRunningIn, defaultEnv, probeComponent } from './connect.mjs'

export { pluginRoot }

const IS_WIN = process.platform === 'win32'

function wingetLink(file) {
  const local = process.env.LOCALAPPDATA
  if (!local) return null
  const p = join(local, 'Microsoft', 'WinGet', 'Links', file)
  return existsSync(p) ? p : null
}

export const SOURCE_TEXT = { managed: '插件内置', setting: '设置里的路径', system: '系统安装', bundled: 'DSH 自带运行时', remote: '远程地址' }

/** uv：插件 tools/uv → 设置里的 uvPath → WinGet 链接 → PATH。返回 { path, source } 或 null。 */
export function resolveUv(cfg) {
  const m = managedPaths()
  if (existsSync(m.uv)) return { path: m.uv, source: 'managed' }
  if (cfg.uvPath) return { path: cfg.uvPath, source: 'setting' }
  const p = wingetLink('uv.exe') || which('uv')
  return p ? { path: p, source: 'system' } : null
}

/** uvx：插件 tools/uv → uvPath 同目录 → WinGet 链接 → PATH。 */
export function resolveUvx(cfg) {
  const m = managedPaths()
  if (existsSync(m.uvx)) return { path: m.uvx, source: 'managed' }
  if (cfg.uvPath) {
    const sibling = join(dirname(cfg.uvPath), IS_WIN ? 'uvx.exe' : 'uvx')
    if (existsSync(sibling)) return { path: sibling, source: 'setting' }
  }
  const p = wingetLink('uvx.exe') || which('uvx')
  return p ? { path: p, source: 'system' } : null
}

/** 兼容旧导出：返回路径字符串，找不到时返回 null。 */
export function findUv(cfg) { return resolveUv(cfg)?.path ?? null }
export function findUvx(cfg) { return resolveUvx(cfg)?.path ?? null }

/** 插件 tools/<id> 里装好的入口命令；安装记录的包名必须和当前设置一致。 */
function managedEntry(id, spec, entry) {
  const m = managedPaths()
  const exe = venvBin(m.venv(id), entry)
  if (!existsSync(exe)) return null
  const marker = readMarker(m.dir(id))
  if (marker && marker.package && marker.package !== spec) return null
  return exe
}

/** 候选 node：tools/node → 设置 nodePath → PATH。 */
function nodeCandidates(cfg) {
  const m = managedPaths()
  const list = []
  if (existsSync(m.nodeExe)) list.push([m.nodeExe, 'managed'])
  if (cfg.nodePath) list.push([cfg.nodePath, 'setting'])
  const sys = which('node')
  if (sys) list.push([sys, 'system'])
  return list
}

/**
 * 运行 npm 组件用的 Node：tools/node → 设置 nodePath → PATH 里的 node（都要 20.19+ / 22.12+）→ DSH 自带的
 * Electron（ELECTRON_RUN_AS_NODE=1）。返回 { path, source, version, env } 或 null。
 */
export function resolveNode(cfg) {
  for (const [p, source] of nodeCandidates(cfg)) {
    const version = nodeVersion(p)
    if (version && nodeSatisfies(version)) return { path: p, source, version, env: {} }
  }
  if (process.versions.electron && nodeSatisfies(process.versions.node)) {
    return { path: process.execPath, source: 'bundled', version: 'v' + process.versions.node, env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  return null
}

/** 安装用的 npm（必须和 node 在一起）：tools/node → nodePath → PATH。返回 { node, cli, npx, source, version, env } 或 null。 */
export function resolveNpm(cfg) {
  for (const [p, source] of nodeCandidates(cfg)) {
    const cli = npmCliNear(p)
    if (!cli) continue
    const version = nodeVersion(p)
    if (version && nodeSatisfies(version)) return { node: p, cli, npx: npxCliNear(p), source, version, env: {} }
  }
  return null
}

/** 插件 tools/<id> 里 npm 安装的入口脚本；安装记录的包名必须和当前设置一致。 */
function managedNpmEntry(id, spec) {
  const m = managedPaths()
  const marker = readMarker(m.dir(id))
  if (!marker?.entry) return null
  if (marker.package && marker.package !== spec) return null
  const p = join(m.dir(id), marker.entry)
  return existsSync(p) ? p : null
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
    // 代理慢时 uv 默认 30 秒的下载超时不够，首次拉依赖会反复失败（uvx 兜底时有用）。
    env: { UV_HTTP_TIMEOUT: '600', ...(extra.env ?? {}) },
  }
}

function http(serverName, url, extra = {}) {
  return {
    transport: 'streamable-http',
    serverName,
    url,
    headers: {},
    toolCallTimeoutMs: 180000,
    failOnStartupError: false,
    reconnect: RECONNECT,
    ...extra,
  }
}

const NOT_INSTALLED = (what) => `点「下载安装」把 ${what} 装进插件的 tools 目录`
const OFF = { ok: false, reason: '已在设置里关闭' }

/**
 * npm 组件的启动方案：tools/<id> 里的安装（用 resolveNode 找到的 node 直接跑入口脚本，不联网）→
 * 没装时用带 npm 的 Node 的 npx 临时运行（首次会联网下载）→ 都没有时「未安装」。
 */
function npmLaunch(c, cfg, args, env = {}, extra = {}) {
  const spec = c.spec(cfg)
  const entry = managedNpmEntry(c.id, spec)
  if (entry) {
    const node = resolveNode(cfg)
    if (!node) return { ok: false, missing: true, reason: `已装进 tools\\${c.id}，但找不到 Node.js 20.19+ / 22.12+：到「通用 → Node.js」下载安装，或填 node 路径` }
    return {
      ok: true, source: 'managed', runtime: `Node ${node.version}，${SOURCE_TEXT[node.source]}`,
      config: stdio(c.serverName, node.path, [entry, ...args], { ...extra, env: { ...node.env, ...env } }),
    }
  }
  const npm = resolveNpm(cfg)
  if (!npm?.npx) return { ok: false, missing: true, reason: NOT_INSTALLED(spec) }
  const npxEnv = {}
  if (cfg.proxy) Object.assign(npxEnv, { npm_config_proxy: cfg.proxy, npm_config_https_proxy: cfg.proxy })
  if (cfg.npmRegistry) npxEnv.npm_config_registry = cfg.npmRegistry
  return {
    ok: true, source: npm.source, via: 'npx',
    config: stdio(c.serverName, npm.node, [npm.npx, '--yes', spec, ...args], { ...extra, env: { ...npxEnv, ...env } }),
  }
}

function installNpmTool(c, cfg, task, hooks) {
  return installNpmPackage(task, {
    id: c.id, spec: c.spec(cfg), bin: c.bin, npm: hooks.npm, extraArgs: c.installArgs ?? [],
    registry: cfg.npmRegistry, beforeReplace: hooks.beforeReplace,
  })
}

/** chrome-devtools-mcp 的命令行参数（见它的 docs/configuration.md）。 */
export function chromeArgs(cfg) {
  const a = []
  const mode = cfg.chromeConnect || 'launch'
  if (mode === 'browserUrl') {
    a.push(`--browserUrl=${(cfg.chromeBrowserUrl || 'http://127.0.0.1:9222').trim()}`)
  } else {
    if (mode === 'autoConnect') {
      // Chrome 144+：连正在运行的实例（需 chrome://inspect/#remote-debugging）。
      // 显式带上 channel，避免默认值歧义；不传 userDataDir（由 MCP 按 channel 找默认配置目录的 DevToolsActivePort）。
      a.push('--autoConnect')
      a.push(`--channel=${cfg.chromeChannel || 'stable'}`)
    } else if (cfg.chromeChannel && cfg.chromeChannel !== 'stable') {
      a.push(`--channel=${cfg.chromeChannel}`)
    }
    if (mode === 'launch') {
      if (cfg.chromeHeadless) a.push('--headless')
      if (cfg.chromeUserDataDir) a.push(`--userDataDir=${cfg.chromeUserDataDir.trim()}`)
    }
  }
  const set = cfg.chromeToolset || 'standard'
  if (set === 'slim') a.push('--slim')
  else if (set === 'full') {
    // 内存分析、坐标点击、页面自带的第三方工具；扩展 / PWA 只支持由它自己启动的 Chrome（pipe 连接）。
    a.push('--memoryDebugging', '--experimentalVision', '--categoryExperimentalThirdParty')
    if (mode === 'launch') a.push('--categoryExtensions', '--categoryPwa')
  }
  a.push('--no-usage-statistics')
  return a
}

export const FIGMA_OFFICIAL_URL = 'http://127.0.0.1:3845/mcp'

/** godot-ai attach 的参数：共享后端的 HTTP 端口、Godot 编辑器插件连的 WebSocket 端口（和编辑器设置 godot_ai/http_port、ws_port 一致）。 */
export function godotArgs(cfg) {
  const port = (v, d) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 65536 ? n : d }
  return ['attach', '--port', String(port(cfg.godotHttpPort, 8000)), '--ws-port', String(port(cfg.godotWsPort, 9500))]
}

export const COMPONENTS = [
  {
    id: 'office',
    label: 'Office',
    serverName: 'officemcp',
    summary: '经 COM 控制本机的 Word / Excel / PowerPoint（OfficeMCP）。',
    keys: ['officeEnabled', 'officeRepo', 'officeFolder', 'uvPath'],
    installed() {
      const m = managedPaths()
      return existsSync(m.officePython) && existsSync(join(m.officeRepo, 'pyproject.toml'))
    },
    install(cfg, task, hooks) {
      return installOffice(task, { beforeReplace: hooks.beforeReplace })
    },
    launch(cfg) {
      if (!cfg.officeEnabled) return { ok: false, reason: '已在设置里关闭' }
      if (!IS_WIN) return { ok: false, reason: 'OfficeMCP 依赖 Windows COM，只在 Windows 上启动' }
      const root = pluginRoot()
      const launcher = join(root, 'office', 'launch.py')
      if (!existsSync(launcher)) return { ok: false, reason: `找不到启动脚本：${launcher}` }
      // OfficeMCP 自己的默认目录是 D:\@OfficeMCP，没有 D 盘的机器上会启动即崩，所以退到用户文档目录。
      const folder = cfg.officeFolder || (existsSync('D:\\') ? '' : join(homedir(), 'Documents', 'OfficeMCP'))
      const folderArgs = folder ? ['--folder', folder] : []
      const extra = {
        env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        reconnect: { enabled: true, initialDelayMs: 2000, maxDelayMs: 60000, maxAttempts: 5 },
      }
      // 1) 插件 tools/officemcp：直接用它 venv 里的 python，不经 uv、不联网。
      const m = managedPaths()
      if (this.installed()) {
        return { ok: true, source: 'managed', config: stdio('officemcp', m.officePython, [launcher, ...folderArgs], { ...extra, cwd: m.officeRepo }) }
      }
      // 2) 设置里的仓库 / 3) 插件旁边的 ../officemcp：照旧经 uv run（--with pillow 给 ScreenShot 用）。
      const repo = resolve(cfg.officeRepo || join(root, '..', 'officemcp'))
      if (!existsSync(join(repo, 'pyproject.toml'))) {
        return { ok: false, missing: true, reason: cfg.officeRepo ? `找不到 OfficeMCP 仓库：${repo}` : NOT_INSTALLED('OfficeMCP') }
      }
      const uv = resolveUv(cfg)
      if (!uv) return { ok: false, missing: true, reason: '找不到 uv，点「下载安装」会自动下载 uv 和 OfficeMCP' }
      const args = ['run', '--quiet', '--directory', repo, '--with', 'pillow', 'python', launcher, ...folderArgs]
      return { ok: true, source: cfg.officeRepo ? 'setting' : 'system', config: stdio('officemcp', uv.path, args, { ...extra, cwd: repo }) }
    },
  },
  {
    id: 'blender',
    label: 'Blender',
    serverName: 'blender',
    summary: '控制正在打开的 Blender（mcp-for-blender），Blender 里需要启用对应插件。',
    keys: ['blenderEnabled', 'blenderPackage', 'uvPath'],
    spec: (cfg) => cfg.blenderPackage || 'mcp-for-blender',
    installed(cfg) { const spec = this.spec(cfg); return !!managedEntry('blender', spec, packageName(spec)) },
    install(cfg, task, hooks) {
      const spec = this.spec(cfg)
      return installVenvTool(task, { id: 'blender', spec, entry: packageName(spec), beforeReplace: hooks.beforeReplace })
    },
    launch(cfg) {
      if (!cfg.blenderEnabled) return { ok: false, reason: '已在设置里关闭' }
      const spec = this.spec(cfg)
      const exe = managedEntry('blender', spec, packageName(spec))
      if (exe) return { ok: true, source: 'managed', config: stdio('blender', exe, []) }
      const uvx = resolveUvx(cfg)
      if (!uvx) return { ok: false, missing: true, reason: NOT_INSTALLED(spec) }
      return { ok: true, source: uvx.source, viaUvx: true, config: stdio('blender', uvx.path, [spec]) }
    },
  },
  {
    id: 'unity',
    label: 'Unity',
    serverName: 'unity',
    summary: '控制 Unity 编辑器（Coplay mcp-for-unity），编辑器需装 MCP for Unity 包并开着工程。',
    keys: ['unityEnabled', 'unityPackage', 'uvPath'],
    spec: (cfg) => cfg.unityPackage || 'mcpforunityserver',
    installed(cfg) { return !!managedEntry('unity', this.spec(cfg), 'mcp-for-unity') },
    install(cfg, task, hooks) {
      return installVenvTool(task, { id: 'unity', spec: this.spec(cfg), entry: 'mcp-for-unity', beforeReplace: hooks.beforeReplace })
    },
    launch(cfg) {
      if (!cfg.unityEnabled) return { ok: false, reason: '已在设置里关闭' }
      const spec = this.spec(cfg)
      const args = ['--transport', 'stdio']
      const exe = managedEntry('unity', spec, 'mcp-for-unity')
      if (exe) return { ok: true, source: 'managed', config: stdio('unity', exe, args) }
      const uvx = resolveUvx(cfg)
      if (!uvx) return { ok: false, missing: true, reason: NOT_INSTALLED(spec) }
      return { ok: true, source: uvx.source, viaUvx: true, config: stdio('unity', uvx.path, ['--from', spec, 'mcp-for-unity', ...args]) }
    },
  },
  {
    id: 'figma',
    label: 'Figma',
    serverName: 'figma',
    runtime: 'node',
    summary: '读写 Figma 设计稿（figma-console-mcp，经 Figma 桌面版里的 Desktop Bridge 插件）；也可以改连官方 Figma 桌面版 MCP。',
    keys: ['figmaEnabled', 'figmaMode', 'figmaToken', 'figmaOfficialUrl', 'figmaPackage', 'nodePath'],
    spec: (cfg) => cfg.figmaPackage || 'figma-console-mcp',
    bin: 'figma-console-mcp',
    installed(cfg) { return !!managedNpmEntry('figma', this.spec(cfg)) },
    install(cfg, task, hooks) { return installNpmTool(this, cfg, task, hooks) },
    launch(cfg) {
      if (!cfg.figmaEnabled) return OFF
      if (cfg.figmaMode === 'official') {
        const url = String(cfg.figmaOfficialUrl || FIGMA_OFFICIAL_URL).trim()
        let u
        try { u = new URL(url) } catch { return { ok: false, reason: `官方 MCP 地址无效：${url}` } }
        if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: `官方 MCP 地址只支持 http(s)：${url}` }
        return { ok: true, source: 'remote', config: http('figma', url) }
      }
      const env = {}
      if (cfg.figmaToken && cfg.figmaToken.trim()) env.FIGMA_ACCESS_TOKEN = cfg.figmaToken.trim()
      return npmLaunch(this, cfg, [], env)
    },
  },
  {
    id: 'photoshop',
    label: 'Photoshop',
    serverName: 'photoshop',
    runtime: 'node',
    summary: '经 COM 控制本机的 Adobe Photoshop（photoshop-mcp），不需要装 Photoshop 插件。',
    keys: ['photoshopEnabled', 'photoshopPath', 'photoshopPackage', 'nodePath'],
    spec: (cfg) => cfg.photoshopPackage || '@alisaitteke/photoshop-mcp',
    bin: 'photoshop-mcp',
    // 可选依赖里只有它自带 UI 用的 Claude Agent SDK 平台包（Windows 上 235 MB），MCP 服务器用不到；
    // 安装脚本只给 better-sqlite3 编译 / 下载原生模块（也只有 UI 用），跳过后 MCP 服务器照常工作。
    installArgs: ['--omit=optional', '--ignore-scripts'],
    installed(cfg) { return !!managedNpmEntry('photoshop', this.spec(cfg)) },
    install(cfg, task, hooks) { return installNpmTool(this, cfg, task, hooks) },
    launch(cfg) {
      if (!cfg.photoshopEnabled) return OFF
      if (!IS_WIN && process.platform !== 'darwin') return { ok: false, reason: 'photoshop-mcp 只支持 Windows（COM）和 macOS（AppleScript）' }
      // 关掉它默认开启的匿名统计和反馈提问。
      const env = { ANALYTICS_DISABLED: '1', PSMCP_FEEDBACK: '0' }
      if (cfg.photoshopPath && cfg.photoshopPath.trim()) env.PHOTOSHOP_PATH = cfg.photoshopPath.trim()
      // 创成式填充等操作较慢，工具调用超时放宽到 5 分钟。
      return npmLaunch(this, cfg, [], env, { toolCallTimeoutMs: 300000 })
    },
  },
  {
    id: 'chrome',
    label: 'Chrome',
    serverName: 'chrome',
    runtime: 'node',
    summary: '控制本机的 Google Chrome（Chrome DevTools MCP）：网页操作、截图快照、网络 / 控制台、性能分析、设备模拟等。',
    keys: ['chromeEnabled', 'chromePackage', 'chromeConnect', 'chromeBrowserUrl', 'chromeChannel', 'chromeHeadless', 'chromeUserDataDir', 'chromeToolset', 'nodePath'],
    spec: (cfg) => cfg.chromePackage || 'chrome-devtools-mcp',
    bin: 'chrome-devtools-mcp',
    installed(cfg) { return !!managedNpmEntry('chrome', this.spec(cfg)) },
    install(cfg, task, hooks) { return installNpmTool(this, cfg, task, hooks) },
    launch(cfg) {
      if (!cfg.chromeEnabled) return OFF
      // 关掉 Google 的使用统计和 npm 更新检查（更新由「重新安装」负责）。
      const env = { CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1', CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1' }
      return npmLaunch(this, cfg, chromeArgs(cfg), env)
    },
  },
  {
    id: 'godot',
    label: 'Godot',
    serverName: 'godot',
    summary: `控制 Godot 编辑器（hi-godot/godot-ai），需要 Godot ${GODOT_MIN_VERSION}+，项目里要装同版本的 Godot AI 插件。`,
    // godotProject 只给「安装插件到项目」用，改了不需要重挂。
    keys: ['godotEnabled', 'godotPackage', 'godotHttpPort', 'godotWsPort'],
    spec: (cfg) => cfg.godotPackage || 'godot-ai',
    installed(cfg) { return !!managedEntry('godot', this.spec(cfg), 'godot-ai') },
    /** 替换 / 删除 tools/godot 前：attach 起的共享后端是脱离的 pythonw 进程，DSH 停掉组件后它还会空转约 2 分钟，先结束它释放 venv 里的文件。 */
    beforeRemove(log) { return killProcessesUnder(managedPaths().dir('godot'), log) },
    install(cfg, task, hooks) {
      const self = this
      return installVenvTool(task, {
        id: 'godot',
        spec: this.spec(cfg),
        entry: 'godot-ai',
        // cryptography：给 godot_ai.release_verify 校验插件签名用（godot-ai 的运行依赖里没有它）。
        extraPackages: ['cryptography'],
        beforeReplace: async () => { await hooks.beforeReplace(); await self.beforeRemove(task.log) },
        // 插件包下载失败不算安装失败：服务器照常可用，「安装插件到项目」时会再试。
        afterInstall: async ({ dir, python, version }) => {
          try {
            return { addon: await fetchGodotAddon(task, { dir, python, version }) }
          } catch (error) {
            task.log(`同版本的 Godot 插件没有下载成功（点「安装插件到项目」时会重试）：${error.message}`)
            return { addon: null }
          }
        },
      })
    },
    launch(cfg) {
      if (!cfg.godotEnabled) return OFF
      const spec = this.spec(cfg)
      const exe = managedEntry('godot', spec, 'godot-ai')
      // 不用 uvx 兜底：临时运行的版本不固定，Godot 里的插件版本对不上会被拒绝。
      if (!exe) return { ok: false, missing: true, reason: `${NOT_INSTALLED(spec)}（固定版本，Godot 项目里的插件要装同一版本）` }
      // v4 只接受 attach（stdio 桥，带鉴权）；裸的 http://127.0.0.1:8000/mcp 连不上。关闭匿名统计（attach 起的后端继承这个环境变量）。
      return { ok: true, source: 'managed', config: stdio('godot', exe, godotArgs(cfg), { env: { GODOT_AI_DISABLE_TELEMETRY: 'true', PYTHONIOENCODING: 'utf-8' } }) }
    },
    /** 管理页安装行下面的说明：装的是哪个版本、Godot 项目里的插件要装哪个版本。 */
    note(cfg) {
      const m = managedPaths()
      const marker = this.installed(cfg) ? readMarker(m.dir('godot')) : null
      if (!marker?.version) return `需要 Godot ${GODOT_MIN_VERSION}+。「下载安装」会装 godot-ai 服务器，并下载同版本、签名校验过的 Godot 插件，之后可以一键装进你的 Godot 项目。`
      const v = marker.version
      const addon = marker.addon && marker.addon.version === v && godotAddonReady(m.dir('godot'))
        ? `同版本插件已下载并校验签名（${marker.addon.files} 个文件），填好项目路径后点「安装插件到项目」。`
        : `同版本插件包还没下载好（点「安装插件到项目」时会重试），也可以从 GitHub Release v${v} 手动下载 godot-ai-v4-plugin.zip，解压到项目根目录（得到 addons/godot_ai/plugin.cfg）。`
      return `服务器 godot-ai ${v}（已固定）：Godot 项目里的插件 addons/godot_ai/plugin.cfg 也必须是 ${v}；需要 Godot ${GODOT_MIN_VERSION}+。${addon}`
    },
    /** 把同版本插件装进 Godot 项目（先校验项目路径；插件包缺了就先下载）。 */
    async installAddon(cfg, project, { procs, log } = {}) {
      resolveGodotProject(project)
      const spec = this.spec(cfg)
      if (!managedEntry('godot', spec, 'godot-ai')) throw httpError(409, '先点「下载安装」装好 godot-ai 服务器')
      const m = managedPaths()
      const dir = m.dir('godot')
      const marker = readMarker(dir) || {}
      const version = marker.version
      if (!version) throw httpError(409, '安装记录里没有 godot-ai 的版本，请「重新安装」')
      const python = venvBin(m.venv('godot'), 'python')
      if (!(marker.addon && marker.addon.version === version && godotAddonReady(dir))) {
        const task = { proxy: cfg.proxy || '', step() {}, log: (l) => log?.(l) }
        try {
          marker.addon = await fetchGodotAddon(task, { dir, python, version })
        } catch (error) {
          throw httpError(502, `下载同版本的 Godot 插件失败：${error.message}（检查「通用 → 下载代理」，或从 GitHub Release v${version} 手动下载 godot-ai-v4-plugin.zip 解压到项目根目录）`)
        }
        await writeFile(join(dir, MARKER), JSON.stringify(marker, null, 2))
      }
      let running = false
      try { running = appRunningIn(await procs?.(), 'godot') } catch {}
      return installGodotAddonToProject({ project, dir, python, version, godotRunning: running })
    },
  },
]

export function componentById(id) {
  return COMPONENTS.find((c) => c.id === id)
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const LOG_KEEP = 400
const LOG_SHOW = 80

function idleInstall() {
  return { state: 'idle', step: '', log: [], error: null, startedAt: null, finishedAt: null }
}

/**
 * 管理所有组件的挂载与安装。getConfig 返回当前设置；每次 sync() 只重挂设置键变化了的组件。
 * 安装串行排队（共用 tools/python 和 uv 缓存），同一组件不能重复排队；装完自动重挂该组件。
 */
export function createComponentManager(ctx, getConfig, options = {}) {
  const state = new Map(COMPONENTS.map((c) => [c.id, { key: null, fork: null, status: 'off', detail: '尚未启动', command: null, source: null, generation: 0, rev: 0, suspended: false }]))
  // 「已连接」探测结果，按组件记；gen 对不上 state.generation（组件重挂 / 停掉过）就作废。
  const conns = new Map(COMPONENTS.map((c) => [c.id, { gen: -1, state: 'checking', detail: '正在检查连接', via: null, checkedAt: 0, inflight: null }]))
  const probeEnv = { ...defaultEnv, ...(options.probeEnv ?? {}) }
  const installs = new Map(['uv', 'node', ...COMPONENTS.map((c) => c.id)].map((id) => [id, idleInstall()]))
  let queue = Promise.resolve()
  let mcpClient = null
  let disposed = false
  const addonBusy = new Set() // 正在「安装插件到项目」的组件

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
    const s = state.get(component.id)
    if (s.suspended || disposed) return
    const cfg = getConfig()
    const key = JSON.stringify([s.rev, ...component.keys.map((k) => cfg[k])])
    if (key === s.key) return
    s.key = key
    stop(s)
    const generation = s.generation
    let plan
    try { plan = component.launch(cfg) } catch (error) { plan = { ok: false, reason: String(error?.message ?? error) } }
    if (!plan.ok) {
      s.status = plan.missing ? 'missing' : 'off'
      s.detail = plan.reason
      s.source = null
      return
    }
    try {
      const plugin = await loadMcpClient()
      if (generation !== s.generation) return
      s.fork = ctx.plugin(plugin, plan.config)
      s.status = 'on'
      s.source = plan.source
      s.command = plan.config.transport === 'streamable-http' ? plan.config.url : [plan.config.command, ...plan.config.args].join(' ')
      const via = plan.via ?? (plan.viaUvx ? 'uvx' : null)
      const how = plan.source === 'remote'
        ? `连接 ${plan.config.url}`
        : via ? `${SOURCE_TEXT[plan.source]}的 ${via} 临时运行，尚未装进插件` : SOURCE_TEXT[plan.source] + (plan.runtime ? `，${plan.runtime}` : '')
      s.detail = `已挂载（${how}），工具名前缀 mcp__${component.serverName}__`
    } catch (error) {
      if (generation !== s.generation) return
      s.status = 'error'
      s.detail = String(error?.message ?? error)
      ctx.logger?.warn?.(`dsh-workbench: failed to start ${component.id}`, error)
    }
  }

  /** 停掉组件并暂停同步（安装时替换文件前调用），等子进程退出释放文件。 */
  async function suspend(id, detail = '正在安装，完成后自动重新挂载') {
    const s = state.get(id)
    if (!s) return
    const wasRunning = !!s.fork
    s.suspended = true
    stop(s)
    s.key = null
    s.status = 'off'
    s.detail = detail
    if (wasRunning) await delay(1500)
  }

  async function resume(id) {
    const s = state.get(id)
    if (!s) return
    s.suspended = false
    s.key = null
    s.rev++
    await syncOne(componentById(id))
  }

  /** 正在用 dir 里的程序运行的组件（替换 / 删除 tools/uv、tools/node 前要先停）。 */
  function componentsUsing(dir) {
    const d = dir.toLowerCase()
    return COMPONENTS.filter((c) => state.get(c.id).command?.toLowerCase().startsWith(d)).map((c) => c.id)
  }
  const componentsUsingManagedUv = () => componentsUsing(dirname(managedPaths().uv))
  const componentsUsingManagedNode = () => componentsUsing(managedPaths().node)

  function makeTask(job, proxy) {
    return {
      proxy: proxy || '',
      step(text) { job.step = text },
      log(line) {
        const text = String(line)
        job.log.push(text)
        if (job.log.length > LOG_KEEP) job.log.splice(0, job.log.length - LOG_KEEP)
      },
    }
  }

  /** 下载前置工具（uv / Node.js）到 tools/，进度记在 job 上；失败时抛错（错误已记进 job）。 */
  async function runPrereqInstall(job, cfg, installer) {
    job.state = 'installing'
    job.startedAt ??= Date.now()
    const task = makeTask(job, cfg.proxy)
    try {
      await installer(task)
      job.state = 'done'
      job.step = '安装完成'
      task.log('安装完成')
    } catch (error) {
      job.state = 'error'
      job.error = String(error?.message ?? error)
      job.step = '安装失败'
      task.log(`错误：${job.error}`)
      throw error
    } finally {
      job.finishedAt = Date.now()
    }
  }

  const runUvInstall = (job, cfg) => runPrereqInstall(job, cfg, (task) => installUv(task))
  // Node.js：替换 tools/node 前先停掉正在用它的组件（只有在 beforeReplace 时才停，下载期间组件照常运行）。
  function runNodeInstall(job, cfg) {
    let users = []
    const done = runPrereqInstall(job, cfg, (task) => installNode(task, {
      beforeReplace: async () => {
        users = componentsUsingManagedNode()
        for (const u of users) await suspend(u, '正在更新 Node.js，完成后自动重新挂载')
      },
    }))
    return done.finally(async () => { for (const u of users) await resume(u) })
  }

  async function runPrereqJob(id, job) {
    const cfg = getConfig()
    const users = id === 'uv' ? componentsUsingManagedUv() : []
    for (const u of users) await suspend(u, '正在更新 uv，完成后自动重新挂载')
    try {
      await (id === 'uv' ? runUvInstall(job, cfg) : runNodeInstall(job, cfg))
    } catch (error) {
      ctx.logger?.warn?.(`dsh-workbench: install ${id} failed`, error)
    } finally {
      for (const u of users) await resume(u)
    }
    // uv / Node 到位后，之前「未安装」的组件可以用 uvx / npx 兜底启动了。
    for (const c of COMPONENTS) if (state.get(c.id).status === 'missing') await resume(c.id)
  }

  async function runInstall(id, job) {
    if (disposed) return
    if (id === 'uv' || id === 'node') return runPrereqJob(id, job)
    const cfg = getConfig()
    const component = componentById(id)
    job.state = 'installing'
    job.startedAt = Date.now()
    const task = makeTask(job, cfg.proxy)
    let suspended = false
    let ok = false
    const hooks = { beforeReplace: async () => { suspended = true; await suspend(id) } }
    try {
      if (component.runtime === 'node') {
        let npm = resolveNpm(cfg)
        if (!npm) {
          task.step('先安装 Node.js')
          task.log('没有找到带 npm 的 Node.js 20.19+ / 22.12+，先下载 Node.js 到插件 tools/node…')
          const nodeJob = installs.get('node')
          Object.assign(nodeJob, idleInstall(), { state: 'installing', step: '作为依赖自动安装', startedAt: Date.now() })
          try { await runNodeInstall(nodeJob, cfg) } catch (error) { throw new Error(`安装 Node.js 失败：${error.message}`) }
          npm = resolveNpm(cfg)
          if (!npm) throw new Error('Node.js 装好后仍然找不到 npm')
          task.log('Node.js 已就绪')
        }
        task.log(`使用 npm：${SOURCE_TEXT[npm.source]} ${npm.node}（Node ${npm.version}）`)
        hooks.npm = npm
      } else if (!existsSync(managedPaths().uv)) {
        task.step('先安装 uv')
        task.log('插件 tools/uv 里还没有 uv，先下载 uv…')
        const uvJob = installs.get('uv')
        Object.assign(uvJob, idleInstall(), { state: 'installing', step: '作为依赖自动安装', startedAt: Date.now() })
        try { await runUvInstall(uvJob, cfg) } catch (error) { throw new Error(`安装 uv 失败：${error.message}`) }
        task.log('uv 已就绪')
      }
      await component.install(cfg, task, hooks)
      ok = true
      task.log('安装完成')
    } catch (error) {
      ctx.logger?.warn?.(`dsh-workbench: install ${id} failed`, error)
      job.state = 'error'
      job.error = String(error?.message ?? error)
      job.step = '安装失败'
      task.log(`错误：${job.error}`)
    }
    // 装好（或替换过文件）后重挂这个组件：设置里启用着就会改用 tools/ 里的新安装启动。
    if (ok || suspended) {
      if (ok) job.step = '重新挂载组件'
      await resume(id)
    }
    if (ok) {
      job.state = 'done'
      job.step = '安装完成'
    }
    job.finishedAt = Date.now()
  }

  function checkId(id) {
    if (!installs.has(id)) throw httpError(404, `未知组件：${id}`)
    const job = installs.get(id)
    if (job.state === 'installing' || job.state === 'queued') throw httpError(409, `${id} 正在安装，请等它完成`)
    return job
  }

  function publicInstall(id) {
    const j = installs.get(id)
    return { state: j.state, step: j.step, log: j.log.slice(-LOG_SHOW), error: j.error, startedAt: j.startedAt, finishedAt: j.finishedAt }
  }

  function describe(id) {
    return api.list().find((c) => c.id === id)
  }

  /** 当前代的探测记录（组件重挂过就换一条新的「正在检查」）。 */
  function connOf(id) {
    const s = state.get(id)
    let c = conns.get(id)
    if (c.gen !== s.generation) {
      c = { gen: s.generation, state: 'checking', detail: '正在检查连接', via: null, checkedAt: 0, inflight: null }
      conns.set(id, c)
    }
    return c
  }

  function startProbe(component, c, round) {
    const s = state.get(component.id)
    const gen = s.generation
    const prev = c.state
    c.inflight = probeComponent(component, round).then((r) => {
      if (!r || disposed || state.get(component.id).generation !== gen || conns.get(component.id) !== c) return
      // 工具调用超时（服务器可能正忙着执行模型的调用）时，上一次是已连接就先保持，下次再查。
      if (r.timeout && prev === 'connected') r = { ...r, state: 'connected', detail: `${c.detail.replace(/（最近一次检查超时，可能正忙）$/, '')}（最近一次检查超时，可能正忙）` }
      c.state = r.state
      c.detail = r.detail
      c.via = r.via
    }).catch(() => {}).finally(() => {
      c.checkedAt = Date.now()
      c.inflight = null
    })
    return c.inflight
  }

  const api = {
    sync: () => Promise.all(COMPONENTS.map(syncOne)),

    /**
     * 探测已启动组件的连接（结果缓存 PROBE_TTL_MS，同一组件不会并发探测）。
     * 一轮探测共用一次进程列表。waitMs：最多等这么久就返回（探测照常在后台跑完，下次 list() 就能看到）。
     */
    refreshConnections({ force = false, waitMs } = {}) {
      if (disposed) return Promise.resolve()
      const cfg = getConfig()
      let procs = null
      const round = {
        cfg,
        tools: typeof ctx.get === 'function' ? (ctx.get('tools') ?? ctx.tools) : ctx.tools,
        env: probeEnv,
        procs: () => (procs ??= Promise.resolve().then(() => probeEnv.processes()).catch(() => new Set())),
      }
      const now = Date.now()
      const pending = []
      for (const c of COMPONENTS) {
        const s = state.get(c.id)
        if (s.status !== 'on' || !s.fork) continue
        const conn = connOf(c.id)
        if (conn.inflight) pending.push(conn.inflight)
        else if (force || now - conn.checkedAt >= PROBE_TTL_MS) pending.push(startProbe(c, conn, round))
      }
      const all = Promise.all(pending).then(() => {})
      if (!waitMs) return all
      return Promise.race([all, new Promise((r) => { const t = setTimeout(r, waitMs); t.unref?.() })])
    },

    dispose() {
      disposed = true
      killInstallProcesses()
      for (const s of state.values()) stop(s)
    },

    /** 排队安装（或重新安装）；立刻返回，进度看 list() 里的 install 字段。done 是完成时 resolve 的 Promise。 */
    install(id) {
      const job = checkId(id)
      Object.assign(job, idleInstall(), { state: 'queued', step: '排队中' })
      const done = queue.then(() => runInstall(id, job))
      queue = done.catch(() => {})
      return { component: describe(id), done }
    },

    /** 删除插件 tools/ 里的安装（共享的 tools/python 与缓存保留）。 */
    async uninstall(id) {
      const job = checkId(id)
      const m = managedPaths()
      if (id === 'uv') {
        const users = componentsUsingManagedUv()
        for (const u of users) await suspend(u, '正在删除 uv')
        try { await removeDir(dirname(m.uv)) } finally { for (const u of users) await resume(u) }
      } else if (id === 'node') {
        const users = componentsUsingManagedNode()
        for (const u of users) await suspend(u, '正在删除 Node.js')
        try { await removeDir(m.node) } finally { for (const u of users) await resume(u) }
      } else {
        await suspend(id, '正在卸载')
        try {
          await componentById(id)?.beforeRemove?.((line) => ctx.logger?.info?.(`dsh-workbench: ${line}`))
          await removeDir(id === 'office' ? m.officeRepo : m.dir(id))
        } finally { await resume(id) }
      }
      Object.assign(job, idleInstall(), { step: '已卸载', finishedAt: Date.now() })
      return describe(id)
    },

    /**
     * 组件自带的「装进项目」动作（目前只有 Godot：把同版本插件装进 Godot 项目的 addons/godot_ai）。
     * 返回 { action: installed / replaced / same, target, version, message, … }；参数不对抛带 status 的错误。
     */
    async installAddon(id, project) {
      const component = componentById(id)
      if (!component?.installAddon) throw httpError(404, `${id} 没有可以装进项目的插件`)
      const job = installs.get(id)
      if (job.state === 'installing' || job.state === 'queued') throw httpError(409, `${id} 正在安装，请等它完成`)
      if (addonBusy.has(id)) throw httpError(409, '上一次「安装插件到项目」还没完成')
      addonBusy.add(id)
      try {
        return await component.installAddon(getConfig(), project, {
          procs: () => probeEnv.processes(),
          log: (line) => ctx.logger?.info?.(`dsh-workbench: ${line}`),
        })
      } finally {
        addonBusy.delete(id)
      }
    },

    /** 完整安装日志（list() 里只带最后 80 行）。 */
    installLog(id) { return installs.get(id)?.log ?? [] },

    list() {
      const cfg = getConfig()
      const m = managedPaths()
      const uv = resolveUv(cfg)
      const uvMarker = readMarker(dirname(m.uv))
      const uvItem = {
        id: 'uv',
        label: 'uv',
        kind: 'prerequisite',
        summary: 'Python 包管理器，安装和运行 Office / Blender / Unity / Godot 时使用；安装这些组件时会自动下载。',
        enabled: true,
        installed: existsSync(m.uv),
        status: uv ? 'ready' : 'missing',
        source: uv?.source ?? null,
        detail: uv
          ? `${SOURCE_TEXT[uv.source]}：${uv.path}${uv.source === 'managed' && uvMarker?.version ? `（${uvMarker.version}）` : ''}`
          : '安装 Office / Blender / Unity / Godot 时会自动下载，也可以直接点「下载安装」',
        command: uv?.path ?? null,
        install: publicInstall('uv'),
      }
      const node = resolveNode(cfg)
      const npm = resolveNpm(cfg)
      const nodeItem = {
        id: 'node',
        label: 'Node.js',
        kind: 'prerequisite',
        summary: '运行和安装 Chrome / Figma / Photoshop 组件（npm 包）；系统里没有带 npm 的 Node.js 时，安装这些组件会自动下载到 tools/node。',
        enabled: true,
        installed: existsSync(m.nodeExe),
        status: npm || node ? 'ready' : 'missing',
        source: npm?.source ?? node?.source ?? null,
        detail: npm
          ? `${SOURCE_TEXT[npm.source]}：${npm.node}（${npm.version}，带 npm）`
          : node
            ? `${SOURCE_TEXT[node.source]}：${node.path}（${node.version}）可以运行组件，但没有 npm；安装 npm 组件时会自动下载 Node.js`
            : '没有找到 Node.js 20.19+ / 22.12+，安装 npm 组件时会自动下载，也可以直接点「下载安装」',
        command: npm?.node ?? node?.path ?? null,
        install: publicInstall('node'),
      }
      return [uvItem, nodeItem, ...COMPONENTS.map((c) => {
        const s = state.get(c.id)
        let installed = false
        try { installed = c.installed(cfg) } catch {}
        let note = null
        try { note = c.note ? c.note(cfg) : null } catch {}
        const version = installed && c.id !== 'office' ? (readMarker(m.dir(c.id))?.version || null) : null
        // 已启动的组件带上连接探测结果；探测到已连接时 status 升为 connected（已连接 > 已启动 > 已安装 / 未安装）。
        let connection = null
        if (s.status === 'on') {
          const conn = connOf(c.id)
          connection = { state: conn.state, detail: conn.detail, via: conn.via, checkedAt: conn.checkedAt || null }
        }
        return {
          id: c.id,
          label: c.label,
          kind: 'component',
          summary: c.summary,
          serverName: c.serverName,
          enabled: !!cfg[`${c.id}Enabled`],
          installed,
          status: s.status === 'on' && connection?.state === 'connected' ? 'connected' : s.status,
          source: s.source,
          detail: s.detail,
          command: s.command,
          connection,
          version,
          note,
          install: publicInstall(c.id),
        }
      })]
    },
  }
  return api
}
