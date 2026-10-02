# AllTrace 项目代理规范

本文件适用于当前项目及其所有子目录。它补充全局 `AGENTS.md`，并优先约束本项目的工具调用、验证、部署和止损方式。若与系统或开发者指令冲突，以系统/开发者指令为准。

## 1. 项目边界

- AllTrace 是基于 Cloudflare Workers + Static Assets 的聚合识图站。
- 前端：React + TypeScript + Vite，入口为 `src/main.tsx`。
- Worker：`worker/index.js` 负责路由和 API 适配，`worker/http.js` 负责输入与传输安全，`worker/providers.js` 负责网页/API 解析。
- 测试：`tests/*.test.js` 为 Node 单测，`tests/live-smoke.mjs` 为真实网络烟测。
- 部署：Worker 名为 `alltrace`，生产地址为 `https://alltrace.account-fae.workers.dev`。
- 当前目录不是 Git 仓库。不要无意义执行 `git status`、`git diff`、`git log`。

## 2. 工作方式

- 默认使用简体中文交流、注释、文档和提交说明。
- 修改前先读相关文件，搜索调用链、测试和配置；不要未读代码就直接改。
- 支持任务性质判断：用户只要计划、解释或评审时，不擅自改源代码。
- 只修改任务相关文件，不顺手格式化整个仓库，不改无关锁文件和生成物。
- 手工改文件必须使用补丁式工具；不要用 PowerShell 重定向覆盖源码。
- 新增或修改行为后，按“静态检查 -> 单测 -> 构建 -> 必要时烟测/部署”验证。
- 不重复执行已经证明会失败或超时的同一命令。先定位失败类型，再决定是否重试。

## 3. Windows 工具调用硬规则

### 3.1 Shell 必须统一

- 本项目运行在 Windows PowerShell 环境。
- `exec_command` 必须显式使用 `shell: "powershell"`。
- 禁止使用 `shell: "bash"`、Bash 语法、Unix 路径重定向或 `cmd /c`。
- 看到 `'$var' is not recognized as an internal or external command`，说明命令落到了 `cmd` 或错误 shell。不要继续改写同一条命令；直接改成显式 PowerShell 后重跑一次。
- 看到 `'try' is not recognized`、`'Sort-Object' is not recognized` 等同类错误，按上一条处理。

### 3.2 PowerShell 命令规范

- 读文件用 `Get-Content -LiteralPath`，不要用 `cat`、`type`。
- 检查路径用 `Test-Path -LiteralPath`。
- 路径可能含中文、空格或特殊字符时，必须使用 `-LiteralPath`。
- 删除单个临时文件前先解析并确认路径位于 `$env:TEMP`；禁止对未核验路径递归删除。
- 后台启动程序时使用隐藏窗口；`wrangler dev` / `npm run preview` 这类需要持续读输出的进程优先使用 PTY。
- 不要把多个独立动作用分号硬拼给 `npx`、`npm` 或 `curl.exe`。例如 `npx prettier --write file; npm run build` 会把后续参数误当文件。
- 一条 `exec_command` 只做一件主要事情；需要连续动作时拆成多个调用，或使用明确的 PowerShell 脚本块。

### 3.3 搜索命令规范

- 列文件优先：`rg --files -g '!node_modules/**' -g '!dist/**'`。
- 搜内容优先：`rg -n -C 5 'pattern' src worker tests`。
- 多个备选文本使用多个 `-e`：

```powershell
rg -n -e '独立检索' -e '使用指南' -e '每一份心动' src worker tests
```

- PowerShell 下不要在双引号正则里直接塞 `|`，容易出现参数解析问题；优先使用单引号或多个 `-e`。
- `rg` 返回退出码 1 仅表示“没有匹配”，不是命令失败。确认搜索范围正确后，不要重复执行同一条命令。

### 3.4 补丁工具规范

- 使用 `apply_patch` 时，补丁必须作为单个 UTF-8 参数传入，不要把多行补丁直接管道给 `.bat` 包装器。
- 若 `apply_patch` 报 `requires a UTF-8 PATCH argument` 或 `last line must be '*** End Patch'`，改用当前 Codex 可执行文件调用：

