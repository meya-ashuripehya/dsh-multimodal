/**
 * 组件注册表：加载仓库自带（bundled）与本地（local）组件，汇总 COMPONENTS / APPS / PROBES。
 * 本地目录见 localComponentsDir()（默认 <pluginRoot>/local-components/）。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { localComponentsDir, pluginRoot } from '../tools.mjs'
import office from './office/index.mjs'
import blender from './blender/index.mjs'
import unity from './unity/index.mjs'
import figma from './figma/index.mjs'
import photoshop from './photoshop/index.mjs'
import chrome from './chrome/index.mjs'
import godot from './godot/index.mjs'
import * as officeMod from './office/index.mjs'
import * as blenderMod from './blender/index.mjs'
import * as unityMod from './unity/index.mjs'
import * as figmaMod from './figma/index.mjs'
import * as photoshopMod from './photoshop/index.mjs'
import * as chromeMod from './chrome/index.mjs'
import * as godotMod from './godot/index.mjs'

/** 上游贡献目标仓库（提交 PR / compare 用）。 */
export const CONTRIBUTE_REPO = 'meya-ashuripehya/dsh-multimodal'
export const CONTRIBUTE_COMPARE_URL = `https://github.com/${CONTRIBUTE_REPO}/compare`

const BUNDLED_ENTRIES = [
  { component: office, mod: officeMod },
  { component: blender, mod: blenderMod },
  { component: unity, mod: unityMod },
  { component: figma, mod: figmaMod },
  { component: photoshop, mod: photoshopMod },
  { component: chrome, mod: chromeMod },
  { component: godot, mod: godotMod },
]

function tagBundled(component, mod) {
  const id = component.id
  const moduleDir = join(pluginRoot(), 'src', 'components', id)
  component.moduleSource = 'bundled'
  component.moduleDir = moduleDir
  if (mod?.meta) mod.meta.moduleSource = 'bundled'
  return { component, mod }
}

/**
 * 扫描 local-components/<id>/index.mjs，动态 import。
 * 跳过与 bundled 同 id 的目录（bundled 优先）；加载失败只记 warn，不拖垮宿主。
 * @returns {Promise<Array<{ component: object, mod: object }>>}
 */
export async function discoverLocalComponents(options = {}) {
  const root = options.dir ?? localComponentsDir()
  const log = options.log ?? console.warn
  if (!existsSync(root)) return []
  let names
  try {
    names = readdirSync(root)
  } catch (error) {
    log?.(`dsh-workbench: cannot read local-components dir ${root}: ${error?.message ?? error}`)
    return []
  }
  const out = []
  for (const name of names) {
    const dir = join(root, name)
    let st
    try { st = statSync(dir) } catch { continue }
    if (!st.isDirectory()) continue
    const entry = join(dir, 'index.mjs')
    if (!existsSync(entry)) continue
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      log?.(`dsh-workbench: skip local component "${name}"（id 须为 kebab 小写）`)
      continue
    }
    try {
      const href = pathToFileURL(entry).href
      const mod = await import(href)
      const component = mod.component ?? mod.default
      if (!component?.id) {
        log?.(`dsh-workbench: local ${name}/index.mjs 未导出 component/default`)
        continue
      }
      if (component.id !== name) {
        log?.(`dsh-workbench: local folder "${name}" 与 component.id "${component.id}" 不一致，跳过`)
        continue
      }
      component.moduleSource = 'local'
      component.moduleDir = dir
      if (mod.meta) mod.meta.moduleSource = 'local'
      out.push({ component, mod })
    } catch (error) {
      log?.(`dsh-workbench: failed to load local component ${name}: ${error?.message ?? error}`)
    }
  }
  return out
}

function buildMaps(entries) {
  /** @type {import('./shared.mjs').ComponentModule[]} */
  const COMPONENTS = entries.map((e) => e.component)
  const MODULES = Object.fromEntries(entries.map((e) => [e.component.id, e.mod]))
  const APPS = Object.fromEntries(COMPONENTS.map((c) => [c.id, MODULES[c.id]?.app]).filter(([, a]) => a))
  const PROBES = Object.fromEntries(COMPONENTS.map((c) => [c.id, MODULES[c.id]?.probe]).filter(([, p]) => typeof p === 'function'))
  return { COMPONENTS, MODULES, APPS, PROBES }
}

