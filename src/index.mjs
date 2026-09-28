/**
 * dsh-workbench — 工作组件插件的宿主半边。
 *
 *  1. 工作组件：Office / Blender / Unity 等控制其他工作软件的 MCP 服务器，统一以 dsh-mcp-client
 *     子插件挂载（定义与运行时见 ./components.mjs），开关和路径在「工作组件」设置页里，改动后立即重挂。
 *  2. 设置：用 ctx.settings 注册 `dsh-workbench` 命名空间（没有 settings 服务时退回组合配置），
 *     并经 webServer 暴露 /dsh-workbench/api/settings、/dsh-workbench/api/components。
 *  3. 出图演示：`mm_image_demo` 在 Node 端生成演示 PNG，经 attachments.saveImage 存成持久图片，结果里带 image block。
 *
 * 前端设置页与工具卡片在 lib/client.js。
 */
import z from 'schemastery'
import { defineTool } from '@dsh/define-tool'
import { renderDemoImage } from './png.mjs'
import { COMPONENTS, componentById, createComponentManager } from './components.mjs'

export { COMPONENTS }

export const name = 'dsh-workbench'
export const inject = ['tools']

const NAMESPACE = 'dsh-workbench'
const API_PREFIX = '/dsh-workbench/api'
const BODY_LIMIT = 16 * 1024

export const SettingsSchema = z.object({
  imageProvider: z.union(['demo', 'openai-compatible']).default('demo')
    .description('出图提供方。demo 为本地演示图；openai-compatible 预留给真实生图接口。'),
  imageEndpoint: z.string().default('').description('生图接口地址（openai-compatible 时使用，雏形阶段未接入）。'),
  imageModel: z.string().default('').description('生图模型名（雏形阶段未接入）。'),
  defaultSize: z.natural().min(64).max(1024).default(384).description('演示图默认边长（px）。'),
  uvPath: z.string().default('').description('uv 可执行文件（uvx 取同目录）；留空时自动查找 WinGet 安装的 uv，再退回 PATH。'),
  officeEnabled: z.boolean().default(true).description('启动 OfficeMCP（仅 Windows，COM 控制 Word / Excel / PowerPoint）。'),
  officeRepo: z.string().default('').description('OfficeMCP 仓库目录；留空时用插件目录旁边的 officemcp。'),
  officeFolder: z.string().default('').description('OfficeMCP 的工作根目录；留空时用它自己的默认值 D:\\@OfficeMCP。'),
  blenderEnabled: z.boolean().default(true).description('启动 Blender MCP。'),
  blenderPackage: z.string().default('mcp-for-blender').description('uvx 运行的 Blender MCP 包名。'),
  unityEnabled: z.boolean().default(true).description('启动 Unity MCP。'),
  unityPackage: z.string().default('mcpforunityserver').description('uvx --from 使用的 Unity MCP 包名。'),
})

/** 兼容旧导出：Office 组件的启动方案（冒烟脚本在用）。 */
export function officeLaunchPlan(cfg) {
  return componentById('office').launch(cfg)
}

export const Config = SettingsSchema

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

export function apply(ctx, config) {
  // ── 设置：优先 ctx.settings（可持久、可热改），否则用组合配置 ──
  let current = SettingsSchema(config ?? {})
  let scope = null
  const components = createComponentManager(ctx, () => current)
  const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
  if (settings && typeof settings.register === 'function') {
    try {
      scope = settings.register(NAMESPACE, SettingsSchema, { base: config ?? {}, applies: 'live' })
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

  // ── 设置页 API（同源 fetch）──
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
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
            const next = SettingsSchema({ ...current, ...patch }) // 先按 schema 校验
            if (scope) {
              await scope.update(patch)
              current = scope.get()
            } else {
              current = next
            }
            await components.sync()
            return sendJson(res, 200, { ok: true, persisted: scope !== null, value: current })
          }
          if (sub === '/components' && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, components: components.list() })
          }
          if (sub === '/health') return sendJson(res, 200, { ok: true, name, persisted: scope !== null })
          return sendJson(res, 404, { ok: false, error: 'not found' })
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }), 'dsh-workbench: settings api')
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
