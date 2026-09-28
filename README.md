# dsh-multimodal（雏形）

DSH 多模态插件的最小骨架。现在只有两样东西：

- **设置页**：宿主用 `ctx.settings.register('dsh-multimodal', schema)` 注册配置命名空间；前端在 `settings.section` 挂「多模态」页面，经同源接口 `/dsh-multimodal/api/settings` 读写。
- **图片输出测试**：工具 `mm_image_demo` 在 Node 端生成一张演示 PNG，经 `attachments.saveImage` 存成持久图片，工具结果带 `image` block；前端按工具名在 `tool.call.toolview` 注册卡片，用 `loadImage` 显示图片。

## 目录

| 路径 | 说明 |
|---|---|
| `src/index.mjs` | 宿主半边源码（设置、接口、工具） |
| `src/png.mjs` | 零依赖 PNG 编码与演示图渲染 |
| `lib/index.mjs` | 构建产物（宿主入口） |
| `lib/client.js` | 前端半边（手写，直接被 ModuleLoader 加载） |
| `cordis.patch.yml` | bundle 层，插入宿主插件行 |

## 构建

```powershell
npm install
npm run build   # 不需要安装 DSH；defineTool 已拷进 vendor/dsh-tools（DSH 升级后可 npm run vendor:sync）
npm run smoke   # 假 ctx 冒烟，生成 lib/smoke.png
```

## 挂进 DSH Desktop

在 `~/.dsh/profiles/desktop/package.json` 里：

1. `dependencies` 加 `"dsh-multimodal": "link:C:/Project/dsh-plugins/dsh-multimodal"`
2. `dsh.profile.bundles` 加 `"dsh-multimodal"`

然后在该目录执行 `pnpm install`，重启 DSH Desktop（或用 super-injector 热注入）。

## 下一步

- 真实生图提供方（`imageProvider: openai-compatible`），API key 走 credentials 而不是明文设置
- `mm_search`（复用 `ctx.web`）与 `mm_route`（宿主拼瓦片出静态路线图）
