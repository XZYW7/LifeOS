/**
 * LLM 调用层 —— 移植自 TraceBrain packages/core/src/llm/（client.ts + cost-tracker.ts）
 * 适配 LifeOS 环境变量命名：LLM_PROVIDER / LLM_MODEL / LLM_API_KEY / LLM_BASE_URL(可选)
 * deepseek 走 OpenAI 兼容接口 https://api.deepseek.com/v1
 * 严禁在日志中打印 apiKey。
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { extractAndRepairJSON } from './json-utils.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 要求返回 JSON object（OpenAI 兼容 response_format） */
  json?: boolean;
  /** 调用超时（ms），默认 90s */
  timeoutMs?: number;
  /** 成本追踪用任务标签 */
  task?: string;
}

export interface LLMConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

const PROVIDER_DEFAULT_BASE: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434/v1',
};

export function llmConfigFromEnv(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER || 'deepseek').trim();
  return {
    provider,
    model: (process.env.LLM_MODEL || 'deepseek-chat').trim(),
    apiKey: (process.env.LLM_API_KEY || '').trim(),
    baseUrl: (process.env.LLM_BASE_URL || '').trim() || PROVIDER_DEFAULT_BASE[provider],
  };
}

// ── Cost Tracker（移植自 cost-tracker.ts，落盘 data/cost_log.jsonl）──

export interface CostRecord {
  timestamp: string;
  model: string;
  task: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
}

// DeepSeek pricing per 1M tokens (approximate, from TraceBrain)
const PRICING: Record<string, { input: number; output: number }> = {
  'deepseek-v4-flash': { input: 0.0008, output: 0.0012 },
  'deepseek-v4': { input: 0.002, output: 0.008 },
  'deepseek-reasoner': { input: 0.004, output: 0.016 },
  'deepseek-chat': { input: 0.002, output: 0.008 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  default: { input: 0.002, output: 0.008 },
};

export class CostTracker {
  constructor(private logPath: string) {}

  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  record(model: string, task: string, inputText: string, outputText: string, durationMs: number): void {
    const inputTokens = this.estimateTokens(inputText);
    const outputTokens = this.estimateTokens(outputText);
    const pricing = PRICING[model] ?? PRICING['default'];
    const rec: CostRecord = {
      timestamp: new Date().toISOString(),
      model,
      task,
      inputTokens,
      outputTokens,
      estimatedCostUsd: (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000,
      durationMs,
    };
    fsp
      .mkdir(path.dirname(this.logPath), { recursive: true })
      .then(() => fsp.appendFile(this.logPath, JSON.stringify(rec) + '\n', 'utf-8'))
      .catch((e) => console.error('[CostTracker] write failed:', (e as Error).message));
  }
}

// ── LLM Client（OpenAI 兼容，移植自 OpenAICompatibleClient）──

export class LLMClient {
  private baseUrl: string;
  private tracker: CostTracker | null = null;

  constructor(private config: LLMConfig) {
    this.baseUrl = config.baseUrl ?? PROVIDER_DEFAULT_BASE[config.provider] ?? PROVIDER_DEFAULT_BASE.openai;
  }

  get configured(): boolean {
    return this.config.apiKey.length > 0;
  }

  get model(): string {
    return this.config.model;
  }

  setCostTracker(tracker: CostTracker): void {
    this.tracker = tracker;
  }

  async chat(messages: LLMMessage[], options: LLMChatOptions = {}): Promise<string> {
    if (!this.configured) throw new Error('LLM not configured (LLM_API_KEY missing)');
    const timeoutMs = options.timeoutMs ?? 90_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    try {
      const resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 2048,
          ...(options.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const bodyText = (await resp.text()).slice(0, 300);
        throw new Error(`LLM HTTP ${resp.status}: ${bodyText}`);
      }
      const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content ?? '';
      if (!content) throw new Error('LLM returned empty content');
      this.tracker?.record(
        this.config.model,
        options.task ?? 'chat',
        messages.map((m) => m.content).join('\n'),
        content,
        Date.now() - start,
      );
      return content;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error(`LLM timeout after ${timeoutMs}ms`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async chatJSON<T>(messages: LLMMessage[], options: LLMChatOptions = {}): Promise<T> {
    const text = await this.chat(messages, { ...options, json: true });
    return extractAndRepairJSON<T>(text);
  }
}
