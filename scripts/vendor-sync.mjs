// 从本机 DSH Desktop 重新同步 vendor/dsh-tools（DSH 升级后用）。
//   npm run vendor:sync
//   DSH_NODE_MODULES=<...\node_modules> npm run vendor:sync
// 只覆盖 schema.js、json-schema.js、util-values.js；harness-error.js 和 README.md 手工维护。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const nm = process.env.DSH_NODE_MODULES ?? 'C:\\Program Files\\DSH Desktop\\resources\\app\\node_modules'
const scope = join(nm, '@deepseek-ai')
const out = join(root, 'vendor', 'dsh-tools')

const files = [
  [join(scope, 'dsh-tools', 'lib', 'types', 'schema.js'), 'schema.js'],
  [join(scope, 'dsh-tools', 'lib', 'types', 'json-schema.js'), 'json-schema.js'],
  [join(scope, 'dsh-util-values', 'lib', 'index.js'), 'util-values.js'],
]
for (const [src] of files) {
  if (!existsSync(src)) {
    console.error(`vendor:sync: 找不到 ${src}\n设置 DSH_NODE_MODULES 指向 DSH Desktop 的 node_modules。`)
    process.exit(1)
  }
}
for (const [src, name] of files) {
  const text = readFileSync(src, 'utf8')
    .replaceAll("from '@deepseek-ai/dsh-llm'", "from './harness-error.js'")
    .replaceAll("from '@deepseek-ai/dsh-util-values'", "from './util-values.js'")
  if (/from ['"]@deepseek-ai\//.test(text)) {
    console.error(`vendor:sync: ${name} 出现新的 @deepseek-ai 依赖，需要手工处理。`)
    process.exit(1)
  }
  writeFileSync(join(out, name), text)
}
const ver = JSON.parse(readFileSync(join(scope, 'dsh-tools', 'package.json'), 'utf8')).version
console.log(`vendor:sync: 已同步 dsh-tools ${ver}，记得更新 vendor/dsh-tools/README.md 里的版本。`)