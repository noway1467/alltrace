# AllTrace 寻迹

基于 **Cloudflare Workers + Static Assets** 的聚合识图站。前端使用 React、TypeScript、Vite 和独立 CSS，无数据库、R2、图床或服务器依赖。

## 功能

- 樱色日系界面、深浅主题、手机和平板响应式布局。
- 上传、拖拽、剪贴板粘贴与 HTTPS 图片链接。
- 九个引擎可单独选择，内置结果按动画、插画、全网分类。
- API 请求并行，分别显示加载、匹配、无结果、失败及重试状态。
- 番剧集数和时间点、插画出处、角色候选、相似度与来源链接。
- 只在用户点击搜索后发送图片，不在本站持久保存图片。

## 接入边界（已修正上一版的外链占位）

| 引擎          | 上传文件 | 图片链接 | 结果展示                                                     |
| ------------- | -------- | -------- | ------------------------------------------------------------ |
| trace.moe     | 支持     | 支持     | 动画匹配截图、集数、时间点                                   |
| AnimeTrace    | 支持     | 支持     | 角色候选；AniList / Bangumi 同名作品封面                     |
| SauceNAO      | 支持     | 支持     | 无密钥匿名网页解析；有密钥使用 JSON API                      |
| Yandex Images | 支持     | 支持     | 上传到 yandex.ru 后解析图片和来源页，不需重复上传            |
| ascii2d       | 支持     | 支持     | 浏览器打开带图片地址的检索页，不请求内置检索、不显示内置卡片 |
| IQDB          | 支持     | 支持     | 浏览器打开带图片地址的检索页，不请求内置检索、不显示内置卡片 |
| 百度识图      | 支持     | 支持     | 浏览器打开带图片地址的检索页，不请求内置检索、不显示内置卡片 |
| 搜图 Bot 酱   | 支持     | 支持     | 链接模式由 Worker 安全取回图片，再以文件上传到内置接口       |
| Google Lens   | 支持     | 支持     | 用你的浏览器和网络打开 Lens，结果在新标签页                  |

Google Lens、ascii2d、IQDB 和百度识图只通过浏览器打开检索页，不再并行调用内置搜索接口，也不占用内置结果卡片。上传文件时先生成有效期 10 分钟的临时图片链接；输入图片链接时直接使用该链接。浏览器阻止弹窗时，在上传区提供可手动打开的链接，不把外站占位显示为内置结果。搜图 Bot 酱的链接模式会由 Worker 下载公开图片并校验格式、大小后，再以文件提交给内置接口；不接受需要 Cookie、登录或非 HTTPS 的图片地址。

### 浏览器打开偏好

- **外部搜索 SauceNAO**：默认关闭；开启后 SauceNAO 改走浏览器，不再请求或显示内置结果。保存在 `localStorage` 的 `alltrace-sauce-browser`。
- **外部搜索引擎**：默认关闭；开启后允许选择并通过浏览器打开外部搜索引擎。关闭时取消当前所有外部搜索引擎的勾选并禁用其复选框，包括已切换为外部搜索的 SauceNAO，以及链接模式下的 Bot 酱；不会退回内置请求。“全选”只勾选当前可用的内置引擎。保存在 `localStorage` 的 `alltrace-browser-enabled`，勾选变更也会保存；读取旧偏好时会清除与总开关冲突的勾选。
- 移动端浏览器通常限制一次用户操作只能打开一个标签页，因此一次搜索只自动打开首个外部引擎；其余引擎会在配置区提供手动入口，不再显示为失败状态。
- 切换输入模式或 SauceNAO 打开方式时，勾选会同步按当前能力过滤。重新开启总开关会自动勾回关闭前已选择的外部搜索引擎；若没有可恢复记录，则勾选当前所有可用的外部搜索引擎。
- 若关闭总开关后没有勾选任何引擎，搜索前会提示开启开关或选择内置引擎，不发送请求。偏好影响下一次搜索，已开始的结果按发起时的方式展示。
- 浏览器存储不可用时仍可使用本次开关，只是不保证刷新后保留。

