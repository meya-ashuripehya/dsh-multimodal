/**
 * In-place retract / regenerate / cancel for session logs.
 */
import {
  findSessionLogPath, readSessionLog, writeSessionLog, backupLog, sha256, clearDerivedCaches,
} from './zstd-log.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

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

function isQueuedTurnInsert(ev) {
  if (ev?.type !== 'agent/inbox/spliced') return false
  const data = ev.data || {}
  const inserted = Array.isArray(data.inserted) ? data.inserted : []
  const removed = Number(data.removedCount || 0)
  return data.target === 'next-turn' && inserted.length > 0 && removed === 0
}

/**
 * A suffix cut at turn/start leaves the inbox insert that fed the turn.
 * After reopen that insert is still "pending", and the queue rejects send/delete
 * because the turn that claimed it is gone. Drop that insert when the turn
 * consumed the whole run sitting immediately in front of it.
 */
function dropConsumedTurnInput(events, turnStartIdx, cutIdx) {
  let runStart = turnStartIdx
  while (runStart > 0 && isQueuedTurnInsert(events[runStart - 1])) runStart -= 1
  const run = turnStartIdx - runStart
  if (run === 0 || cutIdx > turnStartIdx) return cutIdx
  let consumed = 0
  for (let i = turnStartIdx + 1; i < events.length; i++) {
    const ev = events[i]
    if (ev.type === 'turn/start' || ev.type === 'turn/end') break
    if (ev.type === 'agent/inbox/spliced' && ev.data?.target === 'next-turn' && Number(ev.data.removedCount) > 0) {
      consumed = Number(ev.data.removedCount)
      break
    }
  }
  if (consumed <= 0 || run > consumed) return cutIdx
  return runStart
}

function lastModelSource(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const data = events[i]?.data
    const header = data?.header
    const candidates = [data?.source, data?.message?.source, header, header?.config, data?.config]
    for (const src of candidates) {
      if (src && typeof src.provider === 'string' && src.provider && typeof src.model === 'string' && src.model) {
        return { provider: src.provider, model: src.model }
      }
    }
  }
  return null
}

/** Carrier the page uses to tell a regenerate replace from a retract replace. */
export const REGENERATE_CARRIER_TEXT = '已丢弃此前的回答，准备重新生成。'
/** Followup source kind. Not `user`, so the chat does not paint a second question bubble. */
export const REGENERATE_SOURCE_KIND = 'dsw-regenerate'

function isAppendUserMessage(ev) {
  return ev?.type === 'user/message' && (ev.surfaceOp === 'append' || ev.surfaceOp == null)
}

/**
 * First real user message of the turn that owns anchorSeq.
 * Replacement carriers are not appends, so they are skipped.
 */
export function turnPrompt(events, anchorSeq) {
  const { turnStartIdx } = findTurnStartIndex(events, anchorSeq)
  for (let i = turnStartIdx; i < events.length; i++) {
    const ev = events[i]
    if (i !== turnStartIdx && ev.type === 'turn/start') break
    if (ev.type === 'turn/end') break
    if (!isAppendUserMessage(ev)) continue
    const content = Array.isArray(ev.data?.content) ? ev.data.content : []
    const text = textOfUserMessage(ev)
    if (!text && content.length === 0) continue
    return { userSeq: Number(ev.seq), text, content }
  }
  return { userSeq: null, text: '', content: [] }
}

function surfaceNodeSeqs(session) {
  const nodes = session.surface?.nodes
  if (!nodes || typeof nodes.length !== 'number') {
    throw Object.assign(new Error('live session has no surface'), { status: 409 })
  }
  const seqs = []
  for (let i = 0; i < nodes.length; i++) {
    const seq = Number(nodes[i])
    if (Number.isSafeInteger(seq)) seqs.push(seq)
  }
  return seqs
}

/**
 * Contiguous surface suffix after the kept user node.
 * A seq filter can skip a node that still sits inside that suffix; the replace
 * contract requires every shadowed surface node, in surface order.
 */
export function shadowSeqsAfterUser(surfaceSeqs, userSeq) {
  const list = Array.isArray(surfaceSeqs) ? surfaceSeqs : []
  const userIdx = list.indexOf(userSeq)
  let start = userIdx >= 0 ? userIdx + 1 : list.findIndex((seq) => seq > userSeq)
  if (start < 0) return []
  if (userIdx < 0 && start === 0) start = 1
  if (start >= list.length) return []
  return list.slice(start)
}

