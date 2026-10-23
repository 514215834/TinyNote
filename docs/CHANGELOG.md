# 更新日志

本文件记录每个版本的功能点（编号见 [ROADMAP](./ROADMAP.md)）、数据 schema 变更与已知问题。

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
