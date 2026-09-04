# CodeSpeakForYoutube 隐私政策

最后更新：2026-09-04

CodeSpeakForYoutube 用于在 YouTube 普通视频的英文字幕上提供单词或词组查询、发音和收藏功能。

## 收集的数据

当项目 Worker 配置了 Google Analytics 4 Secret 后，扩展会生成一个随机安装 ID，并通过项目的 Cloudflare Worker 向 Google Analytics 4 发送以下信息：

- 匿名安装 ID
- 事件名称（例如扩展活跃、翻译完成、收藏单词）
- 翻译是否成功、是否命中本地缓存

匿名统计不会发送 YouTube 视频地址、字幕原文、查询单词、账号信息、姓名或邮箱。用户主动点击查询时，所查询的英文单词或词组会发送到百度智能云以获得翻译；百度密钥只保存在 Cloudflare Worker 中。收藏单词和翻译缓存只保存在用户当前 Chrome 配置的本地存储中。

## 第三方服务

- Cloudflare Workers：转发翻译请求并保护百度智能云密钥。
- 百度智能云：处理用户主动查询的英文单词或词组。
- Google Analytics 4：接收上述匿名功能事件，用于统计活跃用户和功能使用情况。

翻译服务或统计服务不可用时，扩展仍可使用本地 Mock 释义或其他本地功能。

## 数据保留与删除

本地收藏和缓存可以通过清除扩展数据删除。匿名统计数据由 Google Analytics 按其政策保留；由于不包含账号或字幕内容，无法通过扩展中的单词反查用户身份。

## 联系方式

隐私问题可通过项目 GitHub 仓库提交 Issue：

<https://github.com/Wowgreat/CodeSpeakForyoutube/issues>