function eventAtSeq(events, seq) {
  const direct = events?.[seq]
  if (direct && direct.seq === seq) return direct
  return events?.find((ev) => ev.seq === seq) ?? null
}

/**
 * Surface suffix of a retract. Node 0 is the system prompt and a user/message
 * replace cannot cover it; the prompt stays, and the turn after it is shadowed.
 */
export function retractShadowSeqs(surfaceSeqs, events, fromSeq) {
  const list = Array.isArray(surfaceSeqs) ? surfaceSeqs : []
  const start = list.findIndex((seq) => seq >= fromSeq)
  if (start < 0) return []
  const headIsPrompt = start === 0 && eventAtSeq(events, list[0])?.type === 'system/message'
  const from = headIsPrompt ? 1 : start
  if (from >= list.length) return []
  return list.slice(from)
}

export function outputShadowSeqs(events, surfaceSeqs, anchorSeq) {
  const prompt = turnPrompt(events, anchorSeq)
  if (prompt.userSeq == null) return { userSeq: null, text: '', content: [], shadowed: [] }
  return {
    userSeq: prompt.userSeq,
    text: prompt.text,
    content: prompt.content,
    shadowed: shadowSeqsAfterUser(surfaceSeqs, prompt.userSeq),
  }
}

function appendRecallCarrier(session, events, shadowed, text) {
  const model = lastModelSource(events)
  if (!model) throw Object.assign(new Error('session has no model header yet'), { status: 409 })
  const marker = session.append('user/message', {
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: model.provider, model: model.model },
  }, {
    surfaceOp: { op: 'replace', startSeq: shadowed[0], endSeq: shadowed[shadowed.length - 1] },
    sourceEventSeqs: shadowed.slice(),
  })
  return marker
}

/**
 * Hide a turn on the open session the way dsh-retrace does: append a
 * user/message surface replace. The live event stream updates the page;
 * seq stays contiguous, so a later followup does not require a restart.
 */
export function recallLiveTurn(session, userMessageSeq) {
  if (!session || typeof session.append !== 'function' || typeof session.snapshotEvents !== 'function') {
    throw Object.assign(new Error('live session cannot accept a recall marker'), { status: 409 })
  }
  const events = session.snapshotEvents()
  const { turnStartIdx } = findTurnStartIndex(events, userMessageSeq)
  const fromSeq = Number(events[turnStartIdx].seq)
  const shadowed = retractShadowSeqs(surfaceNodeSeqs(session), events, fromSeq)
  if (!shadowed.length) {
    throw Object.assign(new Error('nothing on the surface to retract'), { status: 409 })
  }
  const marker = appendRecallCarrier(session, events, shadowed, '已撤回此回合及之后的内容。')
  const markerSeq = marker?.seq ?? null
  return {
    ok: true,
    applied: 'live',
    mode: 'recall',
    markerSeq,
    shadowed: shadowed.length,
    hideFrom: shadowed[0],
    hideUntil: markerSeq,
    hideFromExclusive: false,
    needReload: false,
  }
}

/**
 * Keep the turn's user message on the surface and shadow everything after it
 * (the reply, tool results, and later turns). The page hides that seq range
 * and the followup streams the new reply under the same question.
 */
export function recallLiveOutput(session, anchorSeq) {
  if (!session || typeof session.append !== 'function' || typeof session.snapshotEvents !== 'function') {
    throw Object.assign(new Error('live session cannot accept a recall marker'), { status: 409 })
  }
  const events = session.snapshotEvents()
  const prompt = turnPrompt(events, anchorSeq)
  if (prompt.userSeq == null || (!prompt.text && prompt.content.length === 0)) {
    throw Object.assign(new Error('no user message to regenerate'), { status: 409 })
  }
  const shadowed = shadowSeqsAfterUser(surfaceNodeSeqs(session), prompt.userSeq)
  if (!shadowed.length) {
    return {
      ok: true,
      applied: 'live',
      mode: 'replace-output',
      markerSeq: null,
      shadowed: 0,
      userSeq: prompt.userSeq,
      userText: prompt.text,
      content: prompt.content,
      hideFrom: null,
      hideUntil: null,
      hideFromExclusive: true,
      needReload: false,
    }
  }
  const marker = appendRecallCarrier(session, events, shadowed, REGENERATE_CARRIER_TEXT)
  const markerSeq = marker?.seq ?? null
  return {
    ok: true,
    applied: 'live',
    mode: 'replace-output',
    markerSeq,
    shadowed: shadowed.length,
    userSeq: prompt.userSeq,
    userText: prompt.text,
    content: prompt.content,
    hideFrom: prompt.userSeq,
    hideUntil: markerSeq,
    hideFromExclusive: true,
    needReload: false,
  }
}

