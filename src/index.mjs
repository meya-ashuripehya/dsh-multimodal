/**
 * dsh-workbench — 工作组件插件的宿主半边。
 *
 *  1. 工作组件：Office / Blender / Unity / Figma / Photoshop / Chrome / Godot 等控制其他工作软件的 MCP 服务器，统一以
 *     dsh-mcp-client 子插件挂载（定义与运行时见 ./components.mjs），开关和路径在「工作组件」设置页里，改动后立即重挂。
 *     组件（和 uv、Node.js）可以在设置页一键下载安装到插件自己的 tools/ 目录（见 ./tools.mjs）。
 *     已启动的组件在 /components 请求时按需探测「已连接」（对应程序在运行且 MCP 够得着它，见 ./connect.mjs）。
 *  2. 设置：用 ctx.settings 注册 `dsh-workbench` 命名空间（没有 settings 服务时退回组合配置），
 *     并经 webServer 暴露 /dsh-workbench/api/settings、/dsh-workbench/api/components、
 *     POST /dsh-workbench/api/components/<id>/install|uninstall
 *     （id：uv / node / office / blender / unity / figma / photoshop / chrome / godot），
 *     POST /dsh-workbench/api/components/godot/addon { project }（把同版本的 Godot AI 插件装进 Godot 项目），
 *     以及 /dsh-workbench/assets/*（插件 assets/ 下的静态图，如 Figma 导入说明截图）。
 *  3. 出图演示：`mm_image_demo` 在 Node 端生成演示 PNG，经 attachments.saveImage 存成持久图片，结果里带 image block。
 *
 * 前端设置页与工具卡片在 lib/client.js。
 */
import z from 'schemastery'
import { defineTool } from '@dsh/define-tool'
import { renderDemoImage } from './png.mjs'
import { COMPONENTS, componentById, createComponentManager, contributeInfo, localComponentsDir, CONTRIBUTE_COMPARE_URL } from './components.mjs'
import { dirSize, killProcessesUnder, managedPaths, pluginRoot, toolsDir } from './tools.mjs'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'

export { COMPONENTS, componentById, createComponentManager, contributeInfo, localComponentsDir, CONTRIBUTE_COMPARE_URL, dirSize, killProcessesUnder, managedPaths, toolsDir }

export const name = 'dsh-workbench'
export const inject = ['tools']

const NAMESPACE = 'dsh-workbench'
const API_PREFIX = '/dsh-workbench/api'
const ASSETS_PREFIX = '/dsh-workbench/assets'
const BODY_LIMIT = 16 * 1024
const ASSET_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

