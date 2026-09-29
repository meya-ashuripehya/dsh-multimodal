/**
 * 「已连接」探测：汇总各组件文件夹的 app / probe，并提供 probeComponent。
 * 共享原语见 ./connect-lib.mjs；约定见 ../docs/component-module.md。
 */
export {
  PROBE_TTL_MS, PROBE_TIMEOUT_MS, CONN_STATES, listProcesses, appRunning, appRunningIn,
  setApps, tcpOpen, unityPing, httpJson, httpStatus, profileLocked, defaultEnv,
  mcpToolNames, callMcpTool, chromeDefaultUserDataDir, result, toolFailed, noAppFor,
} from './connect-lib.mjs'

import { PROBE_TIMEOUT_MS, result, setApps } from './connect-lib.mjs'
import { APPS, PROBES } from './components/registry.mjs'

setApps(APPS)
export { APPS }

/**
 * 探测一个组件。probeCtx：{ cfg, tools, env, procs }。
 * 整体限时 PROBE_TIMEOUT_MS；超时算 unreachable（调用方可按上一次结果处理）。
 */
export async function probeComponent(component, probeCtx) {
  const fn = PROBES[component.id]
  if (!fn) return null
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ...result('unreachable', `检查连接超时（${PROBE_TIMEOUT_MS / 1000} 秒）`, 'timeout'), timeout: true }), PROBE_TIMEOUT_MS)
  })
  try {
    return await Promise.race([fn.call(component, probeCtx), timeout])
  } catch (error) {
    return result('unreachable', `检查连接出错：${error?.message ?? error}`, 'error')
  } finally {
    clearTimeout(timer)
  }
}
