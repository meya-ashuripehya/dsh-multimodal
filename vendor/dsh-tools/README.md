# vendor/dsh-tools

这里是 DSH 自带包里 `defineTool` 及其依赖的原样拷贝，让插件在任何电脑上 `npm install` 后都能直接构建，不再需要安装或解包 DSH Desktop。npm 上发布的 `@deepseek-ai/dsh-tools` 版本太旧，不能直接用。

| 文件 | 来源 | 版本 |
| --- | --- | --- |
| `schema.js` | `@deepseek-ai/dsh-tools/lib/types/schema.js` | 0.1.5-rc.2 |
| `json-schema.js` | `@deepseek-ai/dsh-tools/lib/types/json-schema.js` | 0.1.5-rc.2 |
| `util-values.js` | `@deepseek-ai/dsh-util-values/lib/index.js` | 0.1.5-rc.2 |
| `harness-error.js` | `@deepseek-ai/dsh-llm/lib/types/error.js` 中的 `HarnessError` 类 | 0.1.5-rc.2 |

取自 DSH Desktop 2.0.13（`resources\app\node_modules\@deepseek-ai`）。改动只有一处：`schema.js` 和 `json-schema.js` 的包导入改成了指向同目录的相对路径。以上包均为 MIT 许可。

DSH 升级后如果 `defineTool` 的行为变了，运行 `npm run vendor:sync` 重新同步（默认读取 `C:\Program Files\DSH Desktop\resources\app\node_modules`，可用 `DSH_NODE_MODULES` 覆盖）。