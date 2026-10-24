# 更新日志

本文件记录每个版本的功能点（编号见 [ROADMAP](./ROADMAP.md)）、数据 schema 变更与已知问题。

## v0.5.0（2026-10-24）

外观、缓存、性能与全局搜索：个性化外观入口、单篇大笔记的性能上限，以及 Ctrl+K 全局搜索（承接 v1.0 规划的 F-602/F-603 提前实现）。

### 功能

- F-521 外观定制：主题色 6 预设（靛蓝/紫罗兰/翠绿/琥珀/玫红/天蓝）+ 自定义取色（自动派生加深色）；正文字体（系统/衬线/等宽）、预览字号（12–20px）、行宽（窄/中/宽/不限）；顶栏新增齿轮入口打开「设置面板」，品牌强调色统一为 CSS 变量 token（`--color-accent` 等，Tailwind `accent` 语义工具类），全部偏好存 localStorage、重启保持
- F-522 浏览器缓存管理：设置面板新增「缓存与存储」区——存储用量/配额/持久化状态（自数据菜单迁入，数据菜单瘦身为纯备份菜单）、离线缓存（Cache Storage）摘要与一键清理（PWA 预缓存下次激活自动回填）、「清空全部数据」破坏性入口（confirm + 输入「清空」双重确认，提示先备份；单事务清空 IndexedDB 全部表 + 应用 localStorage 键 + 离线缓存后刷新）
- F-523 大文本性能（**schema v4 正文分离**）：notes 表瘦身为元数据 `NoteMeta`（含保存时计算的纯文本摘要 `excerpt`），正文 1:1 拆入新 `contents` 表——启动与列表不再加载任何正文，内存与单篇大小/笔记总量脱钩；正文按需读取（编辑器异步加载，加载完成前禁止保存防空正文覆盖）；预览渲染/大纲/字数统计 250ms 防抖；附件孤儿清理只取 id 不读 Blob 本体；预览 img 惰性加载（loading=lazy）
- F-524 全局搜索（Ctrl+K）：命令面板——标题/标签/摘要内存即时过滤 + 正文 Dexie 游标流式扫描（不载入全部正文；防抖 200ms、陈旧查询事务中止、查询结果 LRU 缓存、命中限额 30 篇/3 处）；标题命中 > 正文命中、正文命中按最近更新排序，命中处 ±40 字摘要与安全高亮；↑↓/Enter/Esc 键盘导航；空查询展示最近笔记与内置动作（新建笔记/打开回收站/切换深浅色）；侧栏搜索框与面板共用同一搜索状态，正文命中并入侧栏列表（无功能回退）
- 界面调整（光效升级，v0.5 反馈迭代）：恢复三色环境光晕并修正初版问题——光斑颜色统一经 alpha 收敛（浅色 0.42/0.36/0.30、深色 0.20/0.15/0.12，初版直接落无透明度 hex 导致过艳遮挡正文），颜色跟随主题预设（自定义取色按色相偏移派生三色）；设置面板新增「环境光晕」开关可一键关闭；保留玻璃边缘渐变高光描边与面板内斜向光带；顶栏由通栏贴边改为浮动圆角玻璃卡（与侧栏/主区一致），备份数据条同步圆角化
- 应用图标：浏览器 favicon 与 PWA/主屏图标更换为自定义封面图——常规尺寸 22% 圆角（`scripts/generate-icons.ps1` 生成，Windows System.Drawing 零依赖）；maskable 与 apple-touch 保持全出血以适配系统遮罩；favicon 由内联 emoji SVG 换为 PNG
- v0.4 体验修正（随本版部署）：F-403 备份提醒「暂不提醒」由仅本会话生效改为 7 天贪睡记忆（localStorage，跨启动生效，超过提醒周期重新提示）；编辑器查看模式（编辑/分栏/预览）持久化，重启与切换笔记后保持

### 数据 schema

- **IndexedDB schema v4 迁移（F-523）**：新增 `contents: 'id'` 表；升级回调把 v3 notes 行的 `content` 全部拆入 contents（含回收站笔记），notes 行重写为元数据并计算 `excerpt`（含 Markdown 剥离）。备份格式 **schemaVersion 2 保持不变**：导出时 join 还原完整 Note，导入时拆分落库，新旧版本互导零影响
- **备份导出恢复语义不变**：全量覆盖导入、快照清空等行为与 v0.4 一致；新增 `backupPort.wipe()`（单事务清空六张表，含 settings）

### 测试

- 新增单测：theme（预设/自定义派生/夹取兜底）、engine（正文扫描命中/摘要/限额/取消/排序）、searchStore（共用状态/缓存）、settingsStore 外观偏好持久化、schema v1/v2/v3 → v4 迁移（含回收站笔记与 excerpt 计算）、backupPort.wipe、saveWithContent/listActiveWithContent/loadContent、缓存 API 降级
- 全量 `npm run test:run` **193 用例**通过；`npm run build`（vue-tsc 类型检查前置）通过，PWA 产物正常

### 已知问题 / 范围外

- 全文搜索无倒排索引：正文命中为流式扫描（每次查询 O(正文总量)），数万篇或 contents 总量 >50MB 时需按 ROADMAP F-604 切换 MiniSearch + 中文 n-gram
- 侧栏搜索的正文命中依赖异步扫描完成，扫描进行中列表先展示标题/摘要命中（渐进更新）；扫描按内容表顺序读取，超大库下正文命中可能出现数百毫秒级延迟
- 快照/保存仍为全文写入（IndexedDB 无增量更新）：单篇正文越大，每次防抖落库与自动快照的写入成本越高，属预期行为
- 「清空全部数据」后页面整页刷新，离线缓存随后台自动回填；清理离线缓存不会登出任何数据（Cache Storage 不含用户数据）
- 设置面板无焦点陷阱（与全项目浮层一致，Esc/点击遮罩关闭）；命令面板 Enter 仅支持笔记跳转与三个内置动作，插件化命令注册留待 F-603/F-605

