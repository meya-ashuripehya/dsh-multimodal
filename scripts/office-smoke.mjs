// OfficeMCP 冒烟：按插件的启动方案拉起 OfficeMCP，走一遍 initialize、tools/list 和
// AvailableApps（只查注册表，不会打开 Office），并检查标准输出里没有非 JSON 的行。
// 启动方案优先用插件 tools/officemcp（「下载安装」的结果）；加 --expect-managed 时不是它就算失败。
import { spawn } from 'node:child_process'
import { SettingsSchema, officeLaunchPlan } from '../lib/index.mjs'

const plan = officeLaunchPlan(SettingsSchema({}))
if (!plan.ok) {
  console.error(`office-smoke: ${plan.reason}`)
  process.exit(1)
}
const { command, args, cwd, env } = plan.config
console.log('source:', plan.source, '| cwd:', cwd)
console.log('spawn:', command, args.join(' '))
if (process.argv.includes('--expect-managed') && plan.source !== 'managed') {
  console.error('office-smoke: 没有用插件 tools/officemcp 里的安装（先跑 npm run smoke:tools 或在设置页下载安装）')
  process.exit(1)
}
const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] })

let buf = ''
let nextId = 1
const pending = new Map()
const junk = []
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { junk.push(line); continue }
    const resolve = pending.get(msg.id)
    if (resolve) { pending.delete(msg.id); resolve(msg) }
  }
})

function send(msg) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n') }
function rpc(method, params) {
  const id = nextId++
  send({ id, method, params })
  return new Promise((resolve, reject) => {
    pending.set(id, resolve)
    setTimeout(() => reject(new Error(`${method} timed out`)), 180_000).unref()
  })
}

try {
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'office-smoke', version: '0' } })
  if (init.error) throw new Error(`initialize: ${JSON.stringify(init.error)}`)
  console.log('server:', JSON.stringify(init.result.serverInfo))
  send({ method: 'notifications/initialized' })
  const list = await rpc('tools/list', {})
  console.log('tools:', list.result.tools.map((t) => t.name).join(', '))
  const apps = await rpc('tools/call', { name: 'AvailableApps', arguments: {} })
  console.log('AvailableApps:', JSON.stringify(apps.result?.structuredContent ?? apps.result?.content ?? apps.error))
  if (junk.length) {
    console.error('office-smoke: 标准输出里有非 JSON 行：', junk)
    process.exitCode = 1
  } else {
    console.log('office-smoke: ok')
  }
} catch (error) {
  console.error('office-smoke:', error.message)
  process.exitCode = 1
} finally {
  child.kill()
}
