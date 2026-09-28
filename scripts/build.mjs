// 构建宿主半边：src/index.mjs → lib/index.mjs（自包含，零外部依赖）。
// defineTool 取自 DSH 自带的 @deepseek-ai/dsh-tools（npm 上的版本太旧），
// 因此需要一份 DSH Desktop 的 node_modules：默认用解包后的 app.asar。
//   DSH_NODE_MODULES=<...\node_modules> npm run build
// 客户端 lib/client.js 为手写文件，不参与构建。
import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const dshModules = process.env.DSH_NODE_MODULES ?? join(tmpdir(), 'dsh-asar', 'node_modules')
const defineToolEntry = join(dshModules, '@deepseek-ai', 'dsh-tools', 'lib', 'types', 'schema.js')
if (!existsSync(defineToolEntry)) {
  console.error(`build: 找不到 ${defineToolEntry}\n先解包 DSH Desktop 的 app.asar，或设置 DSH_NODE_MODULES。`)
  process.exit(1)
}

await build({
  entryPoints: [join(root, 'src', 'index.mjs')],
  outfile: join(root, 'lib', 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  alias: { '@dsh/define-tool': defineToolEntry },
  nodePaths: [join(root, 'node_modules'), dshModules],
  banner: { js: "import { createRequire as __mmCreateRequire } from 'node:module'; const require = __mmCreateRequire(import.meta.url);" },
  logLevel: 'info',
})
