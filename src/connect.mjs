/**
 * 「已连接」探测：组件的 MCP 服务器已启动（status on）之后，再看它控制的那个程序是不是真的连得上。
 *
 * 已连接 = (a) 对应程序正在运行 + (b) MCP 这一层真的够得着它。每个组件按它的服务器实际怎么连程序来查，
 * 只用只读、不会拉起程序的办法；程序没在运行时一律不调工具（有的工具会顺手启动程序）：
 *
 *   Office     进程 WINWORD / EXCEL / POWERPNT 等 → 调 OfficeMCP 的 RunningApps（COM GetActiveObject，只读、不启动）
 *   Blender    进程 blender → 服务器已注册工具 → TCP 连 Blender 插件端口（BLENDER_HOST:BLENDER_PORT，默认 localhost:9876，
 *              服务器自己就连这个口）。不调工具：它的工具带遥测上报，get_addon_status 还可能弹同意提示。
 *   Unity      进程 Unity → 服务器已注册工具 → 按 ~/.unity-mcp（或 UNITY_MCP_STATUS_DIR）里的状态 / 端口文件和默认 6400，
 *              照服务器自己的端口探测做一次 FRAMING=1 握手 + ping/pong。不调工具（带遥测）。
 *   Figma      console：进程 Figma → figma_get_status（不带 probe）里 transport.websocket.available 为真，即 Desktop Bridge 已连上；
 *              官方：进程 Figma → TCP 连官方 MCP 地址（Figma 桌面版自己监听的 127.0.0.1:3845）。
 *   Photoshop  进程 Photoshop → photoshop_ping 返回 Successfully connected（服务器找得到 Photoshop；
 *              已设 PSMCP_FEEDBACK=0 / ANALYTICS_DISABLED=1，不会带反馈提问或上报）。不跑 JSX，免得打扰正在用的 Photoshop。
 *   Chrome     launch：看 chrome-devtools-mcp 自己的配置目录有没有被 Chrome 占用（Windows 查 lockfile 是否被独占，
 *              其他系统查 SingletonLock 指向的进程），占用了才调 list_pages——没开时调它会拉起新的 Chrome；
 *              autoConnect：进程 chrome + 该渠道默认配置目录里有 DevToolsActivePort 且端口开着 → list_pages
 *              （Chrome 144+ 的 chrome://inspect/#remote-debugging 开关会写这个文件；端口只有 WebSocket，
 *              /json/version 会 404，这是正常的，不代表没开远程调试；.cache 目录与本模式无关）；
 *              browserUrl：GET <地址>/json/version 成功 → list_pages。
 *   Godot      进程 Godot*（Godot_v4.7-stable_win64 / _console 等，不算 godot-ai 自己）→ session_manage(op=list)
 *              （只读、只查服务器自己的会话表，不碰编辑器）里有已连上的编辑器 → 再调只读的 editor_state 确认编辑器应答。
 *              没有会话时不调 editor_state（免得连续的「无会话」失败触发它的断路器，影响模型随后的调用）。
 *
 * 结果缓存 PROBE_TTL_MS，由 /components 请求按需触发（没人看设置页时不探测），每次探测整体限时 PROBE_TIMEOUT_MS。
 * 工具直接经 ctx.tools 里 dsh-mcp-client 注册的定义调用（走它已有的 MCP 连接，不另起连接），只用上面这些只读工具。
 */
import { execFile } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PROBE_TTL_MS = 6000
export const PROBE_TIMEOUT_MS = 15000
const TOOL_TIMEOUT_MS = 4000
const NET_TIMEOUT_MS = 800
const IS_WIN = process.platform === 'win32'

/** connection.state 的取值（前端据此显示文字 / 颜色）。 */
export const CONN_STATES = ['connected', 'no-app', 'unreachable', 'mcp-down', 'checking']

