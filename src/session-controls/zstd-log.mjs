/**
 * Multi-frame zstd JSONL session log helpers (frame0 = header line only).
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const MAGIC = 0xfd2fb528
const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function sessionsRoot() {
  return join(dshHome(), 'sessions')
}

export function findSessionLogPath(sessionId) {
  const root = sessionsRoot()
  if (!existsSync(root)) return null
  const want = String(sessionId)
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      const full = join(dir, e.name)
      if (!e.isDirectory()) continue
      if (e.name === want) {
        for (const name of ['session.v4.jsonl.zstd', 'session.v3.jsonl.zstd', 'session.v4.jsonl', 'session.v3.jsonl', 'session.jsonl.zstd', 'session.jsonl']) {
          const p = join(full, name)
          if (existsSync(p)) return p
        }
      }
      stack.push(full)
    }
  }
  return null
}

function frameByteLength(buf, offset) {
  if (buf.readUInt32LE(offset) !== MAGIC) throw new Error('bad zstd magic at ' + offset)
  let p = offset + 4
  const fd = buf[p++]
  const dictionaryIdFlag = fd & 0x3
  const contentChecksumFlag = (fd >> 2) & 0x1
  const singleSegment = (fd >> 5) & 0x1
  const frameContentSizeFlag = (fd >> 6) & 0x3
  if (!singleSegment) p += 1
  p += [0, 1, 2, 4][dictionaryIdFlag]
  let fcsSize = [0, 2, 4, 8][frameContentSizeFlag]
  if (frameContentSizeFlag === 0 && singleSegment) fcsSize = 1
  p += fcsSize
  while (true) {
    if (p + 3 > buf.length) throw new Error('truncated zstd block header')
    const blockHeader = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)
    const last = blockHeader & 1
    const blockType = (blockHeader >> 1) & 3
    const blockSize = blockHeader >> 3
    p += 3
    if (blockType === 1) p += 1
    else if (blockType === 0 || blockType === 2) p += blockSize
    else throw new Error('reserved zstd block type')
    if (last) break
  }
  if (contentChecksumFlag) p += 4
  return p - offset
}

export function readSessionLog(logPath) {
  const buf = readFileSync(logPath)
  const zstd = logPath.endsWith('.zstd')
  let lines
  let frames = 1
  if (!zstd) {
    lines = buf.toString('utf8').split(/\n/).filter((l) => l.trim())
  } else {
    lines = []
    let offset = 0
    frames = 0
    while (offset < buf.length) {
      const len = frameByteLength(buf, offset)
      const text = zstdDecompressSync(buf.subarray(offset, offset + len)).toString('utf8')
      for (const line of text.split(/\n/)) if (line.trim()) lines.push(line)
      offset += len
      frames++
    }
  }
  if (!lines.length) throw new Error('empty session log')
  return {
    header: JSON.parse(lines[0]),
    events: lines.slice(1).map((l) => JSON.parse(l)),
    frames,
    bytes: buf.length,
    zstd,
  }
}

export function compressMultiFrame(header, events, { maxFrameBytes = 1024 * 1024 } = {}) {
  const headerLine = JSON.stringify(header) + '\n'
  const frames = [zstdCompressSync(Buffer.from(headerLine, 'utf8'), CHECKSUM)]
  let batch = []
  let batchBytes = 0
  const flush = () => {
    if (!batch.length) return
    frames.push(zstdCompressSync(Buffer.from(batch.join('\n') + '\n', 'utf8'), CHECKSUM))
    batch = []
    batchBytes = 0
  }
  for (const ev of events) {
    const line = JSON.stringify(ev)
    const size = Buffer.byteLength(line, 'utf8') + 1
    if (batchBytes + size > maxFrameBytes && batch.length) flush()
    batch.push(line)
    batchBytes += size
  }
  flush()
  return Buffer.concat(frames)
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex').toUpperCase()
}

export function backupLog(logPath, stamp) {
  const dir = join(dshHome(), 'repair-backups', 'workbench-session-controls-' + stamp)
  mkdirSync(dir, { recursive: true })
  const base = logPath.split(/[\\/]/).pop()
  const dest = join(dir, base)
  copyFileSync(logPath, dest)
  return { dir, dest, sha256: sha256(readFileSync(logPath)) }
}

export function writeSessionLog(logPath, header, events) {
  if (logPath.endsWith('.zstd')) writeFileSync(logPath, compressMultiFrame(header, events))
  else {
    const body = JSON.stringify(header) + '\n' + events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '')
    writeFileSync(logPath, body, 'utf8')
  }
}

/**
 * Drop derived caches that would resurrect a physically removed tail.
 * Official Harness 0.2 stores the projection at
 * storages/session_projcache/sessions/<id>.json. A retrace summary, if the
 * old plugin left one, is the same kind of shadow.
 */
export function clearDerivedCaches(sessionId) {
  const id = String(sessionId)
  const removed = []
  const candidates = [
    join(dshHome(), 'storages', 'session_projcache', 'sessions', `${id}.json`),
    join(dshHome(), 'dsh-retrace', 'summaries', `${id}.jsonl`),
    join(dshHome(), 'dsh-retrace', 'summaries', `${id}.json`),
  ]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    rmSync(file, { force: true })
    removed.push(file)
  }
  return removed
}
