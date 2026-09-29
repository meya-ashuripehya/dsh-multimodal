/**
 * 工作组件：photoshop
 * @see ../../../docs/component-module.md
 */
import { IS_WIN, installNpmTool, managedNpmEntry, npmLaunch, OFF } from '../shared.mjs'
import { appRunning, callMcpTool, mcpNotReady, noAppFor, result, toolFailed } from '../../connect-lib.mjs'

export const id = 'photoshop'

export const app = { name: 'Photoshop', exe: 'Photoshop.exe', match: /photoshop/ }

export const meta = {
  id: 'photoshop',
  title: 'Photoshop',
  group: '工作组件',
  url: 'https://github.com/alisaitteke/photoshop-mcp',
  serverName: 'photoshop',
  summary: '经 COM 控制本机的 Adobe Photoshop（photoshop-mcp），不需要装 Photoshop 插件。',
}

/** @type {import('../shared.mjs').ComponentModule} */
export const component = {
    id: 'photoshop',
    label: 'Photoshop',
    url: 'https://github.com/alisaitteke/photoshop-mcp',
    serverName: 'photoshop',
    runtime: 'node',
    summary: '经 COM 控制本机的 Adobe Photoshop（photoshop-mcp），不需要装 Photoshop 插件。',
    keys: ['photoshopEnabled', 'photoshopPath', 'photoshopPackage', 'nodePath'],
    spec: (cfg) => cfg.photoshopPackage || '@alisaitteke/photoshop-mcp',
    bin: 'photoshop-mcp',
    // 可选依赖里只有它自带 UI 用的 Claude Agent SDK 平台包（Windows 上 235 MB），MCP 服务器用不到；
    // 安装脚本只给 better-sqlite3 编译 / 下载原生模块（也只有 UI 用），跳过后 MCP 服务器照常工作。
    installArgs: ['--omit=optional', '--ignore-scripts'],
    installed(cfg) { return !!managedNpmEntry('photoshop', this.spec(cfg)) },
    install(cfg, task, hooks) { return installNpmTool(this, cfg, task, hooks) },
    launch(cfg) {
      if (!cfg.photoshopEnabled) return OFF
      if (!IS_WIN && process.platform !== 'darwin') return { ok: false, reason: 'photoshop-mcp 只支持 Windows（COM）和 macOS（AppleScript）' }
      // 关掉它默认开启的匿名统计和反馈提问。
      const env = { ANALYTICS_DISABLED: '1', PSMCP_FEEDBACK: '0' }
      if (cfg.photoshopPath && cfg.photoshopPath.trim()) env.PHOTOSHOP_PATH = cfg.photoshopPath.trim()
      // 创成式填充等操作较慢，工具调用超时放宽到 5 分钟。
      return npmLaunch(this, cfg, [], env, { toolCallTimeoutMs: 300000 })
    },
  }

export async function probe(ctx) {
    if (!appRunning(await ctx.procs(), app)) return noAppFor(app)
    const nr = mcpNotReady(ctx, this); if (nr) return nr
    const r = await callMcpTool(ctx.tools, this.serverName, 'photoshop_ping')
    if (!r.ok) return toolFailed(r, `Photoshop 在运行，但 photoshop_ping 失败：${r.error}`, 'tool:photoshop_ping')
    if (!/Successfully connected/i.test(r.text)) return result('unreachable', `Photoshop 在运行，但 photoshop_ping 返回：${r.text.split('\n')[0] || '（空）'}`, 'tool:photoshop_ping')
    return result('connected', 'Photoshop 在运行，photoshop_ping 成功', 'tool:photoshop_ping')
  
}

export default component