// ── 程序进程 ──
// 名字统一小写、去掉 .exe；macOS 上是可执行文件名（ps -o comm= 的最后一段）。
export const APPS = {
  office: { name: 'Office（Word / Excel / PowerPoint 等）', exe: 'WINWORD / EXCEL / POWERPNT', match: /^(winword|excel|powerpnt|visio|msaccess|winproj|outlook|mspub|onenote|wps|et|wpp|microsoft (word|excel|powerpoint))$/ },
  blender: { name: 'Blender', exe: 'blender.exe', match: /^blender$/ },
  unity: { name: 'Unity 编辑器', exe: 'Unity.exe', match: /^unity$/ },
  // figma_agent（字体助手）开机常驻，不算 Figma 在运行。
  figma: { name: 'Figma 桌面版', exe: 'Figma.exe', match: /^figma( beta)?$/ },
  photoshop: { name: 'Photoshop', exe: 'Photoshop.exe', match: /photoshop/ },
  chrome: { name: 'Chrome', exe: 'chrome.exe', match: /^(chrome|google chrome( beta| dev| canary)?)$/ },
  // Godot_v4.7-stable_win64(.exe)、…_console、…_mono_win64、Linux / macOS 的 Godot；godot-ai（MCP 服务器自己的入口）不算。
  godot: { name: 'Godot 编辑器', exe: 'Godot_v4.x-stable_win64.exe', match: /^godot(?![-_ ]?ai\b)/ },
}

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(String(stdout))
    })
  })
}

/** 当前进程名集合（小写、无 .exe）。Windows 用 tasklist（CSV 第一列是映像名，和系统语言无关）。 */
export async function listProcesses() {
  const names = new Set()
  if (IS_WIN) {
    const out = await run('tasklist', ['/FO', 'CSV', '/NH'])
    for (const line of out.split(/\r?\n/)) {
      const m = /^"([^"]+)"/.exec(line)
      if (m) names.add(m[1].toLowerCase().replace(/\.exe$/, ''))
    }
  } else {
    const out = await run('ps', ['-A', '-o', 'comm='])
    for (const line of out.split('\n')) {
      const p = line.trim()
      if (p) names.add(p.split('/').pop().toLowerCase())
    }
  }
  return names
}

function appRunning(procs, id) {
  const app = APPS[id]
  for (const n of procs) if (app.match.test(n)) return true
  return false
}

/** 进程名集合里有没有该组件的程序（procs 为空 / 不是集合时算没有）。 */
export function appRunningIn(procs, id) {
  if (!procs || typeof procs[Symbol.iterator] !== 'function' || !APPS[id]) return false
  return appRunning(procs, id)
}

// ── 网络 ──
/** TCP 能不能连上（连上立刻断开，不发数据）。 */
export function tcpOpen(host, port, timeout = NET_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port })
    const done = (ok) => { clearTimeout(timer); sock.destroy(); resolve(ok) }
    const timer = setTimeout(() => done(false), timeout)
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

/** MCP for Unity 桥接的握手 + ping（和服务器 port_discovery._try_probe_unity_mcp 一样的帧格式）。 */
export function unityPing(port, timeout = NET_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port })
    let buf = Buffer.alloc(0)
    let stage = 'hello'
    const done = (ok) => { clearTimeout(timer); sock.destroy(); resolve(ok) }
    const timer = setTimeout(() => done(false), timeout)
    sock.once('error', () => done(false))
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      if (stage === 'hello') {
        const text = buf.toString('latin1')
        if (!text.includes('FRAMING=1')) {
          if (text.includes('\n') || buf.length > 256) done(false)
          return
        }
        stage = 'pong'
        buf = Buffer.alloc(0)
        const header = Buffer.alloc(8)
        header.writeBigUInt64BE(4n)
        sock.write(Buffer.concat([header, Buffer.from('ping')]))
        return
      }
      if (buf.length < 8) return
      const len = Number(buf.readBigUInt64BE(0))
      if (len > 10000) return done(false)
      if (buf.length < 8 + len) return
      done(buf.subarray(8, 8 + len).toString('utf8').includes('"message":"pong"'))
    })
  })
}

