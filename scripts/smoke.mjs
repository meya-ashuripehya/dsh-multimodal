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

// Check output.render emits MmBlock (type:mm) when available
const out = tool.output || tool.definition?.output
const render = out && (out.render || out.renderer)
if (typeof render === 'function') {
  const sample = {
    prompt: '夕阳下的初雪',
    image: { attachmentId: 'att_smoke', mediaType: 'image/png', bytes: savedPng.length, width: 256, height: 256, name: 'smoke.png' },
  }
  const blocks = render({}, sample)
  const mm = (blocks || []).find((b) => b && b.type === 'mm' && b.kind === 'image')
  if (!mm) throw new Error('render missing type:mm kind:image block: ' + JSON.stringify(blocks))
  if (mm.status !== 'ready') throw new Error('mm status expected ready, got ' + mm.status)
  if (!mm.asset?.attachment?.attachmentId) throw new Error('mm.asset.attachment missing')
  const legacy = (blocks || []).find((b) => b && b.type === 'image')
  if (!legacy) throw new Error('legacy type:image block missing')
  console.log('render mm block ok:', JSON.stringify(mm).slice(0, 200))
} else {
  console.log('skip render check (no output.render on tool wrapper)')
}

// mm_send_image: read a local PNG and emit the same mm + legacy image blocks
const sendTool = tools.find((t) => t.name === 'mm_send_image')
if (!sendTool) throw new Error('mm_send_image not registered')
const samplePath = join(root, 'lib', 'smoke.png')
let sendResult
try {
  sendResult = await sendTool.execute({ path: samplePath, title: 'smoke-send', caption: 'from smoke' }, { signal: new AbortController().signal })
} catch (e) {
  console.error('mm_send_image execute failed:', e)
  process.exit(1)
}
console.log('mm_send_image result:', JSON.stringify(sendResult, null, 2).slice(0, 500))
if (!sendResult?.image?.attachmentId) throw new Error('mm_send_image missing image.attachmentId')
const sendOut = sendTool.output || sendTool.definition?.output
const sendRender = sendOut && (sendOut.render || sendOut.renderer)
if (typeof sendRender === 'function') {
  const blocks = sendRender({}, sendResult)
  const mm = (blocks || []).find((b) => b && b.type === 'mm' && b.kind === 'image' && b.status === 'ready')
  if (!mm?.asset?.attachment?.attachmentId) throw new Error('mm_send_image render missing mm ready block')
  const legacy = (blocks || []).find((b) => b && b.type === 'image')
  if (!legacy) throw new Error('mm_send_image render missing legacy image block')
  console.log('mm_send_image render ok')
} else {
  console.log('skip mm_send_image render check')
}
