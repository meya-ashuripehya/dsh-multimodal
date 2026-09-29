# 工作组件模块约定

本文约定 `src/components/<id>/` 的目录布局与稳定接口。目标：每个工作组件自洽（启动、安装、已连接探测、设置键），宿主只负责加载与注册；行为与改前一致。

> **非目标**：不把「下载安装」落地的包放进 `src/`；`tools/` 仍是运行时目录（gitignore）。uv / Node.js 是通用前置，不做成工作组件文件夹（仍由宿主安装队列管理）。

相关入口：`src/components/index.mjs`（注册表 + 管理器）、`src/connect.mjs`（探测汇总）、`src/tools.mjs`（下载 / venv / npm 原语）、`lib/client.js`（设置页 UI，手写，需与模块 meta / 字段说明保持同步）。

---

## 目录布局

```
src/components/
  index.mjs           # 对外导出：COMPONENTS、createComponentManager、resolve*
  registry.mjs        # 加载 bundled + local，汇总 COMPONENTS / APPS / PROBES
  shared.mjs          # 共享：stdio/http、resolveUv/Node/npm、npmLaunch…
  manager.mjs         # 挂载、安装队列、list / install / uninstall / addon
  <id>/
    index.mjs         # 仓库自带（bundled）组件模块

local-components/     # 用户本地兼容（local；gitignore；默认可写）
  <id>/
    index.mjs         # 与 bundled 同一 ComponentModule 接口；registry 自动发现
```

可选（复杂组件可再拆，当前实现多合在 `index.mjs`）：

| 文件 | 用途 |
| --- | --- |
| `meta` 段 / `export const meta` | id、title、group、url、serverName、summary（图标仍在 `lib/client.js` 的 `ICONS`） |
| `install` | `component.install` |
| `launch` | `component.launch` + 专用 args（如 `chromeArgs` / `godotArgs` 可放 shared 或本目录） |
| `probe` | `export async function probe` + `export const app` |
| 设置 | `component.keys`；字段文案 / schema 说明见模块注释与 `lib/client.js` 的 `INPUT_FIELDS` |

命名：`id` 使用 **kebab 小写**，与现有一致：`office`、`blender`、`unity`、`figma`、`photoshop`、`chrome`、`godot`。`tools/<id>/`、API `/components/<id>/…`、设置键前缀（如 `chromeEnabled`）均对齐该 id。

---

## 稳定接口（组件模块必须导出）

```ts
/** 进程匹配（已连接 (a)） */
export type AppMatch = {
  name: string    // 人类可读，如「Blender」
  exe: string     // 提示用，如 blender.exe
  match: RegExp   // 对 listProcesses() 返回的小写进程名
}

/** 探测上下文（只读，不拉起程序） */
export type ProbeCtx = {
  cfg: object
  tools: unknown
  env: object           // defaultEnv 可覆盖
  procs: () => Promise<Set<string>>
}

export type LaunchPlan =
  | { ok: true, source: string, config: object, runtime?: string, via?: string, viaUvx?: boolean }
  | { ok: false, reason: string, missing?: boolean }

/**
 * 注册给宿主的组件对象（COMPONENTS 数组元素）
 * @typedef {object} ComponentModule
 * @property {string} id
 * @property {string} label
 * @property {string} [url]
 * @property {string} serverName   // 工具前缀 mcp__<serverName>__
 * @property {string} summary
 * @property {'bundled'|'local'} [moduleSource]
 * @property {string} [moduleDir]
 * @property {'node'} [runtime]    // 缺省 Python/uv；node → npm
 * @property {string[]} keys       // 变更后需重挂的设置键
 * @property {(cfg)=>string} [spec]
 * @property {string} [bin]
 * @property {string[]} [installArgs]
 * @property {(cfg?)=>boolean} installed
 * @property {(cfg, task, hooks)=>Promise} [install]
 * @property {(cfg)=>LaunchPlan} launch
 * @property {(cfg)=>string|null} [note]
 * @property {(log?)=>Promise} [beforeRemove]
 * @property {(cfg, project, opts?)=>Promise} [installAddon]  // 如 Godot 装插件到项目
 */
```

每个 `src/components/<id>/index.mjs` **至少**导出：

| 导出 | 说明 |
| --- | --- |
| `id` | 与文件夹名相同 |
| `meta` | `{ id, title, group, url?, serverName, summary }` |
| `app` | `AppMatch`，供进程探测 |
| `probe(ctx)` | 已连接探测；绑定 `this` 为 component；用 `connect-lib` 原语 |
| `component` / `default` | `ComponentModule`，供 `COMPONENTS` 注册 |

宿主通过 `registry.mjs` 收集后：

- `createComponentManager` 按 `component.launch` / `install` 挂载与安装
- `probeComponent` 调 `PROBES[id]`（即各模块的 `probe`）
- `GET /components` 的 `url` 来自 `component.url`

---

## 什么留在共享层