export const SettingsSchema = z.object({
  imageProvider: z.union(['demo', 'openai-compatible']).default('demo')
    .description('出图提供方。demo 为本地演示图；openai-compatible 预留给真实生图接口。'),
  imageEndpoint: z.string().default('').description('生图接口地址（openai-compatible 时使用，雏形阶段未接入）。'),
  imageModel: z.string().default('').description('生图模型名（雏形阶段未接入）。'),
  defaultSize: z.natural().min(64).max(1024).default(384).description('演示图默认边长（px）。'),
  uvPath: z.string().default('').description('uv 可执行文件（uvx 取同目录）。插件 tools/uv 里已下载 uv 时优先用它；否则用这里的路径，留空时查找 WinGet 安装的 uv，再退回 PATH。'),
  proxy: z.string().default('').description('下载安装工具时使用的 HTTP 代理，例如 http://127.0.0.1:7890；留空时使用环境变量 HTTPS_PROXY / HTTP_PROXY。'),
  officeEnabled: z.boolean().default(true).description('启动 OfficeMCP（仅 Windows，COM 控制 Word / Excel / PowerPoint）。'),
  officeRepo: z.string().default('').description('OfficeMCP 仓库目录。插件已下载安装 OfficeMCP（tools/officemcp）时优先用它；否则用这里的目录，留空时用插件目录旁边的 officemcp。'),
  officeFolder: z.string().default('').description('OfficeMCP 的工作根目录；留空时用它自己的默认值 D:\\@OfficeMCP（没有 D 盘时用 文档\\OfficeMCP）。'),
  blenderEnabled: z.boolean().default(true).description('启动 Blender MCP。'),
  blenderPackage: z.string().default('mcp-for-blender').description('Blender MCP 的 pip 包名（入口命令同名），下载安装时装进 tools/blender。'),
  unityEnabled: z.boolean().default(true).description('启动 Unity MCP。'),
  unityPackage: z.string().default('mcpforunityserver').description('Unity MCP 的 pip 包名（入口命令 mcp-for-unity），下载安装时装进 tools/unity。'),
  figmaEnabled: z.boolean().default(false).description('启动 Figma MCP（需要 Figma 桌面版）。'),
  figmaMode: z.union(['console', 'official']).default('console')
    .description('console：figma-console-mcp（经 Desktop Bridge 插件读写画布）；official：连接官方 Figma 桌面版 MCP（需付费计划的 Dev / Full 席位）。'),
  figmaToken: z.string().role('secret').default('').description('Figma 个人访问令牌（figd_ 开头），console 模式下作为 FIGMA_ACCESS_TOKEN 传给服务器，REST 类工具要用。'),
  figmaOfficialUrl: z.string().default('http://127.0.0.1:3845/mcp').description('官方 Figma 桌面版 MCP 地址（streamable HTTP）。'),
  figmaPackage: z.string().default('figma-console-mcp').description('Figma MCP 的 npm 包（可带版本），下载安装时装进 tools/figma。'),
  photoshopEnabled: z.boolean().default(false).description('启动 Photoshop MCP（经 COM 控制本机 Photoshop）。'),
  photoshopPath: z.string().default('').description('Photoshop.exe 路径；留空时从注册表自动检测。'),
  photoshopPackage: z.string().default('@alisaitteke/photoshop-mcp').description('Photoshop MCP 的 npm 包（可带版本），下载安装时装进 tools/photoshop。'),
  chromeEnabled: z.boolean().default(false).description('启动 Chrome DevTools MCP（控制本机 Google Chrome）。'),
  chromeConnect: z.union(['launch', 'autoConnect', 'browserUrl']).default('launch')
    .description('launch：用独立配置目录启动一个 Chrome（默认 %USERPROFILE%\\.cache\\chrome-devtools-mcp，用到时自动创建）；autoConnect：连接正在运行的 Chrome（144+，在 chrome://inspect/#remote-debugging 打开远程调试；第一次用工具时 Chrome 弹「允许调试」确认框）；browserUrl：连接 --remote-debugging-port 调试端口（需非默认 user-data-dir；inspect 开关开的端口没有 /json/version，请用 autoConnect）。'),
  chromeBrowserUrl: z.string().default('http://127.0.0.1:9222').description('browserUrl 模式下 Chrome 的调试地址（需 chrome --remote-debugging-port=9222 --user-data-dir=<非默认目录>）。'),
  chromeChannel: z.union(['stable', 'beta', 'dev', 'canary']).default('stable').description('launch / autoConnect 时使用的 Chrome 渠道。'),
  chromeHeadless: z.boolean().default(false).description('launch 模式下无头运行（不显示窗口）。'),
  chromeUserDataDir: z.string().default('').description('launch 模式下的配置目录；留空时用 chrome-devtools-mcp 自己的专用目录（登录状态会保留，不动你平时的 Chrome 配置）。'),
  chromeToolset: z.union(['standard', 'full', 'slim']).default('standard').description('standard：默认工具；full：再加内存分析、坐标点击、扩展与 PWA 等；slim：只留导航 / 执行脚本 / 截图 3 个。'),
  chromePackage: z.string().default('chrome-devtools-mcp').description('Chrome MCP 的 npm 包（可带版本），下载安装时装进 tools/chrome。'),
  godotEnabled: z.boolean().default(false).description('启动 Godot MCP（godot-ai attach，经 Godot 编辑器里的 Godot AI 插件控制编辑器，需要 Godot 4.7+）。'),
  godotPackage: z.string().default('godot-ai').description('Godot MCP 的 pip 包（可带版本，如 godot-ai==4.2.3），下载安装时装进 tools/godot 并固定版本；Godot 项目里的插件必须是同一版本。'),
  godotHttpPort: z.natural().min(1).max(65535).default(8000).description('godot-ai 共享后端的 HTTP 端口（attach --port），要和 Godot 编辑器设置 godot_ai/http_port 一致。'),
  godotWsPort: z.natural().min(1).max(65535).default(9500).description('Godot 编辑器插件连接的 WebSocket 端口（attach --ws-port），要和编辑器设置 godot_ai/ws_port 一致。'),
  ffmpegEnabled: z.boolean().default(false).description('启动 FFmpeg / Kinocut MCP（本机媒体转换；需要本机已安装 ffmpeg）。'),
  ffmpegPackage: z.string().default('kinocut').description('FFmpeg 组件的 pip 包名（入口命令 kino），下载安装时装进 tools/ffmpeg。'),
  ffmpegPath: z.string().default('').description('可选。本机 ffmpeg 可执行文件路径；留空时从 PATH 查找。'),
  obsidianEnabled: z.boolean().default(false).description('启动 Obsidian MCP（经 Local REST API 插件读写库）。'),
  obsidianPackage: z.string().default('obsidian-mcp-server').description('Obsidian MCP 的 npm 包（可带版本），下载安装时装进 tools/obsidian。'),
  obsidianApiKey: z.string().role('secret').default('').description('Obsidian Local REST API 插件的 API 密钥（Bearer Token）。'),
  obsidianBaseUrl: z.string().default('http://127.0.0.1:27123').description('Local REST API 地址，默认 HTTP http://127.0.0.1:27123；HTTPS 可用 https://127.0.0.1:27124。'),
  obsidianEnableCommands: z.boolean().default(false).description('是否允许 MCP 执行 Obsidian 命令面板命令（OBSIDIAN_ENABLE_COMMANDS）。'),
  godotProject: z.string().default('').description('Godot 项目目录（含 project.godot）；「安装插件到项目」把同版本插件装进它的 addons/godot_ai。'),

  windowsEnabled: z.boolean().default(true).description('启动 Windows-MCP（控制本机桌面：窗口、键鼠、截图、文件系统等；仅 Windows）。'),
  windowsMode: z.union(['stdio', 'http']).default('stdio')
    .description('stdio：由本插件拉起 windows-mcp（推荐）；http：连接已在运行的 Windows-MCP HTTP 服务（如计划任务 127.0.0.1:18765）。'),
  windowsUrl: z.string().default('http://127.0.0.1:18765/mcp').description('HTTP 模式下的 Windows-MCP 地址（streamable-http）。'),
  windowsPackage: z.string().default('windows-mcp').description('Windows-MCP 的 pip 包名（入口 windows-mcp），下载安装时装进 tools/windows。'),
  notionEnabled: z.boolean().default(true).description('启动官方 Notion MCP（经 mcp-remote OAuth 桥；首次连接会弹出授权页）。'),
  notionUrl: z.string().default('https://mcp.notion.com/mcp').description('Notion MCP 远程地址。'),
  notionPackage: z.string().default('mcp-remote').description('OAuth 桥接用的 npm 包（默认 mcp-remote），下载安装时装进 tools/notion；也可复用 %USERPROFILE%\.dsh\mcp-remote。'),
  cloudflareEnabled: z.boolean().default(true).description('启动官方 Cloudflare API MCP（经 mcp-remote OAuth 桥；scope=offline_access）。'),
  cloudflareUrl: z.string().default('https://mcp.cloudflare.com/mcp').description('Cloudflare API MCP 远程地址。'),
  cloudflarePackage: z.string().default('mcp-remote').description('OAuth 桥接用的 npm 包（默认 mcp-remote），下载安装时装进 tools/cloudflare。'),
  'cloudflare-docsEnabled': z.boolean().default(true).description('启动 Cloudflare 文档 MCP（公开 HTTP，无需登录）。'),
  'cloudflare-docsUrl': z.string().default('https://docs.mcp.cloudflare.com/mcp').description('Cloudflare Docs MCP 远程地址。'),
  githubEnabled: z.boolean().default(true).description('启动官方 GitHub MCP（托管 streamable-http）。'),
  githubUrl: z.string().default('https://api.githubcopilot.com/mcp/').description('GitHub MCP 托管端点地址。'),
  githubToken: z.string().role('secret').default('').description('GitHub PAT（Bearer）。优先用本设置；留空时读环境变量 GITHUB_MCP_PAT。不要把 token 写进仓库。'),
  comfyuiEnabled: z.boolean().default(true).description('启动官方 Comfy MCP（comfy-mcp）；需本机 ComfyUI / comfy-cli。'),
  comfyuiPackage: z.string().default('comfy-mcp').description('Comfy MCP 的 pip 包名（入口 comfy-mcp），下载安装时装进 tools/comfyui。'),
  comfyuiBin: z.string().default('').description('comfy-cli 的 comfy 可执行文件路径，作为 COMFY_BIN 传给服务器；留空时用环境变量 COMFY_BIN。'),
  nodePath: z.string().default('').description('node 可执行文件（npm 取同目录）。插件 tools/node 里有 Node.js 时优先用它；否则用这里的路径，留空时用 PATH 里的 node，再退回 DSH 自带的运行时。'),
  npmRegistry: z.string().default('').description('npm 镜像地址，例如 https://registry.npmmirror.com；留空用 npm 自己的设置。'),
})