```powershell
$patch = @'
*** Begin Patch
*** Update File: path/to/file
@@
- old
+ new
*** End Patch
'@ -join "`n"
$codexExe = (Get-ChildItem -LiteralPath "$env:LOCALAPPDATA\OpenAI\Codex\bin" -Filter 'codex.exe' -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
& $codexExe --codex-run-as-apply-patch $patch
```

- Codex 安装目录哈希可能变化；优先使用当前会话实际可用的 `codex.exe` 路径，不要假设旧路径永久有效。
- 不要用临时脚本、字符串拼接或重定向生成项目源码。

### 3.5 网络与临时文件

- Node 直连需要系统代理时使用 `node --use-env-proxy --input-type=module`；普通 Node `fetch` 不保证继承代理环境变量。
- `curl.exe` 参数在 PowerShell 中使用单引号，例如：

```powershell
curl.exe --max-time 30 -sS -H 'Origin: http://127.0.0.1:8787' -F 'image=@public/assets/sakura.jpg;type=image/jpeg' 'http://127.0.0.1:8787/api/search/google'
```

- `curl.exe` 退出码 3 通常表示 URL/参数引号错误。不要原样重试，先修正 PowerShell 引号。
- 临时文件只放 `$env:TEMP`，任务结束必须清理。若 `Remove-Item` 被策略拦截，可在核验路径位于临时目录后使用 `[IO.File]::Delete()`。
- 不下载远程图片或媒体来绕开展示限制。

## 4. 退出码与失败含义

| 命令/结果                        | 含义                          | 正确处理                            |
| -------------------------------- | ----------------------------- | ----------------------------------- |
| `rg` 退出码 1                    | 没有匹配                      | 确认范围后接受结果，不重试同一命令  |
| `prettier --check` 退出码 1      | 格式不一致                    | 只对相关文件执行 `prettier --write` |
| `npm run check` 非 0             | TypeScript 错误               | 读取文件与行号并修复                |
| `npm test` 非 0                  | 测试失败                      | 查看失败用例与断言，不重跑          |
| `npm run build` 非 0             | Vite 构建失败                 | 修复首个编译错误                    |
| `wrangler deploy --dry-run` 非 0 | Wrangler 配置、认证或打包问题 | 读取具体配置项或认证提示            |
| `'$...' is not recognized`       | 错误 shell                    | 改为显式 PowerShell，只重跑一次     |
| Google 超时、`SG_REL`、验证页    | 上游反爬或需执行 JS           | 记录为阻塞，停止重复测试            |
| `curl.exe` 退出码 3              | 参数引号错误                  | 修正引号，不重复原命令              |

不要为了“多验证一下”反复调用第三方搜索接口。真实搜索引擎调用会产生额度、限流和反爬风险。

## 5. 常用命令

```powershell
npm run check
npm test
npm run build
npx wrangler deploy --dry-run
npm run start
npm run deploy
```

- `npm run preview`：本地真实 Worker，地址 `http://127.0.0.1:8787`。
- `npm run deploy`：生产构建并发布到 Cloudflare，仅在用户明确要求部署时执行。
- 部署后只做必要公网烟测：检查 `/` 返回 200，检查 `/api/config` 返回预期 JSON；不要顺便把所有搜索接口打一遍。

## 6. 代码改动规则

- `src/main.tsx`：页面结构、文案、全局浏览器偏好开关。
- `src/useSearch.ts`：图片预处理、请求编排、取消与超时。
- `src/EngineCard.tsx`：结果卡片、缩略图显示策略。
- `src/engines.ts`：引擎元数据与外站链接。
- `src/styles.css`：界面样式与响应式规则。
- `worker/index.js`：API 路由和各引擎流程。
- `worker/http.js`：输入校验、请求大小、安全链接和上游传输。
- `worker/providers.js`：网页解析、Google Lens 适配、Bot 酱和封面补全。

当前前端约定：

- SauceNAO / 搜图 Bot 酱缩略图由结果区总开关统一控制。
- 偏好键为 `alltrace-sauce-bot-thumbnails`，保存在 `localStorage`。
- 默认开启，关闭后隐藏这两个引擎的缩略图。
- 不要重新加入已删除的“使用指南”“独立检索”和用户明确删除的提示文案。

## 7. Google Lens 专项止损

- 当前 Google Lens 通过 Worker 直连时，上传可能成功，但结果页可能返回 `SG_REL` JavaScript 重试页。
- Worker 不能执行浏览器脚本，因此这不是通过继续调选择器就能稳定解决的问题。
- 每次任务最多进行一次真实 Google Lens 端到端尝试；出现超时、验证页或 `SG_REL` 后立即记录阻塞并停止。
- 不得声称 Google 已稳定可用，除非真实联网请求返回 `200` 且解析出非空结果。
- 不自动处理 CAPTCHA、不绕过验证、不使用登录 Cookie。
- 若用户要求真正修复 Google，方案应是 Cloudflare Browser Rendering、外部无头浏览器服务，或正式/付费搜索 API；不要继续反复抓 HTML。

## 8. 测试与 UI 验证

- 修改纯前端：至少执行 `npm run check` 和 `npm run build`。
- 修改 Worker 或解析器：至少执行 `npm test`，必要时补解析 fixture 和请求参数断言。
- 修改全链路：执行 `npm run check`、`npm test`、`npm run build`。
- 用户明确要求真实烟测时，才执行 `tests/live-smoke.mjs`。
- UI 验证优先使用 Codex in-app browser；步骤为启动 `npm run preview`、打开本地页面、检查 AX/截图、关闭临时标签页、停止本地服务。
- UI 验证结束必须清理临时打开的服务和标签页。

## 9. 部署规范

- 未经用户明确要求，不执行 `npm run deploy`。
- 部署前确认工作区没有无关改动；本项目无 Git 时不要伪造 diff。
- 部署时执行 `npm run deploy`，允许 Wrangler 提示代理环境变量和 workers.dev 默认开启。
- 成功后报告公网地址和 Version ID。
- 不输出 Secret、API Key、Cookie 或完整上游 URL 中的敏感参数。

## 10. 完成标准

交付前确认：

- [ ] 只修改了任务相关文件。
- [ ] 使用补丁工具完成编辑。
- [ ] 相关文件通过 Prettier 检查。
- [ ] `npm run check` 通过。
- [ ] 功能相关测试通过。
- [ ] 生产构建通过。
- [ ] 部署时已完成必要公网烟测。
- [ ] 临时进程、标签页和 `$env:TEMP` 文件已清理。
- [ ] 最终回复说明：改了什么、验证了什么、部署地址、剩余阻塞。