| 共享 | 位置 | 职责 |
| --- | --- | --- |
| 安装队列 / suspend·resume | `manager.mjs` | 串行安装、替换前停挂、装完重挂 |
| HTTP 路由 | `src/index.mjs` | `/settings`、`/components`、`install`/`uninstall`/`addon`、`/assets` |
| 设置壳 | `src/index.mjs` `SettingsSchema` + `lib/client.js` | schema 与 UI；字段键与组件 `keys` 对齐 |
| 下载 / venv / npm 原语 | `src/tools.mjs` | `installUv`、`installNode`、`installVenvTool`、`installNpmPackage`、`installOffice`、Godot addon 校验等 |
| 进程列表 / TCP / MCP 调用 | `src/connect-lib.mjs` | `listProcesses`、`tcpOpen`、`callMcpTool`、`listPages`… |
| 解析与 stdio 封装 | `components/shared.mjs` | `resolveUv`/`resolveNode`/`npmLaunch`/`stdio`/`http` |

uv、Node.js 在 `manager.list()` 里以 `kind: 'prerequisite'` 出现，**不要**放到 `src/components/uv`（除非未来明确要做成可插拔「工具行」）。

---

## 本地 vs 仓库自带

| | 仓库自带（bundled / 已兼容） | 本地兼容（local） |
| --- | --- | --- |
| 路径 | `src/components/<id>/`（进 git） | `local-components/<id>/`（默认；gitignore） |
| 标记 | `moduleSource: 'bundled'`（registry 写入） | `moduleSource: 'local'` |
| 发现 | `registry.mjs` 静态 import | 启动时扫描目录并 `import()` |
| 设置页 | 「工作组件」分组，徽标「仓库自带」 | 「本地兼容」分组，徽标「本地」；管理页可「贡献到仓库」 |
| 覆盖 | — | 与 bundled **同 id 时 bundled 优先**，本地被忽略 |

**为何用 `local-components/` 而不是 `tools/` 或 `%APPDATA%`：**

- `tools/` 是「下载安装」落地的运行时目录（MCP 包、uv、Node…），与**源码模块**不同；AI / 用户写入的兼容模块不应混进去。
- 默认放在插件根下 `local-components/`，和 `src/components/` 结构对称，方便对照与拷贝进 PR。
- 可用环境变量 `DSH_WORKBENCH_LOCAL_COMPONENTS_DIR` 改到持久位置（例如 `%APPDATA%\dsh-workbench\local-components`），以免插件目录被替换时丢掉本地模块。

**不要**在「添加工作组件」AI 流程里自动往 `tools/` 下载 MCP；本地 = 磁盘上的源码模块，安装仍由用户在设置页触发。

### 提交 PR（本地 → 仓库）

设置页本地组件管理页提供「复制 PR 清单」「打开 Compare」。安全默认：

- 复制清单 + `git` / `gh` 命令模板，打开 https://github.com/meya-ashuripehya/dsh-multimodal/compare
- **不**自动 commit / push / force-push；**不**在未确认时跑 `gh pr create`
- API：`GET /dsh-workbench/api/components/<id>/contribute`

合并进仓库时：把 `local-components/<id>/` 拷到 `src/components/<id>/`，再按下面「合入仓库」清单改 registry / schema / client。

---

## 新增组件检查清单

### A. 先做本地兼容（推荐；设置页「添加工作组件」提示词走这条）

1. 建目录 `local-components/<id>/`，实现 `index.mjs`（`meta` / `app` / `probe` / `component`）。
2. 重启 / 重载插件后应出现在设置页「本地兼容」；**不要**改 `registry.mjs` 静态表。
3. **不要**把 MCP 下载进 `tools/`（除非用户在 UI 点「下载安装」）。
4. 满意后用管理页「贡献到仓库」复制清单，开 PR。

### B. 合入仓库（bundled）

1. 将模块放到 `src/components/<id>/`，在 `registry.mjs` 增加 import 并写入 `COMPONENTS`。
2. 在 `src/index.mjs` 的 `SettingsSchema` 增加默认键（`<id>Enabled`、包名、端口等）。
3. 在 `lib/client.js` 增加 `INPUT_FIELDS`、`FEATURES` 行与 `ICONS`（图标暂不强制进模块）；`FEATURES` 上标 `moduleSource: "bundled"`。
4. 若有静态资源：放 `assets/`，经 `/dsh-workbench/assets/*` 提供。
5. 若有「装进项目」类动作：实现 `installAddon`。
6. `npm run build`；按需 smoke。
7. 更新本文件与 README 组件表；删除或停止使用对应的 `local-components/<id>/`。

---

## 与前端的关系

`lib/client.js` 仍由 ModuleLoader 直接加载，**不**从 `src/components` 打包。约定：

- `FEATURES[].id` / `component` / `url` 与模块 `meta` 一致
- `INPUT_FIELDS` 的 key 覆盖该组件管理页字段，且重挂相关键 ⊆ `component.keys`（可另含仅 UI 用的键，如 `godotProject`）

日后若要「UI 也模块化」，可把 `settingsFields` 从模块导出再生成客户端数据；当前以同步手写文案为准。

---

## 反例

- 在 `src/components/<id>/` 里 vendor 上游 npm/PyPI 包或解压 Godot 插件 zip → 应落在 `tools/<id>/`
- 在探测里调用会拉起目标程序的工具（例如 Chrome `list_pages` 在 profile 未占用时）
- 随意改 `id` / `serverName`（会破坏工具名前缀与已存设置）
