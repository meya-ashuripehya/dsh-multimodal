/**
 * Circuit breaker: stop runaway tool / step / thinking loops via agent.cancel.
 */
export function createCircuitBreaker(ctx, getConfig) {
  /** @type {Map<string, { toolKey: string, toolStreak: number, steps: number, reasoningChars: number, tripped?: object }>} */
  const state = new Map()
  const notices = []
  const MAX_NOTICES = 20

  function cfg() {
    const c = getConfig?.() ?? {}
    return {
      enabled: c.sessionCircuitEnabled !== false,
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

  function cancelSession(sessionId, reason) {
    const agents = typeof ctx.get === 'function' ? ctx.get('agents') : ctx.agents
    const agent = agents?.get?.(sessionId)
    if (!agent || typeof agent.cancel !== 'function') {
      pushNotice({ sessionId, reason, ok: false, error: 'no live agent' })
      return { ok: false, error: 'no live agent for session' }
    }
    try {
      agent.cancel({ kind: 'user' }, { keepInbox: true })
      const notice = { sessionId, reason, ok: true, message: '熔断：已取消当前回合 — ' + reason }
      pushNotice(notice)
      const b = bucket(sessionId)
      b.tripped = notice
      return notice
    } catch (error) {
      const notice = { sessionId, reason, ok: false, error: String(error?.message ?? error) }
      pushNotice(notice)
      return notice
    }
  }

  function onTool(sessionId, name, args) {
    const c = cfg()
    if (!c.enabled) return null
    const b = bucket(sessionId)
    let key = String(name || '')
    try { key += '|' + JSON.stringify(args ?? null) } catch { key += '|?' }
    if (key === b.toolKey) b.toolStreak++
    else { b.toolKey = key; b.toolStreak = 1 }
    if (b.toolStreak >= c.maxSameTool) {
      return cancelSession(sessionId, `同一工具连续调用 ${b.toolStreak} 次（${name}）`)
    }
    return null
  }

  function onStep(sessionId) {
    const c = cfg()
    if (!c.enabled) return null
    const b = bucket(sessionId)
    b.steps++
    if (b.steps >= c.maxSteps) {
      return cancelSession(sessionId, `单回合步数超过 ${c.maxSteps}`)
    }
    return null
  }

  function onReasoning(sessionId, chunkText) {
    const c = cfg()
    if (!c.enabled) return null
    const b = bucket(sessionId)
    b.reasoningChars += String(chunkText ?? '').length
    if (b.reasoningChars >= c.maxReasoningChars) {
      return cancelSession(sessionId, `思考内容超过 ${c.maxReasoningChars} 字符`)
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
        disposers.push(on('session/event', (ev) => {
          try {
            const sessionId = ev?.sessionId ?? ev?.session?.id
            if (!sessionId) return
            const type = ev?.type ?? ev?.event?.type
            const data = ev?.data ?? ev?.event?.data
            if (type === 'turn/start') reset(sessionId)
            else if (type === 'step/start') onStep(sessionId)
            else if (type === 'tool/call' || type === 'assistant/tool-call') {
              onTool(sessionId, data?.name ?? data?.toolName, data?.arguments ?? data?.args)
            } else if (type === 'assistant/reasoning' || type === 'assistant/chunk') {
              const text = data?.chunk ?? data?.text ?? data?.delta ?? ''
              if (data?.kind === 'reasoning' || type === 'assistant/reasoning') onReasoning(sessionId, text)
            }
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