/** 兼容旧导出：Office 组件的启动方案（冒烟脚本在用）。 */
export function officeLaunchPlan(cfg) {
  return componentById('office').launch(cfg)
}

/** Local components' `<id>Enabled` keys (discovered at load). Default ON — align with launch `=== false` / manager. */
function localEnabledSchemaExtras() {
  const shape = {}
  for (const c of COMPONENTS) {
    if (c.moduleSource !== 'local') continue
    const key = `${c.id}Enabled`
    shape[key] = z.boolean().default(true).description(`启用本地组件 ${c.label || c.id}`)
  }
  return shape
}

const _localEnabledShape = localEnabledSchemaExtras()
/** Runtime schema: base SettingsSchema ∩ local *Enabled. Prefer this for register / API validate. */
export const RuntimeSettingsSchema = Object.keys(_localEnabledShape).length
  ? z.intersect([SettingsSchema, z.object(_localEnabledShape)])
  : SettingsSchema

/** Keep local `*Enabled` booleans that Cordis settings.register may drop from unknown keys. */
function pickLocalEnabled(from) {
  const out = {}
  if (!from || typeof from !== 'object') return out
  for (const c of COMPONENTS) {
    if (c.moduleSource !== 'local') continue
    const key = `${c.id}Enabled`
    if (Object.prototype.hasOwnProperty.call(from, key) && typeof from[key] === 'boolean') out[key] = from[key]
  }
  // Also accept any *Enabled boolean for ids that look like local comps already in from/current
  for (const [k, v] of Object.entries(from)) {
    if (!k.endsWith('Enabled') || typeof v !== 'boolean') continue
    if (Object.prototype.hasOwnProperty.call(out, k)) continue
    const id = k.slice(0, -'Enabled'.length)
    if (!id || componentById(id)?.moduleSource !== 'local') continue
    out[k] = v
  }
  return out
}

