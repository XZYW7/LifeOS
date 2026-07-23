# LifeOS

一个自托管、局域网优先的个人生命操作系统，目标是在疲惫、混乱和信息过载时，接住正在失稳的生活。

[English](./README.md) | [中文](./README_CN.md)

## 为什么做 LifeOS

人在精力、注意力和执行能力下降时，生活很容易从一些小问题开始失控：重要事项被遗忘，任务不断堆积，决定散落在聊天和笔记里，状态恶化却没有被及时察觉。

LifeOS 的首要目标不是把生活优化得完美，而是发现生活正在失稳的迹象，保住重要信息，并帮助你找到下一步最小、可执行的行动。

## 核心闭环

LifeOS 把日常对话和零散记录转化为持续可用的上下文：

```text
捕捉碎片与对话
       ↓
理解并记录真正重要的内容
       ↓
沉淀记忆、知识、任务、线程和每日状态
       ↓
将累积上下文重新交给 Agent 理解
       ↓
选择下一步最小可执行行动
       ↓
复盘状态与模式，在小问题演变成崩溃前接住它
```

系统允许你先记录、后整理，不要求你在事情发生的瞬间就建立完美分类。AI 负责理解和建立连接，本地数据才是最终事实来源。

## 设计原则

- **先稳定，再优化**：先保证今天能够正常运转，再追求更大的计划。
- **先接住，再结构化**：记录发生时不强迫自己维护完美的分类体系。
- **事实先于叙事**：长期判断应当能够追溯到真实记录。
- **选择最小有效行动**：能量低时降低下一步的负担，而不是继续增加压力。
- **数据归用户所有**：个人数据由本地系统掌控，发送给外部 LLM 的调用明确、可配置。

## 核心功能

- **自托管、局域网优先架构**：服务器和主要数据运行在用户控制的主机上，手机及其他设备可通过局域网连接
- **AI 驱动记忆**：使用 LLM 从记忆条目自动生成用户画像
- **Memex 集成**：一次性导入 memex 备份档案
- **前后端同步**：客户端与 LifeOS 服务器之间实时更新状态
- **移动端支持**：基于 Capacitor 的 Android 客户端，移动壳可扩展至 iOS
- **线程组织**：将记忆按对话线程分类组织

## 项目结构

```
LifeOS/
├── app/              # 前端（React + TypeScript + Vite）
├── server/           # 后端（Node.js + TypeScript）
└── design/           # 架构和 UI/UX 文档
```

## 快速开始

### 系统要求

- Node.js 20+
- npm 或 pnpm

### 1. 后端启动

```bash
cd server
npm install
cp .env.example .env
# 编辑 .env 配置 LLM 提供商和 API 密钥
npm run dev
```

后端运行在 `http://localhost:3456`

### 2. 前端启动（新终端）

```bash
cd app
npm install
npm run dev -- --host
```

前端开发服务器运行在 `http://localhost:3000`

