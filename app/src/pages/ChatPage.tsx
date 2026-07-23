/**
 * ChatPage：与长期人生 Agent 的对话页。
 * ─────────────────────────────────────────────────────────────
 * 主区：历史消息（用户右 / Agent 左）+ 底部输入框；
 * 发送后：server 在线 → POST /api/chat 用真实 LLM 回复（失败静默回落）；
 * 离线 → 本地规则引擎 chat(input, context)（context 从 store 实时组装）；
 * 返回的 actions 渲染为「采纳调整」按钮（apply_plan → adjustTodayPlan 等）；
 * 在线回复附带 organizeId，由 OrganizedCard 轮询 /api/organize/:id 渲染「已整理」卡片；
 * 顶部有不显眼的连接状态标识；右侧栏：Agent 长期记忆摘要（事实 / 模式 / 洞察）。
 */
import { useEffect, useRef, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import type { AgentAction, ChatContext, ChatMessage } from '@/types';
import {
  USER_ID,
  getActiveMemories,
  getAllStates,
  initServerSync,
  uid,
  useLifeOS,
} from '@/lib/store';
import { chat } from '@/lib/agent';
import { api, checkHealth, useServerStatus } from '@/lib/api';
import MessageBubble from '@/components/chatpage/MessageBubble';
import ChatInput from '@/components/chatpage/ChatInput';
import MemoryPanel from '@/components/chatpage/MemoryPanel';
import OrganizedCard from '@/components/chatpage/OrganizedCard';

function buildContext(): ChatContext {
  const s = useLifeOS.getState();
  return {
    user: s.user,
    states: getAllStates(s),
    tasks: s.tasks,
    goals: s.goals,
    memories: getActiveMemories(s),
  };
}

function newMessage(role: ChatMessage['role'], content: string, actions?: AgentAction[]): ChatMessage {
  return {
    id: uid('chat'),
    userId: USER_ID,
    role,
    content,
    actions,
    createdAt: new Date().toISOString(),
  };
}

export default function ChatPage() {
  const chatMessages = useLifeOS((s) => s.chatMessages);
  const addChatMessage = useLifeOS((s) => s.addChatMessage);
  const adjustTodayPlan = useLifeOS((s) => s.adjustTodayPlan);
  const setEnergyMode = useLifeOS((s) => s.setEnergyMode);
  const updateTaskStatus = useLifeOS((s) => s.updateTaskStatus);

  const [pending, setPending] = useState(false);
  const [appliedActions, setAppliedActions] = useState<ReadonlySet<string>>(new Set());
  /** 每条 agent 消息对应的整理任务 id（key = 消息 id），渲染为该气泡下方的 OrganizedCard */
  const [organizeByMsg, setOrganizeByMsg] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // server 在线 / LLM 状态（顶部不显眼标识）
  const serverStatus = useServerStatus();

  // 进入对话页时刷新一次健康状态（静默，失败即离线）
  useEffect(() => {
    void checkHealth();
  }, []);

  // 新消息 / 思考态 / 已整理卡片出现时滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages.length, pending, organizeByMsg]);

  /** 离线路径：本地规则引擎（保留原有模拟延迟） */
  const replyLocally = (text: string) => {
    window.setTimeout(() => {
      const result = chat(text, buildContext());
      addChatMessage(newMessage('agent', result.reply, result.actions));
      setPending(false);
    }, 500);
  };

  const send = (text: string) => {
    if (pending) return;
    addChatMessage(newMessage('user', text));
    setPending(true);
    if (serverStatus.online) {
      // 在线路径：server 真实 LLM；调用失败静默回落本地规则引擎
      api
        .chat(text)
        .then((result) => {
          // 本地 agent 消息必须复用 server 落库的 id：initServerSync 会用 server 状态整体替换
          // 消息列表，id 不一致会让「已整理」卡片的挂载键失效（卡片永远渲染不出来）
          const agentMsg = result.agentMessageId
            ? { ...newMessage('agent', result.reply, result.actions), id: result.agentMessageId }
            : newMessage('agent', result.reply, result.actions);
          addChatMessage(agentMsg);
          setPending(false);

          // ① 对话整理管线：拿到 organizeId，由 OrganizedCard 轮询渲染「已整理」卡片
          if (result.organizeId) {
            setOrganizeByMsg((prev) => ({ ...prev, [agentMsg.id]: result.organizeId }));
          }

          // ② 拉取 server 全量状态刷新本地 store，线程页/轨迹页/记忆面板立刻反映新数据。
          //    异步执行，不阻塞消息显示；失败静默（initServerSync 内部已处理不可达回落）。
          void initServerSync();
        })
        .catch(() => replyLocally(text));
      return;
    }
    replyLocally(text);
  };

  const handleAction = (_message: ChatMessage, action: AgentAction, key: string) => {
    switch (action.type) {
      case 'apply_plan':
        if (action.plan) adjustTodayPlan(action.plan);
        break;
      case 'set_mode':
        if (action.mode) setEnergyMode(action.mode, action.reason ?? '对话中采纳 Agent 建议');
        break;
      case 'defer_task':
        if (action.taskId) updateTaskStatus(action.taskId, 'skipped');
        break;
      case 'keep_task':
        if (action.taskId) updateTaskStatus(action.taskId, 'todo');
        break;
      // freeze_plan / split_task：规则引擎暂无可写操作，仅标记已读
      default:
        break;
    }
    setAppliedActions((prev) => new Set(prev).add(key));
  };

  return (
    <div className="flex h-full">
      {/* 主对话区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border px-4 py-4 md:px-8 md:py-5">
          <div className="flex items-center gap-2.5">
            <MessagesSquare className="h-5 w-5 text-brand" strokeWidth={1.8} />
            <h1 className="text-xl font-semibold text-foreground">AI 对话</h1>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            一个记得你目标、节律与上一次判断的长期 Agent。卡住的时候来聊，不知道说什么就试试下方快捷问题。
          </p>
          {/* server 连接状态标识（不显眼） */}
          <div className="mt-2 flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground/60">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                serverStatus.online ? 'bg-emerald-500/80' : 'bg-muted-foreground/30'
              }`}
            />
            {serverStatus.online
              ? serverStatus.llm
                ? '已连接本地核心 · LLM'
                : '已连接本地核心 · 本地规则引擎'
              : '离线模式 · 本地规则引擎'}
          </div>
        </header>

        {/* 消息列表 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
          {chatMessages.length === 0 ? (
            <div className="mx-auto mt-16 max-w-md rounded-lg border border-border bg-card px-6 py-8 text-center">
              <MessagesSquare className="mx-auto h-8 w-8 text-brand/60" strokeWidth={1.5} />
              <p className="mt-4 text-sm text-foreground">还没有对话记录</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                告诉我今天的真实状态——累、卡住、迷茫都可以。
                我会结合你的打卡、任务与记忆判断这是恢复需求还是动力不足，再决定要不要动你的计划。
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {chatMessages.map((m) => (
                <div key={m.id} className="space-y-2">
                  <MessageBubble
                    message={m}
                    appliedActions={appliedActions}
                    onAction={handleAction}
                  />
                  {organizeByMsg[m.id] && <OrganizedCard organizeId={organizeByMsg[m.id]} />}
                </div>
              ))}

              {pending && (
                <div className="flex justify-start">
                  <div className="rounded-lg border border-border bg-card px-4 py-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                      正在结合你的记录分析…
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="shrink-0 border-t border-border px-4 py-3 md:px-8 md:py-4">
          <div className="mx-auto max-w-3xl">
            <ChatInput disabled={pending} onSend={send} />
          </div>
        </div>
      </div>

      {/* 右侧：长期记忆 */}
      <aside className="hidden w-80 shrink-0 border-l border-border lg:block">
        <MemoryPanel />
      </aside>
    </div>
  );
}
