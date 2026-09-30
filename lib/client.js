window.__ModuleLoader__.load({
	id: "dsh-workbench",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
/**
 * dsh-workbench — 客户端半边（手写，无需构建）。
 *  1. settings.section「工作组件」设置页：首页是功能列表（按「多模态 / 工作组件 / 通用」分组，每行显示实时状态），
 *     点击一行进入该功能的管理页（运行状态、下载安装 + 启用旋钮、安装日志、配置），「‹ 返回」或 Esc 回到列表。
 *     「启用」旋钮和安装按钮在同一行靠右，拨动立即保存（只改这一项）。列表行和管理页标题前带应用图标（内置 SVG）。
 *     组件状态：未安装 / 未启动 / 已启动（MCP 服务器已挂载）/ 已连接（对应程序在运行且 MCP 够得着它，绿色实心徽标）/ 出错；
 *     管理页状态行下面的连接行给出探测细节（程序未运行 / 未连接的原因）。有组件在探测连接时每 5 秒刷新一次状态。
 *     工作组件：Office / Blender / Unity / Godot（Python，uv 安装）、Figma / Photoshop / Chrome（npm，Node.js 安装）。
 *     组件可带安装行下面的说明（/components 里的 note，如 Godot 要装哪个版本的插件）和字段旁的动作按钮
 *     （Godot「安装插件到项目」：POST /dsh-workbench/api/components/godot/addon { project }，成功后记住项目路径）。
 *     「基础工具」：添加工作组件——填写程序名称，复制给 AI 的接入提示词（只加可下载列表，不装进 tools/）。
 *     读写 /dsh-workbench/api/settings，状态来自 /dsh-workbench/api/components，
 *     「下载安装」调用 POST /dsh-workbench/api/components/<id>/install，安装期间轮询状态（不论当前在哪一页）。
 *  2. tool.call.toolview 按工具名 `mm_image_demo` 注册卡片：用 owner 传入的 loadImage 显示持久图片。
 * 所有网络请求都是同源 fetch 到宿主，插件前端不直连外部资源（CSP）。
 */
var React = require("react");
var h = React.createElement;

var API = "/dsh-workbench/api";

var STYLES = [
  ".mm-page{font-size:13px;line-height:1.6;padding:14px 16px;max-width:640px}",
  ".mm-page [hidden]{display:none!important}",
  ".mm-page h3{margin:0 0 4px;font-size:14px}",
  ".mm-page .mm-sub{color:var(--theme-text-secondary,#888);font-size:12px;margin:0 0 14px}",
  ".mm-field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}",
  ".mm-field label{font-weight:600;font-size:12px}",
  ".mm-field .mm-desc{color:var(--theme-text-secondary,#888);font-size:11px}",
  ".mm-input{background:var(--theme-input-bg,#111);color:var(--theme-text,#ddd);border:1px solid var(--theme-border,#333);border-radius:6px;padding:6px 8px;font-size:12px}",
  ".mm-row{display:flex;gap:8px;align-items:center;margin-top:6px}",
  ".mm-btn{background:var(--theme-accent,#4a9eff);color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px}",
  ".mm-btn:disabled{opacity:.45;cursor:not-allowed}",
  ".mm-msg{font-size:12px;color:var(--theme-text-secondary,#888)}",
  ".mm-msg.err{color:#e55}",
  ".mm-section{margin:18px 0 6px;padding-top:12px;border-top:1px solid var(--theme-border,#333);font-weight:600;font-size:13px}",
  ".mm-status{font-size:12px;margin:-4px 0 12px;word-break:break-all}",
  ".mm-status.on{color:#3a3}",
  ".mm-status.error{color:#e55}",
  ".mm-status.off{color:var(--theme-text-secondary,#888)}",
  ".mm-status.missing{color:#d93}",
  ".mm-status.ready{color:#3a3}",
  ".mm-status.connected{color:#2da44e;font-weight:600}",
  // 连接行（管理页状态行下面）：已连接 / 程序未运行 / 未连接 / MCP 未就绪 / 正在检查
  ".mm-conn{position:relative;font-size:12px;margin:-8px 0 12px;padding-left:14px;word-break:break-all;color:var(--theme-text-secondary,#888)}",
  ".mm-conn::before{content:\"\";position:absolute;left:1px;top:.55em;width:7px;height:7px;border-radius:50%;background:currentColor}",
  ".mm-conn.connected{color:#2da44e}",
  ".mm-conn.no-app,.mm-conn.unreachable{color:#d93}",
  ".mm-conn.mcp-down{color:#e55}",
  ".mm-install{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-6px 0 8px}",
  ".mm-install .mm-istate{flex-basis:100%}", // 安装步骤单独一行，按钮行不挤
  ".mm-btn.mm-ghost{background:transparent;color:var(--theme-text,#ddd);border:1px solid var(--theme-border,#333)}",
  ".mm-istate{font-size:12px;color:var(--theme-text-secondary,#888);word-break:break-all}",
  ".mm-istate.installing,.mm-istate.queued{color:var(--theme-accent,#4a9eff)}",
  ".mm-istate.done{color:#3a3}",
  ".mm-istate.error{color:#e55}",
  ".mm-log{margin:0 0 12px;font-size:12px}",
  ".mm-log summary{cursor:pointer;color:var(--theme-text-secondary,#888)}",
  ".mm-log pre{max-height:180px;overflow:auto;margin:4px 0 0;padding:6px 8px;border-radius:6px;background:var(--theme-input-bg,#111);border:1px solid var(--theme-border,#333);font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-all}",
  // 功能列表（首页）
  ".mm-group{margin:16px 0 6px;font-size:12px;font-weight:600;color:var(--theme-text-secondary,#888)}",
  ".mm-list{border:1px solid var(--theme-border,#333);border-radius:8px;overflow:hidden}",
  ".mm-item{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;outline:none;user-select:none}",
  ".mm-item+.mm-item{border-top:1px solid var(--theme-border,#333)}",
  ".mm-item:hover{background:rgba(127,127,127,.12)}",
  ".mm-item:focus-visible{box-shadow:inset 0 0 0 2px var(--theme-accent,#4a9eff)}",
  ".mm-item-main{flex:1;min-width:0}",
  ".mm-item-name{font-weight:600;font-size:13px;display:inline-flex;align-items:center;gap:6px;min-width:0}",
  ".mm-item-desc{color:var(--theme-text-secondary,#888);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".mm-chev{flex:none;color:var(--theme-text-secondary,#888);font-size:18px;line-height:1}",
  ".mm-badge{flex:none;font-size:11px;line-height:18px;padding:0 8px;border-radius:9px;border:1px solid currentColor;white-space:nowrap;color:var(--theme-text-secondary,#888)}",
  ".mm-badge.on,.mm-badge.ready{color:#3a3}",
  ".mm-badge.connected{color:#fff;background:#2da44e;border-color:#2da44e;font-weight:600}",
  ".mm-badge.error{color:#e55}",
  ".mm-badge.missing{color:#d93}",
  ".mm-badge.busy{color:var(--theme-accent,#4a9eff)}",
  // 功能管理页
  ".mm-dhead{display:flex;align-items:center;gap:10px;margin:0 0 12px}",
  ".mm-dhead h3{margin:0;flex:1;min-width:0;display:flex;align-items:center;gap:8px}",
  ".mm-dtitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  // 上游仓库外链（标题旁蓝色网址文字，新标签打开）
  ".mm-ext{flex:none;display:inline;max-width:min(42vw,280px);margin:0;padding:0;border:none;border-radius:0;color:#3b82f6;text-decoration:none;font-weight:400;font-size:12px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:baseline}",
  ".mm-ext:hover,.mm-ext:focus-visible{color:#2563eb;text-decoration:underline}",
  ".mm-ext:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}",
  ".mm-item-name .mm-ext{font-size:11px;max-width:min(36vw,220px)}",
  ".mm-dhead .mm-ext{font-size:12px;max-width:min(40vw,260px)}",
  ".mm-btn.mm-back{padding:3px 10px}",
  // 应用图标
  ".mm-ico{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px}",
  ".mm-ico svg{display:block;width:100%;height:100%;overflow:visible}",
  ".mm-dhead .mm-ico{width:22px;height:22px}",
  // 「启用」旋钮（button role=switch，和安装按钮同一行靠右）
  ".mm-toggle{margin-left:auto;display:flex;align-items:center;gap:8px;min-width:0}",
  ".mm-toggle label{font-size:12px;cursor:pointer;user-select:none}",
  ".mm-tmsg{font-size:12px;color:var(--theme-text-secondary,#888);word-break:break-all}",
  ".mm-tmsg.err{color:#e55}",
  ".mm-tmsg:empty{display:none}",
  ".mm-switch{position:relative;flex:none;box-sizing:border-box;width:36px;height:20px;margin:0;padding:0;border:1px solid var(--theme-border,#555);border-radius:10px;background:rgba(127,127,127,.32);cursor:pointer;transition:background-color .15s,border-color .15s}",
  ".mm-switch::after{content:\"\";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.4);transition:transform .15s}",
  ".mm-switch[aria-checked=true]{background:var(--theme-accent,#4a9eff);border-color:var(--theme-accent,#4a9eff)}",
  ".mm-switch[aria-checked=true]::after{transform:translateX(16px)}",
  ".mm-switch:focus-visible{outline:2px solid var(--theme-accent,#4a9eff);outline-offset:2px}",
  ".mm-switch:disabled{opacity:.45;cursor:not-allowed}",
  ".mm-switch[aria-busy=true]{cursor:progress}",
  ".mm-note{color:var(--theme-text-secondary,#888);font-size:11px;margin:-2px 0 10px}",
  // 组件说明（安装行下面，如 Godot 插件版本）与字段旁的动作按钮（安装插件到项目）
  ".mm-cnote{font-size:11px;line-height:1.55;margin:-2px 0 12px;padding:6px 9px;border:1px solid var(--theme-border,#333);border-radius:6px;color:var(--theme-text-secondary,#888);word-break:break-all}",
  // Figma 连接说明旁的 ? 帮助：悬停 / 聚焦弹出截图
  ".mm-sub.mm-sub-with-help{display:block}",
  ".mm-help{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;width:16px;height:16px;margin:0 0 0 6px;padding:0;border:none;border-radius:50%;background:var(--theme-accent,#4a9eff);color:#fff;cursor:help;position:relative;flex:none;line-height:1}",
  ".mm-help:focus-visible{outline:2px solid var(--theme-accent,#4a9eff);outline-offset:2px}",
  ".mm-help svg{display:block;width:10px;height:10px}",
  ".mm-help-pop{display:none;position:absolute;z-index:40;left:0;top:calc(100% + 8px);width:min(420px,calc(100vw - 48px));padding:8px;border-radius:8px;border:1px solid var(--theme-border,#333);background:var(--theme-input-bg,#111);box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none}",
  ".mm-help-pop.open{display:block}",
  ".mm-help-pop img{display:block;width:100%;height:auto;border-radius:4px}",
  ".mm-help-pop .mm-help-cap{margin:6px 2px 0;font-size:11px;line-height:1.4;color:var(--theme-text-secondary,#888)}",
  ".mm-action{flex-wrap:wrap;margin:2px 0 0}",
  ".mm-amsg{flex:1;min-width:0;font-size:12px;color:var(--theme-text-secondary,#888);word-break:break-all}",
  ".mm-amsg.ok{color:#3a3}",
  ".mm-amsg.err{color:#e55}",
  ".mm-amsg:empty{display:none}",
  ".mm-warn{font-size:12px;line-height:1.55;margin:0 0 14px;padding:8px 10px;border-radius:6px;border:1px solid #c9842a;background:rgba(201,132,42,.12);color:#e0a84a;word-break:break-word;white-space:pre-line}",
  ".mm-msg.ok{color:#3a3}",
  ".mm-src{flex:none;font-size:10px;line-height:16px;padding:0 6px;border-radius:8px;border:1px solid var(--theme-border,#555);color:var(--theme-text-secondary,#888);white-space:nowrap}",
  ".mm-src.bundled{color:#6a9;border-color:#6a9}",
  ".mm-src.local{color:#c9842a;border-color:#c9842a}",
  ".mm-item-name .mm-src{margin-left:2px}",
  ".mm-dhead .mm-src{margin-left:4px}",
  ".mm-pr{margin:12px 0;padding:10px;border:1px solid var(--theme-border,#333);border-radius:8px;background:rgba(127,127,127,.06)}",
  ".mm-pr h4{margin:0 0 6px;font-size:12px}",
  ".mm-pr p{margin:0 0 8px;font-size:12px;color:var(--theme-text-secondary,#888);line-height:1.55}",
  ".mm-pr-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
  ".mm-pr pre{margin:8px 0 0;max-height:160px;overflow:auto;padding:6px 8px;border-radius:6px;background:var(--theme-input-bg,#111);border:1px solid var(--theme-border,#333);font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-all}",
  ".mm-copy-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px}"
].join("\n");

// 设置项（按 key 引用）。type "switch" 是管理页里安装按钮行右侧的「启用」旋钮，拨动即保存，不进下方字段区。
var INPUT_FIELDS = [
  { key: "imageProvider", label: "出图提供方", type: "select", options: ["demo", "openai-compatible"], desc: "demo 为本地演示图；openai-compatible 预留给真实生图接口（尚未接入）。" },
  { key: "imageEndpoint", label: "生图接口地址", type: "text", desc: "openai-compatible 时使用。" },
  { key: "imageModel", label: "生图模型", type: "text", desc: "尚未接入。" },
  { key: "defaultSize", label: "演示图默认边长（px）", type: "number", min: 64, max: 1024, desc: "mm_image_demo 未指定 size 时使用，64–1024。" },
  { key: "officeEnabled", label: "启用", type: "switch", desc: "仅 Windows。注意：其中 RunPython 工具会执行模型给出的任意 Python 代码。" },
  { key: "officeRepo", label: "OfficeMCP 仓库目录", type: "text", desc: "已「下载安装」时优先用插件 tools\\officemcp，这里可留空；否则用这里的目录，留空时找插件目录旁边的 officemcp。" },
  { key: "officeFolder", label: "工作根目录", type: "text", desc: "OfficeMCP 读写文件的根目录；留空时使用它的默认值 D:\\@OfficeMCP（没有 D 盘时用 文档\\OfficeMCP）。" },
  { key: "blenderEnabled", label: "启用", type: "switch", desc: "Blender 没开时会在后台反复重连，不影响其他功能。" },
  { key: "blenderPackage", label: "pip 包名", type: "text", desc: "默认 mcp-for-blender（入口命令同名）。改了包名后需要重新「下载安装」；未安装时用 uvx 临时运行。" },
  { key: "unityEnabled", label: "启用", type: "switch", desc: "Unity 没开时会在后台反复重连，不影响其他功能。" },
  { key: "unityPackage", label: "pip 包名", type: "text", desc: "默认 mcpforunityserver（入口命令 mcp-for-unity）。改了包名后需要重新「下载安装」；未安装时用 uvx 临时运行。" },
  { key: "figmaEnabled", label: "启用", type: "switch", desc: "需要 Figma 桌面版。figma-console 模式下要在 Figma 里导入并运行 Desktop Bridge 插件（见上方说明）；Figma 没开时工具会报未连接，不影响其他功能。" },
  { key: "figmaMode", label: "连接方式", type: "select", options: [
    { value: "console", label: "figma-console-mcp（推荐：读写画布，免费计划可用）" },
    { value: "official", label: "官方 Figma 桌面版 MCP（需付费计划的 Dev / Full 席位）" }
  ], desc: "官方桌面版 MCP 要在 Figma 桌面版的 Dev Mode 里打开「启用桌面版 MCP 服务器」，只读、不能改画布；官方远程服务器需要 OAuth 登录，这里不支持。" },
  { key: "figmaToken", label: "个人访问令牌", type: "password", placeholder: "figd_…", desc: "可选。Figma → 设置 → 安全 → 个人访问令牌（figd_ 开头）。读写画布走插件，不需要令牌；读取文件 / 变量 / 评论 / 版本历史等 REST 类工具需要。只在 figma-console 模式下使用。" },
  { key: "figmaOfficialUrl", label: "官方 MCP 地址", type: "text", desc: "官方 Figma 桌面版 MCP 的地址，默认 http://127.0.0.1:3845/mcp；只在「官方」模式下使用。" },
  { key: "figmaPackage", label: "npm 包名", type: "text", desc: "默认 figma-console-mcp（可带版本，如 figma-console-mcp@1.40.7）。改了包名后需要重新「下载安装」；未安装时用 npx 临时运行。" },
  { key: "photoshopEnabled", label: "启用", type: "switch", desc: "Photoshop 没开时工具会报找不到 Photoshop，不影响其他功能。注意：其中 photoshop_execute_script 工具会执行模型给出的任意 ExtendScript。" },
  { key: "photoshopPath", label: "Photoshop 路径", type: "text", placeholder: "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe", desc: "可选。留空时从注册表自动检测已安装的 Photoshop。" },
  { key: "photoshopPackage", label: "npm 包名", type: "text", desc: "默认 @alisaitteke/photoshop-mcp（可带版本）。改了包名后需要重新「下载安装」；未安装时用 npx 临时运行。" },
  { key: "chromeEnabled", label: "启用", type: "switch", desc: "AI第一次使用此工具时才会启动 Chrome。注意：evaluate_script 会在网页里执行模型给出的 JS，模型能看到页面里的所有内容。" },
  { key: "chromeConnect", label: "连接方式", type: "select", options: [
    { value: "launch", label: "启动独立的 Chrome（默认）" },
    { value: "autoConnect", label: "连接正在运行的 Chrome（autoConnect，Chrome 144+）" },
    { value: "browserUrl", label: "连接调试端口（browserUrl）" }
  ], desc: "「启动独立的 Chrome」：用专用配置目录（默认 %USERPROFILE%\\.cache\\chrome-devtools-mcp），不动你平时的配置，AI第一次使用此工具时才会启动。.cache 目录不存在是正常的，用到时会自动创建。「连接正在运行的 Chrome（autoConnect）」：Chrome 144+，在 chrome://inspect/#remote-debugging 打开「允许为此浏览器实例进行远程调试」；打开开关本身不会弹窗——第一次用浏览器工具连接时，Chrome 才会弹出「允许调试」确认框，点允许即可。此模式不需要也不使用 .cache。「连接调试端口」：必须用 chrome.exe --remote-debugging-port=… --user-data-dir=<非默认目录> 启动；inspect 页开关不会提供 /json/version（会 404），那种情况请改用 autoConnect。" },
  { key: "chromeBrowserUrl", label: "调试地址", type: "text", desc: "只在「连接调试端口（browserUrl）」时使用。Chrome 必须用 --remote-debugging-port 且带非默认 --user-data-dir 启动，例如 chrome.exe --remote-debugging-port=9222 --user-data-dir=%TEMP%\\chrome-profile-stable 后填 http://127.0.0.1:9222。chrome://inspect 开关开出的 9222 端口没有 /json/version（会 404），请改用 autoConnect。" },
  { key: "chromeChannel", label: "Chrome 渠道", type: "select", options: ["stable", "beta", "dev", "canary"], desc: "启动或连接哪个渠道的 Chrome，默认正式版（stable）。" },
  { key: "chromeHeadless", label: "窗口", type: "select", bool: true, options: [
    { value: "false", label: "显示窗口" },
    { value: "true", label: "无头（不显示窗口）" }
  ], desc: "只对「启动独立的 Chrome」有效。" },
  { key: "chromeUserDataDir", label: "配置目录", type: "text", desc: "可选，只对「启动独立的 Chrome」有效。留空时用 chrome-devtools-mcp 自己的专用目录（%USERPROFILE%\\.cache\\chrome-devtools-mcp\\chrome-profile）；目录不存在会在第一次启动时自动创建。autoConnect / browserUrl 不用这个目录。" },
  { key: "chromeToolset", label: "工具集", type: "select", options: [
    { value: "standard", label: "标准（约 30 个工具）" },
    { value: "full", label: "完整（再加内存分析、坐标点击、扩展与 PWA 等）" },
    { value: "slim", label: "精简（只有导航 / 执行脚本 / 截图）" }
  ], desc: "工具越多，每次对话占用的上下文越多。扩展与 PWA 工具只在「启动独立的 Chrome」时可用。" },
  { key: "chromePackage", label: "npm 包名", type: "text", desc: "默认 chrome-devtools-mcp（可带版本，如 chrome-devtools-mcp@1.10.1）。改了包名后需要重新「下载安装」；未安装时用 npx 临时运行。" },
  { key: "godotEnabled", label: "启用", type: "switch", desc: "Godot 没开时服务器照常运行、等编辑器连上，不影响其他功能；启用期间占用 HTTP / WebSocket 端口（默认 8000 / 9500）。注意：模型可以改项目里的场景、脚本和资源，也可以运行项目。" },
  { key: "godotProject", label: "Godot 项目路径", type: "text", placeholder: "D:\\Games\\MyGame", desc: "含 project.godot 的文件夹。「安装插件到项目」把与服务器同版本、签名校验过的插件装进 <项目>\\addons\\godot_ai：已是同版本时不改动；已有其他版本时先把旧目录整个挪到 addons\\.godot_ai_backup（需先关闭 Godot），不覆盖。装完在 Godot「项目 → 项目设置 → 插件」里启用 Godot AI。",
    action: { component: "godot", path: "/components/godot/addon", label: "安装插件到项目" } },
  { key: "godotPackage", label: "pip 包名", type: "text", desc: "默认 godot-ai（装最新版并固定下来；可写 godot-ai==4.2.3 这样的版本，对上项目里已有的插件）。改了包名后需要重新「下载安装」；不用 uvx 临时运行。" },
  { key: "godotHttpPort", label: "HTTP 端口", type: "number", min: 1, max: 65535, desc: "godot-ai 共享后端的端口（attach --port），默认 8000；要和 Godot「编辑器设置 → godot_ai/http_port」一致。" },
  { key: "godotWsPort", label: "WebSocket 端口", type: "number", min: 1, max: 65535, desc: "Godot 编辑器插件连接的端口（attach --ws-port），默认 9500；要和「编辑器设置 → godot_ai/ws_port」一致。" },
    
  { key: "windowsEnabled", label: "启用", type: "switch", desc: "仅 Windows。注意：模型可以操作桌面、读写文件并执行 PowerShell。" },
  { key: "windowsMode", label: "连接方式", type: "select", options: [
    { value: "stdio", label: "插件拉起（stdio，推荐）" },
    { value: "http", label: "连接已有 HTTP 服务" }
  ], desc: "stdio：由本插件启动 windows-mcp；http：连接计划任务等方式已启动的服务（默认 127.0.0.1:18765）。" },
  { key: "windowsUrl", label: "HTTP 地址", type: "text", desc: "只在「连接已有 HTTP 服务」时使用，默认 http://127.0.0.1:18765/mcp。" },
  { key: "windowsPackage", label: "pip 包名", type: "text", desc: "默认 windows-mcp。改了包名后需要重新「下载安装」；未安装时用系统 uv tool 或 uvx。" },
  { key: "notionEnabled", label: "启用", type: "switch", desc: "首次连接会弹出 Notion 授权页；token 缓存在 %USERPROFILE%\\.mcp-auth。" },
  { key: "notionUrl", label: "远程地址", type: "text", desc: "默认 https://mcp.notion.com/mcp。" },
  { key: "notionPackage", label: "npm 包名（桥）", type: "text", desc: "默认 mcp-remote。已有 %USERPROFILE%\\.dsh\\mcp-remote 时可直接用，不必再装。" },
  { key: "cloudflareEnabled", label: "启用", type: "switch", desc: "首次连接会弹出 Cloudflare 授权页；插件只预申请 offline_access，请在同意页勾选权限。" },
  { key: "cloudflareUrl", label: "远程地址", type: "text", desc: "默认 https://mcp.cloudflare.com/mcp。" },
  { key: "cloudflarePackage", label: "npm 包名（桥）", type: "text", desc: "默认 mcp-remote。" },
  { key: "cloudflare-docsEnabled", label: "启用", type: "switch", desc: "公开文档 MCP，无需登录。" },
  { key: "cloudflare-docsUrl", label: "远程地址", type: "text", desc: "默认 https://docs.mcp.cloudflare.com/mcp。" },
  { key: "githubEnabled", label: "启用", type: "switch", desc: "需要 GitHub PAT（设置或环境变量 GITHUB_MCP_PAT）。" },
  { key: "githubUrl", label: "托管端点", type: "text", desc: "默认 https://api.githubcopilot.com/mcp/。" },
  { key: "githubToken", label: "GitHub PAT", type: "password", placeholder: "ghp_… / github_pat_…", desc: "优先用这里的 token；留空时读用户环境变量 GITHUB_MCP_PAT。不要提交到 git。" },
  { key: "comfyuiEnabled", label: "启用", type: "switch", desc: "ComfyUI 没开时仍可挂载 MCP（可用工具 launch_comfyui）；本机 8188 开着时状态会注明。" },
  { key: "comfyuiPackage", label: "pip 包名", type: "text", desc: "默认 comfy-mcp。改了包名后需要重新「下载安装」；未安装时用系统 uv tool 或 uvx。" },
  { key: "comfyuiBin", label: "comfy.exe 路径", type: "text", placeholder: "C:\\Users\\…\\uv\\tools\\comfy-cli\\Scripts\\comfy.exe", desc: "可选。作为 COMFY_BIN 传给服务器；留空时用环境变量 COMFY_BIN。" },
    { key: "ffmpegEnabled", label: "启用", type: "switch", desc: "需要本机已安装 ffmpeg / ffprobe（PATH 或下方路径）。未装 FFmpeg 时服务器无法可靠工作；关掉不影响其他功能。" },
  { key: "ffmpegPath", label: "FFmpeg 路径", type: "text", placeholder: "C:\\ffmpeg\\bin\\ffmpeg.exe", desc: "可选。本机 ffmpeg 可执行文件完整路径；留空时从 PATH 查找。填写后启动 MCP 时会把该目录前置到 PATH（便于找到同目录的 ffprobe）。" },
  { key: "ffmpegPackage", label: "pip 包名", type: "text", desc: "默认 kinocut（入口命令 kino，原 mcp-video）。改了包名后需要重新「下载安装」；未安装时用 uvx 临时运行。" },
  { key: "obsidianEnabled", label: "启用", type: "switch", desc: "需要 Obsidian 开着，并启用社区插件 Local REST API。没开时工具会报连不上，不影响其他功能。" },
  { key: "obsidianApiKey", label: "API 密钥", type: "password", placeholder: "在 Local REST API 插件设置里复制", desc: "必填。Obsidian → 设置 → 社区插件 → Local REST API 中的 API key（Bearer Token）。" },
  { key: "obsidianBaseUrl", label: "API 地址", type: "text", desc: "默认 http://127.0.0.1:27123（需在插件里开启 Non-encrypted HTTP）。HTTPS 默认端口可用 https://127.0.0.1:27124（自签证书由服务器侧跳过校验）。" },
  { key: "obsidianEnableCommands", label: "允许执行命令面板", type: "switch", desc: "对应 OBSIDIAN_ENABLE_COMMANDS。打开后 MCP 可列出并执行 Obsidian 命令（可能含破坏性操作），默认关闭。" },
  { key: "obsidianPackage", label: "npm 包名", type: "text", desc: "默认 obsidian-mcp-server（可带版本）。改了包名后需要重新「下载安装」；未安装时用 npx 临时运行。" },
  { key: "nodePath", label: "node 路径", type: "text", placeholder: "C:\\Program Files\\nodejs\\node.exe", desc: "插件 tools\\node 里有 Node.js 时优先用它；否则用这里的路径（npm 取同目录），留空时用 PATH 里的 node（需 20.19+ / 22.12+），再退回 DSH 自带的运行时（只能运行，不能安装）。" },
  { key: "npmRegistry", label: "npm 镜像", type: "text", placeholder: "https://registry.npmmirror.com", desc: "可选。安装 npm 组件时使用的镜像地址；留空时用 npm 自己的设置（默认 registry.npmjs.org）。改完先点保存再安装。" },
  { key: "uvPath", label: "uv 路径", type: "text", desc: "插件 tools\\uv 里有 uv 时优先用它；否则用这里的路径（uvx 取同目录），留空时查找 WinGet 安装的 uv，再用 PATH。" },
  { key: "proxy", label: "下载代理", type: "text", desc: "下载安装时使用的 HTTP 代理（uv、Python、Node.js、npm 都走它），例如 http://127.0.0.1:7890；留空时使用环境变量 HTTPS_PROXY / HTTP_PROXY。改完先点保存再安装。" }
];
var FIELD_BY_KEY = {};
INPUT_FIELDS.forEach(function (f) { FIELD_BY_KEY[f.key] = f; });

/** Local component enable switch: same <id>Enabled key as bundled; register dynamically when not in INPUT_FIELDS. Default ON (launch === false / manager). */
function ensureLocalEnabledField(id) {
  var key = id + "Enabled";
  if (!FIELD_BY_KEY[key]) {
    FIELD_BY_KEY[key] = {
      key: key,
      label: "启用",
      type: "switch",
      desc: "关闭后此组件不会在后台启动，也不影响其它功能。",
      localDynamic: true
    };
  }
  return FIELD_BY_KEY[key];
}

// 应用图标：静态 SVG 常量（手绘的简化图形），只通过 innerHTML 写入这些常量。
function svgIcon(body) {
  return '<svg viewBox="0 0 24 24" width="100%" height="100%" focusable="false" aria-hidden="true">' + body + "</svg>";
}
var ICONS = {
  // 图片（线条，跟随文字颜色）
  image: svgIcon('<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.8" r="1.7"/><path d="M20.5 15.6l-4.8-4.8L6.2 19.5"/></g>'),
  // Office：橙红色「门」形标记
  office: svgIcon('<path fill="#D83B01" fill-rule="evenodd" d="M3.2 6.3 14.6 2.4l6.2 2.1v15l-6.2 2.1-11.4-3.9ZM7.4 8.1v8.2l7.2 2.4V5.7Z"/>' +
    '<path fill="#FF6A2B" d="M14.6 2.4l6.2 2.1v15l-6.2 2.1Z" opacity=".55"/>'),
  // Blender：橙色机身 + 白环 + 蓝色眼睛
  blender: svgIcon('<g stroke="#EA7600" stroke-width="2.6" stroke-linecap="round"><path d="M2.6 8h8.6M5.4 12.4h4.2M4.4 19.2l4.6-3.8"/></g>' +
    '<circle cx="14.4" cy="13.4" r="7.2" fill="#EA7600"/><circle cx="14.4" cy="13.4" r="4.5" fill="#fff"/><circle cx="14.4" cy="13.4" r="2.7" fill="#265787"/>'),
  // Unity：立方体（跟随文字颜色，深浅主题都清楚）
  unity: svgIcon('<g fill="currentColor"><path d="M12 2.5l7.9 4.55L12 11.6 4.1 7.05Z"/><path d="M3.5 8.05l7.8 4.5v9L3.5 17Z" opacity=".72"/>' +
    '<path d="M20.5 8.05l-7.8 4.5v9l7.8-4.5Z" opacity=".46"/></g>'),
  // uv：紫色方块上的「uv」
  uv: svgIcon('<rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#DE5FE9"/>' +
    '<path d="M6 8.2v4.3a2.5 2.5 0 0 0 5 0M11 8.2v7.6M13.2 8.2l2.9 7.6 2.9-7.6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  // Figma：五块彩色图形（红 / 橙 / 紫 / 蓝圆 / 绿水滴）
  figma: svgIcon('<path fill="#F24E1E" d="M12 2.4H8.8a3.2 3.2 0 0 0 0 6.4H12Z"/><path fill="#FF7262" d="M12 2.4h3.2a3.2 3.2 0 0 1 0 6.4H12Z"/>' +
    '<path fill="#A259FF" d="M12 8.8H8.8a3.2 3.2 0 0 0 0 6.4H12Z"/><circle cx="15.2" cy="12" r="3.2" fill="#1ABCFE"/>' +
    '<path fill="#0ACF83" d="M12 15.2v3.2a3.2 3.2 0 1 1-3.2-3.2Z"/>'),
  // Photoshop：深蓝圆角方块 + 亮蓝「Ps」（手绘路径，不依赖字体）
  photoshop: svgIcon('<rect x="1.5" y="1.5" width="21" height="21" rx="4.6" fill="#001E36"/>' +
    '<rect x="1.5" y="1.5" width="21" height="21" rx="4.6" fill="none" stroke="#31A8FF" stroke-opacity=".35" stroke-width=".8"/>' +
    '<g fill="none" stroke="#31A8FF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6.3 17.2V6.9h3.1a2.95 2.95 0 0 1 0 5.9H6.3"/>' +
    '<path d="M17.6 10.9a2.3 2.3 0 0 0-1.9-.9c-1.1 0-1.9.6-1.9 1.45 0 1.95 4 1.05 4 3.2 0 .95-.9 1.6-2.1 1.6a2.8 2.8 0 0 1-2.3-1.05"/></g>'),
  // Chrome：红 / 黄 / 绿三段外环 + 白圈 + 蓝色圆心
  chrome: svgIcon('<path fill="#EA4335" d="M12 12 3.34 7A10 10 0 0 1 20.66 7Z"/><path fill="#FBBC04" d="M12 12 20.66 7A10 10 0 0 1 12 22Z"/>' +
    '<path fill="#34A853" d="M12 12 12 22A10 10 0 0 1 3.34 7Z"/><circle cx="12" cy="12" r="4.9" fill="#fff"/><circle cx="12" cy="12" r="3.8" fill="#4285F4"/>'),
  // Godot：蓝色机器人头（顶上三个凸起）+ 白眼睛、深色瞳孔、白鼻子和嘴（手绘路径，深浅主题都清楚）
  godot: svgIcon('<path fill="#478CBF" d="M5.1 5.3 7.3 3.6l1.5 1.9c.9-.4 1.9-.62 2.9-.68L12 2.3l.3 2.52c1 .06 2 .28 2.9.68l1.5-1.9 2.2 1.7-1.25 2.05c.95.8 1.7 1.8 2.2 2.95.25.55.4 1.2.4 1.8v5.2a2.8 2.8 0 0 1-2.8 2.8H6.55a2.8 2.8 0 0 1-2.8-2.8v-5.2c0-.6.15-1.25.4-1.8.5-1.15 1.25-2.15 2.2-2.95Z"/>' +
    '<circle cx="8.35" cy="11.9" r="2.55" fill="#fff"/><circle cx="15.65" cy="11.9" r="2.55" fill="#fff"/>' +
    '<circle cx="8.7" cy="12.15" r="1.25" fill="#414042"/><circle cx="15.3" cy="12.15" r="1.25" fill="#414042"/>' +
    '<rect x="11.25" y="11.3" width="1.5" height="2.6" rx=".75" fill="#fff"/>' +
    '<path d="M6.9 16.6c1.5.75 3.2 1.1 5.1 1.1s3.6-.35 5.1-1.1" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>'),
  // Node.js：绿色六边形 + 白色「N」
  node: svgIcon('<path fill="#5FA04E" d="M12 1.8l8.8 5.1v10.2L12 22.2l-8.8-5.1V6.9Z"/>' +
    '<path d="M9 16V8l6 8V8" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'),
  // Windows：蓝色窗口
  windows: svgIcon('<rect x="2.5" y="3.5" width="19" height="17" rx="2.2" fill="#0078D4"/>' +
    '<path fill="#fff" d="M4.2 5.2h7.2v6.2H4.2Zm8.4 0h7.2v6.2h-7.2ZM4.2 12.6h7.2v6.2H4.2Zm8.4 0h7.2v6.2h-7.2Z" opacity=".95"/>'),
  // Notion：黑白「N」
  notion: svgIcon('<rect x="2.5" y="2.5" width="19" height="19" rx="3.2" fill="#000"/>' +
    '<path fill="#fff" d="M8.2 6.4h2.1l5.5 8.2V6.4H18v11.2h-2.1l-5.5-8.2v8.2H8.2Z"/>'),
  // Cloudflare：橙云
  cloudflare: svgIcon('<path fill="#F38020" d="M17.6 15.2H6.1a3.4 3.4 0 0 1-.2-6.8 5.5 5.5 0 0 1 10.6-1.5 3.7 3.7 0 0 1 1.1 8.3Z"/>' +
    '<path fill="#FAAD3F" d="M8.8 16.6h10.2a2.6 2.6 0 1 0-.4-5.2 4.2 4.2 0 0 0-7.9.9 2.3 2.3 0 0 0-1.9 4.3Z" opacity=".9"/>'),
  // Cloudflare Docs：橙云 + 文档角
  cloudflareDocs: svgIcon('<path fill="#F38020" d="M6.2 4.2h8.2l3.4 3.4v12.2H6.2Z"/>' +
    '<path fill="#fff" d="M14.2 4.4v3.2h3.2" opacity=".55"/><path fill="#fff" d="M8.2 11.2h7.6M8.2 13.6h7.6M8.2 16h5.2" stroke="none"/>' +
    '<rect x="8.2" y="10.8" width="7.6" height="1.1" fill="#fff"/><rect x="8.2" y="13.2" width="7.6" height="1.1" fill="#fff"/><rect x="8.2" y="15.6" width="5.2" height="1.1" fill="#fff"/>'),
  // GitHub：章鱼猫剪影
  github: svgIcon('<circle cx="12" cy="12" r="9.2" fill="#181717"/>' +
    '<path fill="#fff" d="M12 6.2a5.8 5.8 0 0 0-1.8 11.3c.3.06.4-.13.4-.28v-1c-1.7.37-2.1-.82-2.1-.82-.28-.7-.7-.9-.7-.9-.57-.4.04-.39.04-.39.63.04.96.65.96.65.56.96 1.47.68 1.83.52.06-.4.22-.68.4-.83-1.36-.15-2.8-.68-2.8-3.03 0-.67.24-1.22.63-1.65-.06-.16-.27-.78.06-1.62 0 0 .52-.17 1.7.63a5.8 5.8 0 0 1 3.1 0c1.18-.8 1.7-.63 1.7-.63.33.84.12 1.46.06 1.62.4.43.63.98.63 1.65 0 2.36-1.44 2.88-2.81 3.03.23.2.43.58.43 1.18v1.75c0 .15.1.34.4.28A5.8 5.8 0 0 0 12 6.2Z"/>'),
  // ComfyUI：紫节点
  comfyui: svgIcon('<rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="#7C5CFF"/>' +
    '<circle cx="8.2" cy="9" r="2.1" fill="#fff"/><circle cx="15.8" cy="9" r="2.1" fill="#fff"/><circle cx="12" cy="15.4" r="2.1" fill="#fff"/>' +
    '<path d="M10 9h3.6M9.2 10.6 11 13.6M14.8 10.6 13 13.6" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>'),
  // 下载代理：地球（线条，跟随文字颜色）
  proxy: svgIcon('<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
    '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.7" ry="8.5"/><path d="M3.9 9.2h16.2M3.9 14.8h16.2"/></g>'),
  // FFmpeg：深绿圆角方块 + 白色「ff」（媒体剪辑）
  ffmpeg: svgIcon('<rect x="1.5" y="1.5" width="21" height="21" rx="4.6" fill="#1A7A3A"/>' +
    '<g fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M7.2 7.2v9.6M7.2 12h3.4a2.4 2.4 0 0 0 0-4.8H7.2"/>' +
    '<path d="M13.6 7.2v9.6M13.6 12h3.4a2.4 2.4 0 0 0 0-4.8H13.6"/></g>'),
  // Obsidian：紫色多面体（简化品牌色）
  obsidian: svgIcon('<path fill="#7C3AED" d="M12 2.2 19.4 7.1v9.8L12 21.8 4.6 16.9V7.1Z"/>' +
    '<path fill="#A78BFA" d="M12 2.2 19.4 7.1 12 12.2 4.6 7.1Z" opacity=".9"/>' +
    '<path fill="#4C1D95" d="M12 12.2 19.4 7.1v9.8L12 21.8Z" opacity=".75"/>'),
  // 添加工作组件：三格拼图 + 加号（线条，跟随文字颜色）
  addComponent: svgIcon('<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/>' +
    '<rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><path d="M17 13.5v7M13.5 17h7"/></g>')
};

// 功能列表：每项一行、一个管理页。component：状态来自 /components 里同 id 的一项；
// 没有 component 的是纯设置项，列表里的状态由 summary(已保存的设置) 给出。icon：ICONS 里的静态 SVG。
var FEATURES = [
  {
    id: "image", group: "多模态", title: "出图演示", icon: ICONS.image,
    desc: "mm_image_demo 本地演示出图；预留 openai-compatible 生图接口。",
    intro: "mm_image_demo 在本地生成演示 PNG 并存成持久图片，用来验证 DSH 里的图片输出；真实生图接口尚未接入。",
    keys: ["imageProvider", "imageEndpoint", "imageModel", "defaultSize"],
    summary: function (v) {
      if (v.imageProvider === "openai-compatible") return { text: "openai-compatible · 未接入", cls: "missing" };
      return { text: "演示图 · " + v.defaultSize + "px", cls: "ready" };
    }
  },
  {
    id: "office", group: "工作组件", title: "Office", component: "office",
    moduleSource: "bundled", icon: ICONS.office,
    url: "https://github.com/officemcp/officemcp",
    desc: "经 COM 控制本机的 Word / Excel / PowerPoint（OfficeMCP）。",
    intro: "经 COM 控制本机的 Word / Excel / PowerPoint（OfficeMCP），工具名前缀 mcp__officemcp__。",
    keys: ["officeEnabled", "officeRepo", "officeFolder"]
  },
  {
    id: "blender", group: "工作组件", title: "Blender", component: "blender",
    moduleSource: "bundled", icon: ICONS.blender,
    url: "https://github.com/ahujasid/blender-mcp",
    desc: "控制正在打开的 Blender（mcp-for-blender）。",
    intro: "控制正在打开的 Blender（mcp-for-blender），工具名前缀 mcp__blender__。Blender 里需要启用对应插件。",
    keys: ["blenderEnabled", "blenderPackage"]
  },
  {
    id: "unity", group: "工作组件", title: "Unity", component: "unity",
    moduleSource: "bundled", icon: ICONS.unity,
    url: "https://github.com/CoplayDev/unity-mcp",
    desc: "控制 Unity 编辑器（Coplay mcp-for-unity）。",
    intro: "控制 Unity 编辑器（Coplay mcp-for-unity），工具名前缀 mcp__unity__。编辑器需装 MCP for Unity 包并开着工程。",
    keys: ["unityEnabled", "unityPackage"]
  },
  {
    id: "figma", group: "工作组件", title: "Figma", component: "figma",
    moduleSource: "bundled", icon: ICONS.figma,
    url: "https://github.com/southleft/figma-console-mcp",
    desc: "读写 Figma 设计稿（figma-console-mcp）。",
    intro: "经 Figma 桌面版里的 Desktop Bridge 插件读写设计稿（figma-console-mcp，121 个工具：创建 / 修改节点和组件、变量与设计令牌、截图、FigJam、Slides 等），工具名前缀 mcp__figma__。准备：装 Figma 桌面版；启用本组件后，在 Figma 里「插件 → 开发 → 从清单导入插件」，选 %USERPROFILE%\\.figma-console-mcp\\plugin\\manifest.json，再在设计文件里运行「Figma Desktop Bridge」。",
    helpImage: "/dsh-workbench/assets/figma-import-plugin.png",
    helpImageData: "data:image/png;base64,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",
    helpCaption: "Figma：插件 → 开发 → 从清单导入插件…",
    keys: ["figmaEnabled", "figmaMode", "figmaToken", "figmaOfficialUrl", "figmaPackage"]
  },
  {
    id: "photoshop", group: "工作组件", title: "Photoshop", component: "photoshop",
    moduleSource: "bundled", icon: ICONS.photoshop,
    url: "https://github.com/alisaitteke/photoshop-mcp",
    desc: "经 COM 控制本机的 Photoshop（photoshop-mcp）。",
    intro: "经 COM 控制本机的 Adobe Photoshop（photoshop-mcp，125 个工具：文档、图层、选区与蒙版、滤镜、调色、文字、导出、动作、创成式填充等），工具名前缀 mcp__photoshop__。需要本机装有 Photoshop（CS6 / 2012 及以上）并开着；不需要装 Photoshop 插件（只有神经滤镜要另装它的 UXP 插件）。",
    keys: ["photoshopEnabled", "photoshopPath", "photoshopPackage"]
  },
  {
    id: "chrome", group: "工作组件", title: "Chrome", component: "chrome",
    moduleSource: "bundled", icon: ICONS.chrome,
    url: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
    desc: "控制本机的 Google Chrome（Chrome DevTools MCP）。",
    intro: "用 Google 官方的 Chrome DevTools MCP 控制本机 Chrome：打开 / 切换标签页、点击输入和填表、上传文件、处理对话框、截图和页面快照、执行 JS、网络请求与控制台、性能追踪与 Lighthouse、设备 / 网络 / 地理位置模拟等，工具名前缀 mcp__chrome__。默认启动一个独立配置的 Chrome，也可以连接你正在用的 Chrome。",
    keys: ["chromeEnabled", "chromeConnect", "chromeBrowserUrl", "chromeChannel", "chromeHeadless", "chromeUserDataDir", "chromeToolset", "chromePackage"]
  },
  {
    id: "godot", group: "工作组件", title: "Godot", component: "godot",
    moduleSource: "bundled", icon: ICONS.godot,
    url: "https://github.com/hi-godot/godot-ai",
    desc: "控制 Godot 编辑器（hi-godot/godot-ai）。",
    intro: "用 godot-ai 控制 Godot 编辑器：场景与节点、脚本（GDScript 校验并热重载）、信号、UI、材质、动画、粒子、相机与环境，运行项目、跑测试、读日志、编辑器截图等（47 个工具），工具名前缀 mcp__godot__。需要 Godot 4.7+。准备：① 点「下载安装」（服务器版本会固定下来，并下载同版本、签名校验过的 Godot 插件）；② 在下面填 Godot 项目目录，点「安装插件到项目」（或按下方说明手动解压同版本的 godot-ai-v4-plugin.zip）；③ 在 Godot 里「项目 → 项目设置 → 插件」启用 Godot AI；④ 打开「启用」。DSH 已经通过本组件连接，不要再在 Godot AI 面板里给 DeepSeek Harness 点 Configure（会多出一份重复的工具）。",
    keys: ["godotEnabled", "godotProject", "godotPackage", "godotHttpPort", "godotWsPort"]
  },
  {
    id: "windows", group: "工作组件", title: "Windows", component: "windows",
    moduleSource: "bundled", icon: ICONS.windows,
    url: "https://github.com/CursorTouch/Windows-MCP",
    desc: "控制本机 Windows 桌面（Windows-MCP）。",
    intro: "控制本机 Windows 桌面（Windows-MCP）：窗口、键鼠、截图、文件系统、注册表、PowerShell 等，工具名前缀 mcp__windows__。默认由本插件以 stdio 拉起；也可改连已在跑的 HTTP 服务（如计划任务 127.0.0.1:18765）。注意：模型可以操作桌面与执行 PowerShell。",
    keys: ["windowsEnabled", "windowsMode", "windowsUrl", "windowsPackage"]
  },
  {
    id: "notion", group: "工作组件", title: "Notion", component: "notion",
    moduleSource: "bundled", icon: ICONS.notion,
    url: "https://developers.notion.com/docs/mcp",
    desc: "官方 Notion MCP（OAuth，经 mcp-remote）。",
    intro: "官方 Notion MCP（OAuth）。DSH HTTP 传输没有浏览器授权，经 mcp-remote stdio 桥；首次连接会弹出 Notion 授权页，token 缓存在 %USERPROFILE%\\.mcp-auth。工具名前缀 mcp__notion__。",
    keys: ["notionEnabled", "notionUrl", "notionPackage"]
  },
  {
    id: "cloudflare", group: "工作组件", title: "Cloudflare", component: "cloudflare",
    moduleSource: "bundled", icon: ICONS.cloudflare,
    url: "https://github.com/cloudflare/mcp-server-cloudflare",
    desc: "官方 Cloudflare API MCP（OAuth，经 mcp-remote）。",
    intro: "官方 Cloudflare API MCP（OAuth / Code Mode）。经 mcp-remote 桥；预申请 scope=offline_access，授权页请自行勾选权限。工具名前缀 mcp__cloudflare__（docs / search / execute）。",
    keys: ["cloudflareEnabled", "cloudflareUrl", "cloudflarePackage"]
  },
  {
    id: "cloudflare-docs", group: "工作组件", title: "Cloudflare Docs", component: "cloudflare-docs",
    moduleSource: "bundled", icon: ICONS.cloudflareDocs,
    url: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-catalog/",
    desc: "Cloudflare 文档 MCP（公开，无需登录）。",
    intro: "Cloudflare 文档 MCP（公开 streamable-http，无需登录）。查文档不必等 API 授权。工具名前缀 mcp__cloudflare-docs__。",
    keys: ["cloudflare-docsEnabled", "cloudflare-docsUrl"]
  },
  {
    id: "github", group: "工作组件", title: "GitHub", component: "github",
    moduleSource: "bundled", icon: ICONS.github,
    url: "https://github.com/github/github-mcp-server",
    desc: "官方 GitHub MCP（托管 HTTP + PAT）。",
    intro: "官方 GitHub MCP 托管端点。Token 优先读设置 githubToken，否则读环境变量 GITHUB_MCP_PAT；不要把 token 写进仓库。工具名前缀 mcp__github__。",
    keys: ["githubEnabled", "githubUrl", "githubToken"]
  },
  {
    id: "comfyui", group: "工作组件", title: "ComfyUI", component: "comfyui",
    moduleSource: "bundled", icon: ICONS.comfyui,
    url: "https://github.com/Comfy-Org/comfy-mcp",
    desc: "官方 Comfy MCP（驱动本机 ComfyUI）。",
    intro: "官方 Comfy MCP（comfy-mcp，经 comfy-cli 驱动本机 ComfyUI）。工具名前缀 mcp__comfyui__。ComfyUI 需先开着，或用工具 launch_comfyui。可选填写 COMFY_BIN（comfy.exe）。",
    keys: ["comfyuiEnabled", "comfyuiPackage", "comfyuiBin"]
  },
  {
    id: "ffmpeg", group: "工作组件", title: "FFmpeg", component: "ffmpeg",
    moduleSource: "bundled", icon: ICONS.ffmpeg,
    url: "https://github.com/KyaniteLabs/kinocut",
    desc: "本机媒体转换 / 探针 / 剪辑（Kinocut MCP，封装 FFmpeg）。",
    intro: "用 Kinocut（原 mcp-video）经类型化工具调用本机 FFmpeg：转码、剪辑、合并、字幕、探针、缩略图、质量检查与 Shorts/Reels 再包装等（百余工具，可用 search_tools 发现），工具名前缀 mcp__ffmpeg__。准备：① 本机安装 ffmpeg/ffprobe（winget install ffmpeg，或填「FFmpeg 路径」）；② 点「下载安装」装 Kinocut 到 tools\\ffmpeg；③ 打开「启用」。不会把庞大的 FFmpeg 二进制打进插件仓库。",
    keys: ["ffmpegEnabled", "ffmpegPath", "ffmpegPackage"]
  },
  {
    id: "obsidian", group: "工作组件", title: "Obsidian", component: "obsidian",
    moduleSource: "bundled", icon: ICONS.obsidian,
    url: "https://github.com/cyanheads/obsidian-mcp-server",
    desc: "读写本机 Obsidian 库（经 Local REST API 插件）。",
    intro: "用 obsidian-mcp-server 读写 Obsidian 库：读笔记、列表、搜索、追加/补丁、frontmatter 与标签等（14 个工具），工具名前缀 mcp__obsidian__。准备：① 安装并打开 Obsidian；② 社区插件安装启用「Local REST API」，建议开启 Non-encrypted HTTP（默认 http://127.0.0.1:27123）；③ 复制 API 密钥填到下方；④ 点「下载安装」；⑤ 打开「启用」。",
    keys: ["obsidianEnabled", "obsidianApiKey", "obsidianBaseUrl", "obsidianEnableCommands", "obsidianPackage"]
  },
  {
    id: "uv", group: "通用", title: "uv", component: "uv", icon: ICONS.uv,
    url: "https://github.com/astral-sh/uv",
    desc: "下载 Python、安装和运行 Python 组件的工具（Office / Blender / Unity / Godot / Windows / ComfyUI / FFmpeg）。",
    intro: "uv 负责下载 Python 和安装 Office / Blender / Unity / Godot / Windows / ComfyUI / FFmpeg；安装这些组件时会自动下载到插件的 tools\\uv。所有组件、Python 和缓存都放在插件的 tools 目录里。",
    keys: ["uvPath"]
  },
  {
    id: "node", group: "通用", title: "Node.js", component: "node", icon: ICONS.node,
    url: "https://nodejs.org/",
    desc: "运行和安装 Chrome / Figma / Photoshop / Notion / Cloudflare / Obsidian 等依赖 npm 的组件。",
    intro: "Chrome / Figma / Photoshop / Notion / Cloudflare（mcp-remote 桥）/ Obsidian 依赖 npm。把 npm 装进插件 tools 目录或本机 Node.js（20.19+ / 22.12+）都行。查找顺序：插件 tools\\node → 设置路径 → 系统 PATH。",
    keys: ["nodePath", "npmRegistry"]
  },
  {
    id: "proxy", group: "通用", title: "下载代理", icon: ICONS.proxy,
    desc: "下载安装 uv、Python、Node.js 和各组件时使用的 HTTP 代理。",
    intro: "只影响「下载安装」，不影响组件运行。改完先点保存再安装。",
    keys: ["proxy"],
    summary: function (v) {
      return v.proxy
        ? { text: "已设置", cls: "on", title: v.proxy }
        : { text: "未设置", cls: "off", title: "使用环境变量 HTTPS_PROXY / HTTP_PROXY" };
    }
  },
  {
    id: "add-component", group: "基础工具", title: "添加工作组件", icon: ICONS.addComponent,
    kind: "add-component",
    desc: "生成提示词，让 AI 在 local-components/ 写本地兼容模块；装好后可在管理页提交 PR。",
    intro: "填写要接入的程序名称，复制下方命令粘贴给 AI。AI 按 docs/component-module.md 在 local-components/<id>/ 写本地兼容模块（与仓库自带同接口）；不会下载进 tools/。写好后出现在「本地」分组，可在管理页「提交 PR」贡献到仓库。",
    keys: [],
    summary: function () {
      return { text: "提示词工具", cls: "ready" };
    }
  }
];


// 上游仓库外链：标题旁蓝色网址文字，新标签打开（rel=noopener）。无 url 的功能（出图演示 / 下载代理）不渲染。
function extLinkLabel(url) {
  try {
    var u = new URL(url);
    var host = (u.hostname || "").replace(/^www\./, "");
    var path = (u.pathname || "/").replace(/\/+$/, "") || "";
    if (!host) return url;
    if (!path || path === "/") return host;
    var label = host + path;
    if (u.search) label += u.search;
    if (label.length > 42) label = label.slice(0, 39) + "\u2026";
    return label;
  } catch (e) {
    return url.length > 42 ? url.slice(0, 39) + "\u2026" : url;
  }
}
function extLink(f) {
  if (!f || !f.url) return null;
  var a = document.createElement("a");
  a.className = "mm-ext";
  a.href = f.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = "打开上游：" + f.url;
  a.setAttribute("aria-label", "打开上游仓库（新标签）：" + extLinkLabel(f.url));
  a.textContent = extLinkLabel(f.url);
  a.addEventListener("click", function (e) { e.stopPropagation(); });
  a.addEventListener("keydown", function (e) { e.stopPropagation(); });
  return a;
}
function titleName(f, cls) {
  var wrap = el("div", cls || "mm-item-name");
  wrap.append(document.createTextNode(f.title));
  var link = extLink(f);
  if (link) wrap.append(link);
  return wrap;
}

var MODULE_SOURCE_TEXT = { bundled: "仓库自带", local: "本地" };
var CONTRIBUTE_COMPARE_DEFAULT = "https://github.com/meya-ashuripehya/dsh-multimodal/compare";

function sourceChip(src) {
  var kind = src === "local" ? "local" : "bundled";
  var span = el("span", "mm-src " + kind, MODULE_SOURCE_TEXT[kind] || kind);
  span.title = kind === "local"
    ? "用户/AI 写在 local-components/ 的本地兼容组件，可提交 PR"
    : "随 git 仓库分发的已兼容组件";
  return span;
}

function titleNameWithSource(f, cls) {
  var wrap = titleName(f, cls);
  if (f.moduleSource === "bundled" || f.moduleSource === "local") wrap.append(sourceChip(f.moduleSource));
  return wrap;
}


// 应用图标节点：只装 FEATURES 里的静态 SVG 常量；装饰性，读屏跳过。
function iconEl(f) {
  var span = el("span", "mm-ico");
  span.setAttribute("aria-hidden", "true");
  if (f.icon) span.innerHTML = f.icon;
  return span;
}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// init 原样透传给 fetch（含可选的 signal，用于中止请求）。
function fetchJson(path, init) {
  return fetch(API + path, Object.assign({ headers: { "content-type": "application/json" } }, init || {}))
    .then(function (r) { return r.json(); });
}

// 基础工具「添加工作组件」：Token 声明 + 作者实测参考（非通用上限）。
var ADD_COMPONENT_TOKEN_WARN =
  "注意：不同的 Coding Agent、不同模型在处理时所用的 Token 量与成本都不同。请确认后再复制。\n\n" +
  "以作者使用 Deepseek Harness 作为 Coding Agent，模型使用 DeepSeek-V41-Flash、思考强度 Low，添加 Docker 组件时，Token 用量信息如下：\n" +
  "· 本轮用量：1,572,371 tok\n" +
  "· 提供方 / 模型：deepseek-official/deepseek-flash\n" +
  "· 缓存命中：98.9%\n" +
  "· 未缓存输入：17,855 tok\n" +
  "· 缓存读取：1,542,144 tok\n" +
  "· 输出：12,372 tok（其中推理 6,349 tok）";

function buildAddComponentPrompt(programName) {
  var name = String(programName || "").trim();
  return [
    "请按下列步骤，为程序「" + name + "」设计并接入 dsh-workbench（本插件仓库：meya-ashuripehya/dsh-multimodal，设置页「工作组件」）：",
    "",
    "1. 先确认 / 核实「" + name + "」：它是什么软件、主要运行平台（Windows / macOS / Linux）、是否暴露自动化能力（COM、HTTP API、CLI、官方/社区插件、MCP server 等）。用简短结论说明是否适合做成工作组件。",
    "",
    "2. 搜索可用于「" + name + "」的 MCP server 或其他自动化工具（GitHub / npm / PyPI / 官方文档），列出可选方案并简要对比（能力范围、协议、维护状态、许可证）。**选型优先：功能最全优先**，其次再看维护状态与许可证。",
    "",
    "3. 选定上游后，写成**本地兼容组件**（不要直接改仓库自带清单）。下列约定已内嵌，按此实现即可，**不要**再打开 docs/ 或其他源码文件（省 token）：",
    "",
    "### 落盘位置",
    "- 只创建：`local-components/<id>/index.mjs`（插件根下；该目录 gitignore）。",
    "- `<id>`：小写 kebab，须匹配 `^[a-z][a-z0-9-]*$`；文件夹名、`export const id`、`component.id` 三者必须相同。现有风格如 `office` / `chrome` / `blender`，本地也可用 `demo-local` 这类带连字符的 id。",
    "- **不要**占用已有 bundled id：`office` / `blender` / `unity` / `figma` / `photoshop` / `chrome` / `godot`。",
    "- **不要**把文件写进 `src/components/`（那是仓库自带；合入仓库时才拷过去）。",
    "- 可从本地模块相对导入宿主原语（勿整份复制）：",
    "  - `../../src/components/shared.mjs`（`stdio` / `http` / `npmLaunch` / `installNpmTool` / `OFF` / `NOT_INSTALLED` / `resolveUv` / `resolveUvx` 等）",
    "  - `../../src/connect-lib.mjs`（`appRunning` / `result` / `noAppFor` / `mcpNotReady` / `callMcpTool` / `toolFailed` 等）",
    "  - `../../src/tools.mjs`（如 `installVenvTool` / `installOffice`，按需）",
    "",
    "### 必须导出（与 chrome / office 同约定；示例已内嵌）",
    "",
    "**(a) `export const id`** — 字符串，与文件夹名相同。例：`export const id = 'chrome'`。",
    "",
    "**(b) `export const meta`** — `{ id, title, group, url?, serverName, summary }`。",
    "- chrome 例：`{ id: 'chrome', title: 'Chrome', group: '工作组件', url: 'https://github.com/ChromeDevTools/chrome-devtools-mcp', serverName: 'chrome', summary: '控制本机的 Google Chrome（Chrome DevTools MCP）：网页操作、截图快照…' }`。",
    "- office 例：`{ id: 'office', title: 'Office', group: '工作组件', url: 'https://github.com/officemcp/officemcp', serverName: 'officemcp', summary: '经 COM 控制本机的 Word / Excel / PowerPoint（OfficeMCP）。' }`。",
    "- `serverName` 决定工具前缀 `mcp__<serverName>__`，选定后勿改。",
    "- 启用键约定为 `<id>Enabled`（如 `chromeEnabled` / `officeEnabled`）：manager 读取配置键 = id 拼接 Enabled；**设置里没有该键时默认启用**。",
    "- **launch 关闭判断（易错）**：必须写 `if (cfg.<id>Enabled === false) return OFF`（或 `{ ok:false, reason:'已在设置里关闭' }`）。**禁止** `if (!cfg.<id>Enabled)`——本地阶段没有 SettingsSchema，该键为 `undefined`，`!` 会把「未配置」当成关闭，组件永远不挂载。",
    "",
    "**(c) `export const app`** — `{ name, exe, match }`，供进程探测「已连接」。",
    "- chrome：`{ name: 'Chrome', exe: 'chrome.exe', match: /^(chrome|google chrome( beta| dev| canary)?)$/ }`。",
    "- office：`{ name: 'Office（Word / Excel / PowerPoint 等）', exe: 'WINWORD / EXCEL / POWERPNT', match: /^(winword|excel|powerpnt|visio|msaccess|winproj|outlook|mspub|onenote|wps|et|wpp|microsoft (word|excel|powerpoint))$/ }`。",
    "- `match` 对着 `listProcesses()` 返回的**小写、已去掉 .exe** 的进程名。",
    "",
    "**(d) `export async function probe(ctx)`** — 只读探测，**不要**在探测里拉起目标程序。",
    "- `ctx`：`{ cfg, tools, env, procs }`；函数内 `this` 绑定为 component。",
    "- 高层流程（常见桌面应用）：`const procs = await ctx.procs()` → 若 `!appRunning(procs, app)` 则 `return noAppFor(app)` → `const nr = mcpNotReady(ctx, this); if (nr) return nr` → 再用 TCP / HTTP / `callMcpTool` 确认可达。",
    "- **例外（守护进程 / 远程 / WSL / 无头）**：进程名可能对不上 Desktop，但仍可达时——先 `mcpNotReady` + 工具/端口探测；工具成功即可 `connected`（文案可写「未见 Desktop 进程」）；仅当工具失败且也没有匹配进程时才 `noAppFor`。",
    "- 返回形状：`{ state, detail, via }`；`state` ∈ `connected` | `no-app` | `unreachable` | `mcp-down` | `checking`。",
    "- 助手：`result(state, detail, via)`、`noAppFor(app)`、`toolFailed(r, detail, via)`（均来自 connect-lib）。",
    "- blender 简例：进程在跑后检查插件端口 `tcpOpen('127.0.0.1', 9876)`，通则 `result('connected', '…', 'socket')`，不通则 `result('unreachable', '…', 'socket')`。",
    "- office 简例：进程在跑且 MCP 就绪后 `callMcpTool(ctx.tools, this.serverName, 'RunningApps')`，解析结果后 `result('connected', 'COM 可连接：…', 'tool:RunningApps')`。",
    "",
    "**(e) `export const component` + `export default component`** — 注册给宿主的对象，至少包含：",
    "- `id` / `label` / `url?` / `serverName` / `summary`（与 meta 对齐）。",
    "- `keys: string[]`：变更后需重挂的设置键，通常含 `<id>Enabled`、包名键等。chrome 例：`['chromeEnabled','chromePackage','chromeConnect','chromeBrowserUrl','chromeChannel','chromeHeadless','chromeUserDataDir','chromeToolset','nodePath']`；office 例：`['officeEnabled','officeRepo','officeFolder','uvPath']`。",
    "- `runtime?: 'node'`：npm 包组件设为 `'node'`；缺省按 Python/uv。",
    "- `spec?(cfg)=>string`：包名，如 `(cfg) => cfg.chromePackage || 'chrome-devtools-mcp'` 或 `(cfg) => cfg.blenderPackage || 'mcp-for-blender'`。",
    "- `bin?` / `installArgs?`：按上游需要。",
    "- `installed(cfg)=>boolean`：是否已落到运行时目录 `tools/<id>/`（可用 shared 的 `managedNpmEntry` / `managedEntry` 等）。",
    "- `install?(cfg, task, hooks)`：设置页「下载安装」会调它；可委托 `installNpmTool(this, cfg, task, hooks)` 或 `installVenvTool(...)` / 专用安装器。**写好即可，本任务不要执行下载。**",
    "- `launch(cfg)` → LaunchPlan：成功 `{ ok:true, source, config, runtime?, via?, viaUvx? }`；失败 `{ ok:false, reason, missing? }`。关闭时返回 `OFF` 或 `{ ok:false, reason:'已在设置里关闭' }`（**仅** `cfg.<id>Enabled === false` 时；缺键视为启用，见上）。`config` 一般用 `stdio(serverName, command, args, opts)` 或 `npmLaunch` / `http`。",
    "- 可选：`note(cfg)`、`beforeRemove(log?)`、`installAddon(cfg, project, opts?)`（如 Godot 装插件到项目）。",
    "",
    "### MCP 包落地位置（重要）",
    "- 下载安装的产物只应落在插件根下 **`tools/<id>/`**（运行时目录，gitignore）。",
    "- **只有**用户在设置页点击「下载安装」时，宿主才会调用 `component.install` 写入该目录。",
    "- **本 AI 任务禁止**自动下载 / 解压 / `npm install` / `uv` / 联网装包进 `tools/`；只添加模块 + 安装元数据（`spec` / `installed` / `install` / `launch`），以便设置页稍后下载。",
    "",
    "### 注册表（本地 = drop-in 发现）",
    "- **本地**：启动时 `registry.mjs` 扫描 `local-components/*/index.mjs` 并动态 `import()`，与 bundled 合并；**不必**编辑 `registry.mjs`。",
    "- 与 bundled **同 id** 时 bundled 优先，本地副本被忽略并 warn。",
    "- **bundled**（本次不要做）：才需要在 `registry.mjs` 加静态 import，并改 `SettingsSchema` / `lib/client.js` 的 FEATURES / ICONS / INPUT_FIELDS。",
    "",
    "### 设置页 UI（本地还要不要手同步）",
    "- 详情页在 `/components` 拉取后，对 `moduleSource === 'local'` **自动**补齐「本地组件」条目（`ensureLocalFeature`）：标题用 `label`、简介用 `summary`、图标用通用「添加」图标。",
    "- 后端暴露后**不必**再改 `FEATURES` / `ICONS` / `INPUT_FIELDS` 也能在列表和详情页露脸（含状态、连接、本地下载安装、卸载）。",
    "- **详情页已有「启用」开关**（与 bundled 相同，安装行右侧 `role=switch`）：键名 `<id>Enabled`，经 settings 持久化；**缺省开启**（仅 `=== false` 关闭，与 launch / manager 一致）。",
    "- AI **可以/应该**为组件增加可配置或必填参数（如 host、package、path、token 占位等），并给出清晰的中文 label / 帮助文案；**优先补上有用参数，而不是省略**。本地阶段：在 `keys` 中声明，并在 `launch()` / `spec()` 里硬编码默认值；每个参数在模块注释与 `meta.summary` / `note` 中说明。若这些参数也需要 UI 字段，在注释中写出拟议的 `SettingsSchema` / `INPUT_FIELDS` 形状（含中文 label / desc），供后续 PR；在此之前详情页**不会**渲染这些 `keys` 输入，只有状态、启用开关、本地下载安装、贡献。",
    "- **未进 schema 的自定义键**（除已由 API 合并保留的本地 `*Enabled` 外）不会进持久化 `cfg`；本地仍按上条在 `spec()` / `launch()` 硬编码默认（如 `cfg.xxxPackage || 'upstream-pkg'`，可选路径 `String(cfg.xxx || '').trim()`）——此时无法在 UI 修改。`keys` + 模块注释 + 拟议 schema 形状保留，进仓库时再补 schema / INPUT_FIELDS。",
    "- 本提示词**不要** commit / push / 开 PR。",
    "",
    "4. 模块就位后，用户可在设置页「本地」分组看到它；用户可重启 DSH 后下载。",
    "",
    "请从第 1 步开始执行，并在关键结论后再改代码。程序名称：" + name + "。"
  ].join("\n");
}
function copyTextToClipboard(text) {
  function fallback() {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;opacity:0;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
  }
  return Promise.resolve(fallback());
}

function renderSettingsPage() {
  var page = el("div", "mm-page");
  var style = document.createElement("style");
  style.textContent = STYLES;
  page.append(style);

  var inputs = {};
  var statusLines = {}; // 组件 id -> 管理页里的状态行
  var connLines = {}; // 组件 id -> 管理页里的连接行（只有工作组件有）
  var installUis = {}; // 组件 id -> 管理页里的安装按钮 / 日志
  var badges = {}; // 功能 id -> [列表里的状态徽标, 管理页标题旁的状态徽标]
  var rows = {}; // 功能 id -> 列表行
  var details = {}; // 功能 id -> { view, back, save, msg }
  var toggles = {}; // 设置 key -> 「启用」旋钮 { key, btn, msg, saving }
  var actions = {}; // 组件 id -> 字段旁的动作按钮 { key, btn, msg, path, busy, ready }（如 Godot「安装插件到项目」）
  var currentView = null; // 当前打开的管理页（功能 id）；null 为列表。只记在本页实例里。
  var lastValue = null; // 最近一次从宿主读到 / 保存后的完整设置
  var byComponent = {};
  FEATURES.forEach(function (f) { if (f.component) byComponent[f.component] = f; });
  var localGroupEl = null; // 「本地兼容」分组标题（动态）
  var localListEl = null;  // 本地组件列表容器
  var compareUrlCached = CONTRIBUTE_COMPARE_DEFAULT;

  // ── 列表（首页）──
  var listView = el("div", "mm-view mm-home");
  listView.append(el("h3", undefined, "工作组件（dsh-workbench）"));
  listView.append(el("p", "mm-sub", "点击一项进入它的管理页：开关、配置、运行状态和下载安装。保存后只重新挂载改动过的组件。"));
  var sub = el("p", "mm-sub", "正在读取设置…");
  listView.append(sub);
  page.append(listView);

  var lastGroup = null;
  var list = null;
  FEATURES.forEach(function (f) {
    if (f.group !== lastGroup) {
      lastGroup = f.group;
      listView.append(el("div", "mm-group", f.group));
      list = el("div", "mm-list");
      list.setAttribute("role", "list");
      listView.append(list);
    }
    var item = el("div", "mm-item");
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.setAttribute("data-feature", f.id);
    var main = el("div", "mm-item-main");
    main.append(titleNameWithSource(f, "mm-item-name"), el("div", "mm-item-desc", f.desc));
    var badge = el("span", "mm-badge off", "读取中…");
    var chev = el("span", "mm-chev", "›");
    chev.setAttribute("aria-hidden", "true");
    item.append(iconEl(f), main, badge, chev);
    item.addEventListener("click", function () { openDetail(f.id); });
    item.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        openDetail(f.id);
      }
    });
    rows[f.id] = item;
    badges[f.id] = [badge];
    list.append(item);
  });


  function openCompareUrl(url) {
    var u = url || compareUrlCached || CONTRIBUTE_COMPARE_DEFAULT;
    try { window.open(u, "_blank", "noopener,noreferrer"); } catch (e) { /* ignore */ }
  }

  function buildContributePanel(f) {
    var box = el("div", "mm-pr");
    box.setAttribute("data-contribute", f.component || f.id);
    box.append(el("h4", undefined, "贡献到仓库"));
    box.append(el("p", undefined, "安全默认：复制 PR 清单与命令到剪贴板，并打开 GitHub compare。不会自动 commit / push / force-push；只有你在本机确认后才应手动跑 git/gh。"));
    var row = el("div", "mm-pr-row");
    var copyBtn = el("button", "mm-btn", "提交 PR（复制清单）");
    copyBtn.type = "button";
    var openBtn = el("button", "mm-btn mm-ghost", "贡献到仓库（Compare）");
    openBtn.type = "button";
    var msg = el("span", "mm-msg");
    row.append(copyBtn, openBtn, msg);
    var pre = el("pre");
    pre.hidden = true;
    box.append(row, pre);
    var lastInfo = null;
    function fillPre(text) {
      pre.textContent = text || "";
      pre.hidden = !text;
    }
    copyBtn.addEventListener("click", function () {
      if (disposed) return;
      copyBtn.disabled = true;
      msg.textContent = "生成清单…";
      msg.className = "mm-msg";
      pageFetch("/components/" + encodeURIComponent(f.component || f.id) + "/contribute").then(function (d) {
        if (disposed) return;
        if (!d || !d.ok) throw new Error((d && d.error) || "无法生成贡献说明");
        lastInfo = d;
        if (d.compareUrl) compareUrlCached = d.compareUrl;
        fillPre(d.checklist || "");
        return copyTextToClipboard(d.checklist || "");
      }).then(function (ok) {
        if (disposed) return;
        msg.textContent = ok ? "已复制清单（含命令模板）" : "复制失败，请从下方全文手动复制";
        msg.className = ok ? "mm-msg ok" : "mm-msg err";
      }).catch(function (e) {
        if (disposed || isAbort(e)) return;
        msg.textContent = e.message || String(e);
        msg.className = "mm-msg err";
      }).finally(function () {
        if (disposed) return;
        copyBtn.disabled = false;
      });
    });
    openBtn.addEventListener("click", function () {
      if (disposed) return;
      var url = (lastInfo && lastInfo.compareUrl) || compareUrlCached || CONTRIBUTE_COMPARE_DEFAULT;
      // 二次确认：仅打开浏览器，不执行 git
      if (!window.confirm("打开 GitHub compare 页面？\\n\\n不会在本机执行 git push / gh pr create。\\n" + url)) return;
      openCompareUrl(url);
      msg.textContent = "已尝试打开浏览器";
      msg.className = "mm-msg ok";
    });
    return box;
  }

  function ensureLocalGroup() {
    if (localListEl) return localListEl;
    localGroupEl = el("div", "mm-group", "本地兼容");
    localGroupEl.title = "来自 local-components/ 的用户本地模块（可提交 PR）";
    localListEl = el("div", "mm-list");
    localListEl.setAttribute("role", "list");
    // 插在「工作组件」之后、「通用」之前：找到第一个 group===通用 的行，插到其 group 标题前
    var general = null;
    FEATURES.forEach(function (f) {
      if (!general && f.group === "通用" && rows[f.id]) general = rows[f.id].parentNode && rows[f.id].parentNode.previousSibling;
    });
    // fallback：追加在列表视图末尾（返回按钮区域之前）
    var anchorNode = null;
    FEATURES.some(function (f) {
      if (f.group === "通用" && rows[f.id]) {
        // group title is previous sibling of the list containing the row
        var list = rows[f.id].parentNode;
        anchorNode = list && list.previousSibling; // mm-group 通用
        return true;
      }
      return false;
    });
    if (anchorNode && anchorNode.parentNode === listView) {
      listView.insertBefore(localGroupEl, anchorNode);
      listView.insertBefore(localListEl, anchorNode);
    } else {
      listView.append(localGroupEl, localListEl);
    }
    return localListEl;
  }

  function buildLocalDetail(f) {
    var view = el("div", "mm-view mm-detail");
    view.hidden = true;
    view.setAttribute("data-feature", f.id);
    view.setAttribute("role", "region");
    view.setAttribute("aria-label", f.title);
    var head = el("div", "mm-dhead");
    var back = el("button", "mm-btn mm-ghost mm-back", "‹ 返回");
    back.type = "button";
    back.title = "返回功能列表（Esc）";
    back.addEventListener("click", showList);
    var hbadge = el("span", "mm-badge off", "读取中…");
    var title = el("h3");
    title.append(iconEl(f), el("span", "mm-dtitle", f.title));
    var _ext = extLink(f);
    if (_ext) title.append(_ext);
    title.append(sourceChip("local"));
    head.append(back, title, hbadge);
    badges[f.id] = badges[f.id] || [];
    badges[f.id].push(hbadge);
    view.append(head, buildIntro(f));
    statusLines[f.component] = el("div", "mm-status off", "状态读取中…");
    view.append(statusLines[f.component]);
    var cl = connLines[f.component] = el("div", "mm-conn");
    cl.hidden = true;
    cl.setAttribute("aria-live", "polite");
    view.append(cl);
    var ui = buildInstallUi(f.component);
    installUis[f.component] = ui;
    // Enable switch: same as bundled work components — right side of install row; persist via settings <id>Enabled.
    var enabledField = ensureLocalEnabledField(f.component);
    if (!f.keys || !f.keys.length) f.keys = [enabledField.key];
    var tg = buildToggle(enabledField);
    ui.row.insertBefore(tg.wrap, ui.state);
    view.append(ui.row, tg.note, ui.cnote, ui.details);
    // /components often arrives after /settings: sync switch from lastValue (default ON) and unlock.
    if (lastValue) {
      var _hasEn = Object.prototype.hasOwnProperty.call(lastValue, enabledField.key);
      setSwitch(enabledField.key, _hasEn ? !!lastValue[enabledField.key] : true);
      if (toggles[enabledField.key]) toggles[enabledField.key].btn.disabled = false;
    }
    view.append(buildContributePanel(f));
    var foot = el("div", "mm-row");
    var msg = el("span", "mm-msg");
    foot.append(msg);
    view.append(foot);
    details[f.id] = { view: view, back: back, save: null, msg: msg };
    page.append(view);
  }

  function ensureLocalFeature(c) {
    if (!c || c.kind === "prerequisite") return;
    if (c.moduleSource !== "local") return;
    if (byComponent[c.id]) return;
    var f = {
      id: c.id,
      group: "本地兼容",
      title: c.label || c.id,
      component: c.id,
      moduleSource: "local",
      icon: ICONS.addComponent,
      url: c.url || null,
      desc: c.summary || "本地兼容组件（local-components/" + c.id + "）",
      intro: (c.summary || "") + " 来源：本地目录 local-components/" + c.id + "/。可用下方「贡献到仓库」生成 PR 清单。",
      keys: [c.id + "Enabled"]
    };
    ensureLocalEnabledField(c.id);
    FEATURES.push(f);
    byComponent[c.id] = f;
    var list = ensureLocalGroup();
    var item = el("div", "mm-item");
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.setAttribute("data-feature", f.id);
    var main = el("div", "mm-item-main");
    main.append(titleNameWithSource(f, "mm-item-name"), el("div", "mm-item-desc", f.desc));
    var badge = el("span", "mm-badge off", "读取中…");
    var chev = el("span", "mm-chev", "›");
    chev.setAttribute("aria-hidden", "true");
    item.append(iconEl(f), main, badge, chev);
    item.addEventListener("click", function () { openDetail(f.id); });
    item.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        openDetail(f.id);
      }
    });
    rows[f.id] = item;
    badges[f.id] = [badge];
    list.append(item);
    buildLocalDetail(f);
  }

  function syncLocalFromComponents(components, meta) {
    if (meta && meta.contributeCompareUrl) compareUrlCached = meta.contributeCompareUrl;
    (components || []).forEach(ensureLocalFeature);
  }


  // ── 各功能的管理页（一次建好，切换时只改 hidden；轮询不管在哪一页都更新这里）──
  FEATURES.forEach(function (f) {
    var view = el("div", "mm-view mm-detail");
    view.hidden = true;
    view.setAttribute("data-feature", f.id);
    view.setAttribute("role", "region");
    view.setAttribute("aria-label", f.title);
    var head = el("div", "mm-dhead");
    var back = el("button", "mm-btn mm-ghost mm-back", "‹ 返回");
    back.type = "button";
    back.title = "返回功能列表（Esc）";
    back.addEventListener("click", showList);
    var hbadge = el("span", "mm-badge off", "读取中…");
    var title = el("h3");
    title.append(iconEl(f), el("span", "mm-dtitle", f.title));
    var _ext = extLink(f);
    if (_ext) title.append(_ext);
    if (f.moduleSource === "bundled" || f.moduleSource === "local") title.append(sourceChip(f.moduleSource));
    head.append(back, title, hbadge);
    badges[f.id].push(hbadge);
    view.append(head, buildIntro(f));
    // 基础工具「添加工作组件」：警告 + 程序名称 + 复制命令（无设置字段 / 保存）
    if (f.kind === "add-component") {
      var warn = el("div", "mm-warn", ADD_COMPONENT_TOKEN_WARN);
      warn.setAttribute("role", "note");
      var nameField = el("div", "mm-field");
      var nameLab = el("label", undefined, "程序名称");
      nameLab.setAttribute("for", "mm-add-component-name");
      var nameDesc = el("div", "mm-desc", "要接入的软件名，例如 Blender、Notion、After Effects。");
      var nameInput = el("input", "mm-input");
      nameInput.type = "text";
      nameInput.id = "mm-add-component-name";
      nameInput.placeholder = "例如 Notion";
      nameInput.autocomplete = "off";
      nameField.append(nameLab, nameDesc, nameInput);
      var crow = el("div", "mm-copy-row");
      var copyBtn = el("button", "mm-btn", "复制命令");
      copyBtn.type = "button";
      copyBtn.disabled = true;
      var cmsg = el("span", "mm-msg");
      crow.append(copyBtn, cmsg);
      view.append(warn, nameField, crow);
      function syncCopyEnabled() {
        if (disposed) return;
        copyBtn.disabled = !String(nameInput.value || "").trim();
      }
      nameInput.addEventListener("input", syncCopyEnabled);
      nameInput.addEventListener("change", syncCopyEnabled);
      copyBtn.addEventListener("click", function () {
        if (disposed) return;
        var name = String(nameInput.value || "").trim();
        if (!name) {
          cmsg.textContent = "请先填写程序名称";
          cmsg.className = "mm-msg err";
          copyBtn.disabled = true;
          return;
        }
        copyBtn.disabled = true;
        cmsg.textContent = "复制中…";
        cmsg.className = "mm-msg";
        copyTextToClipboard(buildAddComponentPrompt(name)).then(function (ok) {
          if (disposed) return;
          if (ok) {
            cmsg.textContent = "已复制到剪贴板";
            cmsg.className = "mm-msg ok";
          } else {
            cmsg.textContent = "复制失败，请手动全选提示词";
            cmsg.className = "mm-msg err";
          }
        }).finally(function () {
          if (disposed) return;
          syncCopyEnabled();
        });
      });
      details[f.id] = { view: view, back: back, save: null, msg: cmsg };
      page.append(view);
      return;
    }
    var ui = null;
    if (f.component) {
      statusLines[f.component] = el("div", "mm-status off", "状态读取中…");
      view.append(statusLines[f.component]);
      if (f.group === "工作组件") {
        var cl = connLines[f.component] = el("div", "mm-conn");
        cl.hidden = true;
        cl.setAttribute("aria-live", "polite");
        view.append(cl);
      }
      ui = installUis[f.component] = buildInstallUi(f.component);
      view.append(ui.row);
    }
    // 「启用」旋钮：放进安装按钮那一行（安装步骤之前，靠右）；说明文字放在这一行下面。
    f.keys.forEach(function (k) {
      if (FIELD_BY_KEY[k].type !== "switch") return;
      var tg = buildToggle(FIELD_BY_KEY[k]);
      if (ui) ui.row.insertBefore(tg.wrap, ui.state);
      else {
        var trow = el("div", "mm-install");
        trow.append(tg.wrap);
        view.append(trow);
      }
      view.append(tg.note);
    });
    if (ui) view.append(ui.cnote, ui.details);
    f.keys.forEach(function (k) { if (FIELD_BY_KEY[k].type !== "switch") view.append(buildField(FIELD_BY_KEY[k])); });
    var srow = el("div", "mm-row");
    var save = el("button", "mm-btn", "保存");
    save.type = "button";
    save.disabled = true; // 设置读到之前不能保存，免得用空值覆盖
    var msg = el("span", "mm-msg");
    srow.append(save, msg);
    view.append(srow);
    details[f.id] = { view: view, back: back, save: save, msg: msg };
    save.addEventListener("click", function () { saveFeature(f); });
    page.append(view);
  });

  // 管理页说明文字；有 helpImage 时在文末加蓝色圆形 ?，悬停 / 聚焦弹出截图提示（不挡住下方控件）。
  function buildIntro(f) {
    var p = el("p", f.helpImage || f.helpImageData ? "mm-sub mm-sub-with-help" : "mm-sub");
    p.append(document.createTextNode(f.intro || ""));
    if (f.helpImage || f.helpImageData) p.append(buildHelpTip(f));
    return p;
  }
  function helpImageSrc(f) {
    // DSH 同源 HTTP 优先；file:// 截图用 harness / 内嵌 data URL，不依赖 Downloads。
    if (typeof location !== "undefined" && /^https?:/i.test(location.protocol) && f.helpImage) return f.helpImage;
    return f.helpImageData || f.helpImage || "";
  }
  function buildHelpTip(f) {
    var wrap = el("span"); // 外层不抢 flex，图标 inline
    wrap.style.position = "relative";
    wrap.style.display = "inline-block";
    var btn = el("button", "mm-help");
    btn.type = "button";
    btn.setAttribute("aria-label", "查看「从清单导入插件」示意图");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-haspopup", "dialog");
    btn.title = f.helpCaption || "查看示意图";
    btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><text x="8" y="12" text-anchor="middle" font-size="11" font-family="Segoe UI,sans-serif" font-weight="700" fill="currentColor">?</text></svg>';
    var pop = el("div", "mm-help-pop");
    pop.setAttribute("role", "tooltip");
    var img = document.createElement("img");
    img.alt = f.helpCaption || "从清单导入插件示意图";
    img.src = helpImageSrc(f);
    img.loading = "lazy";
    pop.append(img);
    if (f.helpCaption) pop.append(el("div", "mm-help-cap", f.helpCaption));
    wrap.append(btn, pop);
    var open = false;
    function setOpen(v) {
      open = !!v;
      pop.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    // 弹出层 pointer-events:none，不占定时器；离开 / 失焦立刻收起，避免卸载后残留 setTimeout。
    btn.addEventListener("mouseenter", function () { setOpen(true); });
    btn.addEventListener("mouseleave", function () { setOpen(false); });
    btn.addEventListener("focus", function () { setOpen(true); });
    btn.addEventListener("blur", function () { setOpen(false); });
    btn.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && open) { ev.preventDefault(); setOpen(false); btn.blur(); }
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setOpen(!open); }
    });
    return wrap;
  }

  // 「启用」旋钮：设置读到之前禁用；拨动后立即保存（见 toggleSetting）。
  function buildToggle(f) {
    var wrap = el("div", "mm-toggle");
    var msg = el("span", "mm-tmsg");
    msg.setAttribute("aria-live", "polite");
    var btn = el("button", "mm-switch");
    btn.type = "button";
    btn.id = "mm-sw-" + f.key + "-" + Math.random().toString(36).slice(2, 8);
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-checked", "false");
    btn.disabled = true;
    btn.title = f.desc;
    var label = el("label", undefined, f.label);
    label.htmlFor = btn.id;
    var note = el("div", "mm-note", f.desc);
    note.id = btn.id + "-note";
    btn.setAttribute("aria-describedby", note.id);
    wrap.append(msg, label, btn);
    var t = { key: f.key, btn: btn, msg: msg, saving: false };
    toggles[f.key] = t;
    btn.addEventListener("click", function () { toggleSetting(t); });
    return { wrap: wrap, note: note };
  }
  function setSwitch(k, on) {
    var t = toggles[k];
    if (!t || t.saving) return; // 正在保存的旋钮由保存结果决定
    t.btn.setAttribute("aria-checked", on ? "true" : "false");
  }

  function buildField(f) {
    var wrap = el("div", "mm-field");
    var label = el("label", undefined, f.label);
    var input;
    if (f.type === "select") {
      input = el("select", "mm-input");
      // 选项可以是字符串（值即文字），也可以是 { value, label }。
      f.options.forEach(function (o) {
        var value = typeof o === "string" ? o : o.value;
        var opt = el("option", undefined, typeof o === "string" ? o : o.label);
        opt.value = value;
        input.append(opt);
      });
    } else {
      input = el("input", "mm-input");
      input.type = f.type;
      if (f.min !== undefined) input.min = String(f.min);
      if (f.max !== undefined) input.max = String(f.max);
      if (f.type === "password") {
        // 令牌类：不让浏览器记住 / 自动填充，也不做拼写检查。
        input.autocomplete = "new-password";
        input.spellcheck = false;
        input.setAttribute("data-secret", "true");
      }
    }
    if (f.placeholder) input.placeholder = f.placeholder;
    input.id = "mm-f-" + f.key + "-" + Math.random().toString(36).slice(2, 8);
    label.htmlFor = input.id;
    inputs[f.key] = input;
    wrap.append(label, input);
    if (f.action) wrap.append(buildAction(f));
    wrap.append(el("span", "mm-desc", f.desc));
    return wrap;
  }

  // 字段旁的动作按钮：组件装好之前禁用（renderInstall 里更新）；点了用输入框当前的值调用接口，成功后顺手保存这个字段。
  function buildAction(f) {
    var row = el("div", "mm-row mm-action");
    var btn = el("button", "mm-btn mm-ghost", f.action.label);
    btn.type = "button";
    btn.disabled = true;
    btn.title = "先「下载安装」";
    var msg = el("span", "mm-amsg");
    msg.setAttribute("aria-live", "polite");
    row.append(btn, msg);
    var a = actions[f.action.component] = { key: f.key, btn: btn, msg: msg, path: f.action.path, busy: false, ready: false };
    btn.addEventListener("click", function () { runAction(a); });
    return row;
  }
  function runAction(a) {
    if (disposed || a.busy || a.btn.disabled) return;
    var value = inputs[a.key].value.trim();
    function say(text, cls) {
      a.msg.textContent = text;
      a.msg.className = "mm-amsg" + (cls ? " " + cls : "");
    }
    if (!value) {
      say("先填 " + FIELD_BY_KEY[a.key].label, "err");
      inputs[a.key].focus();
      return;
    }
    a.busy = true;
    a.btn.disabled = true;
    say("正在安装…（第一次要先下载插件包）");
    var body = {};
    body.project = value;
    pageFetch(a.path, { method: "POST", body: JSON.stringify(body) }).then(function (d) {
      if (disposed) return;
      if (!d || !d.ok) throw new Error((d && d.error) || "安装失败");
      say(d.message || "已完成", "ok");
      // 记住这次用的路径（只改这一个字段）。
      if (lastValue && lastValue[a.key] !== value) {
        return postSettings(function (patch) { patch[a.key] = value; return patch; }).then(function () {}, function () {});
      }
    }).catch(function (e) {
      if (disposed || isAbort(e)) return;
      say(e.message, "err");
    }).finally(function () {
      if (disposed) return;
      a.busy = false;
      a.btn.disabled = !a.ready;
    });
  }

  // ── 页内导航（不改 location，避免干扰宿主路由）──
  function openDetail(id) {
    if (disposed || !details[id]) return;
    if (currentView && currentView !== id) details[currentView].view.hidden = true;
    listView.hidden = true;
    details[id].view.hidden = false;
    currentView = id;
    details[id].back.focus();
  }
  function showList() {
    if (disposed || !currentView) return;
    var id = currentView;
    details[id].view.hidden = true;
    listView.hidden = false;
    currentView = null;
    rows[id].focus();
  }
  // Esc 只在焦点位于本页内时生效；管理页里处理掉，免得宿主把整个设置窗口关掉。
  function onKeydown(e) {
    if (e.key !== "Escape" && e.key !== "Esc") return;
    if (!currentView) return;
    e.preventDefault();
    e.stopPropagation();
    showList();
  }
  page.addEventListener("keydown", onKeydown);

  function setBadge(id, b) {
    (badges[id] || []).forEach(function (node) {
      node.className = "mm-badge " + (b.cls || "off");
      node.textContent = b.text;
      node.title = b.title || "";
    });
  }
  function updateSummaries() {
    if (!lastValue) return;
    FEATURES.forEach(function (f) { if (f.summary) setBadge(f.id, f.summary(lastValue)); });
  }

  function fill(value, keys) {
    var list = keys || INPUT_FIELDS.map(function (f) { return f.key; });
    // Full fill also refreshes dynamic local *Enabled toggles (not in INPUT_FIELDS).
    if (!keys) {
      Object.keys(toggles).forEach(function (k) {
        if (list.indexOf(k) < 0) list = list.concat([k]);
      });
    }
    list.forEach(function (k) {
      var f = FIELD_BY_KEY[k];
      if (!f) return;
      var has = value && Object.prototype.hasOwnProperty.call(value, k);
      if (f.type === "switch") setSwitch(k, has ? !!value[k] : true); // default ON
      else {
        var v = value && value[k];
        inputs[k].value = v === undefined || v === null ? "" : String(v);
      }
    });
  }
  var STATUS_TEXT = { connected: "已连接", on: "已启动", off: "未启动", error: "出错", missing: "未安装", ready: "可用" };
  var CONN_TEXT = { connected: "已连接", "no-app": "程序未运行", unreachable: "未连接", "mcp-down": "MCP 未就绪", checking: "正在检查连接" };
  var WATCH_MS = 5000; // 有组件在探测连接时的状态刷新间隔（安装期间仍是 1.5 秒）
  var disposed = false;
  var pollTimer = null;
  var pollMs = 0; // 当前轮询间隔：1500（安装中）/ WATCH_MS（探测连接）
  var settleTimer = null; // 安装结束后延迟 2 秒补刷一次状态的一次性定时器
  var wasActive = false;
  var statusInFlight = false; // /components 请求进行中，定时器不再叠加新请求
  var refreshAgain = false; // 请求进行中时有手动刷新，回来后再补刷一次
  var failCount = 0; // 连续读取状态失败次数
  var pollPaused = false; // 因连续失败暂停了自动刷新
  var MAX_FAILS = 3;
  var controllers = new Set(); // 本页进行中的请求，卸载时统一中止

  function abortError() {
    var e = new Error("已中止");
    e.name = "AbortError";
    return e;
  }
  function isAbort(e) {
    return !!e && e.name === "AbortError";
  }
  // 本页发出的请求都走这里：登记 AbortController，卸载时统一中止；卸载后不再发请求。
  function pageFetch(path, init) {
    if (disposed) return Promise.reject(abortError());
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var opts = Object.assign({}, init || {});
    if (ctrl) {
      controllers.add(ctrl);
      opts.signal = ctrl.signal;
    }
    function done() { if (ctrl) controllers.delete(ctrl); }
    return fetchJson(path, opts).then(function (d) { done(); return d; }, function (e) { done(); throw e; });
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    pollMs = 0;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    wasActive = false;
  }

  function buildInstallUi(id) {
    var row = el("div", "mm-install");
    var install = el("button", "mm-btn", "下载安装");
    var remove = el("button", "mm-btn mm-ghost", "卸载");
    var state = el("span", "mm-istate");
    install.type = "button";
    remove.type = "button";
    remove.style.display = "none";
    row.append(install, remove, state);
    var details = el("details", "mm-log");
    var summary = el("summary", undefined, "安装日志");
    var pre = el("pre");
    details.append(summary, pre);
    details.style.display = "none";
    var cnote = el("div", "mm-cnote");
    cnote.hidden = true;
    install.addEventListener("click", function () {
      install.disabled = true;
      state.className = "mm-istate queued";
      state.textContent = "正在提交…";
      pageFetch("/components/" + id + "/install", { method: "POST", body: "{}" }).then(function (d) {
        if (disposed) return;
        if (!d || !d.ok) throw new Error((d && d.error) || "无法开始安装");
        details.style.display = "";
        details.open = true;
      }).catch(function (e) {
        if (disposed || isAbort(e)) return;
        state.className = "mm-istate error";
        state.textContent = e.message;
      }).finally(function () {
        refreshStatus();
      });
    });
    remove.addEventListener("click", function () {
      var keep = id === "uv" || id === "node" ? "" : "（共用的 Python、Node.js 和缓存会保留）";
      if (!window.confirm("删除插件 tools 目录里的「" + id + "」安装？" + keep)) return;
      remove.disabled = true;
      install.disabled = true;
      state.className = "mm-istate queued";
      state.textContent = "正在卸载…";
      pageFetch("/components/" + id + "/uninstall", { method: "POST", body: "{}" }).then(function (d) {
        if (disposed) return;
        if (!d || !d.ok) throw new Error((d && d.error) || "卸载失败");
      }).catch(function (e) {
        if (disposed || isAbort(e)) return;
        state.className = "mm-istate error";
        state.textContent = e.message;
      }).finally(function () {
        if (disposed) return;
        remove.disabled = false;
        refreshStatus();
      });
    });
    return { row: row, install: install, remove: remove, state: state, details: details, pre: pre, cnote: cnote };
  }

  function elapsed(job) {
    if (!job.startedAt) return "";
    var s = Math.max(0, Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 1000));
    return s >= 60 ? Math.floor(s / 60) + " 分 " + (s % 60) + " 秒" : s + " 秒";
  }

  // 列表行 / 管理页标题旁的状态徽标：安装进行中优先，其次是运行状态。
  function componentBadge(c) {
    var job = c.install || {};
    if (job.state === "installing") return { text: "安装中" + (job.startedAt ? " " + elapsed(job) : ""), cls: "busy", title: job.step || "" };
    if (job.state === "queued") return { text: "排队中", cls: "busy", title: "等前一个安装完成" };
    var cn = c.connection;
    var title = cn && cn.detail ? (CONN_TEXT[cn.state] || cn.state) + "：" + cn.detail : c.detail || "";
    return { text: STATUS_TEXT[c.status] || c.status, cls: c.status, title: title };
  }

  // 管理页的连接行：只在组件已启动（带 connection）时显示。
  function renderConn(c) {
    var line = connLines[c.id];
    if (!line) return;
    var cn = c.connection;
    if (!cn) {
      line.hidden = true;
      line.textContent = "";
      line.className = "mm-conn";
      return;
    }
    line.hidden = false;
    line.className = "mm-conn " + cn.state;
    var label = CONN_TEXT[cn.state] || cn.state;
    line.textContent = cn.state === "checking" || !cn.detail || cn.detail === label ? label + "…" : label + "：" + cn.detail;
    line.title = cn.checkedAt ? "检查于 " + new Date(cn.checkedAt).toLocaleTimeString() + (cn.via ? "（" + cn.via + "）" : "") : "";
  }

  function renderInstall(c) {
    var ui = installUis[c.id];
    if (!ui) return;
    var job = c.install || { state: "idle", log: [] };
    var busy = job.state === "installing" || job.state === "queued";
    ui.install.textContent = c.installed ? "重新安装" : "下载安装";
    ui.install.title = c.installed ? "重新下载最新版本并覆盖插件 tools 目录里的安装" : "下载并安装到插件的 tools 目录";
    ui.install.disabled = busy;
    ui.remove.style.display = c.installed && !busy ? "" : "none";
    var text;
    if (job.state === "installing") text = "安装中（" + elapsed(job) + "）：" + (job.step || "");
    else if (job.state === "queued") text = "排队中，等前一个安装完成";
    else if (job.state === "error") text = "安装失败：" + (job.error || "");
    else if (job.state === "done") text = "安装完成，用时 " + elapsed(job);
    else text = c.installed ? "已装进插件 tools 目录" : (job.step || "未装进插件 tools 目录");
    ui.state.className = "mm-istate " + job.state;
    ui.state.textContent = text;
    // 组件说明（如 Godot：装的是哪个版本、项目里的插件要装哪个版本）
    ui.cnote.textContent = c.note || "";
    ui.cnote.hidden = !c.note;
    var a = actions[c.id];
    if (a) {
      a.ready = !!c.installed && !busy;
      if (!a.busy) a.btn.disabled = !a.ready;
      a.btn.title = a.ready ? "把与服务器同版本的插件装进上面填的项目" : busy ? "正在安装，完成后再试" : "先「下载安装」";
    }
    var log = (job.log || []).join("\n");
    if (log) {
      ui.details.style.display = "";
      if (ui.pre.textContent !== log) {
        var stick = ui.pre.scrollTop + ui.pre.clientHeight >= ui.pre.scrollHeight - 8;
        ui.pre.textContent = log;
        if (stick) ui.pre.scrollTop = ui.pre.scrollHeight;
      }
    }
  }

  // active：有安装在进行（1.5 秒一刷）；watch：有已启动的组件在探测连接（WATCH_MS 一刷，看「已连接」的变化）。
  // 只用一个定时器，间隔变了就换一个。
  function setPolling(active, watch) {
    if (disposed) return;
    var ms = active ? 1500 : watch ? WATCH_MS : 0;
    if (pollTimer && pollMs !== ms) { clearInterval(pollTimer); pollTimer = null; pollMs = 0; }
    if (ms && !pollTimer) { pollTimer = setInterval(function () { refreshStatus(true); }, ms); pollMs = ms; }
    // 安装刚结束时组件还在重新挂载，稍后再刷一次状态。
    if (wasActive && !active) {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        settleTimer = null;
        refreshStatus();
      }, 2000);
    }
    wasActive = active;
  }

  // 唯一的状态刷新管线：同时更新列表徽标和各管理页。
  // fromTimer：由轮询定时器触发；手动操作（保存、安装、卸载）不传。
  function refreshStatus(fromTimer) {
    if (disposed) return;
    if (statusInFlight) {
      // 上一次请求还没回来：定时器直接跳过，手动刷新等它回来后补刷一次。
      if (fromTimer !== true) refreshAgain = true;
      return;
    }
    statusInFlight = true;
    function settle() {
      statusInFlight = false;
      if (refreshAgain && !disposed) {
        refreshAgain = false;
        refreshStatus();
      }
    }
    pageFetch("/components").then(function (d) {
      if (disposed) return;
      if (!d || !d.ok) throw new Error((d && d.error) || "读取失败");
      failCount = 0;
      pollPaused = false;
      var active = false;
      var watch = false;
      syncLocalFromComponents(d.components, d);
      d.components.forEach(function (c) {
        if (c.install && (c.install.state === "installing" || c.install.state === "queued")) active = true;
        if (c.connection) watch = true;
        renderInstall(c);
        renderConn(c);
        if (byComponent[c.id]) setBadge(byComponent[c.id].id, componentBadge(c));
        var line = statusLines[c.id];
        if (!line) return;
        line.className = "mm-status " + c.status;
        line.textContent = (STATUS_TEXT[c.status] || c.status) + "：" + c.detail;
        line.title = c.command || "";
      });
      setPolling(active, watch);
      settle();
    }).catch(function (e) {
      if (disposed) return;
      if (isAbort(e)) { settle(); return; }
      failCount++;
      // 轮询中连续失败 MAX_FAILS 次就暂停自动刷新；手动操作成功后会重新开始。
      if (failCount >= MAX_FAILS && pollTimer) {
        stopPolling();
        pollPaused = true;
      }
      var text = "无法读取组件状态：" + e.message + (pollPaused ? "（已暂停自动刷新，稍后再试或点保存刷新）" : "");
      Object.keys(statusLines).forEach(function (id) {
        statusLines[id].className = "mm-status error";
        statusLines[id].textContent = text;
        if (byComponent[id]) setBadge(byComponent[id].id, { text: "读取失败", cls: "error", title: text });
      });
      settle();
    });
  }

  pageFetch("/settings").then(function (d) {
    if (disposed) return;
    if (!d || !d.ok) throw new Error((d && d.error) || "读取失败");
    lastValue = d.value || {};
    fill(lastValue);
    updateSummaries();
    FEATURES.forEach(function (f) { if (details[f.id].save) details[f.id].save.disabled = false; });
    Object.keys(toggles).forEach(function (k) { toggles[k].btn.disabled = false; });
    refreshStatus();
    sub.textContent = d.persisted ? "设置保存在 DSH 设置服务里，修改后立即生效。" : "当前没有设置服务，修改只在本次运行内有效。";
  }).catch(function (e) {
    if (disposed || isAbort(e)) return;
    sub.textContent = "无法连接插件宿主接口：" + e.message;
    sub.className = "mm-msg err";
    FEATURES.forEach(function (f) {
      if (f.summary) setBadge(f.id, { text: "读取失败", cls: "error", title: e.message });
      if (details[f.id].save && details[f.id].msg) {
        details[f.id].msg.textContent = "设置读取失败，暂时不能保存";
        details[f.id].msg.className = "mm-msg err";
      }
    });
  });

  // 唯一的保存管线：请求排队依次发出，每次都以「轮到它时」最近读到的完整设置为底、只换上调用方的字段，
  // 所以旋钮和「保存」前后脚点也不会互相覆盖。成功后更新 lastValue、列表徽标并刷新一次状态。
  var saveQueue = Promise.resolve();
  function postSettings(change) {
    var run = saveQueue.then(function () {
      if (disposed) throw abortError();
      return pageFetch("/settings", { method: "POST", body: JSON.stringify(change(Object.assign({}, lastValue || {}))) });
    }).then(function (d) {
      if (disposed) throw abortError();
      if (!d || !d.ok) throw new Error((d && d.error) || "保存失败");
      lastValue = d.value || lastValue;
      updateSummaries();
      refreshStatus();
      return lastValue;
    });
    saveQueue = run.catch(function () {});
    return run;
  }

  // 某个管理页的「保存」：以最近读到的完整设置为底，只换上本页的字段，
  // 其他功能的设置原样带回（不会被清空，也不会带上别的页里没保存的改动）。
  // 「启用」不在这里：它由旋钮单独保存，这里沿用已保存的值（即旋钮当前状态）。
  function saveFeature(f) {
    var ui = details[f.id];
    function say(text, isErr) {
      ui.msg.textContent = text;
      ui.msg.className = isErr ? "mm-msg err" : "mm-msg";
    }
    var values = {};
    f.keys.forEach(function (k) {
      var fd = FIELD_BY_KEY[k];
      if (fd.type === "switch") return;
      var raw = inputs[k].value;
      values[k] = fd.type === "number" ? Number(raw) : fd.bool ? raw === "true" : raw;
    });
    ui.save.disabled = true;
    say("保存中…");
    postSettings(function (patch) { return Object.assign(patch, values); }).then(function () {
      fill(lastValue, f.keys);
      say("已保存");
    }).catch(function (e) {
      if (disposed || isAbort(e)) return;
      say(e.message, true);
    }).finally(function () {
      if (disposed) return;
      ui.save.disabled = false;
    });
  }

  // 拨动「启用」旋钮：先显示新状态并禁用旋钮，只把这一项改掉后保存；失败时回到已保存的状态并提示。
  function toggleSetting(t) {
    if (disposed || t.saving || t.btn.disabled || !lastValue) return;
    var next = t.btn.getAttribute("aria-checked") !== "true";
    function say(text, isErr) {
      t.msg.textContent = text;
      t.msg.className = isErr ? "mm-tmsg err" : "mm-tmsg";
    }
    t.btn.setAttribute("aria-checked", next ? "true" : "false");
    t.btn.setAttribute("aria-busy", "true");
    t.btn.disabled = true;
    t.saving = true;
    say("保存中…");
    postSettings(function (patch) { patch[t.key] = next; return patch; }).then(function (v) {
      t.saving = false;
      setSwitch(t.key, !!v[t.key]);
      say(v[t.key] ? "已启用" : "已停用");
    }).catch(function (e) {
      if (disposed || isAbort(e)) return;
      t.saving = false;
      setSwitch(t.key, !!(lastValue || {})[t.key]);
      say("未保存：" + e.message, true);
    }).finally(function () {
      if (disposed) return;
      t.saving = false;
      t.btn.disabled = false;
      t.btn.removeAttribute("aria-busy");
    });
  }

  page.__mmDispose = function () {
    disposed = true;
    stopPolling();
    page.removeEventListener("keydown", onKeydown);
    // 中止所有进行中的请求；回调里见到 disposed / AbortError 会直接返回，不再写 DOM。
    controllers.forEach(function (c) { c.abort(); });
    controllers.clear();
  };
  return page;
}