/** GET 一个 JSON（只用于 Chrome 调试地址的 /json/version）。 */
export async function httpJson(url, timeout = 1500) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 探测 HTTP 状态（区分「端口没开」和 Chrome 144+ inspect 开关下 /json/version 返回 404）。 */
export async function httpStatus(url, timeout = 1500) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ac.signal })
    return res.status
  } catch {
    return 0
  } finally {
    clearTimeout(timer)
  }
}

/** Chrome 配置目录是不是正被某个 Chrome 占用。 */
export function profileLocked(dir) {
  if (!dir) return false
  if (IS_WIN) {
    // Chrome 运行期间独占打开 <配置目录>\lockfile；打得开（或不存在）就说明没有 Chrome 在用。
    const p = join(dir, 'lockfile')
    if (!existsSync(p)) return false
    try {
      closeSync(openSync(p, 'r+'))
      return false
    } catch (error) {
      return error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES'
    }
  }
  try {
    const target = readlinkSync(join(dir, 'SingletonLock')) // "<host>-<pid>"
    const pid = Number(target.split('-').pop())
    if (!pid) return false
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export const defaultEnv = { processes: listProcesses, tcpOpen, unityPing, httpJson, httpStatus, profileLocked, home: homedir, env: process.env }

// ── 经 dsh-mcp-client 已有连接调用工具 ──
/** 服务器在 ctx.tools 里注册了的工具名（mcp__<server>__*）；拿不到工具表时返回 null。 */
export function mcpToolNames(tools, serverName) {
  const prefix = `mcp__${serverName}__`
  try {
    const view = tools?.view?.()
    if (view?.visible instanceof Map) return [...view.visible.keys()].filter((n) => n.startsWith(prefix))
  } catch {}
  try {
    const list = tools?.schemas?.()
    if (Array.isArray(list)) return list.map((s) => s.name).filter((n) => typeof n === 'string' && n.startsWith(prefix))
  } catch {}
  return null
}

function textOf(value) {
  const content = Array.isArray(value?.content) ? value.content : []
  return content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
}

/** 直接执行 dsh-mcp-client 注册的工具定义（它的 execute 用自己的 MCP 连接发 tools/call）。 */
export async function callMcpTool(tools, serverName, rawName, args = {}, timeoutMs = TOOL_TIMEOUT_MS) {
  const def = typeof tools?.get === 'function' ? tools.get(`mcp__${serverName}__${rawName}`) : undefined
  if (!def || typeof def.execute !== 'function') return { ok: false, missing: true, error: `没有注册工具 ${rawName}` }
  const ac = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { ac.abort(); reject(Object.assign(new Error(`${rawName} ${timeoutMs / 1000} 秒内没有返回`), { timeout: true })) }, timeoutMs)
  })
  try {
    const value = await Promise.race([def.execute(args, { signal: ac.signal }), timeout])
    return { ok: true, value, text: textOf(value) }
  } catch (error) {
    return { ok: false, timeout: !!error?.timeout, error: String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
}

// ── 各组件 ──
const result = (state, detail, via) => ({ state, detail, via })
// 工具调用失败；超时单独标出（服务器可能正忙着执行模型的调用，调用方可以沿用上一次的结果）。
const toolFailed = (r, detail, via) => ({ ...result('unreachable', detail, via), ...(r.timeout ? { timeout: true } : {}) })
const noApp = (id, extra = '') => result('no-app', `没有检测到 ${APPS[id].name} 在运行（${APPS[id].exe}）${extra}`, 'process')

/** 工具结果里的 JSON（structuredContent 优先，其次文本）；取不到返回 null。 */
function jsonOf(r) {
  const sc = r?.value?.structuredContent
  if (sc && typeof sc === 'object') return sc.result && typeof sc.result === 'object' && !Array.isArray(sc.result) ? sc.result : sc
  try { return JSON.parse(r.text) } catch { return null }
}

/** 服务器还没注册任何工具时（连接中 / 重连中 / 已放弃），不算已连接。 */
function mcpNotReady(ctx, component) {
  const names = mcpToolNames(ctx.tools, component.serverName)
  if (names && names.length === 0) return result('mcp-down', 'MCP 服务器还没连上（没有注册任何工具），可能在启动或重连中', 'tools')
  return null
}

function chromeProfileDir(cfg, home) {
  if (cfg.chromeUserDataDir && cfg.chromeUserDataDir.trim()) return cfg.chromeUserDataDir.trim()
  const ch = cfg.chromeChannel && cfg.chromeChannel !== 'stable' ? `chrome-profile-${cfg.chromeChannel}` : 'chrome-profile'
  return join(home, '.cache', 'chrome-devtools-mcp', ch)
}

/** autoConnect 连的是该渠道 Chrome 的默认配置目录。 */
export function chromeDefaultUserDataDir(channel, env, home) {
  const ch = channel || 'stable'
  if (IS_WIN) {
    const base = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    const name = { stable: 'Chrome', beta: 'Chrome Beta', dev: 'Chrome Dev', canary: 'Chrome SxS' }[ch] || 'Chrome'
    return join(base, 'Google', name, 'User Data')
  }
  if (process.platform === 'darwin') {
    const name = { stable: 'Chrome', beta: 'Chrome Beta', dev: 'Chrome Dev', canary: 'Chrome Canary' }[ch] || 'Chrome'
    return join(home, 'Library', 'Application Support', 'Google', name)
  }
  const name = { stable: 'google-chrome', beta: 'google-chrome-beta', dev: 'google-chrome-unstable', canary: 'google-chrome-canary' }[ch] || 'google-chrome'
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), name)
}