export const Config = RuntimeSettingsSchema


const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
  },
}

function imageRef(image) {
  return {
    attachmentId: image.attachmentId,
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...(image.name === undefined ? {} : { name: image.name }),
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > BODY_LIMIT) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** 只读提供插件 assets/ 下的静态文件（路径不能跳出该目录）。 */
function sendAsset(res, reqPath) {
  const name = decodeURIComponent(reqPath).replace(/^\/+/, '')
  if (!name || name.includes('\0') || name.split(/[\\/]/).some((p) => p === '..')) {
    res.writeHead(400); res.end('bad path'); return
  }
  const root = join(pluginRoot(), 'assets')
  const full = resolve(root, name)
  const rel = relative(root, full)
  if (rel.startsWith('..') || rel.includes(`..${sep}`) || !existsSync(full) || !statSync(full).isFile()) {
    res.writeHead(404); res.end('not found'); return
  }
  const type = ASSET_TYPES[extname(full).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=86400' })
  createReadStream(full).pipe(res)
}

export function apply(ctx, config) {
  // ── 设置：优先 ctx.settings（可持久、可热改），否则用组合配置 ──
  let current = RuntimeSettingsSchema(config ?? {})
  let scope = null
  const components = createComponentManager(ctx, () => current)
  const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
  if (settings && typeof settings.register === 'function') {
    try {
      scope = settings.register(NAMESPACE, RuntimeSettingsSchema, { base: config ?? {}, applies: 'live' })
      current = scope.get()
      scope.watch?.((next) => { current = next; components.sync() })
    } catch (error) {
      ctx.logger?.warn?.('dsh-workbench: settings.register failed, fallback to composition config', error)
      scope = null
    }
  }

  // ── 工作组件：各自 fork 一个 dsh-mcp-client 子插件（不写进 profile，随本插件卸载）──
  components.sync()
  ctx.effect?.(() => () => components.dispose(), 'dsh-workbench: components')

  // ── 设置页 API + 静态 assets（同源，供设置页帮助截图等）──
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const offApi = webCtx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://local')
          const sub = url.pathname.slice(API_PREFIX.length) || '/'
          if (sub === '/settings' && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, persisted: scope !== null, value: current })
          }
          if (sub === '/settings' && req.method === 'POST') {
            if (req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, 403, { ok: false, error: 'cross-site request refused' })
            const patch = JSON.parse(await readBody(req) || '{}')
            const localEnabled = pickLocalEnabled({ ...current, ...patch })
            const next = RuntimeSettingsSchema({ ...current, ...patch, ...localEnabled })
            if (scope) {
              await scope.update({ ...patch, ...localEnabled })
              current = { ...scope.get(), ...pickLocalEnabled({ ...scope.get(), ...localEnabled }) }
            } else {
              current = { ...next, ...localEnabled }
            }
            await components.sync()
            return sendJson(res, 200, { ok: true, persisted: scope !== null, value: current })
          }
          if (sub === '/components' && req.method === 'GET') {
            // 顺带探测已启动组件的连接（有缓存、不并发）；最多等 1.5 秒，没探完的下次请求再带上。
            await components.refreshConnections({ waitMs: 1500 })
            return sendJson(res, 200, {
              ok: true,
              toolsDir: toolsDir(),
              localComponentsDir: localComponentsDir(),
              contributeCompareUrl: CONTRIBUTE_COMPARE_URL,
              components: components.list(),
            })
          }
          const addon = /^\/components\/([\w-]+)\/addon$/.exec(sub)
          if (addon && req.method === 'POST') {
            if (req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, 403, { ok: false, error: 'cross-site request refused' })
            const body = JSON.parse(await readBody(req) || '{}')
            const result = await components.installAddon(addon[1], body.project)
            return sendJson(res, 200, { ok: true, result, message: result.message, component: components.list().find((c) => c.id === addon[1]) })
          }
          const action = /^\/components\/([\w-]+)\/(install|uninstall)$/.exec(sub)
          if (action && req.method === 'POST') {
            if (req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, 403, { ok: false, error: 'cross-site request refused' })
            const [, id, verb] = action
            if (verb === 'install') {
              const { component } = components.install(id)
              return sendJson(res, 202, { ok: true, component })
            }
            return sendJson(res, 200, { ok: true, component: await components.uninstall(id) })
          }
          const contrib = /^\/components\/([\w-]+)\/contribute$/.exec(sub)
          if (contrib && req.method === 'GET') {
            const info = components.contribute(contrib[1])
            if (!info) return sendJson(res, 404, { ok: false, error: `${contrib[1]} 不是本地组件，或没有贡献信息` })
            return sendJson(res, 200, { ok: true, ...info })
          }
          if (sub === '/health') return sendJson(res, 200, { ok: true, name, persisted: scope !== null })
          return sendJson(res, 404, { ok: false, error: 'not found' })
        } catch (error) {
          return sendJson(res, error?.status ?? 400, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })
      const offAssets = webCtx.webServer.register({
        kind: 'prefix',
        path: ASSETS_PREFIX,
        handler: async (req, res) => {
          try {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              res.writeHead(405); res.end('method not allowed'); return
            }
            const url = new URL(req.url ?? '/', 'http://local')
            const sub = url.pathname.slice(ASSETS_PREFIX.length) || '/'
            if (sub === '/' || sub === '') { res.writeHead(404); res.end('not found'); return }
            if (req.method === 'HEAD') {
              // 只确认存在，不传内容
              const name = decodeURIComponent(sub).replace(/^\/+/, '')
              const full = resolve(join(pluginRoot(), 'assets'), name)
              const rel = relative(join(pluginRoot(), 'assets'), full)
              if (rel.startsWith('..') || !existsSync(full)) { res.writeHead(404); res.end(); return }
              const type = ASSET_TYPES[extname(full).toLowerCase()] || 'application/octet-stream'
              res.writeHead(200, { 'content-type': type, 'content-length': String(statSync(full).size), 'cache-control': 'public, max-age=86400' })
              res.end(); return
            }
            return sendAsset(res, sub)
          } catch (error) {
            res.writeHead(500); res.end(String(error?.message ?? error))
          }
        },
      })
      return () => { offApi?.(); offAssets?.() }
    }, 'dsh-workbench: settings api')
  })

  // ── 出图测试工具：只在 attachments 服务存在时注册（与原生 read_image 同一门控）──
  ctx.inject(['attachments'], (imgCtx) => {
    imgCtx.tools.register(defineTool({
      name: 'mm_image_demo',
      description: 'Generate a local demo PNG (gradient + rings, colored by the prompt) and return the image itself. This is a prototype used to verify image output in DSH; it does not do real image generation.',
      parameters: {
        prompt: { type: 'string', required: true, description: 'Any text; it only decides the colors of the demo image.' },
        size: { type: 'integer', description: 'Edge length in px (64-1024). Defaults to the plugin setting.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prompt: { type: 'string', required: true },
            image: IMAGE_VALUE_SCHEMA,
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `Generated demo image for "${value.prompt}": ${value.image.mediaType}, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes.`,
          },
          { type: 'image', attachment: imageRef(value.image) },
        ],
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const prompt = String(args.prompt ?? '').trim()
        if (!prompt) throw new Error('prompt must be a non-empty string')
        const size = Math.max(64, Math.min(1024, Math.round(args.size ?? current.defaultSize ?? 384)))
        const attachments = imgCtx.get('attachments')
        if (!attachments) throw new Error('no attachment service is mounted')
        const data = renderDemoImage(prompt, size)
        const ref = await attachments.saveImage({ data, mediaType: 'image/png', name: `mm-demo-${Date.now()}.png` })
        return {
          prompt,
          image: {
            attachmentId: String(ref.attachmentId),
            mediaType: ref.mediaType,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
            ...(ref.name === undefined ? {} : { name: ref.name }),
          },
        }
      },
    }))
  })
}
