import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsw-ensure-live-'))

const { ensureLiveSession } = await import('./index.mjs')

function liveSession(id) {
  return {
    id,
    append() {},
    snapshotEvents() { return [] },
  }
}

function ctxWith(map) {
  return {
    get(name) {
      if (!Object.prototype.hasOwnProperty.call(map, name)) {
        throw new Error('cannot get property "' + name + '" without inject')
      }
      return map[name]
    },
  }
}

test('an attached agent is used without resuming', async () => {
  const session = liveSession('s1')
  const agent = { id: 's1', session, followup() {} }
  let resumed = 0
  const found = await ensureLiveSession(ctxWith({
    sessions: { get: () => session, list: () => [session] },
    agents: { get: () => agent, list: () => [agent] },
    sessionController: { agents: { resolveAgent() { resumed += 1; return { agent } } } },
  }), 's1')
  assert.equal(resumed, 0)
  assert.equal(found.agent, agent)
  assert.equal(found.live, session)
})

test('a cold open session is resumed before the page is rewritten', async () => {
  const session = liveSession('cold')
  const agent = { id: 'cold', session, followup() {} }
  let seen = null
  const found = await ensureLiveSession(ctxWith({
    sessions: { get: () => null, list: () => [] },
    agents: { get: () => undefined, list: () => [] },
    sessionController: {
      agents: {
        async resolveAgent(id) {
          seen = id
          return { agent }
        },
      },
    },
  }), 'cold')
  assert.equal(seen, 'cold')
  assert.equal(found.live, session)
  assert.equal(found.agent, agent)
})

test('a resume failure does not invent a session', async () => {
  const found = await ensureLiveSession(ctxWith({
    sessions: { get: () => null, list: () => [] },
    agents: { get: () => undefined, list: () => [] },
    sessionController: {
      agents: { async resolveAgent() { return { error: new Error('missing') } } },
    },
  }), 'gone')
  assert.equal(found.live, null)
  assert.equal(found.agent, null)
  assert.match(found.error, /missing/)
})

test('preset rejection falls through to agents.resume', async () => {
  const session = liveSession('cold')
  const agent = { id: 'cold', session, followup() {} }
  let resumed = null
  const found = await ensureLiveSession(ctxWith({
    sessions: { get: () => null, list: () => [] },
    agents: {
      get: () => undefined,
      list: () => [],
      async resume(options) {
        resumed = options
        return { agent, dispose() {} }
      },
    },
    sessionController: {
      agents: { async resolveAgent() { return { error: new Error('Unknown agent preset: guest') } } },
    },
  }), 'cold')
  assert.equal(resumed.resumeSessionId, 'cold')
  assert.equal(found.agent, agent)
  assert.equal(found.live, session)
})

test('a live log without an agent still resumes, and keeps the log if resume fails', async () => {
  const session = liveSession('held')
  const found = await ensureLiveSession(ctxWith({
    sessions: { get: () => session, list: () => [session] },
    agents: { get: () => undefined, list: () => [] },
    sessionController: {
      agents: { async resolveAgent() { return { error: new Error('writer held') } } },
    },
  }), 'held')
  assert.equal(found.live, session)
  assert.equal(found.agent, null)
})
