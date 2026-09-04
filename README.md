# CodeSpeakForYoutube

CodeSpeakForYoutube 是一个 Chrome Manifest V3 扩展 MVP。它在 YouTube 普通视频的英文字幕上创建独立的可点击字幕层，通过已部署的安全代理调用百度智能云“文本翻译－词典版”，并提供中文释义、词性、音标、浏览器发音和本地单词收藏。翻译服务无法连接时会自动回退到 Mock 释义。

扩展脚本会在 `youtube.com` 域内加载，以便覆盖从首页进入视频的 SPA 导航；实际字幕处理严格限制在 `/watch` 普通视频页面，`/shorts` 不会启用。

## 开发与构建

```powershell
npm install
npm run check
```

构建后可以直接加载项目根目录，也可以加载独立的 `dist/` 目录。根目录 manifest 指向 `dist/` 内的资源；构建脚本还会生成一个资源路径经过转换的 `dist/manifest.json`。修改源码后重新运行 `npm run build`，然后在扩展管理页点击刷新。

## 百度智能云翻译配置

百度智能云 API Key/Secret Key 绝不能写入扩展。项目在 `backend/` 中提供了一个 Cloudflare Worker 代理，详细配置、费用说明与部署步骤见 [backend/README.md](backend/README.md)。

扩展已默认使用项目部署的生产 Worker，普通用户无需配置：

```text
https://codespeakforyoutube.1242196553.workers.dev/api/translate
```

翻译成功后卡片会显示“百度智能云词典”，并优先使用接口返回的中文词典释义、词性和音标；相同查询会在扩展本地缓存 30 天，最多保存 500 项。默认 `workers.dev` 域名在部分网络环境中可能无法访问；面向 YouTube 的用户通常已使用可访问该域名的网络环境。

Worker 可选接入 Google Analytics 4 统计匿名活跃度。统计只使用随机安装 ID 和功能事件，不上传字幕、单词、视频地址或账号信息；未配置 GA Secret 时自动停用。配置方法见 [backend/README.md](backend/README.md)。

隐私政策见 [PRIVACY.md](PRIVACY.md)。上架 Chrome Web Store 时，可将其公开 GitHub 地址填写为隐私权政策网址：

```text
https://github.com/Wowgreat/CodeSpeakForyoutube/blob/main/PRIVACY.md
```

本地开发时，可在扩展 Service Worker 的 DevTools 控制台执行以下命令覆盖生产地址；覆盖值仅接受 `localhost` 或 `127.0.0.1`：

```js
chrome.storage.local.set({ developmentTranslationApiUrl: "http://127.0.0.1:8787/api/translate" });
```

恢复生产地址：

```js
chrome.storage.local.remove("developmentTranslationApiUrl");
```

## 在 Chrome 安装

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目根目录 `C:\code\CodeSpeakForYoutube`。也可以选择其中的 `dist` 目录，两种方式都受支持。
5. 建议将 CodeSpeakForYoutube 固定到工具栏，方便查看收藏。

## 从 GitHub Releases 安装

如果暂时不通过 Chrome Web Store，可从 [Releases](https://github.com/Wowgreat/CodeSpeakForyoutube/releases) 下载 ZIP。解压到本地目录后，在 `chrome://extensions/` 开启“开发者模式”，点击“加载已解压的扩展程序”，选择解压后的目录（其中应包含 `manifest.json`）。

开发者模式下安装的扩展不会自动更新；发布新版本后需要重新下载、解压并在扩展管理页点击“重新加载”。

## 手动验收

1. 打开一个带人工英文字幕或英文自动字幕的普通 YouTube 视频（URL 应为 `/watch?v=...`，不要使用 Shorts）。
2. 点击播放器的 CC 按钮，并在字幕设置中选择 English。
3. 播放视频，确认字幕外观和原位置基本保持不变；把鼠标移到不同单词上，确认每个英文单词可以独立高亮。
4. 点击 `across`（或任意单词），确认字幕附近出现卡片，短暂显示“正在翻译”，随后出现百度中文译文、词性、“发音”和“收藏”。
5. 从一个字幕单词按下鼠标并拖到后续单词再松开，例如从 `across` 拖到 `globe`；确认高亮会自动吸附到完整单词，不会出现 `he thir` 这样的半词结果，并且卡片展示完整词组、标记为“词组”，发音和收藏也使用完整词组。向前反向拖选也应正常工作。
6. 在视频播放状态点击单词或选择词组，确认卡片打开时视频自动暂停；点击卡片右上角 `×`，确认视频从原位置继续播放。
7. 卡片打开且视频暂停时，点击视频画面恢复播放，确认翻译卡片随即自动消失；用播放按钮或播放快捷键恢复时也应一致。
8. 先手动暂停视频，再打开并关闭卡片，确认插件不会擅自恢复播放。
8. 点击“发音”，确认系统使用英文语音朗读该单词或词组。
9. 点击“收藏”，确认按钮变为“已收藏”；关闭卡片，点击浏览器工具栏中的扩展图标，确认 popup 中显示该单词或词组。
10. 关闭 popup 或刷新页面后重新打开 popup，确认收藏仍存在；点击“删除”可移除收藏。
11. 确认视频播放、进度条和其他控制按钮仍可正常操作。
12. 在 YouTube 页面内点击推荐视频切换到另一个 `/watch` 视频，不刷新标签页；开启英文字幕并确认功能继续工作。
13. 分别进入影院模式和全屏模式，确认字幕可点击、卡片在可视区域内，退出模式后仍可用。
14. 关闭 CC，确认增强字幕消失且不会留下旧字幕；再开启 CC，确认恢复工作。
15. 切换到非英文字幕，确认插件不增强已能识别语言码的非英文轨道；打开 `/shorts/...`，确认插件不处理。

## 当前限制

- 真实中文译文、词性和音标优先来自百度智能云词典版；词典字段缺失时词性使用本地推测，代理不可用时中文释义回退为 Mock。
- 当前字幕语言读取依赖 YouTube 的非公开播放器接口；接口取不到语言码时会用保守文本启发式判断，因此很短的英文字幕可能暂时不显示，某些拉丁字母语言也可能被误判。
- YouTube 会持续调整字幕 DOM 和内部类名，未来可能需要更新选择器。
- 独立字幕层按当前字幕片段的矩形和主要计算样式复刻；特殊字幕定位、卡拉 OK 逐字特效和极端缩放下可能与原字幕略有差异。
- SpeechSynthesis 的可用音色和首次播放行为取决于操作系统与 Chrome 配置。
- 收藏只保存在当前 Chrome 配置的本地存储中，没有同步、导入导出或学习状态。

## 后续建议

1. 解析更多百度词典字段，例如例句、词形变化、考试标签和近义词。
2. 为语言识别与 YouTube DOM 适配增加回归测试和诊断状态提示。
3. 增加上下文例句、原形归一化、收藏搜索与导出功能。
4. 增加设置页，让用户控制字幕字号、卡片位置、发音音色和播放速度。
