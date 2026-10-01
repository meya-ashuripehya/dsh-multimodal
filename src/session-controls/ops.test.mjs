import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const home = mkdtempSync(join(tmpdir(), 'dsw-session-'))
process.env.DSH_HOME = home

const { writeSessionLog, readSessionLog, findSessionLogPath } = await import('./zstd-log.mjs')
const { truncateSession, rewindTailTurn, outputShadowSeqs, recallLiveOutput, recallLiveTurn, retractShadowSeqs, REGENERATE_CARRIER_TEXT } = await import('./ops.mjs')

function event(seq, type, data) {
  return { seq, type, time: 1, data }
}

function frameLength(buf) {
  if (buf.readUInt32LE(0) !== 0xfd2fb528) throw new Error('bad magic')
  let p = 4
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
    const blockHeader = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)
    const last = blockHeader & 1
    const blockType = (blockHeader >> 1) & 3
    const blockSize = blockHeader >> 3
    p += 3
    if (blockType === 1) p += 1
    else if (blockType === 0 || blockType === 2) p += blockSize
    else throw new Error('reserved block')
    if (last) break
  }
  if (contentChecksumFlag) p += 4
  return p
}

test('suffix cut keeps contiguous seq and drops the projection cache', () => {
  const sessionId = 'ch-test'
  const dir = join(home, 'sessions', 'proj', sessionId)
  mkdirSync(dir, { recursive: true })
  const logPath = join(dir, 'session.v3.jsonl.zstd')
  const header = { id: sessionId, cwd: 'C:/tmp', createdAt: 1, version: 3 }
  const events = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', { content: [{ type: 'text', text: 'keep' }] }),
    event(2, 'turn/end', { turn: 1 }),
    event(3, 'turn/start', { turn: 2 }),
    event(4, 'user/message', { content: [{ type: 'text', text: 'drop' }] }),
    event(5, 'tool/call', { name: 'vision_describe', turn: 2 }),
  ]
  writeSessionLog(logPath, header, events)
  const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
  mkdirSync(cacheDir, { recursive: true })
  const cache = join(cacheDir, sessionId + '.json')
  writeFileSync(cache, '{"stale":true}')

  const result = truncateSession(sessionId, 5, { keepMode: 'before-turn' })
  assert.equal(result.deletedEvents, 3)
  assert.equal(result.userText, 'drop')
  assert.deepEqual(result.clearedCaches, [cache])
  assert.equal(existsSync(cache), false)
  assert.equal(findSessionLogPath(sessionId), logPath)

  const restored = readSessionLog(logPath)
  assert.deepEqual(restored.events.map((item) => item.seq), [0, 1, 2])
  assert.equal(restored.events.at(-1).type, 'turn/end')
  assert.equal(restored.frames >= 2, true)

  const raw = readFileSync(logPath)
  const headerText = zstdDecompressSync(raw.subarray(0, frameLength(raw))).toString('utf8')
  assert.equal(headerText.endsWith('\n'), true)
  assert.equal(headerText.indexOf('\n'), headerText.length - 1)
  assert.equal(JSON.parse(headerText).id, sessionId)
})

test('rewind refuses when the tail turn is no longer the captured one', () => {
  const sessionId = 'ch-rewind'
  const dir = join(home, 'sessions', 'proj', sessionId)
  mkdirSync(dir, { recursive: true })
  const header = { id: sessionId, cwd: 'C:/tmp', createdAt: 1 }
  writeSessionLog(join(dir, 'session.v3.jsonl.zstd'), header, [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'turn/end', { turn: 1 }),
    event(2, 'turn/start', { turn: 2 }),
    event(3, 'turn/end', { turn: 2 }),
  ])
  assert.throws(() => rewindTailTurn(sessionId, { expectStartSeq: 0 }), /tail turn changed/)
  const cut = rewindTailTurn(sessionId, { expectStartSeq: 2 })
  assert.equal(cut.afterEvents, 2)
})