网页解析不是官方 API，可能随改版、地区和限流失效；不执行上游脚本、不自动处理验证码、不使用登录 Cookie。SauceNAO 的可选 API Key 可提高稳定性，但匿名网页已有真实结果，不再因缺少密钥而变成外链。

AnimeTrace 原始接口只返回名称和角色位置，不返回相似图片。配图通过候选作品名精确比对补充，明确标为「作品封面」，不会将封面当作匹配截图；若元数据服务失败或没有同名条目，显示「封面暂缺」。

Bot 酱的特征分不等于相似度百分比，低于原站参考阈值时明确标为低置信度。图库可能含成人内容，SauceNAO / Bot 酱缩略图由结果区总开关控制，默认不加载且偏好保存在浏览器。Bot 酱会在自己的服务保存检索记录，本站不保证第三方不留存。

## 本地运行

推荐 Node.js 24 LTS，最低需满足当前 Vite / Wrangler 的 Node 版本要求。

在项目目录执行：

```powershell
npm ci
npm start
```

打开 **http://127.0.0.1:8787**。此入口先构建前端，再启动真实 Workers 本地运行时，前后端同源。

开发时可打开两个终端：

```powershell
# 终端一：API 与 Worker
npm run build
npm run preview

# 终端二：前端热更新
npm run dev
```

热更新默认地址为 http://127.0.0.1:5173，Vite 将 /api 请求代理到 8787。修改 CSS 和 TSX 后无需手动构建；只运行 npm start 时，修改前端后需要重新执行 npm run build。

### 本地密钥

```powershell
Copy-Item -LiteralPath .dev.vars.example -Destination .dev.vars
```

编辑 .dev.vars 中的 SAUCENAO_API_KEY 和可选的 TRACE_API_KEY，重启 Wrangler。此文件已被 Git 忽略。不要把密钥写入 VITE_ 环境变量或前端源码。

## 部署到 Cloudflare

```powershell
npx wrangler login
npm run deploy

# 需要 SauceNAO 时添加，交互输入不会出现在前端构建中。
npx wrangler secret put SAUCENAO_API_KEY

# 可选：trace.moe 付费或专属额度
npx wrangler secret put TRACE_API_KEY
```

默认 Worker 名为 alltrace，可在 wrangler.jsonc 中修改。部署命令会构建并发布 Worker 和 dist 静态资源，不需要 Pages、KV、D1 或 R2。成功后 Wrangler 返回 workers.dev 地址；自定义域名在 Cloudflare 控制台绑定。

如果使用 Cloudflare Workers Builds，构建命令为 npm run build，部署命令为 npx wrangler deploy。密钥在 Worker 设置的 Variables and Secrets 中配置为 Secret。

当前交付完成了本地验证及 deploy --dry-run；**未登录你的 Cloudflare 账号，也未发布到公网**。

## 安全与隐私

- 原图上限 8 MB；前端解码后限制 4000 万像素，缩小到最长边 2000px，并转为 JPEG 以减小体积及移除 EXIF。GIF 只使用首帧，透明区域铺白色。
- Worker 对请求流、文件头、文件大小、请求类型、Origin 和 Sec-Fetch-Site 做校验。
- 用户 URL 不会由 Worker 下载。仅传给固定、允许的第三方 API；拒绝常见内网地址、IP 字面量、用户名密码、非 HTTPS 和特殊端口。此校验不是通用 DNS 防火墙，不承诺阻止第三方侧所有 DNS 重绑定情况。
- 上游请求总计最多 35 秒，前端等待最多 45 秒；封面查询单独限时 8 秒。JSON 最大 2 MB，HTML 最大 3 MB。网页跳转最多 4 次且只能在各引擎的固定主机白名单内；跳转 GET 不携带文件、Cookie 或密钥，307/308 上传重放直接拒绝。图片与密钥不写入应用日志。
- Workers Rate Limiting 绑定按 IP 约束为 **20 次 API 请求 / 60 秒**，全选一次消耗 6 次。Cloudflare 限流是分布式近似限制，不是严格全局配额锁。
- API 不缓存；静态资源设置 CSP、禁止嵌入、禁止 MIME 嗅探与 Referrer 保护。
- 本站没有公共图床。图片直接上传所选引擎，Yandex / Google 的检索会话由原站维护；本地不保存会话或图片。
- 开始搜索即会把图片或图片地址交给所选第三方；结果缩略图直接加载第三方资源。候选作品名称会发给 AniList / Bangumi 查询封面，不发送原图；成功封面元数据最多缓存 200 项、1 小时，不缓存原图。
- Cloudflare 和第三方服务有各自的隐私政策及存储行为，本站不保证第三方不留存。请不要上传敏感图片。
- 默认尽可能过滤第三方标注的成人结果，但识别标签并不可靠；Bot 酱原站可能包含成人内容。
- 开放公网前，建议结合自身使用方式增加 Cloudflare Access、Turnstile 或其他配额保护。当前默认是公共工具，不包含账户体系，也不能阻止轮换 IP 滥用共享 API 额度。

