import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { writeSessionLog, readSessionLog } from './zstd-log.mjs'
import { truncateSession, rewindTailTurn } from './ops.mjs'

function event(seq, type, data = {}) {
  return { seq, type, time: 1, data }
}

test('suffix cut keeps contiguous seq and drops the projection cache', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-sc-'))
  process.env.DSH_HOME = home
  const sessionId = 'ch-test-rewind'
  const dir = join(home, 'sessions', 'proj', sessionId)
  mkdirSync(dir, { recursive: true })
  const logPath = join(dir, 'session.v3.jsonl.zstd')
  const header = { id: sessionId, version: 3, cwd: 'C:\\work', createdAt: 1 }
  const events = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', { content: [{ type: 'text', text: 'keep' }] }),
    event(2, 'turn/end', { turn: 1 }),
    event(3, 'turn/start', { turn: 2 }),
    event(4, 'user/message', { content: [{ type: 'text', text: 'drop me' }] }),
    event(5, 'tool/call', { name: 'vision_describe', turn: 2 }),
  ]
  writeSessionLog(logPath, header, events)
  const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
  mkdirSync(cacheDir, { recursive: true })
  const cache = join(cacheDir, sessionId + '.json')
  writeFileSync(cache, '{"stale":true}')
  const summaryDir = join(home, 'dsh-retrace', 'summaries')
  mkdirSync(summaryDir, { recursive: true })
  const summary = join(summaryDir, sessionId + '.jsonl')
  writeFileSync(summary, '{}\n')

  const result = truncateSession(sessionId, 4, { keepMode: 'before-turn' })
  assert.equal(result.deletedEvents, 3)
  assert.equal(result.userText, 'drop me')
  assert.deepEqual(result.clearedCaches.sort(), [cache, summary].sort())
  assert.equal(existsSync(cache), false)
  assert.equal(existsSync(summary), false)

  const restored = readSessionLog(logPath)
  assert.equal(restored.header.id, sessionId)
  assert.deepEqual(restored.events.map((ev) => ev.seq), [0, 1, 2])
  assert.equal(restored.events.at(-1).type, 'turn/end')
  const raw = readFileSync(logPath)
  assert.ok(raw.length > 8)
})

test('before-turn cut drops the inbox insert the turn already consumed', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-sc-'))
  process.env.DSH_HOME = home
  const sessionId = 'ch-inbox'
  const dir = join(home, 'sessions', 'proj', sessionId)
  mkdirSync(dir, { recursive: true })
  const header = { id: sessionId, version: 4, createdAt: 1 }
  const queued = {
    content: [{ type: 'text', text: '大肥鱼' }],
    source: { kind: 'user' },
    role: 'user',
    id: 'm1',
  }
  writeSessionLog(join(dir, 'session.v4.jsonl.zstd'), header, [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(2, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [queued] }),
    event(3, 'turn/start', { turn: 2 }),
    event(4, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    event(5, 'user/message', queued),
    event(6, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
  ])
  const result = truncateSession(sessionId, 5, { keepMode: 'before-turn' })
  assert.equal(result.userText, '大肥鱼')
  assert.equal(result.afterEvents, 2)
  const restored = readSessionLog(join(dir, 'session.v4.jsonl.zstd'))
  assert.deepEqual(restored.events.map((ev) => ev.type), ['turn/start', 'turn/end'])
})

test('rewindTailTurn cuts only the last turn', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-sc-'))
  process.env.DSH_HOME = home
  const sessionId = 'ch-tail'
  const dir = join(home, 'sessions', 'proj', sessionId)
  mkdirSync(dir, { recursive: true })
  const header = { id: sessionId, version: 4, createdAt: 1 }
  writeSessionLog(join(dir, 'session.v4.jsonl.zstd'), header, [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'turn/end', { turn: 1 }),
    event(2, 'turn/start', { turn: 2 }),
    event(3, 'assistant/message', { turn: 2 }),
  ])
  const result = rewindTailTurn(sessionId)
  assert.equal(result.cutTurn, 2)
  assert.equal(result.afterEvents, 2)
  assert.throws(() => rewindTailTurn(sessionId, { expectStartSeq: 99 }), /tail turn changed/)
})
