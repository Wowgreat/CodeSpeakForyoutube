# 百度智能云机器翻译代理

这个 Cloudflare Worker 代理接入用户指定的[百度智能云机器翻译](https://console.bce.baidu.com/ai-engine/machinetranslation/overview/index)，调用“文本翻译－词典版”。该接口在翻译单词和短语时可返回中文词典释义、词性、音标等字段；查询是句子时仍返回普通译文。

扩展和仓库中不包含百度 API Key、Secret Key 或 Access Token。Worker 使用 API Key/Secret Key 获取有效期约 30 天的 Access Token，在运行实例内缓存并自动刷新。

## 匿名使用统计（可选）

Worker 支持通过 Google Analytics 4 Measurement Protocol 统计匿名活跃度。未配置以下两个 Secret 时统计自动停用，不影响翻译：

```powershell
npx wrangler@latest secret put GA_MEASUREMENT_ID --config backend/wrangler.toml
npx wrangler@latest secret put GA_API_SECRET --config backend/wrangler.toml
```

扩展只生成并保存随机安装 ID，发送事件名及成功/缓存状态；不发送字幕、单词、视频地址或账号信息。

## 费用说明

根据百度智能云当前官方文档：

- 未实名认证和个人认证用户没有词典版免费测试调用量；
- 企业认证用户可领取 1000 万字符测试资源；
- 词典版按量后付费价格为 59 元/百万字符；
- 成功调用才计入字符量。

启用服务前请在控制台确认计费方式、资源包与余额提醒。不要仅凭“已有百度账号”假设接口免费。

## 1. 准备百度智能云应用

1. 打开[机器翻译控制台](https://console.bce.baidu.com/ai-engine/machinetranslation/overview/index)。
2. 确认账号认证状态和词典版资源/计费方式。
3. 在“应用管理”中选择专用于 CodeSpeakForYoutube 的应用，并确保它拥有“文本翻译－词典版”权限。
4. 在应用详情中自行取得 API Key 和 Secret Key。不要将凭据粘贴到聊天、扩展源码或 Git。

创建应用、开通服务或启用按量付费会改变云端账户和可能产生费用，必须由账户所有者确认并执行。

## 2. 本地运行

复制 `backend/.dev.vars.example` 为 `backend/.dev.vars`，只在本机填写真实值：

```dotenv
BAIDU_API_KEY=你的API_KEY
BAIDU_SECRET_KEY=你的SECRET_KEY
ALLOWED_ORIGIN=*
```

然后运行：

```powershell
npm run build
npm run dev:backend
```

Wrangler 默认通常监听 `http://localhost:8787`。如需让扩展临时调用本地 Worker，在扩展 Service Worker 的 DevTools 控制台执行：

```js
chrome.storage.local.set({ developmentTranslationApiUrl: "http://127.0.0.1:8787/api/translate" });
```

调试完成后执行 `chrome.storage.local.remove("developmentTranslationApiUrl")`，恢复生产 Worker。

## 3. 部署到 Cloudflare

1. 开发阶段的 `ALLOWED_ORIGIN` 为 `*`，以兼容不同机器上“加载已解压”产生的扩展 ID。发布到 Chrome Web Store 后，应改成商店分配的固定 `chrome-extension://...` 来源。
2. 登录并以交互方式保存 Secret：

```powershell
npx wrangler@latest login
npx wrangler@latest secret put BAIDU_API_KEY --config backend/wrangler.toml
npx wrangler@latest secret put BAIDU_SECRET_KEY --config backend/wrangler.toml
```

3. 构建并部署：

```powershell
npm run build
npx wrangler@latest deploy --config backend/wrangler.toml
```

4. 将 Worker URL 加上 `/api/translate`，写入 `src/shared/translation.ts` 中的 `DEFAULT_TRANSLATION_API_URL` 后重新构建扩展。

## 缓存与额度保护

- 扩展会在 `chrome.storage.local` 缓存最近 500 个查询，缓存有效期 30 天。
- Worker 对单个来源 IP 默认限制为每分钟 60 次翻译请求。
- 建议在百度控制台开启余额提醒，并设置独立的月度费用预算。
- 公网 Worker URL 仍可能被非浏览器客户端伪造请求；正式发布前应增加服务端限流和按月字符计数。

官方文档：

- [文本翻译－词典版 API](https://cloud.baidu.com/doc/MT/s/nkqrzmbpc)
- [文本翻译－词典版价格](https://cloud.baidu.com/doc/MT/s/kkqq9xle8)
- [Access Token 鉴权](https://ai.baidu.com/ai-doc/REFERENCE/Ck3dwjhhu)
