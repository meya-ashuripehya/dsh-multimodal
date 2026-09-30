/**
 * In-place retract / regenerate / cancel for session logs.
 */
import {
  findSessionLogPath, readSessionLog, writeSessionLog, backupLog, sha256,
} from './zstd-log.mjs'
import { readFileSync } from 'node:fs'

function stampNow() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return [
    d.getFullYear(), p(d.getMonth() + 1), p(d.getDate()),
    '-', p(d.getHours()), p(d.getMinutes()), p(d.getSeconds()),
  ].join('')
}

function textOfUserMessage(ev) {
  const parts = ev?.data?.content
  if (!Array.isArray(parts)) return ''
  return parts.filter((p) => p?.type === 'text').map((p) => String(p.text ?? '')).join('\n').trim()
}

/** Find turn/start index for the turn that owns userMessageSeq. */
export function findTurnStartIndex(events, userMessageSeq) {
  const seq = Number(userMessageSeq)
  const msgIdx = events.findIndex((e) => e.seq === seq && (e.type === 'user/message' || e.type === 'agent/inbox/spliced'))
  // Also allow locating by any event seq inside the turn
  let targetIdx = msgIdx
  if (targetIdx < 0) {
    targetIdx = events.findIndex((e) => e.seq === seq)
    if (targetIdx < 0) throw Object.assign(new Error('event seq not found: ' + seq), { status: 404 })
  }
  let turnStartIdx = -1
  for (let i = targetIdx; i >= 0; i--) {
    if (events[i].type === 'turn/start') { turnStartIdx = i; break }
  }
  if (turnStartIdx < 0) throw Object.assign(new Error('no turn/start before seq ' + seq), { status: 400 })
  return { turnStartIdx, turn: events[turnStartIdx].data?.turn, targetIdx }
}

/** Remap turn numbers to contiguous 1..N after a truncate (usually no-op if truncating a suffix). */
export function remapTurnsContiguous(events) {
  const turnMap = new Map()
  let next = 1
  for (const ev of events) {
    if (ev.type === 'turn/start') {
      const old = ev.data?.turn
      if (typeof old === 'number' && !turnMap.has(old)) turnMap.set(old, next++)
    }
  }
  if (turnMap.size === 0) return { events, remapped: false, turnMapSize: 0 }
  let changed = false
  for (const [a, b] of turnMap) if (a !== b) { changed = true; break }
  if (!changed) return { events, remapped: false, turnMapSize: turnMap.size }
  const out = events.map((ev) => {
    if (!ev.data || typeof ev.data !== 'object' || !('turn' in ev.data)) return ev
    const t = ev.data.turn
    if (typeof t !== 'number' || !turnMap.has(t)) return ev
    return { ...ev, data: { ...ev.data, turn: turnMap.get(t) } }
  })
  return { events: out, remapped: true, turnMapSize: turnMap.size }
}

function reseq(events) {
  return events.map((e, i) => (e.seq === i ? e : { ...e, seq: i }))
}

export function listUserTurns(sessionId) {
  const logPath = findSessionLogPath(sessionId)
  if (!logPath) throw Object.assign(new Error('session log not found: ' + sessionId), { status: 404 })
  const { header, events } = readSessionLog(logPath)
  const turns = []
  let currentTurn = null
  for (const ev of events) {
    if (ev.type === 'turn/start') currentTurn = { turn: ev.data?.turn, startSeq: ev.seq, users: [] }
    if ((ev.type === 'user/message') && currentTurn) {
      currentTurn.users.push({ seq: ev.seq, text: textOfUserMessage(ev).slice(0, 200) })
    }
    if (ev.type === 'turn/end' && currentTurn) {
      if (currentTurn.users.length) turns.push({ ...currentTurn, endSeq: ev.seq })
      currentTurn = null
    }
  }
  if (currentTurn?.users?.length) turns.push(currentTurn)
  return {
    sessionId: header.id,
    version: header.version,
    eventCount: events.length,
    turns: turns.slice(-80),
    logPath,
  }
}

/**
 * Truncate log so the chosen user turn and everything after it are removed.
 * keepMode:
 *  - 'before-turn' (retract): drop from turn/start inclusive
 *  - 'after-user' (regen prep): keep turn/start + user messages of that turn, drop the rest of the turn and following
 */
export function truncateSession(sessionId, userMessageSeq, { keepMode = 'before-turn' } = {}) {
  const logPath = findSessionLogPath(sessionId)
  if (!logPath) throw Object.assign(new Error('session log not found: ' + sessionId), { status: 404 })
  const { header, events } = readSessionLog(logPath)
  const { turnStartIdx, turn, targetIdx } = findTurnStartIndex(events, userMessageSeq)

  let cutIdx = turnStartIdx
  let userText = ''
  if (keepMode === 'after-user') {
    // keep from start through last consecutive user/message / inbox splice after turn/start until first step/assistant
    cutIdx = turnStartIdx + 1
    while (cutIdx < events.length) {
      const t = events[cutIdx].type
      if (t === 'user/message' || t === 'agent/inbox/spliced' || t === 'session/title') {
        if (t === 'user/message') userText = textOfUserMessage(events[cutIdx]) || userText
        cutIdx++
        continue
      }
      break
    }
    // If the target user message is later, ensure we include it
    if (targetIdx >= cutIdx) {
      // expand to include targetIdx if it's a user message in this turn
      cutIdx = targetIdx + 1
      userText = textOfUserMessage(events[targetIdx]) || userText
    }
  } else {
    // retract: also capture text for reporting
    for (let i = turnStartIdx; i < events.length; i++) {
      if (events[i].type === 'user/message') { userText = textOfUserMessage(events[i]); break }
      if (events[i].type === 'turn/end') break
    }
  }

  const kept = events.slice(0, cutIdx)
  const { events: remapped, remapped: didRemap, turnMapSize } = remapTurnsContiguous(kept)
  const finalEvents = reseq(remapped)

  const stamp = stampNow()
  const backup = backupLog(logPath, stamp)
  writeSessionLog(logPath, header, finalEvents)
  const after = readFileSync(logPath)

  return {
    ok: true,
    sessionId: header.id,
    logPath,
    mode: keepMode,
    cutTurn: turn,
    cutAtSeq: cutIdx === 0 ? 0 : (finalEvents.length ? finalEvents[finalEvents.length - 1].seq + 1 : 0),
    beforeEvents: events.length,
    afterEvents: finalEvents.length,
    deletedEvents: events.length - cutIdx,
    remapped: didRemap,
    turnMapSize,
    userText,
    backup,
    outSha256: sha256(after),
    needReload: true,
    hint: '已写入磁盘。请关闭并重新打开该会话（或重启 Harness）后再继续，否则内存中的旧日志仍会覆盖。',
  }
}

export function extractUserText(sessionId, userMessageSeq) {
  const logPath = findSessionLogPath(sessionId)
  if (!logPath) throw Object.assign(new Error('session log not found: ' + sessionId), { status: 404 })
  const { events } = readSessionLog(logPath)
  const ev = events.find((e) => e.seq === Number(userMessageSeq))
  if (!ev) throw Object.assign(new Error('seq not found'), { status: 404 })
  if (ev.type === 'user/message') return textOfUserMessage(ev)
  // fallback: find first user message in same turn
  const { turnStartIdx } = findTurnStartIndex(events, userMessageSeq)
  for (let i = turnStartIdx; i < events.length; i++) {
    if (events[i].type === 'user/message') return textOfUserMessage(events[i])
    if (events[i].type === 'turn/end') break
  }
  return ''
}
