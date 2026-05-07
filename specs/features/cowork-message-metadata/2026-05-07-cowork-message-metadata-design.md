# Cowork 消息元数据展示设计文档

## 1. 概述

OpenClaw 原生 UI 在每条 assistant 消息底部展示一行统计信息（input/output tokens、上下文占用百分比、模型名称等），LobsterAI 作为 OpenClaw 的 gateway-client 当前不展示这些信息。本次变更将从 OpenClaw 的 `chat.final` 事件中提取 token 使用量等元数据，持久化到本地 SQLite，并在 Cowork 聊天界面中展示。

### 设计目标

1. **展示关键统计** — 每条 assistant 回复底部展示 ↑input tokens、↓output tokens、context window 使用百分比、模型名称
2. **持久化存储** — 元数据存入 SQLite，历史会话可查看（不依赖实时连接）
3. **无侵入性** — 利用现有 metadata JSON 字段扩展，无需 DB schema 迁移
4. **紧凑 UI** — 灰色小字展示，不干扰正常阅读

### 不包含的内容

- Agent 名称展示（如 "main"）
- 费用/成本展示

### 影响范围

- **主进程**：`openclawRuntimeAdapter.ts` — 数据提取与 ctx% 计算
- **渲染进程**：类型定义、UI 组件、格式化工具

---

## 2. 数据来源分析

### 2.1 OpenClaw 消息结构

OpenClaw 的 `chat` 事件在 `state=final` 时，`payload.message` 包含：

```typescript
{
  role: 'assistant',
  content: [...],
  model: string,          // 使用的模型
  stopReason: string,
  usage: {
    input: number,        // 或 inputTokens
    output: number,       // 或 outputTokens
    cacheRead: number,    // 或 cache_read_input_tokens
    cacheWrite: number,   // 或 cache_creation_input_tokens
  },
  cost: {
    total: number,
    // ...
  },
}
```

### 2.2 contextTokens 来源

OpenClaw gateway 在 `sessions.list` RPC 响应的每个 session row 中返回 `contextTokens` 字段。该值由 gateway 内部通过三层 fallback 解析：

1. **用户配置**：`cfg.agents.defaults.contextTokens`
2. **Model registry 查找**：`lookupContextTokens(model)` — 从内置 model registry / models.json 缓存
3. **兜底默认值**：`DEFAULT_CONTEXT_TOKENS = 200_000`

**结论**：`contextTokens` 总能获取到值（最差情况下为 200k 默认值），无需客户端维护模型映射表。

### 2.3 当前 LobsterAI 提取情况

**文件**：`src/main/libs/agentEngine/openclawRuntimeAdapter.ts`

`handleChatFinal()` 方法（line 3283）当前仅提取：
- `stopReason`（line 3375）
- `errorMessage`（line 3377）

**未提取**：`usage`、`model`、`cost`

LobsterAI 已调用 `sessions.list`（line 1170），但未提取返回的 `contextTokens` 字段。

### 2.4 数据可用性

| 场景 | usage 是否可用 | contextTokens 是否可用 |
|------|---------------|----------------------|
| 实时收到 `chat.final` 事件 | ✅ 可用 | ✅ 通过 session row 获取 |
| 通过 `chat.history` RPC 恢复历史 | ❌ 不可用 | ✅ 可用但无 input 无法算 ctx% |
| 从本地 SQLite 加载 | 取决于是否已持久化 | 取决于是否已持久化 |

**结论**：必须在 `chat.final` 时提取 usage + 计算 ctx% 并存入 SQLite，后续从本地读取。

---

## 3. 数据模型设计

### 3.1 存储策略

**直接存计算结果（ctx%），不存 contextTokens。** 原因：

1. ctx% 是一个**历史快照** —— "这条消息回复时，上下文占了 15%"，这个事实不会随后续模型切换而变
2. 存一个 `contextPercent: 15` 比存 `contextTokens: 131072` + 需要再算更简单
3. 避免存储与展示的语义脱节

**需要存入 SQLite metadata 的字段：**

| 字段 | 来源 | 用途 |
|------|------|------|
| `inputTokens` | `chat.final` → `message.usage.input` | 展示 ↑ |
| `outputTokens` | `chat.final` → `message.usage.output` | 展示 ↓ |
| `contextPercent` | 写入时计算 `inputTokens / contextTokens * 100` | 展示 N% ctx |
| `model` | `chat.final` → `message.model` | 展示模型名 |

