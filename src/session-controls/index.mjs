/**
 * dsh-workbench shared session-controls: retract / regenerate / circuit-breaker.
 * Mounted from src/index.mjs (host HTTP under /dsh-workbench/api/session/*).
 */
import { listUserTurns, truncateSession, extractUserText } from './ops.mjs'
import { createCircuitBreaker } from './circuit.mjs'
import { findSessionLogPath } from './zstd-log.mjs'

export { listUserTurns, truncateSession, extractUserText, findSessionLogPath, createCircuitBreaker }

/**
 * Cancel live agent for sessionId (manual 熔断).
 */
export function cancelLive(ctx, sessionId) {
  const agents = typeof ctx.get === 'function' ? ctx.get('agents') : ctx.agents
  const agent = agents?.get?.(sessionId)
  if (!agent) return { ok: false, error: 'no live agent' }
  agent.cancel({ kind: 'user' }, { keepInbox: true })
  return { ok: true, accepted: true }
}

/**
 * Best-effort flush + detach before rewriting the durable log.
 */
export async function prepareForRewrite(ctx, sessionId) {
  const notes = []
  try {
    const r = cancelLive(ctx, sessionId)
    notes.push(r.ok ? 'cancelled' : 'no-live-agent')
  } catch (e) {
    notes.push('cancel-error:' + String(e?.message ?? e))
  }
  try {
    const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions
    const live = sessions?.get?.(sessionId)
    if (live && typeof live.flush === 'function') {
      await live.flush()
      notes.push('flushed')
    }
  } catch (e) {
    notes.push('flush-error:' + String(e?.message ?? e))
  }
  return notes
}

/**
 * After truncate, re-admit the same user text via sessionController.prompt when available.
 */
export async function rePrompt(ctx, sessionId, text) {
  const body = String(text ?? '').trim()
  if (!body) return { ok: false, error: 'empty user text' }
  const sc = typeof ctx.get === 'function'
    ? (ctx.get('sessionController') || ctx.get('sessions.controller') || ctx.get('apiSessionController'))
    : null
  if (sc && typeof sc.prompt === 'function') {
    await sc.prompt({
      sessionId,
      content: [{ type: 'text', text: body }],
      source: { kind: 'user' },
    })
    return { ok: true, via: 'sessionController.prompt' }
  }
  // Fallback: live agent inbox
  const agents = typeof ctx.get === 'function' ? ctx.get('agents') : ctx.agents
  const agent = agents?.get?.(sessionId)
  if (agent && typeof agent.prompt === 'function') {
    await agent.prompt({ role: 'user', content: [{ type: 'text', text: body }] })
    return { ok: true, via: 'agent.prompt' }
  }
  if (agent && typeof agent.followup === 'function') {
    agent.followup({ role: 'user', content: [{ type: 'text', text: body }] })
    return { ok: true, via: 'agent.followup' }
  }
  return {
    ok: false,
    error: 'no prompt API; truncated — reopen session and resend manually',
    userText: body,
  }
}

/**
 * Handle /dsh-workbench/api/session/* routes. Returns true if handled.
 */
export async function handleSessionApi(ctx, circuit, req, res, sub, { sendJson, readBody }) {
  if (!sub.startsWith('/session')) return false
  const path = sub.slice('/session'.length) || '/'

  if (path === '/status' && req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://local')
    const sessionId = url.searchParams.get('sessionId') || ''
    return void sendJson(res, 200, { ok: true, ...circuit.status(sessionId || undefined) })
  }

  if (path === '/notices' && req.method === 'GET') {
    return void sendJson(res, 200, { ok: true, notices: circuit.listNotices() })
  }

  if (path === '/turns' && req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://local')
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) return void sendJson(res, 400, { ok: false, error: 'sessionId required' })
    return void sendJson(res, 200, { ok: true, ...listUserTurns(sessionId) })
  }

  if (req.headers['sec-fetch-site'] === 'cross-site') {
    return void sendJson(res, 403, { ok: false, error: 'cross-site request refused' })
  }

  if (path === '/cancel' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const sessionId = body.sessionId
    if (!sessionId) return void sendJson(res, 400, { ok: false, error: 'sessionId required' })
    const reason = body.reason || '手动熔断'
    return void sendJson(res, 200, circuit.cancelSession(sessionId, reason))
  }

  if (path === '/retract' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const { sessionId, userMessageSeq } = body
    if (!sessionId || userMessageSeq == null) {
      return void sendJson(res, 400, { ok: false, error: 'sessionId and userMessageSeq required' })
    }
    const prep = await prepareForRewrite(ctx, sessionId)
    const result = truncateSession(sessionId, userMessageSeq, { keepMode: 'before-turn' })
    return void sendJson(res, 200, { ...result, prepare: prep })
  }

  if (path === '/regenerate' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const { sessionId, userMessageSeq } = body
    if (!sessionId || userMessageSeq == null) {
      return void sendJson(res, 400, { ok: false, error: 'sessionId and userMessageSeq required' })
    }
    const userText = extractUserText(sessionId, userMessageSeq)
    const prep = await prepareForRewrite(ctx, sessionId)
    // Drop the whole turn then re-prompt (clean regenerate)
    const truncated = truncateSession(sessionId, userMessageSeq, { keepMode: 'before-turn' })
    let promptResult = { ok: false, deferred: true }
    try {
      promptResult = await rePrompt(ctx, sessionId, userText || truncated.userText)
    } catch (e) {
      promptResult = { ok: false, error: String(e?.message ?? e) }
    }
    return void sendJson(res, 200, {
      ...truncated,
      mode: 'regenerate',
      prepare: prep,
      prompt: promptResult,
      userText: userText || truncated.userText,
      hint: promptResult.ok
        ? '已截断并重新提交用户消息。若界面未刷新，请重新打开会话。'
        : truncated.hint + ' 重新输出未能自动提交：' + (promptResult.error || ''),
    })
  }

  return void sendJson(res, 404, { ok: false, error: 'session route not found' })
}

/**
 * Install circuit breaker + return handle for API.
 */
export function mountSessionControls(ctx, getConfig) {
  const circuit = createCircuitBreaker(ctx, getConfig)
  const dispose = circuit.install()
  return { circuit, dispose }
}
