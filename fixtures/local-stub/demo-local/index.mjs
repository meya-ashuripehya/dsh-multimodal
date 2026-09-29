/**
 * 本地兼容组件桩：仅供 smoke / harness 验证 bundled vs local 合并与贡献清单。
 * 无真实 MCP；不要用于生产。
 */
export const id = 'demo-local'

export const app = {
  name: 'Demo Local',
  exe: 'demo-local.exe',
  match: /^demo-local$/,
}

export const meta = {
  id: 'demo-local',
  title: 'Demo Local',
  group: '工作组件',
  serverName: 'demo_local',
  summary: '本地兼容组件演示桩（无 MCP）。',
}

/** @type {import('../../../src/components/shared.mjs').ComponentModule} */
export const component = {
  id: 'demo-local',
  label: 'Demo Local',
  serverName: 'demo_local',
  summary: '本地兼容组件演示桩（无 MCP）。',
  keys: ['demoLocalEnabled'],
  installed() { return false },
  launch(cfg) {
    if (cfg.demoLocalEnabled === false) return { ok: false, reason: '已在设置里关闭' }
    return { ok: false, missing: true, reason: '本地演示桩：未提供可下载的 MCP（请换成真实上游后再「下载安装」）' }
  },
}

export async function probe() {
  return { state: 'no-app', detail: '演示桩：没有对应程序', via: 'process' }
}

export default component