**时间**不需要额外存 —— `CoworkMessage` 已有 `timestamp` 字段。

### 3.2 类型定义变更

**文件**：`src/renderer/types/cowork.ts`

在 `CoworkMessageMetadata` 接口新增字段：

```typescript
export interface CoworkMessageMetadata {
  // ... 现有字段 ...
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolUseId?: string | null;
  error?: string;
  isError?: boolean;
  isStreaming?: boolean;
  isFinal?: boolean;
  isThinking?: boolean;
  skillIds?: string[];

  // ── 新增: Token 使用量与模型信息 ──
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  contextPercent?: number;  // 上下文窗口使用百分比（写入时计算）
  model?: string;           // 使用的模型名称

  [key: string]: unknown;
}
```

### 3.3 存储结构示例

无 DB schema 变更。`cowork_messages` 表的 `metadata` 列为 JSON 文本，新增字段直接序列化存入：

```json
{
  "isStreaming": false,
  "isFinal": true,
  "usage": {
    "inputTokens": 29600,
    "outputTokens": 647
  },
  "contextPercent": 15,
  "model": "qwen3.6-plus"
}
```

---

## 4. 主进程变更：数据提取

### 4.1 contextTokens 获取

**方案**：在 session 创建/同步时，从 `sessions.list` 返回的 session row 中提取 `contextTokens` 并缓存到 `ActiveTurn` 或 session 级内存结构中。

LobsterAI 已在 line 1170 调用 `sessions.list`，当前未提取 `contextTokens`。修改该处，将 `contextTokens` 存入 session 级缓存：

```typescript
// 在 session 信息中缓存 contextTokens
const sessionRow = sessions.find(s => s.key === sessionKey);
if (sessionRow?.contextTokens) {
  this.sessionContextTokens.set(sessionId, sessionRow.contextTokens);
}
```

新增实例属性：
```typescript
private sessionContextTokens = new Map<string, number>();
```

### 4.2 handleChatFinal() 修改

**文件**：`src/main/libs/agentEngine/openclawRuntimeAdapter.ts`

**位置**：`handleChatFinal()` 方法内，在 line 3317 的 `if (turn.assistantMessageId)` 分支之前新增提取逻辑。

```typescript
// ── 提取 usage + model 元数据 ──
const messageRecord = isRecord(payload.message) ? payload.message : null;

const usageRecord = messageRecord && isRecord(messageRecord.usage)
  ? messageRecord.usage as Record<string, number>
  : null;

const messageModel = messageRecord && typeof messageRecord.model === 'string'
  ? messageRecord.model : undefined;

const inputTokens = usageRecord
  ? (usageRecord.inputTokens ?? usageRecord.input ?? usageRecord.prompt_tokens ?? undefined)
  : undefined;
const outputTokens = usageRecord
  ? (usageRecord.outputTokens ?? usageRecord.output ?? usageRecord.completion_tokens ?? undefined)
  : undefined;

// 计算 ctx%
const contextTokens = this.sessionContextTokens.get(sessionId);
const contextPercent = (typeof inputTokens === 'number' && contextTokens && contextTokens > 0)
  ? Math.min(Math.round((inputTokens / contextTokens) * 100), 100)
  : undefined;

// 构建 metadata 扩展
const usageMetadataExt = {
  ...(inputTokens != null || outputTokens != null ? {
    usage: {
      ...(inputTokens != null && { inputTokens }),
      ...(outputTokens != null && { outputTokens }),
    }
  } : {}),
  ...(contextPercent != null && { contextPercent }),
  ...(messageModel && { model: messageModel }),
};
```

### 4.3 写入 metadata（含 merge 处理）

由于 `coworkStore.updateMessage()` 是**整体替换** metadata，需先读取再合并：

**位置 1** — 更新已有消息（line 3338-3344）：

```typescript
// 读取现有 metadata 并合并
const existingMsg = this.store.getMessage(sessionId, turn.assistantMessageId);
const existingMetadata = existingMsg?.metadata ?? {};

this.store.updateMessage(sessionId, turn.assistantMessageId, {
  content: persistedSegmentText,
  metadata: {
    ...existingMetadata,
    isStreaming: false,
    isFinal: true,
    ...usageMetadataExt,
  },
});
```

**位置 2** — 创建新消息（line 3352-3358）：

```typescript
const assistantMessage = this.store.addMessage(sessionId, {
  type: 'assistant',
  content: finalSegmentText,
  metadata: {
    isStreaming: false,
    isFinal: true,
    ...usageMetadataExt,
  },
});
```