test('regenerate keeps the user message and shadows the output suffix', () => {
  const events = [
    { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
    { seq: 1, type: 'user/message', time: 1, surfaceOp: 'append', data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } } },
    { seq: 2, type: 'tool/call', time: 1, data: { name: 'demo' } },
    { seq: 3, type: 'assistant/message', time: 1, surfaceOp: 'append', data: { message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'old' }], source: { kind: 'model', provider: 'p', model: 'm' } } } },
    { seq: 4, type: 'turn/end', time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    { seq: 5, type: 'turn/start', time: 1, data: { turn: 2 } },
    { seq: 6, type: 'user/message', time: 1, surfaceOp: 'append', data: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'later' }], source: { kind: 'user' } } },
    { seq: 7, type: 'assistant/message', time: 1, surfaceOp: 'append', data: { message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'later-answer' }], source: { kind: 'model', provider: 'p', model: 'm' } } } },
  ]
  const picked = outputShadowSeqs(events, [0, 1, 3, 6, 7], 3)
  assert.equal(picked.userSeq, 1)
  assert.equal(picked.text, 'question')
  assert.equal(picked.shadowed.includes(1), false)
  assert.equal(picked.shadowed.includes(2), false)
  assert.deepEqual(picked.shadowed, [3, 6, 7])

  const appended = []
  const session = {
    snapshotEvents: () => events,
    surface: { nodes: [0, 1, 3, 6, 7] },
    append(type, data, opts) {
      const ev = { type, seq: 8, data, ...opts }
      appended.push(ev)
      return ev
    },
  }
  const recalled = recallLiveOutput(session, 3)
  assert.equal(appended.length, 1)
  assert.equal(appended[0].data.content[0].text, REGENERATE_CARRIER_TEXT)
  assert.equal(appended[0].data.source.kind, 'model')
  assert.deepEqual(appended[0].surfaceOp, { op: 'replace', startSeq: 3, endSeq: 7 })
  assert.deepEqual(appended[0].sourceEventSeqs, [3, 6, 7])
  assert.equal(recalled.hideFrom, 1)
  assert.equal(recalled.hideFromExclusive, true)
  assert.equal(recalled.hideUntil, 8)
  assert.equal(recalled.userText, 'question')
})

test('retract skips the system prompt at surface node 0', () => {
  const events = [
    { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
    { seq: 1, type: 'system/message', time: 1, surfaceOp: 'append', data: { message: { role: 'system', content: [{ type: 'text', text: 'prompt' }] } } },
    { seq: 2, type: 'user/message', time: 1, surfaceOp: 'append', data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } } },
    { seq: 3, type: 'assistant/message', time: 1, surfaceOp: 'append', data: { message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'old' }], source: { kind: 'model', provider: 'p', model: 'm' } } } },
  ]
  assert.deepEqual(retractShadowSeqs([1, 2, 3], events, 0), [2, 3])
  assert.deepEqual(retractShadowSeqs([1], events, 0), [])
  const appended = []
  const session = {
    snapshotEvents: () => events,
    surface: { nodes: [1, 2, 3] },
    append(type, data, opts) {
      const ev = { type, seq: 4, data, ...opts }
      appended.push(ev)
      return ev
    },
  }
  const recalled = recallLiveTurn(session, 2)
  assert.equal(appended.length, 1)
  assert.deepEqual(appended[0].surfaceOp, { op: 'replace', startSeq: 2, endSeq: 3 })
  assert.deepEqual(appended[0].sourceEventSeqs, [2, 3])
  assert.equal(recalled.hideFrom, 2)
  assert.equal(recalled.hideUntil, 4)
})

test('regenerate with no assistant output yet does not append a replace', () => {
  const events = [
    { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
    { seq: 1, type: 'user/message', time: 1, surfaceOp: 'append', data: { content: [{ type: 'text', text: 'question' }] } },
  ]
  let appended = 0
  const session = {
    snapshotEvents: () => events,
    surface: { nodes: [0, 1] },
    append() { appended += 1 },
  }
  const recalled = recallLiveOutput(session, 1)
  assert.equal(appended, 0)
  assert.equal(recalled.shadowed, 0)
  assert.equal(recalled.userText, 'question')
  assert.equal(recalled.markerSeq, null)
})
