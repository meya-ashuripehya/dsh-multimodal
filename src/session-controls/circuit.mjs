/**
 * Circuit breaker: stop runaway tool / step / thinking loops via agent.cancel.
 * Official Harness delivers session/event as (session, event). After an
 * automatic trip the failed tail turn is cut on disk the same way as a manual
 * retract, once the agent has stopped appending.
 */
import { rewindTailTurn } from './ops.mjs'

export function createCircuitBreaker(ctx, getConfig) {
  /** @type {Map<string, { toolKey: string, toolStreak: number, steps: number, reasoningChars: number, seenToolIds?: Set<string>, tripped?: object }>} */
  const state = new Map()
  const notices = []
  const MAX_NOTICES = 20

  function cfg() {
    const c = getConfig?.() ?? {}
    return {
      // Master switch sessionControlsEnabled must be explicitly on (experimental, default off).
      enabled: c.sessionControlsEnabled === true && c.sessionCircuitEnabled !== false,
      maxSameTool: Math.max(2, Number(c.sessionCircuitMaxSameTool ?? 6)),
      maxSteps: Math.max(5, Number(c.sessionCircuitMaxSteps ?? 80)),
      maxReasoningChars: Math.max(1000, Number(c.sessionCircuitMaxReasoningChars ?? 200000)),
    }
  }

  function bucket(sessionId) {
    const id = String(sessionId)
    if (!state.has(id)) state.set(id, { toolKey: '', toolStreak: 0, steps: 0, reasoningChars: 0 })
    return state.get(id)
  }

  function pushNotice(n) {
    notices.unshift({ ...n, at: Date.now() })
    while (notices.length > MAX_NOTICES) notices.pop()
  }

  function liveAgent(sessionId) {
    const agents = typeof ctx.get === 'function' ? ctx.get('agents') : ctx.agents
    return agents?.get?.(sessionId)
  }

  function turnStartSeq(sessionId) {
    const agent = liveAgent(sessionId)
    const events = agent?.session?.snapshotEvents?.()
    if (!Array.isArray(events)) return null
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.type === 'turn/start' && Number.isSafeInteger(events[i].seq)) return events[i].seq
    }
    return null
  }

  function attachedSession(sessionId) {
    try {
      const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions
      const live = sessions?.get?.(sessionId)
      if (live && typeof live.append === 'function') return live
    } catch { /* inject may not name sessions */ }
    try {
      const agent = liveAgent(sessionId)
      if (agent?.session && typeof agent.session.append === 'function') return agent.session
    } catch { /* inject may not name agents */ }
    return null
  }

  function scheduleRewind(sessionId, turnSeq) {
    const run = async () => {
      for (let i = 0; i < 20; i++) {
        let agent = null
        try { agent = liveAgent(sessionId) } catch { agent = null }
        if (!agent || agent.status !== 'running') break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      // The open writer still owns seq = log.length. A shorter file plus a
      // later append breaks the contiguous-seq contract. Cancel already landed.
      if (attachedSession(sessionId)) return
      try {
        const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions
        const live = sessions?.get?.(sessionId)
        if (live && typeof sessions.flush === 'function') await sessions.flush(live)
      } catch {}
      try {
        const result = rewindTailTurn(sessionId, turnSeq == null ? {} : { expectStartSeq: turnSeq })
        pushNotice({
          sessionId,
          ok: true,
          message: '熔断：已截断失败尾轮，重新打开会话后再继续',
          rewind: { cutTurn: result.cutTurn, deletedEvents: result.deletedEvents },
        })
      } catch (error) {
        pushNotice({ sessionId, ok: false, error: '熔断回撤失败：' + String(error?.message ?? error) })
      }
    }
    Promise.resolve().then(run).catch(() => {})
  }

  function cancelSession(sessionId, reason, { rewind = false } = {}) {
    const agent = liveAgent(sessionId)
    if (!agent || typeof agent.cancel !== 'function') {
      pushNotice({ sessionId, reason, ok: false, error: 'no live agent' })
      return { ok: false, error: 'no live agent for session' }
    }
    try {
      const turnSeq = rewind ? turnStartSeq(sessionId) : null
      agent.cancel({ kind: 'user' }, { keepInbox: true })
      const notice = { sessionId, reason, ok: true, message: '熔断：已取消当前回合 — ' + reason }
      pushNotice(notice)
      const b = bucket(sessionId)
      b.tripped = notice
      if (rewind) scheduleRewind(sessionId, turnSeq)
      return notice
    } catch (error) {
      const notice = { sessionId, reason, ok: false, error: String(error?.message ?? error) }
      pushNotice(notice)
      return notice
    }
  }

  function onTool(sessionId, name, args, callId) {
    const c = cfg()
    if (!c.enabled) return null
    const b = bucket(sessionId)
    if (callId) {
      b.seenToolIds ??= new Set()
      const id = String(callId)
      if (b.seenToolIds.has(id)) return null
      b.seenToolIds.add(id)
    }
    let key = String(name || '')
    try { key += '|' + JSON.stringify(args ?? null) } catch { key += '|?' }
    if (key === b.toolKey) b.toolStreak++
    else { b.toolKey = key; b.toolStreak = 1 }
    if (b.toolStreak >= c.maxSameTool) {
      return cancelSession(sessionId, `同一工具连续调用 ${b.toolStreak} 次（${name}）`, { rewind: true })
    }
    return null
  }

  function onStep(sessionId) {
    const c = cfg()
    if (!c.enabled) return null
    const b = bucket(sessionId)
    b.steps++
    if (b.steps >= c.maxSteps) {
      return cancelSession(sessionId, `单回合步数超过 ${c.maxSteps}`, { rewind: true })
    }
    return null
  }

  function onReasoning(sessionId, chunkText) {
    const c = cfg()
    if (!c.enabled) return null
    const b = bucket(sessionId)
    b.reasoningChars += String(chunkText ?? '').length
    if (b.reasoningChars >= c.maxReasoningChars) {
      return cancelSession(sessionId, `思考内容超过 ${c.maxReasoningChars} 字符`, { rewind: true })
    }
    return null
  }

  function reset(sessionId) {
    state.delete(String(sessionId))
  }

  function install() {
    const disposers = []

    // Prefer tools wrapper when available
    const tools = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools
    if (tools && typeof tools.intercept === 'function') {
      try {
        const off = tools.intercept('execute', async (next, call, exec) => {
          const sessionId = exec?.session?.id ?? exec?.sessionId ?? call?.sessionId
          if (sessionId) onTool(sessionId, call?.name ?? exec?.name, call?.arguments ?? exec?.arguments)
          return next()
        })
        if (typeof off === 'function') disposers.push(off)
      } catch {}
    }

    // Session event hooks (best-effort; shape varies by harness version)
    const on = typeof ctx.on === 'function' ? ctx.on.bind(ctx) : null
    if (on) {
      try {
        const observe = (sessionId, type, data) => {
          if (!sessionId || !type) return
          if (type === 'turn/start') reset(sessionId)
          else if (type === 'step/start') onStep(sessionId)
          else if (type === 'tool/call' || type === 'assistant/tool-call') {
            onTool(
              sessionId,
              data?.name ?? data?.toolName ?? data?.call?.name,
              data?.arguments ?? data?.args ?? data?.input,
              data?.callId ?? data?.id,
            )
          } else if (type === 'assistant/reasoning' || type === 'assistant/chunk') {
            const text = data?.chunk ?? data?.text ?? data?.delta ?? ''
            if (data?.kind === 'reasoning' || type === 'assistant/reasoning') onReasoning(sessionId, text)
          } else if (type === 'assistant/message') {
            const blocks = data?.message?.content
            if (!Array.isArray(blocks)) return
            for (const block of blocks) {
              if (block?.type === 'tool-call') {
                onTool(sessionId, block.name ?? block.toolName, block.arguments ?? block.input, block.id)
              } else if (block?.type === 'reasoning' || block?.type === 'thinking') {
                onReasoning(sessionId, block.text ?? block.reasoning ?? '')
              }
            }
          }
        }
        disposers.push(on('session/event', (sessionOrEvent, event) => {
          try {
            // Official 0.2: (session, event). Older envelopes put type on the first arg.
            const official = event && typeof event === 'object' && typeof event.type === 'string'
            const sessionId = official
              ? (sessionOrEvent?.id ?? sessionOrEvent?.sessionId)
              : (sessionOrEvent?.sessionId ?? sessionOrEvent?.session?.id)
            const type = official ? event.type : (sessionOrEvent?.type ?? sessionOrEvent?.event?.type)
            const data = official ? event.data : (sessionOrEvent?.data ?? sessionOrEvent?.event?.data)
            observe(sessionId, type, data)
          } catch {}
        }))
      } catch {}
    }

    return () => { for (const d of disposers) try { d() } catch {} }
  }

  return {
    install,
    cancelSession,
    onTool,
    onStep,
    onReasoning,
    reset,
    listNotices: () => notices.slice(),
    status: (sessionId) => {
      const b = sessionId ? bucket(sessionId) : null
      return { config: cfg(), session: b, notices: notices.slice(0, 10) }
    },
  }
}
