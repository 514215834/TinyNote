# 更新日志

本文件记录每个版本的功能点（编号见 [ROADMAP](./ROADMAP.md)）、数据 schema 变更与已知问题。

## v0.3.0（2026-10-23，待发布）

编辑体验升级：从「能用」到「好用」，并补齐数据安全的出口（备份）。

### 功能

- F-301 CodeMirror 6 编辑器（ADR-004 落地）：`vue-codemirror` 封装为独立组件，对外只暴露 v-model 式接口，store 层不感知；Markdown 语法高亮、自动换行、**行号可选**（统计栏一键开关，偏好存 localStorage）；编辑/预览两侧滚动按**比例联动**（分栏模式）
- F-302 大纲（TOC）：预览态右侧展示标题大纲，点击平滑跳转；标题条目的锚点 id 由纯函数统一生成（`slugify` + 文档序去重 `-1/-2`），与预览 DOM 中写入的 id 完全一致；标题文本剥除行内标记
- F-303 图片粘贴/拖拽：粘贴或拖入图片 → 元数据 + Blob 落入新 `attachments` 表 → 正文光标处插入内部引用 `![名称](tinynote-attachment://<id>)` → 预览经 `env` 注入的 blob URL 映射解析显示；**单附件 ≤ 10MB**，超限/非图片不拦截默认行为；blob URL 与编辑器实例同生命周期（切换笔记 `revokeObjectURL`）；物理删除笔记/清空回收站时**同事务连带删除附件**
- F-304 导出 Markdown：编辑区一键导出当前笔记 `.md`（标题补 `# H1` 首行）；顶栏「导出全部笔记」产出 `tinynote-notes-YYYYMMDD.zip`（`notes/*.md` + README 说明，不含回收站与附件，面向通用可读）
- F-305 全量备份/恢复（backup 格式 schemaVersion 2）：顶栏数据菜单导出 `tinynote-backup-YYYYMMDD.zip`（`manifest.json` + `notes/*.md` + `assets/*`）；导入 zip 或 **v0.1/v0.2 的 legacy JSON** 均走同一校验+迁移管线——`format` 与 `schemaVersion` 校验（v1→v2 补空附件列表，未来版本拒绝并提示升级），恢复为**单事务全量覆盖**，完成后自动刷新列表
- F-306 GFM 增强：预览完整支持**任务列表**（复选框只读，不接受用户 HTML）与**脚注**（`markdown-it-task-lists` / `markdown-it-footnote`）

### 数据 schema

- **IndexedDB schema v2 迁移**：新增 `attachments: 'id, noteId'` 表（升级回调为空动作，旧数据零改造）；schema 测试覆盖「v1 老库打开 v2 表就绪且笔记原样」「全新库直接建 v2」
- 新增 attachmentRepository（get/listByNote/listAll/save/deleteByIds/deleteByNote/replaceAll）
- 新增 backupPort：`snapshot` / `restore`（restore 在单事务内清空+整批写入 notes/folders/attachments）
- 备份格式升级：`BackupFile` 增加可选 `attachments`（`{id, noteId, name, mime, size, createdAt, file}`，`file` 为 zip 内 `assets/<id>.<ext>` 路径）；导入 legacy v1 JSON 自动补空数组

### 测试

- 新增单测：outline（slug 约定/去重 id 与渲染一致）、attachments（准入/引用协议/光标插入）、attachmentRepository（Blob 走真实 Dexie 路径）、backup（校验与 v1→v2 迁移/导出 manifest/**zip 往返导入还原**/附件缺失跳过）、dbSchema（v1→v2 迁移）
- markdown 单测扩展：任务列表、脚注、标题锚点 id 与去重、附件引用解析及缺失占位
- 全量 `npm run test:run` 122 用例通过；`npm run build`（vue-tsc 类型检查前置）通过

### 已知问题 / 范围外

- 正文删除附件引用后，附件记录仍保留（孤儿附件）；备份包体积包含全部历史附件。自动清理留给 v0.4 与快照机制一并设计
- CodeMirror 编辑器内围栏代码块不做嵌套语言高亮（预览侧仍由 highlight.js 负责），保持编辑器包体精简
- 打包体积 1.17MB（gzip 0.41MB），构建提示可拆 chunk；拆分/懒加载列入 v1.0 的 F-604 性能预算
- 滚动联动为「按比例」近似（非按标题偏移）；分栏下首次切换模式时以重新测量兜底
- E2E（Playwright）未落地：验收用例（粘贴图片→清库→备份还原→图片可显示）需手动执行；单测层已覆盖 zip 往返与迁移等效逻辑

---

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
