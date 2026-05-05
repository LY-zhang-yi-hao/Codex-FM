
# Codex-FM

<p align="center">
  <img src="docs/screenshots/codex-fm-promo.png" width="80%" alt="Codex-FM promotional poster">
</p>

### An immersive AI Radio web app for music, chat, mood, and playback

<p>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white">
  <img alt="Express" src="https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white">
  <img alt="OpenAI SDK" src="https://img.shields.io/badge/OpenAI-SDK-412991">
  <img alt="PWA" src="https://img.shields.io/badge/PWA-ready-5A0FC8">
  <img alt="Built with Codex" src="https://img.shields.io/badge/Built%20with-Codex-0F172A">
</p>

**模仿 mmguo 风格 AI 电台体验，结合 AI DJ 对话、音乐推荐、播放器联动、歌词翻页、情绪电台和沉浸式视觉氛围。**

作者注：使用 Codex + vibe-coding + sleep-coding

参考与说明：本项目为基于 [kabaBZ/Claudio](https://github.com/kabaBZ/Claudio) 的学习向二次创作与改编。

---

## 目录

- [项目简介](#项目简介)
- [效果预览](#效果预览)
- [核心特性](#核心特性)
- [为什么这个项目有意思](#为什么这个项目有意思)
- [技术栈](#技术栈)
- [简易功能介绍](#简易功能介绍)
- [项目结构](#项目结构)
- [环境变量](#环境变量)
- [快速开始](#快速开始)
- [运行架构](#运行架构)
- [关键接口](#关键接口)
- [测试](#测试)
- [后续扩展方向](#后续扩展方向)
- [致谢](#致谢)
- [License](#license)

---

## 项目简介

Codex-FM 是一个偏产品原型与体验设计导向的 AI 音乐项目。

它把这些能力组合在了一起：

- **AI DJ 对话**：你可以直接和 Claudio 聊天、点歌、问歌、聊氛围
- **音乐推荐联动**：AI 回复不只是文字，还能转成可播放歌曲卡片
- **多音乐源兜底**：QQ 音乐优先提供搜索 / 音源 / 歌词，网易云负责兜底与歌单能力
- **播放器体验**：封面、歌词、队列、收藏、历史、续播整合在同一套交互里
- **电台氛围 UI**：动态取色、流体背景、自定义背景、模糊调节、DJ voice mode
- **本地化配置**：人格、品味、作息、情绪规则可以直接在本地热更新

它不是传统意义上的播放器，也不是普通聊天机器人，而是更像一个：

> **会陪你听歌、懂上下文、还能顺手把歌播起来的 AI 电台搭子。**

---

## 效果预览

### Style / Player / Chat

<p align="center">
  <img src="docs/screenshots/播放器样式图.png" width="80%" alt="style">
  <img src="docs/screenshots/对话样式图.png" width="80%" alt="chat">
</p>

---

## 核心特性

### 1. AI 对话与推荐联动
- 支持自然语言聊天
- AI 可结合当前播放歌曲继续对话
- `/api/dispatch` 支持简单指令分流、音乐搜索分流和模型流式回复
- 支持结构化返回 `say / reason / play / segue / memory`
- 推荐结果可直接转成歌曲卡片并一键播放
- 聊天记录自动保存，刷新后可恢复

### 2. 多音乐源检索与回退
- QQ 音乐作为主搜索 / 主音源 / 主歌词来源
- 未配置 `QQ_COOKIE` 时自动回退到网易云
- 支持按 `song_source` 区分收藏、历史和歌单歌曲
- 网易云继续承担歌单详情、今日推荐候选池和部分音源兜底

### 3. DJ 串场与 MiMo TTS
- 支持 DJ 串场文案预生成、缓存与消费
- 支持 MiMo TTS 远程合成
- `路路小酱` 音色可读取 `data/voice-clones/lulu-vocals.mp3` 走本地授权 VoiceClone
- 远程 TTS 失败时可回退浏览器语音播报
- Voice Overlay 带转场字幕、波形、进度条和 ducking 联动

### 4. 播放器体验
- 播放器 / 对话双视图切换
- 支持一键播放 / 加入队列 / 收藏 / 历史记录
- 支持 `搜索xxx`、`播放xxx`、下一首、暂停等简单指令
- 自动续播，保留当前歌曲、进度、队列和模式
- 支持歌词获取、封面兜底和音量 / 随机 / 循环控制

### 5. 情绪电台与每日推荐
- 内置当前电台情绪判断接口 `/api/scheduler/mood`
- 内置今日推荐生成接口 `/api/scheduler/daily-playlist`
- 服务端使用 `node-cron` 每小时刷新情绪、每天早上 07:00 生成今日推荐
- 模型不可用时提供本地回退策略，不会让调度能力完全失效

### 6. 沉浸式视觉
- 封面翻页歌词、动态取色、流体背景、氛围光晕
- 支持自定义背景图 / 背景视频
- 支持背景模糊、亮度、对比度、饱和度、缩放调节
- 支持 PWA、Service Worker 和移动端沉浸式状态栏

### 7. 个性化与配置热更新
- 支持 DJ / 用户头像自定义与头像裁切
- 支持页面内修改 OpenAI / QQ / 网易云 / MiMo 相关配置
- `config/agent.md`、`config/taste.md`、`config/routines.md`、`config/moodrules.md` 可热更新
- 支持把聊天里识别出的新偏好写回配置记忆

### 8. 本地持久化
- SQLite 存储收藏、历史记录、聊天记录、偏好设置、播放状态和歌单
- 支持收藏歌曲、历史歌曲记录、聊天历史持久化
- 无需额外数据库服务，个人项目开箱即用

---

## 为什么这个项目有意思

### 不是“AI + 播放器”拼接，而是真联动
AI 的输出会直接影响播放器行为，而不是只停留在聊天气泡里。

### 不是只做功能，而是明显在做氛围
这个项目很强调“数字电台感”和“陪伴感”，视觉、声音、交互都是围绕这个目标去搭的。

### 架构不重，但完整度够高
纯前端页面 + Node.js 单服务 + SQLite，本地跑起来很轻，但功能闭环已经比较完整。

### 很适合继续二开
适合往这些方向继续扩展：
- AI Radio
- AI DJ
- 音乐陪伴类产品
- AI + 内容消费体验
- OpenAI-compatible 接口实践项目

---

## 技术栈

### Frontend
- HTML
- CSS
- Vanilla JavaScript
- Web Audio API
- Web Speech API
- PWA / Service Worker

### Backend
- Node.js 18+
- Express 5
- SQLite (`better-sqlite3`)
- OpenAI SDK (`openai`)
- `node-cron`

### Third-party / API
- OpenAI-compatible API
- MiMo TTS / VoiceClone
- QQ 音乐接口
- 网易云音乐 API

---

## 简易功能介绍

| 功能 | 说明 |
| --- | --- |
| AI 聊天 | 和 Claudio 聊天，问歌、点歌、聊氛围 |
| 歌曲搜索 | 输入“搜索xxx”或“播放xxx”快速找歌 |
| 智能推荐 | AI 返回推荐歌曲卡片，可直接播放 |
| 情绪电台 | 支持当前情绪判断与今日推荐歌单 |
| DJ 串场 | 歌曲切换前生成 DJ segue，可预热并缓存 |
| DJ Voice Mode | MiMo TTS + 浏览器语音兜底的语音播报模式 |
| 收藏系统 | 收藏喜欢的歌曲并持久化保存 |
| 历史记录 | 自动记录历史歌曲与聊天内容 |
| 播放队列 | 支持当前播放列表查看与管理 |
| 网易云歌单 | 支持网易云歌单同步、浏览与播放 |
| 续播能力 | 关闭页面后再次打开可恢复播放状态 |
| 主题氛围 | 动态背景、自动取色、歌词翻页、频谱氛围 |
| 背景调节 | 支持自定义背景图 / 视频与模糊亮度调节 |
| 头像自定义 | 支持 DJ / 用户头像上传与裁切 |
| 配置面板 | 页面内可查看并修改 API 相关配置 |
| 配置热更新 | 修改 `config/*.md` 后服务端自动重载人格与偏好 |

---

## 项目结构

```bash
Codex-FM/
├── server.js
├── package.json
├── .env
├── .env.example
├── config/
│   ├── agent.md
│   ├── taste.md
│   ├── routines.md
│   └── moodrules.md
├── data/
│   ├── claudio.db
│   └── voice-clones/
│       └── lulu-vocals.mp3
├── docs/
│   ├── netease-api-deploy.md
│   └── screenshots/
├── lib/
│   ├── dj-segue.cjs
│   ├── mimo-tts.cjs
│   ├── model-response.cjs
│   ├── music-provider-adapter.cjs
│   └── qq-music-provider.cjs
├── public/
│   ├── index.html
│   ├── css/
│   ├── js/
│   ├── manifest.json
│   └── sw.js
└── test/
    ├── chat-ui.test.cjs
    ├── dj-segue.test.cjs
    ├── project-structure.test.cjs
    └── voice-ui.test.cjs
```

说明：

- `data/*` 默认被 `.gitignore` 忽略
- `data/voice-clones/**` 被显式放行，便于保留授权音色样本结构
- `config/*.md` 是这个项目里非常关键的“电台人格和偏好层”

---

## 环境变量

复制 `.env.example` 为 `.env`，并按需修改：

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5-codex
MIMO_API_KEY=your_mimo_api_key_here
MIMO_TTS_VOICE=路路小酱
MIMO_TTS_STYLE=lazy_night
MIMO_TTS_CLONE_SAMPLE_PATH=data/voice-clones/lulu-vocals.mp3
NETEASE_API=your_netease_api_here
NETEASE_COOKIE=your_netease_cookie_here
PORT=3001
```

### 字段说明

| 变量名 | 说明 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI / Codex 接口的 API Key |
| `OPENAI_BASE_URL` | OpenAI / 兼容接口 Base URL |
| `OPENAI_MODEL` | 使用的模型名，例如 `gpt-5-codex` |
| `MIMO_API_KEY` | MiMo TTS / VoiceClone 接口的 API Key |
| `MIMO_TTS_VOICE` | DJ 默认音色，例如 `路路小酱`、`冰糖` |
| `MIMO_TTS_STYLE` | MiMo DJ 风格预设 ID |
| `MIMO_TTS_CLONE_SAMPLE_PATH` | 本地授权克隆样本路径，默认 `data/voice-clones/lulu-vocals.mp3` |
| `NETEASE_API` | 网易云音乐 API 服务地址 |
| `NETEASE_COOKIE` | 网易云 Cookie，用于获取更多可用内容 |
| `QQ_COOKIE` | 可选，QQ 音乐整串浏览器 Cookie；配置后 QQ 作为主搜索 / 主音源 / 主歌词 |
| `PORT` | 本地服务端口 |

### 网易云 API 说明

本项目里的网易云能力不是前端直连网易云，而是：

1. 前端请求本项目服务端 `/api/netease/*`
2. 服务端再转发到你自己部署的网易云 API 服务

所以别人克隆项目后，除了会填 `Cookie`，还必须自己部署一个可访问的网易云 API，并配置：

```env
NETEASE_API=http://127.0.0.1:3000
NETEASE_COOKIE=MUSIC_U=你的MUSIC_U
```

推荐使用开源项目：

- `Binaryify/NeteaseCloudMusicApi`
- GitHub: https://github.com/Binaryify/NeteaseCloudMusicApi

最简单的部署方式是 Docker：

```bash
docker run -d \
  --name netease-api \
  -p 3000:3000 \
  -e MUSIC_U="你的MUSIC_U" \
  binaryify/netease_cloud_music_api
```

启动后先验证：

```bash
curl "http://127.0.0.1:3000/personalized?limit=1"
```

如果这里拿不到 JSON，说明不是本项目的问题，而是网易云 API 没部署好。

更完整的部署说明见：

- [docs/netease-api-deploy.md](docs/netease-api-deploy.md)

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 准备环境变量

```bash
cp .env.example .env
```

Windows 如果没有 `cp`，手动复制一份也可以。

### 3. 准备可选资源

- 如果要启用 `路路小酱` 的本地克隆音色，请把授权样本放到 `data/voice-clones/lulu-vocals.mp3`
- 如果要启用 QQ 主搜索 / 主音源，请在配置面板或 `.env` 中补充 `QQ_COOKIE`
- 如果要启用网易云歌单和兜底音源，请先部署可访问的网易云 API

### 4. 启动项目

```bash
npm start
```

开发模式：

```bash
npm run dev
```

### 5. 打开浏览器

```bash
http://localhost:3001
```

如果你修改了 `PORT`，请对应替换端口号。

---

## 运行架构

```text
用户输入消息 / 点击播放器
   ↓
前端根据场景调用：
  - /api/dispatch
  - /api/netease/*
  - /api/dj/segue/*
  - /api/dj/tts
  - /api/scheduler/*
   ↓
服务端执行：
  - 简单控制指令分流
  - QQ / 网易云多源检索与回退
  - OpenAI-compatible 模型流式回复
  - MiMo TTS 合成 / VoiceClone
  - SQLite 持久化
  - node-cron 情绪与每日推荐调度
   ↓
前端渲染聊天气泡、歌曲卡片、播放器状态、歌词和视觉氛围
```

---

## 关键接口

| 路径 | 作用 |
| --- | --- |
| `/api/dispatch` | 对话主入口，处理指令、搜索和 AI 流式回复 |
| `/api/netease/search` | 多音乐源搜索结果出口 |
| `/api/netease/song/url` | 获取歌曲播放链接，支持按来源回退 |
| `/api/netease/lyric` | 获取歌词，支持按来源回退 |
| `/api/dj/segue/prepare` | 预生成下一首歌的 DJ 串场文案 |
| `/api/dj/segue/consume` | 消费串场缓存，真正用于播放前播报 |
| `/api/dj/tts` | 调用 MiMo TTS 返回音频 |
| `/api/config` | 读取 / 更新电台人格与偏好配置 |
| `/api/env-config` | 读取 / 更新页面里的运行配置 |
| `/api/scheduler/daily-playlist` | 获取或刷新今日推荐 |
| `/api/scheduler/mood` | 获取或刷新当前电台情绪 |

---

## 测试

运行：

```bash
npm test
```

当前测试主要覆盖：

- README / 项目结构约束
- DJ segue 逻辑
- MiMo TTS 缓存与语音 UI
- 聊天 UI 与浮动按钮结构
- QQ 音乐提供器与歌曲身份归一化

---

## 后续扩展方向

- 接更多音乐平台
- 接更完整的 TTS 服务，而不只依赖浏览器语音
- 增加 AI 长期记忆和用户音乐画像
- 增加账号系统、云同步、多端续播
- 增加更完整的移动端 PWA 安装体验
- 把推荐、人格、调度进一步拆成更独立的服务层

---

## 致谢

- 灵感参考：**mmguo 风格 AI 电台**
- 开发辅助：**Codex**
- AI 接口：**OpenAI-compatible API**
- 音乐能力：**QQ 音乐 + 网易云音乐 API**

---

## License

ISC
