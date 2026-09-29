# dsh-workbench（工作组件）

DSH 插件，用来统一挂载和管理「控制其他工作软件」的 MCP 服务器。每个工作组件以 `@deepseek-ai/dsh-mcp-client` 子插件的形式挂载：不写进 profile，随本插件卸载，设置改动后只重挂受影响的组件。

| 组件 | MCP 服务器 | 工具名前缀 | 前提（简述） |
|---|---|---|---|
| Office | [OfficeMCP](https://github.com/officemcp/officemcp)（COM） | `mcp__officemcp__` | Windows + Office（Word / Excel / PowerPoint 等） |
| Blender | [mcp-for-blender](https://github.com/ahujasid/blender-mcp)（PyPI） | `mcp__blender__` | Blender 开着并启用对应插件 |
| Unity | [mcp-for-unity / mcpforunityserver](https://github.com/CoplayDev/unity-mcp)（Coplay） | `mcp__unity__` | Unity 编辑器装了 MCP for Unity 包并开着工程 |
| Figma | [figma-console-mcp](https://github.com/southleft/figma-console-mcp)（npm；也可改连官方桌面版 MCP） | `mcp__figma__` | Figma 桌面版 + Desktop Bridge（console）或 Dev Mode 官方 MCP |
| Photoshop | [@alisaitteke/photoshop-mcp](https://github.com/alisaitteke/photoshop-mcp)（npm，COM / ExtendScript） | `mcp__photoshop__` | Windows（或 macOS）装有 Photoshop 并开着 |
| Chrome | [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)（npm） | `mcp__chrome__` | 本机 Google Chrome；可独立启动或连已有实例 |
| Godot | [godot-ai](https://github.com/hi-godot/godot-ai)（PyPI，`godot-ai attach`） | `mcp__godot__` | Godot 4.7+ 编辑器开着项目，且项目启用了同版本 Godot AI 插件 |

组件依赖的运行时（uv + Python，或 Node.js）与各上游 MCP 包，都可以在设置页「下载安装」到插件自己的 `tools/` 目录。Figma / Photoshop / Chrome / Godot 默认关闭，装好后在管理页打开「启用」。具体安装、桥接、端口与项目侧配置都在设置 UI 里完成，本 README 不重复操作步骤。

计划加入：TRIX-GAMEBOT。

另保留早期出图演示工具 `mm_image_demo`（生成本地演示 PNG，验证 DSH 的图片输出）。

## 设置页

DSH 设置里的「工作组件」页：首页是功能列表（按分组），行首应用图标、行尾实时状态，点进该项的管理页。

| 分组 | 功能 | 列表状态（示意） | 管理页要点 |
| --- | --- | --- | --- |
| 多模态 | 出图演示 | 演示图边长 / openai-compatible · 未接入 | 出图提供方、接口、模型、默认边长 |
| 工作组件 | Office / Blender / Unity / Figma / Photoshop / Chrome / Godot（徽标「仓库自带」） | 已连接 / 已启动 / 未启动 / 未安装 / 出错 / 安装中… | 运行与连接说明、下载安装 / 卸载、「启用」、组件专属配置 |
| 本地兼容 | `local-components/<id>/` 下的用户模块（徽标「本地」） | 同上 | 与仓库自带同接口；管理页可复制 PR 清单 / 打开 Compare（默认不自动 push） |
| 通用 | uv / Node.js / 下载代理 | 可用 / 未安装 / 已设置… | 运行时安装与代理等共用项 |
| 基础工具 | 添加工作组件 | 提示词工具 | 提示词引导 AI 写入 `local-components/`（不装进 tools/）；之后可提交 PR。 |

管理页「‹ 返回」或 Esc 回列表；每页各自「保存」；「启用」拨动后立即单独保存。安装进行中列表与管理页约每 1.5 秒刷新；有组件已启动时约每 5 秒刷新以跟上「已连接」。设置命名空间：`dsh-workbench`。

### 「已连接」

优先级：安装中 / 排队中 → 出错 → **已连接** → 已启动 → 未启动 / 未安装。

- **已启动**（`status: on`）：MCP 服务器已挂载，尚未确认够得着目标程序。
- **已连接**（`status: connected`）：已启动，且 (a) 对应程序在运行，(b) MCP 层可达。

探测在 `GET /components` 时按需进行（`src/connect.mjs`）：只读、不拉起程序；结果缓存 `PROBE_TTL_MS`（6s），同一组件不并发，一轮共用一次进程列表；单次探测限时 `PROBE_TIMEOUT_MS`（15s）、工具调用默认限时 4s；请求最多等 1.5s，未完成的下次再带。工具经 `ctx.tools` 里 dsh-mcp-client 已有连接直接执行。上次已连接而本次工具超时则暂保持已连接并注明。组件重挂后旧结果作废。

| 组件 | (a) 程序在运行 | (b) MCP 够得着 |
| --- | --- | --- |
| Office | 进程 WINWORD / EXCEL / POWERPNT 等（含 Visio、Outlook、WPS 等） | `RunningApps`（COM，只读）非空 |
| Blender | 进程 blender | 已注册工具 + TCP 连插件端口（`BLENDER_HOST:BLENDER_PORT`，默认 `localhost:9876`） |
| Unity | 进程 Unity | 已注册工具 + 按 `~/.unity-mcp`（或 `UNITY_MCP_STATUS_DIR`）端口文件与默认 6400 做桥接 ping |
| Figma（console） | 进程 Figma（不含 figma_agent） | `figma_get_status` 中 `transport.websocket.available` |
| Figma（官方） | 进程 Figma | TCP 连官方 MCP 地址（默认 `127.0.0.1:3845`） |
| Photoshop | 进程 Photoshop | `photoshop_ping` 成功（`PSMCP_FEEDBACK=0`、`ANALYTICS_DISABLED=1`） |
| Chrome（launch） | chrome-devtools-mcp 专用配置目录被 Chrome 占用 | `list_pages` 成功（未占用时不调，避免拉起 Chrome） |
| Chrome（autoConnect） | chrome + 渠道默认配置目录有 `DevToolsActivePort` 且端口开 | `list_pages` 成功 |
| Chrome（browserUrl） | `GET <调试地址>/json/version` 成功 | `list_pages` 成功 |
| Godot | 进程名以 Godot 开头（不含 venv 里的 `godot-ai`） | 已注册工具 + `session_manage(op=list)` 有会话 + `editor_state` 成功 |

## 架构（给开发者）

组件文件夹约定见 **[docs/component-module.md](./docs/component-module.md)**（布局、稳定导出、共享层、新增检查清单）。

```
src/
  index.mjs            宿主入口：SettingsSchema、API、mm_image_demo
  components.mjs       兼容再导出 → ./components/
  components/          仓库自带组件 + shared / registry / manager
  connect-lib.mjs      「已连接」共享原语（进程 / TCP / MCP 调用）
  connect.mjs          汇总各组件 app/probe，提供 probeComponent
  tools.mjs            tools/ 布局、下载、uv / Node / npm / venv 安装
  png.mjs              零依赖 PNG / 演示图
lib/
  index.mjs            构建产物（宿主）
  client.js            前端设置页与 mm_image_demo 工具卡片（ModuleLoader 直接加载）
office/launch.py       OfficeMCP 启动包装（stdio 友好）
cordis.patch.yml       bundle 层，插入宿主插件行
docs/component-module.md  组件模块约定（含 bundled vs local）
scripts/               build、vendor:sync、各类 smoke
tools/                 本机「下载安装」落地（gitignore）
local-components/      用户本地兼容源码（gitignore；可用 DSH_WORKBENCH_LOCAL_COMPONENTS_DIR 覆盖）
```

**托管安装**：设置页可把 uv、Node.js 与各组件装进 `tools/`（`.dsh-install.json` 记版本）。启动查找顺序一般为：插件 `tools/` → 设置路径 → 系统 / 旁路兜底（如 uvx、`npx`、旁边的 `../officemcp`）。Figma「官方桌面版 MCP」模式走 streamable-http，不需本地包。测试可用环境变量 `DSH_WORKBENCH_TOOLS_DIR` 改落地目录。

**同源 API**（前缀 `/dsh-workbench/api`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/settings` | 读写 `dsh-workbench` 设置 |
| GET | `/components` | `{ ok, toolsDir, localComponentsDir, contributeCompareUrl, components }`；组件含 `moduleSource`（`bundled`/`local`）、`status`、`connection`、`install`、`source`（启动来源）等 |
| GET | `/components/<id>/contribute` | 仅 local：PR 清单、文件列表、compare URL、命令模板 |
| POST | `/components/<id>/install` | 开始（重新）安装，202；冲突 409。`id`：`uv` / `node` / `office` / … / `godot` |
| POST | `/components/<id>/uninstall` | 删除 `tools/` 中该安装 |
| POST | `/components/godot/addon` | body `{ project }`：把同版本插件装进 Godot 项目 |

另有 `/dsh-workbench/assets/*` 提供插件 `assets/` 静态资源。

**新增组件**：先写 `local-components/<id>/`（设置页「添加工作组件」），再按 [docs/component-module.md](./docs/component-module.md) 合入 `src/components/` 并开 PR。测试可用 `DSH_WORKBENCH_LOCAL_COMPONENTS_DIR` 指向桩目录。

## 构建与测试

```powershell
npm install
npm run build          # 不依赖已安装的 DSH；defineTool 在 vendor/dsh-tools（升级后可 npm run vendor:sync）
npm run smoke          # 假 ctx，生成 lib/smoke.png
npm run smoke:tools    # 走同一套安装代码装组件，再 MCP initialize / tools/list（可指定组件、--proxy、--skip-install、--uninstall）
npm run smoke:office   # 按插件启动方案拉起 OfficeMCP（可用 --expect-managed）
npm run smoke:connect  # 「已连接」实机冒烟（Windows）：node scripts/connect-smoke.mjs chrome …
npm run smoke:local    # 本地兼容发现 / moduleSource / contribute 清单
```

从源码挂进 DSH Desktop：在 `~/.dsh/profiles/desktop` 用 `pnpm add link:<插件目录>`，并在 `dsh.profile.bundles` 加入 `"dsh-workbench"`（若 profile 里曾直接挂同名 mcp-client，先去掉以免重复）。改 bundle 后需重启 Desktop。
