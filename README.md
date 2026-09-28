# dsh-workbench（工作组件）

DSH 插件，用来统一挂载和管理「控制其他工作软件」的 MCP 服务器。每个工作组件以 `@deepseek-ai/dsh-mcp-client` 子插件的形式挂载：不写进 profile，随本插件卸载，设置改动后只重挂受影响的组件。

| 组件 | MCP 服务器 | 工具名前缀 | 前提 |
|---|---|---|---|
| Office | [OfficeMCP](https://github.com/officemcp/officemcp)（COM） | `mcp__officemcp__` | Windows + Office（Word / Excel / PowerPoint），OfficeMCP 仓库克隆在插件旁边 |
| Blender | `mcp-for-blender`（uvx） | `mcp__blender__` | Blender 开着并启用对应插件 |
| Unity | `mcpforunityserver` 的 `mcp-for-unity`（uvx） | `mcp__unity__` | Unity 编辑器装了 MCP for Unity 包并开着工程 |

计划加入：TRIX-GAMEBOT。

另外保留了早期的出图演示工具 `mm_image_demo`（生成本地演示 PNG，验证 DSH 的图片输出）。

## 设置页

DSH 设置里的「工作组件」页：每个组件一组，包含开关、配置项和运行状态（运行中 / 未启动 / 出错，鼠标悬停可看实际命令）。设置保存在 DSH 设置服务的 `dsh-workbench` 命名空间里。

## 目录

| 路径 | 说明 |
|---|---|
| `src/components.mjs` | 组件定义（怎么启动）与挂载管理 |
| `src/index.mjs` | 宿主入口：设置、接口（`/dsh-workbench/api/settings`、`/components`）、演示工具 |
| `src/png.mjs` | 零依赖 PNG 编码与演示图渲染 |
| `lib/index.mjs` | 构建产物（宿主入口） |
| `lib/client.js` | 前端半边（手写，直接被 ModuleLoader 加载） |
| `office/launch.py` | OfficeMCP 启动脚本：把它的 print 改到 stderr，避免污染 stdio 协议 |
| `cordis.patch.yml` | bundle 层，插入宿主插件行 |

新增组件：在 `src/components.mjs` 的 `COMPONENTS` 里加一项（`launch(cfg)` 返回 dsh-mcp-client 配置或不启动的原因），在 `src/index.mjs` 的 `SettingsSchema` 加它的设置键，在 `lib/client.js` 的 `FIELDS` 加对应字段。

## 构建与测试

```powershell
npm install
npm run build          # 不需要安装 DSH；defineTool 已拷进 vendor/dsh-tools（DSH 升级后可 npm run vendor:sync）
npm run smoke          # 假 ctx 冒烟，生成 lib/smoke.png
npm run smoke:office   # 按插件的启动方案拉起 OfficeMCP，跑 initialize / tools/list / AvailableApps
```

## Office 组件

1. 把 OfficeMCP 克隆到插件目录旁边：`git clone https://github.com/officemcp/officemcp ../officemcp`（或在设置页里填别的目录）。
2. 首次在仓库里跑一次 `uv sync` 预热依赖（OfficeMCP 需要 Python 3.12 以上，uv 会自己准备）。代理慢时可设 `UV_HTTP_TIMEOUT=600`；插件启动组件时已经带上这个变量。
3. 插件实际执行的命令：

```
uv run --quiet --directory <officemcp> --with pillow python <插件>/office/launch.py [--folder <工作根目录>]
```

`--with pillow` 是给 `ScreenShot` 工具用的（OfficeMCP 没把 Pillow 列进依赖）。

> **注意**：OfficeMCP 的 `RunPython` 工具会用本机 Python 执行模型给出的任意代码（可以操作 Office，也可以读写文件）。不需要时请在设置页关闭 Office 组件。

## 挂进 DSH Desktop

在 `~/.dsh/profiles/desktop` 下：

1. `pnpm add link:<插件目录>`（在 `dependencies` 里加 `"dsh-workbench": "link:<插件目录>"`）
2. `dsh.profile.bundles` 加 `"dsh-workbench"`
3. 如果 profile 的 `cordis.patch.yml` 里原来直接挂了 `serverName: blender` / `unity` 的 dsh-mcp-client，要删掉，否则会重复挂载。

然后**完全退出并重启** DSH Desktop（bundle 列表不会热加载）。
