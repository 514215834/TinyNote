# TinyNote

部署在 GitHub Pages 上的**本地优先（local-first）Markdown 笔记应用**：纯前端（Vue 3 + TypeScript）、无后端，笔记数据全部保存在你自己的浏览器中，随时可导出带走。

## ✨ 功能（v0.2）

- Markdown 笔记新建 / 编辑 / 删除（软删除）
- **文件夹**（单层）：侧边栏管理、拖拽或菜单移动笔记、删除后笔记自动移回未分类
- **标签**：编辑器内打标签，侧边栏标签云点击过滤
- **置顶**：重要笔记固定在列表最前
- **回收站**：恢复 / 彻底删除 / 清空，进入超 30 天启动时自动清理
- **自动保存**：输入防抖 + 失焦即存 + 关页兜底，无需手动保存
- 编辑 / 分栏 / 预览三种模式，代码块高亮，GFM 表格与删除线
- **搜索增强**：关键词高亮、按文件夹/标签过滤、显示结果数（标题命中优先）
- **快捷键**：`Ctrl+N` 新建 · `Ctrl+K` 搜索 · `Ctrl+E` 预览 · `Ctrl+D` 删除
- **统计信息**：字数 / 字符数、创建与更新时间
- 深浅色主题：跟随系统，可手动切换
- 数据存 IndexedDB，纯本地，不出浏览器

## 📚 文档导航

| 文档 | 内容 |
| --- | --- |
| [技术架构文档](./docs/ARCHITECTURE.md) | 技术选型、分层架构、数据模型与 schema 迁移、部署方案、ADR 决策记录 |
| [功能点迭代文档](./docs/ROADMAP.md) | v0.1 → v1.0 的功能点清单，每个功能带编号与验收标准 |
| [CHANGELOG](./docs/CHANGELOG.md) | 每个版本的变更与数据 schema 变更记录 |

## 🛠 技术栈

Vue 3（`<script setup>` + TS）· Pinia · vue-router（Hash）· Dexie/IndexedDB · markdown-it + highlight.js · Tailwind CSS 4 · Vite · Vitest

## 快速开始

```bash
npm install
npm run dev        # 本地开发 http://localhost:5173
npm run test:run   # 单元测试
npm run build      # 类型检查（vue-tsc）+ 构建，产物在 dist/
npm run preview    # 本地预览构建产物
```

## 部署到 GitHub Pages

push 到 `main` 分支后，[deploy.yml](./.github/workflows/deploy.yml) 会自动执行：`npm ci` → 测试门禁 → 构建（自动注入 `VITE_BASE=/<仓库名>/`）→ 发布到 GitHub Pages。只需在仓库 **Settings → Pages → Source** 中选择 **GitHub Actions**。

## 设计要点

- **纯静态可部署**：GitHub Pages 托管，Hash 路由 + `base` 子路径适配，无任何服务端依赖。
- **local-first**：核心数据存 IndexedDB（Dexie），localStorage 只存 UI 偏好；离线可用。
- **可迭代架构**：Repository 数据层抽象（存储实现可替换）+ 数据 schema 版本化迁移（只增不破）。
- **数据安全出口**：软删除 + 全量备份导出/导入 + （远期）Gist 同步，不丢数据是每个版本的发布前提。

## 迭代路线

当前进度：**v0.2 已实现**。后续：v0.3 编辑体验（CodeMirror/附件/备份）→ v0.4 可靠性（PWA/历史版本）→ v0.5 同步 → v1.0 打磨。详见 [ROADMAP](./docs/ROADMAP.md)。
