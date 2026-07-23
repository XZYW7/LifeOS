# LifeOS Server API 契约（P0）

> server 与 frontend 双方以此为准。Base: `http://localhost:3456`，全部 JSON。
> 实体类型以 `app/src/types/index.ts` 为准（server 侧复制一份类型定义）。

## 健康与状态
- `GET /api/health` → `{ ok: true, llm: boolean, version: "0.1.0" }`（llm=是否配置了可用 key）
- `GET /api/state` → 全量状态：`{ user, visions, goals, projects, tasks, dailyStates, energyMode, lifeVersions, memories, knowledge, chatMessages }`
- `PUT /api/state` → 整体替换状态（用于首次迁移/重置/恢复演示数据），body 为全量状态 → `{ ok: true }`

## 细粒度写入（幂等 upsert 语义）
- `POST /api/daily-states` body: DailyState → `{ ok: true }`
- `POST /api/tasks` body: Task（新建）→ `{ ok: true }`
- `PATCH /api/tasks/:id` body: Partial\<Task\> → `{ ok: true }`
- `POST /api/goals` body: Goal → `{ ok: true }`
- `PATCH /api/goals/:id` body: Partial\<Goal\> → `{ ok: true }`
- `POST /api/life-versions` body: LifeVersion → `{ ok: true }`
- `POST /api/memories` body: MemoryEntry → `{ ok: true }`
- `PATCH /api/memories/:id` body: Partial\<MemoryEntry\> → `{ ok: true }`
- `POST /api/chat-messages` body: ChatMessage → `{ ok: true }`
- `POST /api/energy-mode` body: `{ level, reason }` → `{ ok: true }`
- `POST /api/users` body: Partial\<User\> → `{ ok: true }`
- `POST /api/visions` body: Vision → `{ ok: true }`；`PATCH /api/visions/:id` → `{ ok: true }`

## AI 对话（核心，真实 LLM）
- `POST /api/chat` body: `{ input: string }`
  → `{ reply: string, actions: AgentAction[], memoriesWritten: number }`
  - server 侧：组装上下文（近期状态/目标/记忆）→ SuperAgent 管线 → 回复；自动持久化用户与 Agent 两条 ChatMessage；按规则/LLM 判断写入 0-n 条 MemoryEntry
  - 未配置 LLM 或调用失败时：server 回落到移植的规则引擎回复，`reply` 照常返回，响应头 `x-lifeos-llm: fallback`

## CORS
允许 `http://localhost:*`（或前端走 Vite proxy `/api` → `localhost:3456`，二选一，前端用 proxy 优先）。

## 存储
`server/data/`：`state.json`（全量实体，原子写入）+ `memory/`（md+frontmatter 长期记忆，移植自 TraceBrain 格式）+ `cost_log.jsonl`。