/** Any seq inside the turn. Prefer an explicit seq; otherwise match assistant message id. */
export function resolveAnchorSeq(sessionId, { userMessageSeq, messageId } = {}) {
  if (userMessageSeq != null && Number.isFinite(Number(userMessageSeq))) return Number(userMessageSeq)
  if (messageId == null || messageId === '') {
    throw Object.assign(new Error('userMessageSeq or messageId required'), { status: 400 })
  }
  const logPath = findSessionLogPath(sessionId)
  if (!logPath) throw Object.assign(new Error('session log not found: ' + sessionId), { status: 404 })
  const { events } = readSessionLog(logPath)
  const id = String(messageId)
  const hit = events.find((e) => e.type === 'assistant/message' && e.data?.message?.id === id)
    || events.find((e) => e.type === 'user/message' && (e.data?.id === id || e.data?.message?.id === id))
  if (!hit || !Number.isFinite(Number(hit.seq))) {
    throw Object.assign(new Error('message not found: ' + id), { status: 404 })
  }
  return Number(hit.seq)
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
 * Truncate log so the chosen turn and everything after it are removed.
 * Official Harness 0.2 requires seq === event index, contiguous from 0.
 * A suffix cut already satisfies that, so seq and turn numbers stay as logged.
 * keepMode:
 *  - 'before-turn' (retract / failed-tail rewind): drop from turn/start inclusive
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

  if (keepMode !== 'after-user') cutIdx = dropConsumedTurnInput(events, turnStartIdx, cutIdx)

  const finalEvents = events.slice(0, cutIdx)
  for (let i = 0; i < finalEvents.length; i++) {
    if (finalEvents[i].seq !== i) {
      throw Object.assign(
        new Error(`refusing to rewrite: event index ${i} has seq ${finalEvents[i].seq}; official logs must stay contiguous from 0`),
        { status: 409 },
      )
    }
  }

  const stamp = stampNow()
  const backup = backupLog(logPath, stamp)
  writeSessionLog(logPath, header, finalEvents)
  const clearedCaches = clearDerivedCaches(header.id ?? sessionId)
  const after = readFileSync(logPath)

  return {
    ok: true,
    sessionId: header.id,
    logPath,
    mode: keepMode,
    cutTurn: turn,
    cutAtSeq: finalEvents.length,
    beforeEvents: events.length,
    afterEvents: finalEvents.length,
    deletedEvents: events.length - cutIdx,
    userText,
    backup,
    clearedCaches,
    outSha256: sha256(after),
    needReload: true,
    hint: '已按官方多帧 zstd 截断，并清掉投影缓存。当前窗口里的会话仍按旧长度分配 seq，请先重新打开该会话再发送；否则下一条会把不连续序号追加进日志。',
  }
}

/** Cut the last turn on disk. Used after an automatic circuit trip. */
export function rewindTailTurn(sessionId, { expectStartSeq } = {}) {
  const logPath = findSessionLogPath(sessionId)
  if (!logPath) throw Object.assign(new Error('session log not found: ' + sessionId), { status: 404 })
  const { events } = readSessionLog(logPath)
  if (!events.length) throw Object.assign(new Error('session log has no events'), { status: 400 })
  let turnStart = null
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'turn/start') { turnStart = events[i]; break }
  }
  if (!turnStart) throw Object.assign(new Error('no turn/start in session log'), { status: 400 })
  if (expectStartSeq != null && turnStart.seq !== expectStartSeq) {
    throw Object.assign(new Error('tail turn changed before rewind'), { status: 409 })
  }
  return truncateSession(sessionId, turnStart.seq, { keepMode: 'before-turn' })
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
