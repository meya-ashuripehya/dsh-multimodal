// 本地冒烟：用假 ctx 挂载宿主半边；主路径 mm_send_image。render 只能是 text+image（无 mm）；MmCard 数据在 presentationMeta；并把 PNG 写到 lib/smoke.png。
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')

/** Minimal valid 8×8 RGBA PNG for mm_send_image input (no demo tool). */
function encodeTinyPng(size = 8) {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })()
  function crc32(buf) {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const w = size, h = size
  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 80
    rgba[i * 4 + 1] = 140
    rgba[i * 4 + 2] = 220
    rgba[i * 4 + 3] = 255
  }
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const samplePath = join(root, 'lib', 'smoke.png')
const fixturePng = encodeTinyPng(8)
writeFileSync(samplePath, fixturePng)

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
console.log('registered tools:', tools.map((t) => t.name).join(', '))
if (tools.some((t) => t.name === 'mm_image_demo')) throw new Error('mm_image_demo should not be registered')
console.log('routes:', routes.map((r) => `${r.kind} ${r.path}`).join(', '))

const sendTool = tools.find((t) => t.name === 'mm_send_image')
if (!sendTool) throw new Error('mm_send_image not registered')
console.log('tool keys:', Object.keys(sendTool).join(', '))

let sendResult
try {
  sendResult = await sendTool.execute({ path: samplePath, title: 'smoke-send', caption: 'from smoke' }, { signal: new AbortController().signal })
} catch (e) {
  console.error('mm_send_image execute failed:', e)
  process.exit(1)
}
console.log('mm_send_image result:', JSON.stringify(sendResult, null, 2).slice(0, 500))
if (!sendResult?.image?.attachmentId) throw new Error('mm_send_image missing image.attachmentId')
if (!savedPng) throw new Error('no image saved via attachments.saveImage')
console.log('smoke.png bytes:', savedPng.length)

const sendOut = sendTool.output || sendTool.definition?.output
const sendRender = sendOut && (sendOut.render || sendOut.renderer)
if (typeof sendRender === 'function') {
  const blocks = sendRender({}, sendResult)
  const forbidden = (blocks || []).filter((b) => b && b.type === 'mm')
  if (forbidden.length) throw new Error('mm_send_image render must not emit type:mm (DeepSeek Messages UNSUPPORTED_CONTENT); got ' + forbidden.length)
  const text = (blocks || []).find((b) => b && b.type === 'text' && typeof b.text === 'string')
  if (!text?.text) throw new Error('mm_send_image render missing text envelope')
  const image = (blocks || []).find((b) => b && b.type === 'image' && b.attachment?.attachmentId)
  if (!image) throw new Error('mm_send_image render missing image attachment block')
  const badType = (blocks || []).find((b) => b && b.type !== 'text' && b.type !== 'image')
  if (badType) throw new Error('mm_send_image render has unsupported content type: ' + badType.type)
  console.log('mm_send_image render ok (text+image only):', JSON.stringify(blocks).slice(0, 240))
} else {
  console.log('skip mm_send_image render check (no output.render on tool wrapper)')
}

const sendMetaFn = sendOut && sendOut.presentationMeta
if (typeof sendMetaFn === 'function') {
  const meta = sendMetaFn({}, sendResult)
  if (!meta?.mm?.asset?.attachment?.attachmentId) throw new Error('mm_send_image presentationMeta missing mm ready block')
  if (meta.mm.type !== 'mm' || meta.mm.kind !== 'image' || meta.mm.status !== 'ready') {
    throw new Error('mm_send_image presentationMeta.mm shape invalid')
  }
  if (meta.title !== 'smoke-send') throw new Error('mm_send_image presentationMeta title mismatch')
  console.log('mm_send_image presentationMeta ok:', JSON.stringify(meta.mm).slice(0, 200))
} else {
  console.log('skip mm_send_image presentationMeta check (missing on tool wrapper)')
}