function readDevToolsPort(dir) {
  try {
    const [port] = readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)
    const n = Number(port)
    return n > 0 && n < 65536 ? n : null
  } catch {
    return null
  }
}

async function listPages(ctx, component, prefix, timeoutMs = TOOL_TIMEOUT_MS) {
  const r = await callMcpTool(ctx.tools, component.serverName, 'list_pages', {}, timeoutMs)
  if (!r.ok) return toolFailed(r, `${prefix}，但 list_pages 失败：${r.error}`, 'tool:list_pages')
  const pages = (r.text.match(/^\s*\d+:/gm) || []).length
  return result('connected', `${prefix}，list_pages 成功${pages ? `（${pages} 个标签页）` : ''}`, 'tool:list_pages')
}

const PROBES = {
  async office(ctx) {
    if (!appRunning(await ctx.procs(), 'office')) return noApp('office')
    const nr = mcpNotReady(ctx, this); if (nr) return nr
    const r = await callMcpTool(ctx.tools, this.serverName, 'RunningApps')
    if (!r.ok) return toolFailed(r, `Office 程序在运行，但 RunningApps 失败：${r.error}`, 'tool:RunningApps')
    let apps = r.value?.structuredContent?.result
    if (!Array.isArray(apps)) { try { apps = JSON.parse(r.text) } catch { apps = null } }
    if (!Array.isArray(apps)) apps = (r.text.match(/\b(Word|Excel|PowerPoint|Visio|Access|MSProject|Outlook|Publisher|OneNote|Kwps|Ket|Kwpp)\b/g) || [])
    apps = [...new Set(apps.map(String))]
    if (!apps.length) return result('unreachable', 'Office 程序在运行，但 COM 里找不到（刚启动还没注册，或以管理员身份运行）', 'tool:RunningApps')
    return result('connected', `COM 可连接：${apps.join('、')}（RunningApps）`, 'tool:RunningApps')
  },
  async blender(ctx) {
    if (!appRunning(await ctx.procs(), 'blender')) return noApp('blender')
    const nr = mcpNotReady(ctx, this); if (nr) return nr
    const host = ctx.env.env.BLENDER_HOST || 'localhost'
    const port = Number(ctx.env.env.BLENDER_PORT) || 9876
    // 服务器用 Python 的 IPv4 socket 连 localhost，这里同样连 127.0.0.1。
    const ok = await ctx.env.tcpOpen(host === 'localhost' ? '127.0.0.1' : host, port)
    if (!ok) return result('unreachable', `Blender 在运行，但连不上它的 MCP 插件端口 ${host}:${port}：在 Blender 侧栏 BlenderMCP 面板里点 Connect / Start MCP Server`, 'socket')
    return result('connected', `Blender 插件端口 ${host}:${port} 可连接`, 'socket')
  },
  async unity(ctx) {
    if (!appRunning(await ctx.procs(), 'unity')) return noApp('unity')
    const nr = mcpNotReady(ctx, this); if (nr) return nr
    const dir = ctx.env.env.UNITY_MCP_STATUS_DIR || join(ctx.env.home(), '.unity-mcp')
    const ports = []
    const projects = new Map()
    try {
      const files = readdirSync(dir).filter((f) => /^unity-mcp-(status|port)-.*\.json$|^unity-mcp-port\.json$/.test(f))
        .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
      for (const { f } of files) {
        try {
          const data = JSON.parse(readFileSync(join(dir, f), 'utf8'))
          if (Number.isInteger(data.unity_port) && !ports.includes(data.unity_port)) {
            ports.push(data.unity_port)
            if (data.project_path) projects.set(data.unity_port, String(data.project_path).split(/[\\/]/).filter(Boolean).pop())
          }
        } catch {}
      }
    } catch {}
    if (!ports.includes(6400)) ports.push(6400)
    for (const port of ports.slice(0, 4)) {
      if (await ctx.env.unityPing(port)) {
        const project = projects.get(port)
        return result('connected', `MCP for Unity 桥接端口 ${port} 应答 pong${project ? `（工程 ${project}）` : ''}`, 'socket')
      }
    }
    return result('unreachable', `Unity 在运行，但 MCP for Unity 桥接没有应答（试过端口 ${ports.slice(0, 4).join(' / ')}）：在 Unity 里打开 Window → MCP for Unity 并启动桥接`, 'socket')
  },
  async figma(ctx) {
    if (!appRunning(await ctx.procs(), 'figma')) return noApp('figma')
    if (ctx.cfg.figmaMode === 'official') {
      let u
      try { u = new URL(String(ctx.cfg.figmaOfficialUrl || 'http://127.0.0.1:3845/mcp').trim()) } catch { return result('unreachable', '官方 MCP 地址无效', 'socket') }
      const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
      const host = u.hostname.replace(/^\[|\]$/g, '')
      const ok = await ctx.env.tcpOpen(host === 'localhost' ? '127.0.0.1' : host, port)
      if (!ok) return result('unreachable', `Figma 在运行，但连不上官方 MCP 地址 ${u.host}：在 Figma 桌面版 Dev Mode 里启用「桌面版 MCP 服务器」`, 'socket')
      return result('connected', `官方 MCP 地址 ${u.host} 可连接`, 'socket')
    }
    const nr = mcpNotReady(ctx, this); if (nr) return nr
    const r = await callMcpTool(ctx.tools, this.serverName, 'figma_get_status')
    if (!r.ok) return toolFailed(r, `Figma 在运行，但 figma_get_status 失败：${r.error}`, 'tool:figma_get_status')
    let st = null
    try { st = JSON.parse(r.text) } catch {}
    const ws = st?.transport?.websocket
    if (!ws?.available) {
      return result('unreachable', 'Figma 在运行，但 Desktop Bridge 插件没连上：在设计文件里运行「插件 → 开发 → Figma Desktop Bridge」', 'tool:figma_get_status')
    }
    const file = ws.connectedFile?.fileName || (st.currentFileName && !/^\(unable/.test(st.currentFileName) ? st.currentFileName : '')
    return result('connected', `Desktop Bridge 已连上${file ? `：${file}` : ''}（figma_get_status）`, 'tool:figma_get_status')
  },
  async photoshop(ctx) {
    if (!appRunning(await ctx.procs(), 'photoshop')) return noApp('photoshop')
    const nr = mcpNotReady(ctx, this); if (nr) return nr
    const r = await callMcpTool(ctx.tools, this.serverName, 'photoshop_ping')
    if (!r.ok) return toolFailed(r, `Photoshop 在运行，但 photoshop_ping 失败：${r.error}`, 'tool:photoshop_ping')
    if (!/Successfully connected/i.test(r.text)) return result('unreachable', `Photoshop 在运行，但 photoshop_ping 返回：${r.text.split('\n')[0] || '（空）'}`, 'tool:photoshop_ping')
    return result('connected', 'Photoshop 在运行，photoshop_ping 成功', 'tool:photoshop_ping')
  },
  async chrome(ctx) {
    const mode = ctx.cfg.chromeConnect || 'launch'
    if (mode === 'browserUrl') {
      const base = String(ctx.cfg.chromeBrowserUrl || 'http://127.0.0.1:9222').trim().replace(/\/+$/, '')
      let host = '127.0.0.1', port = 9222
      try {
        const u = new URL(base)
        host = (u.hostname || '127.0.0.1').replace(/^\[|\]$/g, '')
        if (host === 'localhost') host = '127.0.0.1'
        port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
      } catch {}
      const info = await ctx.env.httpJson(`${base}/json/version`)
      if (!info) {
        const open = await ctx.env.tcpOpen(host, port)
        const status = ctx.env.httpStatus ? await ctx.env.httpStatus(`${base}/json/version`) : 0
        if (open && (status === 404 || status === 0)) {
          return result('unreachable', `调试地址 ${base} 端口开着，但 /json/version 不可用（HTTP ${status || '无响应'}）：这是 chrome://inspect/#remote-debugging 开关的典型表现，请把连接方式改成「连接正在运行的 Chrome（autoConnect）」；browserUrl 需要用 --remote-debugging-port 且带非默认 --user-data-dir 启动 Chrome`, 'http')
        }
        return result('no-app', `连不上调试地址 ${base}（浏览器没开，或没用 --remote-debugging-port 启动）`, 'http')
      }
      const nr = mcpNotReady(ctx, this); if (nr) return nr
      return listPages(ctx, this, `调试地址 ${base} 可用（${info.Browser || '浏览器'}）`)
    }
    if (mode === 'autoConnect') {
      if (!appRunning(await ctx.procs(), 'chrome')) return noApp('chrome')
      const dir = chromeDefaultUserDataDir(ctx.cfg.chromeChannel, ctx.env.env, ctx.env.home())
      const port = readDevToolsPort(dir)
      if (!port) {
        return result('unreachable', `Chrome 在运行，但默认配置目录还没有 DevToolsActivePort（${dir}）：在 chrome://inspect/#remote-debugging 打开「允许为此浏览器实例进行远程调试」。打开开关本身不会弹窗；第一次用浏览器工具时 Chrome 才会弹出「允许调试」确认框。本模式不需要 %USERPROFILE%\\.cache`, 'devtools-port')
      }
      if (!(await ctx.env.tcpOpen('127.0.0.1', port))) {
        return result('unreachable', `Chrome 在运行，DevToolsActivePort 写着端口 ${port}，但连不上：在 chrome://inspect/#remote-debugging 确认远程调试已打开，或重启 Chrome 后再开一次`, 'devtools-port')
      }
      const nr = mcpNotReady(ctx, this); if (nr) return nr
      // 第一次 autoConnect 要等 Puppeteer 握手（以及可能的「允许调试」弹窗），比默认 4 秒工具超时更宽裕。
      const r = await listPages(ctx, this, `Chrome 在运行，远程调试端口 ${port} 已打开`, 12000)
      if (r.state !== 'connected' && /Could not connect|remote debugging|Allow|权限|拒绝|没有返回/i.test(r.detail || '')) {
        return result('unreachable', `远程调试端口 ${port} 已打开，但 MCP 还没连上：第一次连接时请看 Chrome 是否弹出「允许调试」确认框并点允许（${r.detail}）`, r.via || 'tool:list_pages')
      }
      return r
    }
    // launch：只认 chrome-devtools-mcp 自己启动的那个 Chrome（它的配置目录被占用）；没开时不调 list_pages，免得替模型把 Chrome 拉起来。
    const dir = chromeProfileDir(ctx.cfg, ctx.env.home())
    if (!ctx.env.profileLocked(dir)) {
      return result('no-app', `Chrome MCP 自己的 Chrome 还没打开（配置目录 ${dir}）：AI第一次使用此工具时才会启动，之后显示「已连接」`, 'profile-lock')
    }
    const nr = mcpNotReady(ctx, this); if (nr) return nr
    return listPages(ctx, this, 'Chrome MCP 启动的 Chrome 在运行')
  },
  async godot(ctx) {
    if (!appRunning(await ctx.procs(), 'godot')) return noApp('godot')
    const nr = mcpNotReady(ctx, this); if (nr) return nr
    const hint = '在 Godot 里打开装了 Godot AI 插件的项目，并在「项目 → 项目设置 → 插件」里启用它（插件版本要和服务器一致，端口和编辑器设置 godot_ai/http_port、ws_port 一致）'
    let session = null
    // 工具报错可能是抛异常，也可能是 isError 的结果（看 dsh-mcp-client 怎么转），两种都算失败。
    const asFailure = (r) => (r.ok && r.value?.isError ? { ok: false, error: r.text || '工具返回错误' } : r)
    const list = asFailure(await callMcpTool(ctx.tools, this.serverName, 'session_manage', { op: 'list', params: {} }))
    if (list.ok) {
      const data = jsonOf(list)
      const sessions = Array.isArray(data?.sessions) ? data.sessions : null
      if (sessions && sessions.length === 0) return result('unreachable', `Godot 在运行，但还没有编辑器连上 godot-ai：${hint}`, 'tool:session_manage')
      session = sessions ? (sessions.find((x) => x && x.is_active) || sessions[0]) : null
    } else if (!list.missing) {
      return toolFailed(list, `Godot 在运行，但 session_manage 失败：${list.error}`, 'tool:session_manage')
    }
    const st = asFailure(await callMcpTool(ctx.tools, this.serverName, 'editor_state', {}))
    if (!st.ok) {
      if (/no active godot session|no_active_session|not connected/i.test(st.error)) return result('unreachable', `Godot 在运行，但还没有编辑器连上 godot-ai：${hint}`, 'tool:editor_state')
      return toolFailed(st, `Godot 编辑器已连上，但 editor_state 失败：${st.error}`, 'tool:editor_state')
    }
    const raw = jsonOf(st)
    const info = raw && typeof raw.data === 'object' && raw.data ? raw.data : (raw || {})
    const project = info.project_name || session?.name || ''
    const gv = info.godot_version || session?.godot_version || ''
    const extra = []
    if (gv) extra.push(`Godot ${gv}`)
    if (session?.plugin_version) extra.push(`插件 ${session.plugin_version}`)
    const mismatch = session?.plugin_version && session?.server_version && session.plugin_version !== session.server_version
      ? `；注意插件 ${session.plugin_version} 和服务器 ${session.server_version} 版本不一致` : ''
    return result('connected', `Godot 编辑器已连接${project ? `：${project}` : ''}${extra.length ? `（${extra.join('，')}）` : ''}（editor_state）${mismatch}`, 'tool:editor_state')
  },
}

/**
 * 探测一个组件。probeCtx：{ cfg, tools, env, procs }（procs 是一轮探测共用的进程列表 Promise 工厂）。
 * 整体限时 PROBE_TIMEOUT_MS；超时算 unreachable（调用方可以按上一次结果处理，见 components.mjs）。
 */
export async function probeComponent(component, probeCtx) {
  const fn = PROBES[component.id]
  if (!fn) return null
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ...result('unreachable', `检查连接超时（${PROBE_TIMEOUT_MS / 1000} 秒）`, 'timeout'), timeout: true }), PROBE_TIMEOUT_MS)
  })
  try {
    return await Promise.race([fn.call(component, probeCtx), timeout])
  } catch (error) {
    return result('unreachable', `检查连接出错：${error?.message ?? error}`, 'error')
  } finally {
    clearTimeout(timer)
  }
}
