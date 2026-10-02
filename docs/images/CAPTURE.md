# Screenshot capture checklist（实装截图）

Target DSH Web UI (profile `workbench`, only this plugin):

```
http://127.0.0.1:3080/?token=<token-from-dsh-web>
```

Box token used during prep (rotate if expired):
`r7vn9jWMmPRwuVPGadrNUYXDsMOZ7qWJCNHtnY1PTAk`

Save PNGs into this folder (`docs/images/`). Filenames must match README links.

## Prep

1. Prefer a **fresh** settings state so all work-component switches show **未启用 / 关**（schema defaults）。若当前 profile 已持久化过 `*Enabled: true`，可临时 POST 全 false，或新建空 profile。
2. Rebuild + restart DSH after default-off change so `/dsh-workbench/api/settings` returns all `*Enabled: false`.
3. Window ~1280×800 or larger; light theme if available; hide personal tokens in any field.

## Shots（README 只收录 01）

| # | Filename | Alt / README | Navigation | What to show |
|---|----------|--------------|------------|--------------|
| 01 | `01-settings-workbench-list.png` | 工作组件列表 | Open Settings（齿轮）→ 左侧/分区选 **「工作组件」** | 首页功能列表：多模态 / 工作组件 / 通用 / 基础工具；行尾状态多为「未启用」；可见「仓库自带」等徽标 |

README「实装截图」表只链这一张。补拍其它页可先存本地，不必写进 README。

## Optional extras（不进 README 也可先存）

- `02-component-detail-disabled.png` — 单个工作组件管理页（启用关）
- `03-runtime-uv-node.png` — 通用·运行时
- `04-session-controls-off.png` — 会话控制（实验性）主开关关
- `05-multimodal-image-settings.png` — 多模态「媒体卡片」管理页
- `06-mm-send-image-card.png` — 对话里 `mm_send_image` MmCard（优先于 demo）
- `07-add-component-prompt.png` — 「添加工作组件」提示词工具页
- `08-maturity-chips.png` — 列表里「已验证 / 实验性」芯片特写
- `09-component-list-scroll.png` — 工作组件长列表滚到底（Notion…Obsidian）

## After capture

- Confirm `docs/images/01-settings-workbench-list.png` exists on both Ashuripehya `S:\TRIX\dsh-workbench` and box `/workspace/dsh-workbench`.
- Unused PNGs `02`–`07` should not remain in-tree unless you intentionally keep optional extras.
- README「实装截图」表应自动显示；破图则检查路径与文件名。