然后在浏览器中打开 [http://localhost:3000](http://localhost:3000)

开发模式下，手机或同一局域网内的其他设备请打开 `http://<主机局域网IP>:3000`。Vite 开发服务器会将 API 请求代理到 3456 端口的 LifeOS 服务。

启动脚本使用单端口模式：先执行 `cd app && npm run build`，再启动服务器，然后打开 `http://localhost:3456/`。此时服务器同时托管前端和 API；其他设备可访问 `http://<主机局域网IP>:3456/`。

## 环境配置

在 `server/.env` 中配置 LLM：

```env
# LLM 提供商
LLM_PROVIDER=deepseek

# 模型名称（默认：deepseek-chat）
LLM_MODEL=deepseek-chat

# API 密钥
LLM_API_KEY=sk-xxxxx

# 可选：自定义 API 端点
# LLM_BASE_URL=https://api.deepseek.com/v1
```

详见 [server/.env.example](./server/.env.example) 了解其他提供商配置（OpenAI、Ollama 等）

**支持的 LLM 提供商**：
- **deepseek**（默认）
- **openai**
- **ollama**（本地）

## 架构设计

### 数据模型

```
State (server/data/state.json)
├── profile        # 用户画像（≤800 字符，自动生成）
├── memories[]     # 记忆条目（证据层）
├── knowledge[]    # 方法、资源、笔记等长期知识
├── tasks[]        # 行动层
├── dailyStates[]  # 每日打卡与能量状态
└── threads[]      # 对话线程
```

记忆条目以 Markdown 文件形式存储在 `server/data/memory/`，含 YAML 前言：

```markdown
---
id: uuid
title: 记忆标题
createdAt: ISO-8601
confirmCount: 确认次数
tags: [标签1, 标签2]
---

记忆内容，支持 Markdown 格式。
```

### 前后端状态

- **LifeOS 服务器**：权威状态存储在主机上，以原子方式写入 `state.json`
- **客户端**：浏览器或手机端使用 localStorage 保持界面连续性，并与 LifeOS 服务器同步
- **启动时**：若服务器状态为空但本地浏览器有数据，前端会将本地数据同步回服务器
- **边界**：目前还不是完整的离线优先同步，客户端完整使用仍依赖服务器
- **清空**：同时清除服务器和客户端数据

### 画像生成流程

1. **证据层**：`state.memories` 中的所有记忆条目
2. **筛选**：按 `confirmCount` 取前 40 条
3. **LLM 合成**：DeepSeek 基于选中记忆改写画像
4. **摘要层**：画像（<800 字）注入到聊天上下文
5. **触发条件**：≥5 条新记忆未同步时更新画像

## Memex 集成

从 [memex](https://github.com/memex-lab/memex) 备份导入记忆：

1. 从 memex 导出备份为 `.memex` ZIP 文件
2. 在 LifeOS 设置 → Memex 中上传 ZIP
3. 一次性导入 Cards（作为 MemoryEntry）和 PKM（作为 KnowledgeItem）

**说明**：LifeOS 仅支持 memex 的备份数据格式（ZIP + YAML/Markdown 解析），不包含 memex 源代码。详见 [NOTICE.md](./NOTICE.md) 的说明。

## 开发

### 常用脚本

**后端：**
```bash
npm run dev          # 启动开发服务器，启用文件监听
npm run typecheck    # 验证 TypeScript 类型
```

**前端：**
```bash
npm run dev          # 启动 Vite 开发服务器，启用 HMR
npm run build        # 构建生产版本
npm run preview      # 预览生产版本
npm run lint         # 运行 ESLint
```

### API 端点

- `GET /api/state` — 获取当前状态
- `PUT /api/state` — 更新状态
- `POST /api/chat` — 与 AI 代理聊天
- `POST /api/import/memex` — 导入 memex 备份 ZIP

详见 `server/src/index.ts` 的完整 API 规范。

### 类型检查

```bash
cd server
npm run typecheck    # 验证 TypeScript 类型
```

## 移动应用构建

### Android APK

```bash
cd app
npx cap add android
npx cap sync android
npx cap build android
```

详见 [docs/APK-BUILD.md](./docs/APK-BUILD.md) 的详细构建说明。

## 隐私与数据

- **自托管数据**：主要数据存储在主机上，默认无云同步和用户追踪
- **数据所有权**：您完全掌控自己的记忆
- **LLM 调用是显式功能**：聊天、碎片抽取、画像合成和 Dream 可能将选中的本地上下文发送至配置的 LLM API
- **Memex 导入一次性**：导入后无持续同步

## 许可证与致谢

- **LifeOS 主项目**：[MIT License](./LICENSE)
- **memex 互操作**：LifeOS 仅支持 memex 的备份数据格式，不包含 memex 源代码。详见 [NOTICE.md](./NOTICE.md)
- **UI 组件**：使用 [shadcn/ui](https://ui.shadcn.com/)（MIT）
- **核心框架**：[React](https://react.dev/)、[Vite](https://vitejs.dev/)、[Capacitor](https://capacitorjs.com/)

## 安全边界

开发服务器为了让 Android 客户端和 Agent 调试连接，默认监听局域网地址。
当前局域网模式没有认证：只应在可信的私有网络中使用，保持主机防火墙开启，
不要直接把未认证的服务暴露到公网；如需公网部署，应先增加认证和反向代理层。详见 [SECURITY.md](./SECURITY.md)。

## 贡献

欢迎提交 bug 报告、功能建议和 PR。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 常见问题

### 端口被占用

- 后端（3456）：使用 `Ctrl+C` 停止运行中的进程，或在服务器环境中修改 `LIFEOS_PORT`
- 前端（3000）：如端口被占用，Vite 会自动递增，查看终端输出

### LLM API 错误

- 检查 `.env` 中 API 密钥和 base URL 正确
- 验证网络连接到 LLM 提供商
- 查看 `server/src/llm.ts` 的详细错误日志

### 状态同步问题

- 清除浏览器缓存和 localStorage：DevTools → Application → Clear Storage
- 验证后端是否运行：`curl.exe http://localhost:3456/api/state`
- 检查 `server/data/state.json` 存在且是有效 JSON

## 开发计划

- [ ] 离线优先同步（IndexedDB 支持大数据集）
- [ ] 端到端加密选项
- [ ] 多设备同步
- [ ] iOS 原生优化
- [ ] 插件系统

---

**有问题？** 在本仓库提交 Issue 或讨论。