---

## v0.4.0（2026-10-24）

可靠性与 PWA：把「丢数据」的风险降到最低，并支持离线安装使用。保持纯 Web/PWA 形态，**不做 Electron/Tauri 桌面打包**。

### 功能

- F-401 PWA：`vite-plugin-pwa`（generateSW，v2.0.0）——构建产物全量预缓存（index.html + JS/CSS + 图标 + manifest，共 9 项），`navigateFallback` 支持断网直开；manifest（standalone / 图标 192·512·maskable）支持浏览器「安装到桌面」；图标由 `scripts/generate-icons.mjs` 零依赖生成（SDF 光栅化 + 手写 PNG 编码），`base` 子路径部署由插件自动换算 start_url/scope
- F-402 历史版本快照：编辑器新增「历史版本」面板——**自动快照**挂在自动保存之后，变化字符占比（公共前后缀剥离后的编辑量近似）> 20% 且与任一既有快照不同才落库，首个非空版本即基线；**手动快照**一键存当前草稿；**回滚**带确认，恢复前把当前内容先存为快照（恢复本身可再撤销），恢复后走正常保存路径（updatedAt 刷新、列表重排）；保留上限 **20 条/篇**，超出淘汰最旧
- F-403 备份提醒：距上次全量备份导出 > 7 天（或从未备份）且库中有笔记时，启动显示琥珀色横幅，支持「立即备份」一键导出与「暂不提醒」（记忆为 7 天贪睡，跨启动生效，超过提醒周期重新提示）；`lastBackupAt` 存 IndexedDB settings KV，贪睡时间戳存 localStorage
- 查看模式记忆：编辑器的「编辑 / 分栏 / 预览」选择持久化到 localStorage，重启与切换笔记后保持上次选择
- F-404 版本更新提示：`registerType: 'prompt'`，检测到新版本 Service Worker 后右下角常驻「新版本已就绪 · 刷新更新」，用户确认后重载生效
- F-405 存储持久化申请：启动时 `navigator.storage.persist()`；数据菜单底部展示当前用量/配额与持久化状态，未持久化时提供「申请持久化」重试入口；不支持的环境静默降级
- F-406 孤儿附件清理（承接 v0.3 已知问题）：切换笔记卸载编辑器时，物理删除「正文与全部历史快照都不再引用」的附件（快照回滚依赖附件存在，故被快照引用与被正文引用同等保留）；历史列表未加载完成时跳过清理，宁可暂留不误删

### 数据 schema

- **IndexedDB schema v3 迁移**：新增 `snapshots: 'id, noteId, createdAt'` 表（升级回调为空动作，旧数据零改造）；schema 测试覆盖「v1/v2 老库打开 v3 新表就绪且数据原样」「全新库直接建 v3」
- settings KV 新增 `lastBackupAt`（全量备份导出成功时写入；导入备份、导出 .md zip 均不影响）
- 快照级联语义：彻底删除笔记 / 清空回收站 / 30 天过期清理均在同事务连带删除快照；备份恢复（单事务全量覆盖）清空快照表
- **备份格式保持 schemaVersion 2 不变**：快照是本地编辑历史，不进入备份导出口径（见已知问题）

### 测试

- 新增单测：history（变化字符数/变化率/自动快照阈值边界/上限裁剪）、snapshotRepository（倒序查询/prune/删除，走真实 Dexie 路径）、historyStore（自动快照口径/重复防抖/回滚存档/级联删除/备份恢复清空，fake-indexeddb + 冻结 Date）、backupReminderDue（7 天边界）、backupSnoozeActive 与 settingsStore（「暂不提醒」跨启动贪睡/查看模式记忆）、orphanAttachmentIds（快照引用保留）、formatBytes 与存储 API 降级
- 全量 `npm run test:run` **162 用例**通过；`npm run build`（vue-tsc 类型检查前置）通过，PWA 产物（sw.js + manifest.webmanifest）生成正常
- 构建产物冒烟（vite preview + 浏览器实测）：页面可打开、SW 注册激活、备份提醒横幅展示、历史快照自动/手动/回滚全链路、数据菜单存储用量行均正常

### 已知问题 / 范围外

- **快照不进入备份包**：全量备份不含历史快照，换设备/恢复备份后快照为空。快照定位为「本机后悔药」而非可迁移数据，纳入备份需升级 backup schemaVersion，留待有需求时再做
- 自动快照的变化量为编辑量近似（公共前后缀剥离），非严格 diff；极端场景（如全文乱序但字符集不变）可能低估变化
- 快照只含正文不含标题：回滚仅恢复正文（与快照表结构一致，标题不参与历史）
- F-404 更新提示依赖部署新版本后二次访问：SW 更新检测在页面加载时进行，首次发现新版本时提示，刷新后生效
- E2E（Playwright）仍未落地：断网打开、安装到桌面等验收项为手动执行；本次以构建产物冒烟替代，单测层已覆盖快照/迁移/级联等效逻辑
- 打包体积 1.18MB（gzip 0.42MB）+ workbox-window 5.7KB：拆分/懒加载仍列入 v1.0 的 F-604 性能预算

---

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
