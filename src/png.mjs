// 零依赖 PNG 编码 + 演示图渲染（8-bit RGBA）。
import { deflateSync } from 'node:zlib'

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

/** 把 RGBA 像素编码为 PNG。 */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

/**
 * 渲染演示图：按 prompt 哈希取色的对角渐变 + 同心圆 + 网格。
 * 仅用于验证「工具结果 → 持久图片 → 卡片显示」链路，不是真正的生图。
 */
export function renderDemoImage(prompt, size) {
  const w = size
  const h = size
  const seed = hashString(prompt || 'dsh-multimodal')
  const hue = seed % 360
  const c1 = hsl(hue, 0.7, 0.55)
  const c2 = hsl((hue + 140) % 360, 0.7, 0.35)
  const px = Buffer.alloc(w * h * 4)
  const cx = w * (0.3 + ((seed >>> 8) % 40) / 100)
  const cy = h * (0.3 + ((seed >>> 16) % 40) / 100)
  const grid = Math.max(8, Math.round(size / 16))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h)
      let r = c1[0] * (1 - t) + c2[0] * t
      let g = c1[1] * (1 - t) + c2[1] * t
      let b = c1[2] * (1 - t) + c2[2] * t
      const d = Math.hypot(x - cx, y - cy)
      if (Math.floor(d / (size / 12)) % 2 === 0 && d < size * 0.45) {
        r = r * 0.6 + 255 * 0.4
        g = g * 0.6 + 255 * 0.4
        b = b * 0.6 + 255 * 0.4
      }
      if (x % grid === 0 || y % grid === 0) {
        r *= 0.85
        g *= 0.85
        b *= 0.85
      }
      const i = (y * w + x) * 4
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = 255
    }
  }
  return encodePng(w, h, px)
}