// settings.section 的第二个参数是 React 组件；把手写 DOM 页面挂进去。
function SettingsPage() {
  var ref = React.useRef(null);
  React.useEffect(function () {
    var node = renderSettingsPage();
    if (ref.current) ref.current.appendChild(node);
    return function () {
      if (node.__mmDispose) node.__mmDispose();
      node.remove();
    };
  }, []);
  return h("div", { ref: ref });
}

// ── mm_image_demo 工具卡片 ──
function imageRefs(block) {
  var content = block && Array.isArray(block.content) ? block.content : [];
  return content.filter(function (b) { return b && b.type === "image" && b.attachment; })
    .map(function (b) { return b.attachment; });
}
function blockText(block) {
  var content = block && Array.isArray(block.content) ? block.content : [];
  return content.filter(function (b) { return b && b.type === "text"; })
    .map(function (b) { return b.text; }).join("\n");
}

function DemoImage(props) {
  var st = React.useState(null);
  var url = st[0];
  var setUrl = st[1];
  var es = React.useState(false);
  var failed = es[0];
  var setFailed = es[1];
  React.useEffect(function () {
    var alive = true;
    if (!props.loadImage) return undefined;
    props.loadImage(props.attachment).then(function (u) { if (alive) setUrl(u); }, function () { if (alive) setFailed(true); });
    return function () { alive = false; };
  }, [props.attachment, props.loadImage]);
  if (failed) return h("div", { style: { fontSize: 12, color: "#e55" } }, "图片加载失败");
  if (!url) return h("div", { style: { width: 160, height: 160, borderRadius: 8, background: "rgba(127,127,127,.15)" } });
  return h("img", {
    src: url,
    alt: props.attachment.name || "mm_image_demo",
    style: { maxWidth: 320, maxHeight: 320, borderRadius: 8, display: "block" }
  });
}

