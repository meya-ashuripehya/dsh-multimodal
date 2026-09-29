# dsh-workbench（工作组件）

DSH 插件，用来统一挂载和管理「控制其他工作软件」的 MCP 服务器。每个工作组件以 `@deepseek-ai/dsh-mcp-client` 子插件的形式挂载：不写进 profile，随本插件卸载，设置改动后只重挂受影响的组件。

| 组件 | MCP 服务器 | 工具名前缀 | 前提 |
|---|---|---|---|
| Office | [OfficeMCP](https://github.com/officemcp/officemcp)（COM） | `mcp__officemcp__` | Windows + Office（Word / Excel / PowerPoint） |
| Blender | `mcp-for-blender` | `mcp__blender__` | Blender 开着并启用对应插件 |
| Unity | `mcpforunityserver` 的 `mcp-for-unity` | `mcp__unity__` | Unity 编辑器装了 MCP for Unity 包并开着工程 |
| Figma | [figma-console-mcp](https://github.com/southleft/figma-console-mcp)（npm，121 个工具，读写画布） | `mcp__figma__` | Figma 桌面版 + 在 Figma 里导入并运行它的 Desktop Bridge 插件；免费计划可用。可选个人访问令牌（REST 类工具） |
| Photoshop | [@alisaitteke/photoshop-mcp](https://github.com/alisaitteke/photoshop-mcp)（npm，125 个工具，COM / ExtendScript） | `mcp__photoshop__` | Windows 装有 Photoshop（CS6 / 2012 及以上）并开着；不需要 Photoshop 插件 |
| Chrome | Google 官方 [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)（npm，标准 30 个 / 完整 54 个工具） | `mcp__chrome__` | 本机装有 Google Chrome；连接正在用的 Chrome 需 144+ 并在 `chrome://inspect/#remote-debugging` 打开远程调试 |
| Godot | [godot-ai](https://github.com/hi-godot/godot-ai)（PyPI，MIT，47 个工具；stdio 启动 `godot-ai attach`） | `mcp__godot__` | Godot 4.7+ 编辑器开着项目，项目里装了**同版本**的 Godot AI 插件（`addons/godot_ai`）并已启用 |

这些组件和它们依赖的运行时（uv + Python，或 Node.js）都可以在设置页一键「下载安装」到插件自己的 `tools/` 目录，不需要事先装 uv、git、Python 或 Node.js。新加的 Figma / Photoshop / Chrome / Godot 默认关闭，装好后在管理页拨开「启用」。

计划加入：TRIX-GAMEBOT。

另外保留了早期的出图演示工具 `mm_image_demo`（生成本地演示 PNG，验证 DSH 的图片输出）。

## 设置页

DSH 设置里的「工作组件」页，首页是功能列表，按分组每项一行，行首是应用图标、行尾显示实时状态，点击（或 Tab 选中后按 Enter / 空格）进入该功能的管理页：

| 分组 | 功能 | 列表里的状态 | 管理页内容 |
| --- | --- | --- | --- |
| 多模态 | 出图演示 | 演示图 · 边长 / openai-compatible · 未接入 | 出图提供方、生图接口地址、生图模型、演示图默认边长 |
| 工作组件 | Office / Blender / Unity / Figma / Photoshop / Chrome / Godot | 已连接 / 已启动 / 未启动 / 未安装 / 出错 / 安装中 x 秒 / 排队中 | 运行状态（悬停看实际命令）、连接行（已连接 / 程序未运行 / 未连接的原因）、「下载安装 / 重新安装 / 卸载」、安装进度和安装日志、「启用」旋钮（和安装按钮同一行靠右）与该组件的配置项 |
| 通用 | uv | 可用 / 未安装 / 安装中 | uv 状态、下载安装 / 卸载、uv 路径 |
| 通用 | Node.js | 可用 / 未安装 / 安装中 | Node.js 状态（用的是哪一个）、下载安装 / 卸载 `tools/node`、node 路径、npm 镜像 |
| 通用 | 下载代理 | 已设置 / 未设置 | 下载代理地址 |

管理页左上角「‹ 返回」或按 Esc 回到列表。每个管理页有自己的「保存」，只改本页的字段（其他设置原样带回）；「启用」旋钮拨动后立即单独保存（只改这一项，失败时自动拨回并提示），不用再点保存。安装进行中不论停在哪一页，列表和管理页的状态都会自动刷新（每 1.5 秒）；有组件已启动时每 5 秒刷新一次，跟上「已连接」的变化。设置保存在 DSH 设置服务的 `dsh-workbench` 命名空间里。

### 组件状态与「已连接」

优先级：安装中 / 排队中 → 出错 → **已连接** → 已启动 → 未启动 / 未安装。

- **已启动**：MCP 服务器已经挂载（`status: on`），但还没确认连得上它控制的程序——程序没开、插件 / 桥接没启动，或者还在检查。
- **已连接**（绿色实心徽标，`status: connected`）：已启动，并且 (a) 对应程序正在运行，(b) MCP 这一层真的够得着它。
- 管理页状态行下面的连接行说明原因：「已连接：…」「程序未运行：没有检测到 Photoshop 在运行（Photoshop.exe）」「未连接：Blender 在运行，但连不上它的 MCP 插件端口 localhost:9876…」「MCP 未就绪：服务器还没注册任何工具」。

各组件怎么判断（`src/connect.mjs`；只用只读、不会拉起程序的办法，程序没在运行时一律不调工具）：

| 组件 | (a) 程序在运行 | (b) MCP 够得着 |
| --- | --- | --- |
| Office | 进程 WINWORD / EXCEL / POWERPNT（及 Visio、Outlook、WPS 等 OfficeMCP 支持的） | 调 OfficeMCP 的 `RunningApps`（COM `GetActiveObject`，只读、不启动 Office），返回非空 |
| Blender | 进程 blender | 服务器已注册工具 + TCP 连得上 Blender 插件端口（`BLENDER_HOST:BLENDER_PORT`，默认 localhost:9876，就是服务器自己连的口）。不调工具：它的工具带遥测上报，`get_addon_status` 还可能弹同意提示 |
| Unity | 进程 Unity | 服务器已注册工具 + 按 `~/.unity-mcp`（或 `UNITY_MCP_STATUS_DIR`）里的状态 / 端口文件和默认 6400，照服务器自己的端口探测做 `FRAMING=1` 握手 + ping，收到 pong。不调工具（带遥测） |
| Figma（console） | 进程 Figma（不算常驻的 figma_agent） | `figma_get_status`（不带 probe）里 `transport.websocket.available` 为真，即 Desktop Bridge 插件已连上 |
| Figma（官方） | 进程 Figma | TCP 连得上官方 MCP 地址（Figma 桌面版自己监听的 127.0.0.1:3845） |
| Photoshop | 进程 Photoshop | `photoshop_ping` 返回 Successfully connected（已设 `PSMCP_FEEDBACK=0`、`ANALYTICS_DISABLED=1`）。不跑 JSX，免得打扰正在用的 Photoshop |
| Chrome（launch，默认） | chrome-devtools-mcp 自己的配置目录正被 Chrome 占用（Windows 看 `lockfile` 是否被独占；其他系统看 `SingletonLock`） | `list_pages` 成功。它自己启动的 Chrome 算「程序」：第一次用浏览器工具前没有 Chrome，显示「已启动 / 程序未运行」；探测绝不在没开时调 `list_pages`（那会把 Chrome 拉起来） |
| Chrome（autoConnect） | 进程 chrome + 该渠道默认配置目录里有 `DevToolsActivePort` 且端口开着 | `list_pages` 成功 |
| Chrome（browserUrl） | `GET <调试地址>/json/version` 成功 | `list_pages` 成功 |
| Godot | 进程名以 Godot 开头（`Godot_v4.7-stable_win64.exe`、`…_console.exe` 等；不算 venv 里的 `godot-ai.exe`） | 服务器已注册工具 + `session_manage`（`op: list`，只查服务器自己的会话表）里至少有一个编辑器会话 + `editor_state` 成功（只读，返回项目名 / Godot 版本）。会话为 0 时不调 `editor_state`，显示「未连接：Godot 在运行，但编辑器还没连上…」；插件与服务器版本不一致时在「已连接」后注明 |

探测只在 `GET /components` 时按需进行（没人开设置页就不探测）：结果缓存 6 秒，同一组件不并发，一轮共用一次进程列表（Windows `tasklist`），单次整体限时 5 秒、工具调用限时 4 秒；请求最多等 1.5 秒，没探完的下次请求再带上。工具经 `ctx.tools` 里 dsh-mcp-client 注册的定义直接执行（用它已有的 MCP 连接，不经模型、不走审批）。上一次是已连接而这次工具调用超时（服务器可能正忙着执行模型的调用）时，先保持已连接并注明。组件重挂（设置改动、重装）后旧结果作废。

## 下载安装（插件自管的 tools 目录）

在设置页进入某个组件的管理页，点「下载安装」：

1. 如果 `tools/uv` 里还没有 uv，先从 uv 官方 GitHub release 下载对应平台的包（Windows：`uv-x86_64-pc-windows-msvc.zip`）并解压（Windows 用系统自带的 `tar.exe`）。
2. 安装组件本身：
   - **Office**：下载 `https://github.com/officemcp/officemcp/archive/refs/heads/main.zip`（不需要 git），解压到 `tools/officemcp`，`uv sync` 建 `.venv`，再往里装 `pillow`（`ScreenShot` 工具要用）。
   - **Blender / Unity**：`uv venv` 建独立的 `tools/<组件>/.venv`，`uv pip install` 设置里的包名。
   - **Godot**：同上，`tools/godot/.venv` 里装 `godot-ai`（和 `cryptography`，校验签名用），`.dsh-install.json` 记下装到的版本（之后启动不再联网、不自动升级，「重新安装」才换新版）。再从 GitHub Release `v<同版本>` 下载 `godot-ai-v4-plugin.zip` + 签名清单，用 godot-ai 自带的 `release_verify`（RSA 签名、逐个文件 SHA-256、`plugin.cfg` 版本）校验后解压到 `tools/godot/addon/addons/godot_ai`。插件下载失败不影响服务器安装，「安装插件到项目」时会再试。
   - **Figma / Photoshop / Chrome**（npm 包）：用带 npm 的 Node.js 执行 `npm install <包名> --omit=dev` 到临时目录，检查入口脚本后整体换成 `tools/<组件>`，写 `.dsh-install.json`（包名、版本、入口）；npm 缓存放 `tools/.npm-cache`，装完删除。Photoshop 额外加 `--omit=optional --ignore-scripts`，跳过它只给自带界面用的 claude-agent-sdk（约 235 MB）和 better-sqlite3 原生编译（70 MB 而不是 305 MB，MCP 功能不受影响）。
3. Python（3.12）由 uv 下载到 `tools/python`，缓存放 `tools/.uv-cache`（每次装完会 `uv cache prune --ci`）。不会写用户目录下的 uv 默认目录，也不写注册表。
4. 装完自动重新挂载该组件（如果设置里启用着）。

**Node.js 从哪来**（npm 组件）：插件 `tools/node` → 设置里的 `nodePath`（npm 取同目录的 `node_modules/npm`）→ PATH 上的 node（需 ^20.19 / ^22.12 / 23+）→ DSH Desktop 自带的 Electron（`ELECTRON_RUN_AS_NODE=1`，只能运行、不带 npm）。安装 npm 组件时如果找不到带 npm 的 Node.js，会先从 `https://nodejs.org/dist/latest-v22.x/` 下载 Node.js 22 LTS 的 zip（按 `SHASUMS256.txt` 校验）解压到 `tools/node`，也可以在「通用 → Node.js」里单独装。组件都以 `node <入口脚本>` 启动，不经过 `.cmd`。

安装在后台进行，设置页每 1.5 秒刷新一次进度，「安装日志」可以展开看 uv 的输出；同一时间只跑一个安装，其余排队。「重新安装」会重新下载最新版本覆盖；「卸载」只删除该组件的目录（共用的 `tools/python`、缓存保留）。

下载慢时在「通用 → 下载代理」里填代理（如 `http://127.0.0.1:7890`，先保存再安装）；留空则用环境变量 `HTTPS_PROXY` / `HTTP_PROXY`。代理同时用于插件自己的下载（uv、Node.js、GitHub 源码包）、uv 和 npm（通过 `npm_config_proxy` / `HTTPS_PROXY`）。npm 慢也可以在「通用 → Node.js」里填 npm 镜像。

装好后的目录：

```
tools/
  uv/uv.exe, uvx.exe          uv
  python/cpython-3.12.*       uv 管理的 Python
  .uv-cache/                  uv 缓存
  officemcp/                  OfficeMCP 源码 + .venv（含 pillow）
  blender/.venv/Scripts/mcp-for-blender.exe
  unity/.venv/Scripts/mcp-for-unity.exe
  node/                       Node.js 22（只有找不到带 npm 的 Node.js 时才会下载）
  figma/node_modules/figma-console-mcp/dist/local.js                              约 47 MB
  photoshop/node_modules/@alisaitteke/photoshop-mcp/dist/index.js                 约 70 MB
  chrome/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js    约 14 MB
  godot/.venv/Scripts/godot-ai.exe                                                约 66 MB
  godot/addon/addons/godot_ai/    同版本、已校验的 Godot 编辑器插件（装进项目用）
```

`tools/` 已加进 `.gitignore`。venv 里记录了 Python 的绝对路径，插件目录整体搬走后请「重新安装」。

**启动时的查找顺序**（每个组件）：插件 `tools/` 里的安装 → 设置里填的路径（`uvPath` / `officeRepo`）→ 旧的兜底（WinGet 的 uv、PATH 上的 uv / uvx、插件旁边的 `../officemcp`）。都找不到时状态显示「未安装」，点「下载安装」即可。Blender / Unity 没装进插件但能找到 uvx 时，照旧用 uvx 临时运行；Figma / Photoshop / Chrome 没装进插件但能找到带 npm 的 Node.js 时，用 `npx --yes <包名>` 临时运行（首次联网下载）。Figma 选「官方桌面版 MCP」时不需要安装，直接以 streamable-http 连接设置里的地址（默认 `http://127.0.0.1:3845/mcp`）。

接口（同源）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/dsh-workbench/api/components` | `{ ok, toolsDir, components }`；每项有 `id`（`uv` / `node` / `office` / `blender` / `unity` / `figma` / `photoshop` / `chrome` / `godot`）、`installed`、`version`（插件内置安装的版本）、`note`（组件补充说明，如 Godot 要配的插件版本）、`status`（`connected` / `on` / `off` / `missing` / `error`，uv / node 为 `ready` / `missing`）、`connection`（已启动的组件才有：`{ state: connected / no-app / unreachable / mcp-down / checking, detail, via, checkedAt }`，其余为 `null`）、`source`（`managed` / `setting` / `system` / `bundled` / `remote`）、`detail`、`command`、`install: { state: idle / queued / installing / done / error, step, log, error, startedAt, finishedAt }` |
| POST | `/dsh-workbench/api/components/<id>/install` | 开始（重新）安装，立刻返回 202；正在安装时返回 409 |
| POST | `/dsh-workbench/api/components/<id>/uninstall` | 删除 `tools/` 里该组件的安装（Godot 先结束 `tools/godot` 下还在跑的共享后端） |
| POST | `/dsh-workbench/api/components/godot/addon` | body `{ project }`：把 `tools/godot/addon` 里同版本的插件装进该 Godot 项目的 `addons/godot_ai`，返回 `{ ok, result: { action: installed / replaced / same, target, version, previous, backup }, message, component }`；路径不对 400，没装服务器 / Godot 开着且要换版本 409 |

## 目录

| 路径 | 说明 |
|---|---|
| `src/components.mjs` | 组件定义（怎么启动、怎么安装）与挂载 / 安装管理 |
| `src/connect.mjs` | 「已连接」探测：各组件的程序进程 + MCP 可达性检查 |
| `src/tools.mjs` | `tools/` 目录布局、下载（支持 HTTP 代理）、解压、uv / Node.js / npm 包安装步骤 |
| `src/index.mjs` | 宿主入口：设置、接口（`/dsh-workbench/api/settings`、`/components`）、演示工具 |
| `src/png.mjs` | 零依赖 PNG 编码与演示图渲染 |
| `lib/index.mjs` | 构建产物（宿主入口） |
| `lib/client.js` | 前端半边（手写，直接被 ModuleLoader 加载） |
| `office/launch.py` | OfficeMCP 启动脚本：把它的 print 改到 stderr，避免污染 stdio 协议 |
| `cordis.patch.yml` | bundle 层，插入宿主插件行 |
| `scripts/connect-smoke.mjs` | 「已连接」实机冒烟：用最小 stdio MCP 客户端代替 dsh-mcp-client 拉起真实服务器，验证 Chrome（launch / browserUrl）已连接 ↔ 程序未运行的切换，以及其他组件的当前状态 |
| `scripts/tools-smoke.mjs` | 安装冒烟：走设置页同一套安装代码装组件，再拉起 Blender / Unity / Figma / Photoshop / Chrome / Godot 跑 MCP initialize + tools/list，并试调几个工具（Chrome 用无头 + 临时配置目录打开 example.com、快照、执行脚本、截图；Godot 调只读的 `session_manage` / `editor_state`，再在临时假项目里试「安装插件到项目」）；`--uninstall` 最后走同一套卸载代码 |
| `tools/` | 下载安装的工具（不进 git） |

新增组件：在 `src/components.mjs` 的 `COMPONENTS` 里加一项（`launch(cfg)` 返回 dsh-mcp-client 配置或不启动的原因），在 `src/index.mjs` 的 `SettingsSchema` 加它的设置键，在 `lib/client.js` 的 `INPUT_FIELDS` 加字段、`FEATURES` 加一行（`component` 填组件 id，`keys` 列出它的字段）；要支持「已连接」，在 `src/connect.mjs` 的 `APPS` / `PROBES` 里加它的进程名和探测。

## 构建与测试

```powershell
npm install
npm run build          # 不需要安装 DSH；defineTool 已拷进 vendor/dsh-tools（DSH 升级后可 npm run vendor:sync）
npm run smoke          # 假 ctx 冒烟，生成 lib/smoke.png
npm run smoke:tools    # 把各组件装进 tools/，并验证能响应 MCP initialize / tools/list
                       #   node scripts/tools-smoke.mjs chrome figma --proxy http://127.0.0.1:7890   只装某几个 / 走代理
                       #   node scripts/tools-smoke.mjs node                                          单独装 tools/node
                       #   node scripts/tools-smoke.mjs --skip-install                          只做启动检查
                       #   node scripts/tools-smoke.mjs godot --proxy http://127.0.0.1:7890 --uninstall   装 → 验证 → 卸载
npm run smoke:office   # 按插件的启动方案拉起 OfficeMCP，跑 initialize / tools/list / AvailableApps
                       #   node scripts/office-smoke.mjs --expect-managed   要求用的是 tools/officemcp
npm run smoke:connect  # 「已连接」实机冒烟（Windows）：node scripts/connect-smoke.mjs chrome chrome-url office … godot
```

测试时想装到别处可以设环境变量 `DSH_WORKBENCH_TOOLS_DIR`。

## Office 组件

推荐直接在设置页「下载安装」（见上文）。装好后插件执行的命令是：

```
tools\officemcp\.venv\Scripts\python.exe <插件>\office\launch.py [--folder <工作根目录>]
```

不经 uv、启动时不联网。工作根目录留空时用 OfficeMCP 的默认值 `D:\@OfficeMCP`，没有 D 盘时改用 `文档\OfficeMCP`。

手动方式（旧，仍然支持）：把 OfficeMCP 克隆到插件目录旁边（`git clone https://github.com/officemcp/officemcp ../officemcp`）或在设置里填仓库目录，首次在仓库里 `uv sync`；这时插件执行 `uv run --quiet --directory <officemcp> --with pillow python <插件>/office/launch.py`。

> **注意**：OfficeMCP 的 `RunPython` 工具会用本机 Python 执行模型给出的任意代码（可以操作 Office，也可以读写文件）。不需要时请在设置页关闭 Office 组件。

## Figma / Photoshop / Chrome：需要你做的事

**Figma**（默认「figma-console-mcp」模式）
1. 装 Figma 桌面版（网页版不行），登录。免费计划即可。
2. 在设置页装好并启用 Figma 组件。组件第一次启动时会生成插件清单 `%USERPROFILE%\.figma-console-mcp\plugin\manifest.json`。
3. Figma 桌面版里打开设计文件 →「插件 → 开发 → 从清单导入插件…」选上面的 `manifest.json`（只需一次），然后运行「Figma Desktop Bridge」插件并保持打开。它通过本机 WebSocket（9223–9232 端口）和 MCP 服务器通信。
4. 可选：在「个人访问令牌」里填 `figd_` 开头的令牌（Figma → 设置 → 安全 → 个人访问令牌），启用读取文件 / 变量 / 评论 / 版本历史等 REST 类工具。令牌以环境变量 `FIGMA_ACCESS_TOKEN` 交给子进程。

「官方 Figma 桌面版 MCP」模式：需要付费计划的 **Dev 或 Full 席位**（其他席位每月只有很少的调用次数），在 Figma 桌面版 Dev Mode 里打开「启用桌面版 MCP 服务器」，只读、不能改画布。官方远程服务器（`mcp.figma.com`）要 OAuth 登录，dsh-mcp-client 不支持。

**Photoshop**：本机装 Photoshop（CS6 / 2012 及以上，Windows 走 COM）并开着即可，不需要装任何 Photoshop 插件；只有 `photoshop_neural_filter` 需要它另外的 UXP 插件。Photoshop 没装在默认位置时在「Photoshop 路径」里填 `Photoshop.exe`。服务器的统计和反馈已通过 `ANALYTICS_DISABLED=1`、`PSMCP_FEEDBACK=0` 关闭。

> **注意**：`photoshop_execute_script` 会执行模型给出的任意 ExtendScript；Chrome 的 `evaluate_script` 会在网页里执行模型给出的 JS，模型能看到打开的页面内容（包括已登录网站）。

**Chrome**：本机装 Google Chrome。
- 默认「启动独立的 Chrome」：AI第一次使用此工具时才会启动一个用专用配置目录（`%USERPROFILE%\.cache\chrome-devtools-mcp`，可改）的 Chrome 窗口，不碰你平时的配置；可选无头。
- 「连接正在运行的 Chrome（autoConnect）」：Chrome 144+，先在 `chrome://inspect/#remote-debugging` 打开远程调试，第一次连接 Chrome 会弹窗确认。
- 「连接调试端口」：自己用 `chrome.exe --remote-debugging-port=9222 --user-data-dir=<目录>` 启动后填 `http://127.0.0.1:9222`。
- 「工具集」：标准 30 个；完整（54 个，连接已有 Chrome 时 45 个）再加内存快照、坐标点击（vision）、网页自带的第三方工具，以及（只在独立启动时）扩展与 PWA 工具；精简只有 3 个。已关闭使用统计和更新检查。

## Godot：需要你做的事

1. 本机装 **Godot 4.7 或更新**（godot-ai 4.x 的插件要求 4.7+）。
2. 在设置页「工作组件 → Godot」点「下载安装」。装好后管理页会显示服务器版本和要配的插件版本（两者必须一致）。
3. 把插件装进你的 Godot 项目，二选一：
   - 在「Godot 项目路径」填项目文件夹（里面有 `project.godot`，也可以直接填 `project.godot` 文件），点「安装插件到项目」。它只写这个项目的 `addons/godot_ai`：已经是同版本就不动；版本不同时先把旧的整个挪到 `addons/.godot_ai_backup/<旧版本>-<时间>`（带 `.gdignore`，Godot 不会加载），再放新版本；Godot 开着时拒绝替换，请先关掉 Godot 再点。
   - 手动：从 [GitHub Release](https://github.com/hi-godot/godot-ai/releases) 下载**与服务器同版本**的 `godot-ai-v4-plugin.zip`（不要用 `godot-ai-plugin.zip`，那是 v3 的迁移包），解压到项目根目录，得到 `addons/godot_ai/`。
4. 在 Godot 里打开项目，「项目 → 项目设置 → 插件」勾选 **Godot AI**。
5. 回到设置页打开「启用」。DSH 会用 stdio 启动 `tools\godot\.venv\Scripts\godot-ai.exe attach --port 8000 --ws-port 9500`（已设 `GODOT_AI_DISABLE_TELEMETRY=true`），它再起一个共享的后端（HTTP 8000 给 MCP、WebSocket 9500 给 Godot 插件）；Godot 插件发现已有后端时直接连上去。端口被占用时在「HTTP 端口 / WebSocket 端口」里改，同时要在 Godot 的「编辑器设置 → godot_ai/http_port、ws_port」改成一样的。
6. 状态变成「已连接」就可以用了；连接行会显示项目名和 Godot 版本。

> **注意**：不要在 Godot AI 面板里给 DeepSeek Harness 点「Configure」——DSH 已经通过本组件连上了，再配会往 profile 里多写一份重复的服务器。关掉 Godot 组件或退出 DSH 后，后端会在大约 2 分钟没人用之后自己退出。godot-ai 的工具能改场景、写脚本、运行项目，不需要时请关闭组件。

## 挂进 DSH Desktop

在 `~/.dsh/profiles/desktop` 下：

1. `pnpm add link:<插件目录>`（在 `dependencies` 里加 `"dsh-workbench": "link:<插件目录>"`）
2. `dsh.profile.bundles` 加 `"dsh-workbench"`
3. 如果 profile 的 `cordis.patch.yml` 里原来直接挂了 `serverName: blender` / `unity` 的 dsh-mcp-client，要删掉，否则会重复挂载。

然后**完全退出并重启** DSH Desktop（bundle 列表不会热加载）。
