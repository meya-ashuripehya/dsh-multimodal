/**
 * dsh-multimodal — 宿主半边（雏形）。
 *
 * 目前只做两件事：
 *  1. 设置：用 ctx.settings 注册 `dsh-multimodal` 命名空间（没有 settings 服务时退回组合配置），
 *     并经 webServer 暴露 /dsh-multimodal/api/settings 给前端设置页读写。
 *  2. 出图：注册 `mm_image_demo` 工具，在 Node 端生成一张演示 PNG，
 *     按原生 read_image 的做法经 attachments.saveImage 存成持久图片，结果里带 image block。
 *
 * 后续的搜索 / 路线 / 真实生图都挂在这里，前端卡片在 lib/client.js。
 */
import z from 'schemastery'
import { defineTool } from '@dsh/define-tool'
import { renderDemoImage } from './png.mjs'

export const name = 'dsh-multimodal'
export const inject = ['tools']

const NAMESPACE = 'dsh-multimodal'
const API_PREFIX = '/dsh-multimodal/api'
const BODY_LIMIT = 16 * 1024

export const SettingsSchema = z.object({
  imageProvider: z.union(['demo', 'openai-compatible']).default('demo')
    .description('出图提供方。demo 为本地演示图；openai-compatible 预留给真实生图接口。'),
  imageEndpoint: z.string().default('').description('生图接口地址（openai-compatible 时使用，雏形阶段未接入）。'),
  imageModel: z.string().default('').description('生图模型名（雏形阶段未接入）。'),
  defaultSize: z.natural().min(64).max(1024).default(384).description('演示图默认边长（px）。'),
})

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
  const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
  if (settings && typeof settings.register === 'function') {
    try {
      scope = settings.register(NAMESPACE, SettingsSchema, { base: config ?? {}, applies: 'live' })
      current = scope.get()
      scope.watch?.((next) => { current = next })
    } catch (error) {
      ctx.logger?.warn?.('dsh-multimodal: settings.register failed, fallback to composition config', error)
      scope = null
    }
  }

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
            return sendJson(res, 200, { ok: true, persisted: scope !== null, value: current })
          }
          if (sub === '/health') return sendJson(res, 200, { ok: true, name, persisted: scope !== null })
          return sendJson(res, 404, { ok: false, error: 'not found' })
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }), 'dsh-multimodal: settings api')
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
