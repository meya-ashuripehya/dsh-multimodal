// 本地冒烟：用假 ctx 挂载宿主半边，调用 mm_image_demo，检查结果含 image block，并把 PNG 写到 lib/smoke.png。
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const mod = await import('../lib/index.mjs')
const tools = []
const routes = []
let savedPng = null
const services = {
  tools: { register: (t) => { tools.push(t); return () => {} } },
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  attachments: {
    async saveImage({ data, mediaType, name }) {
      savedPng = data
      return { attachmentId: 'att_smoke', mediaType, bytes: data.length, width: data.readUInt32BE(16), height: data.readUInt32BE(20), name }
    },
  },
}
const ctx = {
  ...services,
  get: (n) => services[n],
  inject: (names, cb) => cb(ctx),
  effect: (fn) => fn(),
  logger: console,
}
mod.apply(ctx, {})
const tool = tools.find((t) => t.name === 'mm_image_demo')
if (!tool) throw new Error('mm_image_demo not registered')
console.log('registered tools:', tools.map((t) => t.name).join(', '))
console.log('routes:', routes.map((r) => `${r.kind} ${r.path}`).join(', '))
console.log('tool keys:', Object.keys(tool).join(', '))

// defineTool 包装后的 execute 签名随版本变化，这里两种都试。
let result
try {
  result = await tool.execute({ prompt: '夕阳下的初雪', size: 256 }, { signal: new AbortController().signal })
} catch (e) {
  console.error('execute failed:', e)
  process.exit(1)
}
console.log('execute result:', JSON.stringify(result, null, 2).slice(0, 800))
if (!savedPng) throw new Error('no image saved')
writeFileSync(join(root, 'lib', 'smoke.png'), savedPng)
console.log('smoke.png bytes:', savedPng.length)