function ImageDemoRow(props) {
  var block = props.block;
  var refs = imageRefs(block);
  var text = blockText(block);
  var args = (block && (block.args || block.input)) || {};
  return h("div", {
    style: { border: "1px solid var(--theme-border,#333)", borderRadius: 10, padding: "10px 12px", margin: "4px 0", fontSize: 12 }
  },
    h("div", { style: { fontWeight: 600, marginBottom: 6 } }, "🖼 mm_image_demo" + (args.prompt ? " · " + args.prompt : "")),
    refs.length > 0
      ? h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, refs.map(function (ref, i) {
          return h(DemoImage, { key: ref.attachmentId || i, attachment: ref, loadImage: props.loadImage });
        }))
      : h("div", { style: { color: "var(--theme-text-secondary,#888)" } }, text || "生成中…"),
    refs.length > 0 && text ? h("div", { style: { marginTop: 6, color: "var(--theme-text-secondary,#888)" } }, text) : null
  );
}

var inject = ["slots"];
function apply(ctx) {
  ctx.effect(function () {
    return ctx.slots.inject("settings.section", function () {
      return ctx.slots.register({
        name: "settings.section",
        id: "dsh-workbench",
        order: 60,
        label: function () { return "工作组件"; }
      }, SettingsPage);
    });
  }, "dsh-workbench: settings page");

  ctx.slots.inject("tool.call.toolview", function () {
    return ctx.slots.register({ name: "tool.call.toolview", key: "mm_image_demo" }, ImageDemoRow);
  });
}

exports.inject = inject;
exports.apply = apply;
exports.name = "dsh-workbench-client";
		return module.exports;
	}
});
