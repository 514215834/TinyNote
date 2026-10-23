# 更新日志

本文件记录每个版本的功能点（编号见 [ROADMAP](./ROADMAP.md)）、数据 schema 变更与已知问题。

## v0.2.0（2026-10-23，待发布）

组织与效率：笔记超过几十篇后依然找得到、管得住。

### 功能

- F-201 文件夹（单层）：侧边栏文件夹树（全部笔记 + 未分类数据不单独成视图），支持新建 / 重命名 / 删除；**拖拽或悬浮菜单**移动笔记；删除文件夹时其中笔记单事务移回未分类；在文件夹视图下新建的笔记自动归入该文件夹
- F-202 标签：编辑器内打标签（回车添加、× 移除，中英文逗号/空格分隔、大小写不敏感去重），侧边栏标签云展示频次并点击过滤
- F-203 置顶：列表项与编辑页均可置顶/取消，置顶笔记在列表最前（组内保持更新时间倒序）
- F-204 回收站：新增 `/trash` 路由视图，支持单条恢复 / 彻底删除 / 一键清空；**进入回收站超 30 天的笔记在应用启动时惰性物理清理**（判断逻辑可在单测中注入当前时间）；恢复只清软删标记，笔记回到原文件夹且标签完整（repository 层保证）
- F-205 搜索增强：命中关键词高亮（按片段渲染 `<mark>`，不走 v-html，符合 ADR-006）、按文件夹/标签前置过滤、显示结果数
- F-206 快捷键：`Ctrl+N` 新建、`Ctrl+K` 聚焦搜索、`Ctrl+E` 编辑/预览切换、`Ctrl+D` 删除选中笔记（带确认）；⌘ 键等价 Ctrl
- F-207 统计信息：编辑区底栏展示字数（CJK 逐字计 + 拉丁整词计）/字符数与创建、更新时间

### 数据 schema

- **无变更（沿用 schema v1）**：`folderId`/`*tags`/`pinned`/`trashedAt` 字段与索引在 v0.1 已创建，本版本仅启用写入
- 新增 folderRepository：文件夹 CRUD；删除文件夹在单事务内把其下笔记 `folderId` 置 null
- 新增 noteRepository 回收站能力：`listTrashed` / `restore` / `deleteForever` / `emptyTrash` / `purgeExpiredBefore`

### 测试

- 新增单测：folders（删除文件夹连带笔记回归未分类，走真实 Dexie 路径）、trash（30 天清理边界注入当前时间、恢复保留原文件夹与标签）、tags、highlight、shortcuts（含 ⌘ 与严格 shift/alt 匹配）、stats（字数口径）
- 全量 `npm run test:run` 77 用例通过；`npm run build`（vue-tsc 类型检查前置）通过

### 已知问题 / 范围外

- `Ctrl+N` 等组合在 Chrome 中被浏览器保留时页面无法拦截，可用界面按钮替代；`Ctrl+D` 会先弹出确认，不会误删
- 全量备份导出/导入仍在 v0.3 提供（F-305）；本版本清浏览器数据仍会丢失笔记与文件夹，属已知风险窗口
- 文件夹按创建顺序排列，暂不支持手动排序；标签不支持编辑器内全文点击跳转等高级交互

---

## v0.1.0（2026-10-23，待发布）

首个可用版本（MVP：能记）。

### 功能

- F-101 笔记新建 / 编辑 / 删除（删除走确认弹窗，数据层软删除，为 v0.2 回收站铺路）
- F-102 自动保存：输入防抖 800ms + 失焦立即保存 + 关页兜底 flush，含保存状态指示
- F-103 Markdown 预览：markdown-it（`html: false` 安全基线）+ highlight.js 代码高亮 + GFM 表格/删除线；编辑 / 分栏 / 预览三模式
- F-104 笔记列表：按更新时间倒序，标题（缺失时回退正文首行）+ 摘要 + 相对时间
- F-105 全文搜索：大小写不敏感，标题命中优先，输入防抖 200ms
- F-106 深浅色主题：默认跟随系统，可手动切换（@vueuse/core `useDark`）
- F-107 数据落 IndexedDB（Dexie，schema v1）

### 工程

- Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS 4
- 单元测试：领域纯函数（搜索/摘要/时间）+ Markdown 安全（原始 HTML 转义）+ 存储层（fake-indexeddb 跑真实 Dexie 路径）
- GitHub Actions 部署流水线：`npm ci` → `npm run test:run` 门禁 → `npm run build`（类型检查前置）→ 发布 Pages

### 数据 schema

- IndexedDB schema **v1**（库名 `tinynote`）：`notes: 'id, folderId, updatedAt, *tags, trashedAt'`、`folders: 'id, name, order'`、`settings: 'key'`
- 说明：`trashed` 布尔字段不进索引（IndexedDB 键不支持 boolean/null），回收站查询走 `trashedAt` 数值索引（ADR-008）

### 已知问题 / 范围外

- 回收站仅有数据层（软删标记），恢复 UI 在 v0.2 提供
- 备份导出/导入在 v0.3 提供；此版本数据仅存本机浏览器，清浏览器数据会丢失笔记