**位置 3** — 复用已有消息（line 3348 `reuseFinalAssistantMessage`）：

```typescript
const reusedMessageId = this.reuseFinalAssistantMessage(sessionId, finalSegmentText);
if (reusedMessageId) {
  turn.assistantMessageId = reusedMessageId;
  // 补充 usage metadata
  const existingMsg = this.store.getMessage(sessionId, reusedMessageId);
  const existingMetadata = existingMsg?.metadata ?? {};
  this.store.updateMessage(sessionId, reusedMessageId, {
    metadata: { ...existingMetadata, ...usageMetadataExt },
  });
}
```

### 4.4 字段名兼容

OpenClaw 不同版本/不同模型 provider 返回的字段名不统一，需兼容多种命名：

| 语义 | 可能的字段名 |
|------|-------------|
| Input tokens | `input`, `inputTokens`, `prompt_tokens` |
| Output tokens | `output`, `outputTokens`, `completion_tokens` |
| Cache read | `cacheRead`, `cache_read_input_tokens` |
| Cache write | `cacheWrite`, `cache_creation_input_tokens` |

提取逻辑使用 `??` 链式取值覆盖所有变体。

---

## 5. 渲染层变更：格式化工具

### 5.1 新建工具文件

**新文件**：`src/renderer/utils/tokenFormat.ts`

```typescript
/**
 * 格式化 token 数量为紧凑显示。
 * 647 → "647", 1200 → "1.2k", 29600 → "29.6k", 128000 → "128k", 1500000 → "1.5M"
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(tokens);
}
```

---

## 6. 渲染层变更：UI 展示

### 6.1 展示位置

**文件**：`src/renderer/components/cowork/CoworkSessionDetail.tsx`

在 `AssistantTurnBlock` 组件内，消息内容渲染完成后，添加一行元数据。

### 6.2 展示格式

```
↑29.6k  ↓647  15% ctx  qwen3.6-plus
```

- `↑` + input tokens（格式化后）
- `↓` + output tokens（格式化后）
- `N% ctx`（上下文占用率）
- 模型名称（去掉 provider 前缀，如 `anthropic/claude-sonnet-4` → `claude-sonnet-4`）

### 6.3 样式

```tsx
<div className="flex items-center gap-2 mt-1 text-[11px] text-zinc-400 dark:text-zinc-500 select-none">
  {usage.inputTokens != null && (
    <span>↑{formatTokenCount(usage.inputTokens)}</span>
  )}
  {usage.outputTokens != null && (
    <span>↓{formatTokenCount(usage.outputTokens)}</span>
  )}
  {contextPercent != null && (
    <span className={contextPercent >= 90 ? 'text-red-400' : contextPercent >= 75 ? 'text-amber-400' : ''}>
      {contextPercent}% ctx
    </span>
  )}
  {model && (
    <span>{model.includes('/') ? model.split('/').pop() : model}</span>
  )}
</div>
```

### 6.4 颜色规则（ctx%）

| 占比 | 颜色 | 含义 |
|------|------|------|
| < 75% | 默认灰色 | 正常 |
| 75%–89% | 黄色/琥珀色 | 警告，上下文即将用完 |
| >= 90% | 红色 | 危险，可能触发截断 |

### 6.5 展示条件

- 仅 assistant 类型消息展示
- 仅 `metadata.isFinal === true` 且 `metadata.usage` 存在时展示
- 流式传输中（`isStreaming === true`）不展示

---

## 7. 风险与边缘场景

### 7.1 ⚠️ metadata 更新是 replace 而非 merge（高风险）

**风险等级**：高 — 可能影响现有功能

**场景**：`coworkStore.updateMessage()` 的 metadata 参数是**整体替换**（直接 `JSON.stringify(newMetadata)` 写入），而非与已有 metadata 合并。如果 `handleChatFinal` 只传入 `{ isStreaming: false, isFinal: true, usage: {...} }`，会丢失之前流式阶段写入的其他字段（如 `skillIds`、`isThinking`）。

**代码确认**：`src/main/coworkStore.ts` line 1020-1022：
```typescript
if (updates.metadata !== undefined) {
  setClauses.push('metadata = ?');
  values.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
}
```

**应对方案**：在 `handleChatFinal` 中写入 metadata 前，先读取该消息现有的 metadata，合并后再写入（见第 4.3 节实现）。

### 7.2 handleChatFinal 多分支遗漏（中风险）