const bundledTagged = BUNDLED_ENTRIES.map(({ component, mod }) => tagBundled(component, mod))
const bundledIds = new Set(bundledTagged.map((e) => e.component.id))

const localEntries = (await discoverLocalComponents()).filter((e) => {
  if (bundledIds.has(e.component.id)) {
    console.warn(`dsh-workbench: local component id "${e.component.id}" 与仓库自带冲突，忽略本地副本`)
    return false
  }
  return true
})

const { COMPONENTS, MODULES, APPS, PROBES } = buildMaps([...bundledTagged, ...localEntries])

export { COMPONENTS, MODULES, APPS, PROBES }

export function componentById(id) {
  return COMPONENTS.find((c) => c.id === id)
}

/** 贡献 PR 用的说明与文件清单（仅 local；bundled 返回 null）。 */
export function contributeInfo(id) {
  const c = componentById(id)
  if (!c || c.moduleSource !== 'local') return null
  const dir = c.moduleDir
  const rel = `local-components/${c.id}/`
  const target = `src/components/${c.id}/`
  const files = []
  try {
    for (const name of readdirSync(dir)) {
      files.push(`${rel}${name}`)
    }
  } catch { /* ignore */ }
  const checklist = [
    `## 贡献本地组件「${c.label || c.id}」到 ${CONTRIBUTE_REPO}`,
    '',
    '### 清单',
    `- [ ] 将 \`${rel}\` 内容拷到仓库的 \`${target}\`（同一 ComponentModule 接口）`,
    '- [ ] 在 `src/components/registry.mjs` 增加静态 import，并写入 COMPONENTS（顺序即列表顺序）',
    '- [ ] 按需补充 `SettingsSchema`、`lib/client.js` 的 ICONS / FEATURES / INPUT_FIELDS',
    '- [ ] 更新 `docs/component-module.md` / README 组件表（若对外可见）',
    '- [ ] `npm run build`；按需 smoke',
    '- [ ] **不要**把 MCP 包或安装产物放进 PR（tools/ 仍 gitignore）',
    '',
    '### 本地文件',
    ...(files.length ? files.map((f) => `- ${f}`) : [`- ${rel}（请确认目录存在）`]),
    '',
    '### 建议命令（在插件仓库根目录；不会自动 push / 不会 force-push）',
    '```bash',
    `git checkout -b contrib/local-${c.id}`,
    `mkdir -p src/components/${c.id}`,
    `cp -R local-components/${c.id}/. src/components/${c.id}/`,
    '# 编辑 registry.mjs / SettingsSchema / client.js 后：',
    'git add src/components/' + c.id + ' src/components/registry.mjs',
    `git status`,
    `git commit -m "feat: add ${c.id} workbench component"`,
    '# 若已配置自己的 fork remote（例如 origin 指向你的 fork）：',
    `git push -u origin HEAD`,
    `gh pr create --repo ${CONTRIBUTE_REPO} --fill`,
    '```',
    '',
    `Compare（浏览器，默认不带你的 branch）：${CONTRIBUTE_COMPARE_URL}`,
  ].join('\n')
  return {
    id: c.id,
    label: c.label,
    moduleSource: 'local',
    moduleDir: dir,
    files,
    targetDir: target,
    compareUrl: CONTRIBUTE_COMPARE_URL,
    repo: CONTRIBUTE_REPO,
    checklist,
    commands: [
      `git checkout -b contrib/local-${c.id}`,
      `mkdir -p src/components/${c.id} && cp -R local-components/${c.id}/. src/components/${c.id}/`,
      `git add src/components/${c.id} src/components/registry.mjs`,
      `git commit -m "feat: add ${c.id} workbench component"`,
      `git push -u origin HEAD`,
      `gh pr create --repo ${CONTRIBUTE_REPO} --fill`,
    ],
  }
}

export { localComponentsDir }