## 验证

```powershell
npm run check
npm test
npm run build
npx wrangler deploy --dry-run

# 真实网络烟测：先启动 npm start，会使用第三方搜索额度。
node tests/live-smoke.mjs

# 若网络需要环境代理，Node 24 可显式启用：
$env:NO_PROXY = 'localhost,127.0.0.1'
node --use-env-proxy tests/live-smoke.mjs
```

自动化测试覆盖输入校验、限流、跨站请求、密钥保密、网页解析、文件真实转发、重定向白名单、Google 新旧页面结构、Google 验证状态、脚本重试后的浏览器提取、登录 Cookie 隔离、同名封面匹配和封面失败降级。真实烟测使用 trace.moe 官方文档公开示例，检查五引擎文件上传、四引擎图片链接及缩略图字段；Google 单独报告，不能用 attention 或超时冒充通过。

2026-09-25：41 项自动化测试、`npm run check`、`npm run build` 和 `wrangler deploy --dry-run` 通过，dry-run 能看到 Browser Run 绑定。同一天的直连复核仍只得到 `SG_REL` 脚本重试页，没有验证码，也没有可解析结果；按止损规则没有再发起第二次真实 Google 检索，因此浏览器路径尚未用公网结果确认。不能声称 Google Lens 已经稳定可用。未验证 SauceNAO 带密钥真实账号调用、真实部署后的 Browser Run 和完整跨浏览器矩阵。

## 文件结构

- src/main.tsx：页面、上传控件与说明弹窗。
- src/useSearch.ts：图片预处理、并行请求、取消与过期结果保护。
- src/EngineCard.tsx：引擎卡片及结果状态。
- src/engines.ts：引擎元数据与外站链接。
- src/styles.css：设计变量、组件样式、深色模式和响应式。
- worker/index.js：API 路由及 trace / AnimeTrace / SauceNAO API 适配。
- worker/http.js：输入校验、安全链接、请求大小和 API 传输。
- worker/providers.js：匿名网页解析、Bot 酱适配、Google 会话降级、封面补全。
- worker/google-browser.js：仅在脚本重试时打开本次 Google 结果页。
- tests/：单元测试与可选真实网络烟测。
- public/：静态视觉资源、安全响应头。

## 接口与素材出处

- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [trace.moe API](https://soruly.github.io/trace.moe-api/)
- [AnimeTrace 开发文档](https://ai.animedb.cn/api-docs)
- [SauceNAO API 说明](https://saucenao.com/user.php?page=search-api)
- 樱花照片：[Unsplash 原始资源](https://images.unsplash.com/photo-1522383225653-ed111181a951)，采用 [Unsplash License](https://unsplash.com/license)，已本地保存，运行不依赖图片 CDN。
- [Phosphor Icons](https://phosphoricons.com/)：MIT。
- [Nunito Sans](https://fonts.google.com/specimen/Nunito+Sans)：SIL Open Font License，随构建自托管；中文使用系统字体。