**风险等级**：中 — 部分消息无元数据

**场景**：`handleChatFinal()` 内有三条路径处理 assistant 消息：

| 路径 | 位置 | 说明 |
|------|------|------|
| 更新已有消息 | line 3338 `this.store.updateMessage(...)` | `turn.assistantMessageId` 已存在时 |
| 复用已有消息 | line 3348 `reuseFinalAssistantMessage()` | 检测到可复用的消息时 |
| 创建新消息 | line 3352 `this.store.addMessage(...)` | 以上都不满足时 |

**应对**：三条路径都必须写入 usage metadata（见第 4.3 节三处写入位置）。

### 7.3 contextTokens 可能不准确（低风险）

**风险等级**：低 — ctx% 数值偏差

**场景**：如果用户使用 OpenClaw 不认识的自定义模型（如本地部署），且未在 config 中配置 `contextTokens`，gateway 会 fallback 到默认值 200k。此时 ctx% 计算基数不准确。

**应对**：属于边缘情况，不会导致功能异常。可在 UI 中当 ctx% < 1% 时不展示（可能是默认值过大导致的假数据）。

### 7.4 sessionContextTokens 缓存未命中（低风险）

**风险等级**：低 — ctx% 不展示

**场景**：如果 session 创建后未经过 `sessions.list` 调用（直接通过 `chat.send` 创建新 session），`sessionContextTokens` map 中可能无对应条目。

**应对**：`contextPercent` 为 undefined 时 UI 不展示 ctx%。后续可在 session 首次收到 chat.final 时补查一次 sessions.preview。

### 7.5 SQLite 老数据兼容（低风险）

**风险等级**：低 — 仅影响展示

**场景**：升级前的历史消息、从 `chat.history` 恢复的消息没有 usage 字段。

**处理**：UI 判断 `metadata.usage` 不存在时不渲染元数据行。不影响任何现有功能。

### 7.6 usage 字段名不统一（低风险）

**风险等级**：低 — 可能导致部分模型无数据

**场景**：不同模型 provider 返回的字段名不统一。

**应对**：用 `??` 链式取值覆盖已知变体。但新增 provider 可能引入未知字段名，需持续关注 OpenClaw 的 `normalizeUsage()` 更新。

### 7.7 chat.final 未到达（低风险）

**风险等级**：低 — 优雅降级

**场景**：网络断开或 gateway 异常，`chat.final` 事件未送达。

**处理**：该 turn 的消息通过 fallback 路径（`phase=end` 或 `chat.history` 同步）完成，但不包含 usage 数据。UI 不展示元数据行。与 OpenClaw 原生 UI 行为一致。

### 7.8 大数值 UI 溢出（极低风险）

**风险等级**：极低

**场景**：超长上下文模型（如 1M tokens）导致格式化后的字符串较长（"1.5M"）。

**处理**：`formatTokenCount` 已覆盖 M 级别格式化。UI 使用 flex 布局自适应宽度。

---

## 8. 测试

### 8.1 单元测试

**新文件**：`src/renderer/utils/tokenFormat.test.ts`

覆盖 `formatTokenCount` 的边界情况：

| 输入 | 预期输出 |
|------|----------|
| `0` | `"0"` |
| `647` | `"647"` |
| `999` | `"999"` |
| `1000` | `"1k"` |
| `1200` | `"1.2k"` |
| `29600` | `"29.6k"` |
| `128000` | `"128k"` |
| `1500000` | `"1.5M"` |

```bash
npm test -- tokenFormat
```

### 8.2 手动测试

| 测试项 | 步骤 | 预期结果 |
|--------|------|----------|
| 基本展示 | 发送消息并等待回复完成 | assistant 消息底部显示 ↑/↓/ctx%/模型名 |
| 流式过程不展示 | 观察回复流式传输中 | 元数据行不出现，直到 final |
| 模型切换 | 中途切换模型后发消息 | 新消息展示新模型名 |
| 历史消息兼容 | 查看升级前的历史会话 | 无元数据行，不报错 |
| 重启后保持 | 关闭并重新打开应用 | 历史消息的元数据行仍正常展示 |
| 暗色模式 | 切换 dark mode | 元数据文字颜色适配 |
| ctx% 高值 | 在长对话中观察 | ctx% 超过 75% 变黄，超过 90% 变红 |

---

## 9. 文件清单

| 文件 | 角色 | 变更类型 |
|------|------|----------|
| `src/main/libs/agentEngine/openclawRuntimeAdapter.ts` | 提取 usage/model，计算 ctx%，缓存 contextTokens | 修改 |
| `src/renderer/types/cowork.ts` | 新增 `usage`、`contextPercent`、`model` 类型定义 | 修改 |
| `src/renderer/utils/tokenFormat.ts` | Token 格式化工具 | 新增 |
| `src/renderer/utils/tokenFormat.test.ts` | 格式化工具单元测试 | 新增 |
| `src/renderer/components/cowork/CoworkSessionDetail.tsx` | 渲染元数据行 | 修改 |

---

## 10. IM 渠道消息 metadata 支持（补充设计）

### 10.1 问题描述

IM/channel 会话在 `handleChatFinal` 后会走 `reconcileWithHistory` 路径，该方法调用 `replaceConversationMessages` 全量重建消息（生成新 UUID）。原来由 `syncUsageMetadata` 用旧 `assistantMessageId` 更新 metadata 的方式，在消息 ID 被替换后失效。

### 10.2 方案

在 `reconcileWithHistory` 内部直接从 `chat.history` 返回数据中提取 usage/model，重建消息时一并写入 metadata。managed 会话继续使用现有 `syncUsageMetadata` 路径（managed 不走 reconcile）。

### 10.3 改动文件

| 文件 | 变更 |
|------|------|
| `src/main/libs/openclawHistory.ts` | `GatewayHistoryEntry` 接口新增 `usage?`、`model?`；`extractGatewayHistoryEntries` 提取这些字段 |
| `src/main/coworkStore.ts` | `replaceConversationMessages` 入参 entry 新增可选 `metadata`；插入时 merge 到基础 metadata |
| `src/main/libs/agentEngine/openclawRuntimeAdapter.ts` | `reconcileWithHistory` 构造 entries 时携带 usage/model metadata |

### 10.4 实现细节

**Step 1: 扩展 `GatewayHistoryEntry`**

```typescript
// src/main/libs/openclawHistory.ts
export interface GatewayHistoryEntry {
  role: string;
  text: string;
  usage?: { input?: number; output?: number };
  model?: string;
}
```

`extractGatewayHistoryEntries` 遍历时从原始 message 对象提取 `.usage` 和 `.model`。

**Step 2: 扩展 `replaceConversationMessages`**

```typescript
// src/main/coworkStore.ts
replaceConversationMessages(
  sessionId: string,
  authoritative: Array<{ role: 'user' | 'assistant'; text: string; metadata?: Record<string, unknown> }>,
): void {
  // ...
  const baseMetadata = { isStreaming: false, isFinal: true };
  const finalMetadata = entry.metadata
    ? { ...baseMetadata, ...entry.metadata }
    : baseMetadata;
  // INSERT ... VALUES (id, sessionId, entry.role, entry.text, JSON.stringify(finalMetadata), now, seq)
}
```

**Step 3: reconcileWithHistory 传递 metadata**

在构造 `authoritativeEntries` 时，从 `extractGatewayHistoryEntries` 结果中获取 usage/model，转换为 metadata 格式：

```typescript
for (const entry of extractGatewayHistoryEntries(history.messages)) {
  // ... 现有 role/text 处理 ...
  const entryMetadata: Record<string, unknown> | undefined =
    (entry.usage || entry.model) ? {
      ...(entry.usage && { usage: { inputTokens: entry.usage.input, outputTokens: entry.usage.output } }),
      ...(entry.model && { model: entry.model }),
    } : undefined;
  authoritativeEntries.push({ role, text, metadata: entryMetadata });
}
```

contextPercent 可选获取：如果 reconcile 内方便拿到 `sessions.preview` 数据则计算，否则留空。

### 10.5 风险与缓解

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| fast path (isInSync/tailInSync) 跳过时老消息无 metadata | 低 | 可接受：与 managed 行为一致，只影响已同步的老消息 |
| sync 比较逻辑误判 | 无 | 比较只看 role+text，metadata 不参与 |
| `replaceConversationMessages` 签名变更 | 低 | 仅 1 处调用 + 测试文件 |
| sessions.preview 额外 RPC | 低 | 可选：contextPercent 留空不影响基础展示 |

### 10.6 验证

1. `npm run electron:dev:openclaw` → IM 渠道发消息 → LobsterAI 查看该会话 → assistant 消息展示 token 统计
2. managed 会话（主窗口）功能不受影响
3. 重启应用 → 历史 IM 消息仍展示 metadata
4. TypeScript 编译 + ESLint 通过
