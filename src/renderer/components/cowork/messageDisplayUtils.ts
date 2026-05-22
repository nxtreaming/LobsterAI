/**
 * Utility functions and types for message display in conversation views.
 * Extracted from CoworkSessionDetail.tsx for reuse by ConversationTurnsView.
 */

import {
  ContextCompactionMode,
  ContextCompactionStatus,
  CoworkSystemMessageKind,
  isInternalCompactionSystemText,
} from '../../../common/coworkSystemMessages';
import { i18nService } from '../../services/i18n';
import type { CoworkMessage, CoworkMessageMetadata } from '../../types/cowork';

// ── Types ────────────────────────────────────────────────────────────────────

export type TodoStatus = 'completed' | 'in_progress' | 'pending' | 'unknown';

export type ParsedTodoItem = {
  primaryText: string;
  secondaryText: string | null;
  status: TodoStatus;
};

export type ToolGroupItem = {
  type: 'tool_group';
  toolUse: CoworkMessage;
  toolResult?: CoworkMessage | null;
};

export type DisplayItem =
  | { type: 'message'; message: CoworkMessage }
  | ToolGroupItem;

export type AssistantTurnItem =
  | { type: 'assistant'; message: CoworkMessage }
  | { type: 'system'; message: CoworkMessage }
  | { type: 'tool_group'; group: ToolGroupItem }
  | { type: 'tool_result'; message: CoworkMessage };

export type ConversationTurn = {
  id: string;
  userMessage: CoworkMessage | null;
  assistantItems: AssistantTurnItem[];
};

// ── Constants ────────────────────────────────────────────────────────────────

export const COWORK_DETAIL_CONTENT_CLASS = 'mx-auto w-full max-w-[760px]';
export const COWORK_DETAIL_GUTTER_CLASS = 'px-6 sm:px-8 lg:px-10';

const TOOL_USE_ERROR_TAG_PATTERN = /^<tool_use_error>([\s\S]*?)<\/tool_use_error>$/i;
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;
export const MEDIA_TOKEN_DISPLAY_RE = /\n?MEDIA:\s*`?[^`\n]+?`?\s*$/gim;
const SILENT_TOKEN_RE = /^[`*_~"'""''()[\]{}<>.,!?;:，。！？；：\s-]{0,8}NO_REPLY[`*_~"'""''()[\]{}<>.,!?;:，。！？；：\s-]{0,8}$/i;

// ── Pure utility functions ───────────────────────────────────────────────────

export const formatUnknown = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const getStringArray = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;
  const lines = value.filter((item) => typeof item === 'string') as string[];
  return lines.length > 0 ? lines.join('\n') : null;
};

export const normalizeToolName = (value: string): string => value.toLowerCase().replace(/[\s_]+/g, '');

export const getToolDisplayName = (toolName: string | undefined): string => {
  if (!toolName) return 'Tool';
  const normalized = normalizeToolName(toolName);
  switch (normalized) {
    case 'cron':
      return 'Cron';
    case 'exec':
    case 'bash':
    case 'shell':
      return 'Bash';
    case 'read':
    case 'readfile':
      return 'Read';
    case 'write':
    case 'writefile':
      return 'Write';
    case 'edit':
    case 'editfile':
      return 'Edit';
    case 'multiedit':
      return 'MultiEdit';
    case 'process':
      return 'Process';
    case 'sessionsspawn':
      return 'Subagent';
    default:
      return toolName;
  }
};

export const isBashLikeToolName = (toolName: string | undefined): boolean => {
  if (!toolName) return false;
  const normalized = normalizeToolName(toolName);
  return normalized === 'bash' || normalized === 'exec' || normalized === 'shell';
};

export const getToolInputString = (
  input: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
};

export const truncatePreview = (value: string, maxLength = 120): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;

export const normalizeToolResultText = (value: string): string => {
  const withoutAnsi = value.replace(ANSI_ESCAPE_PATTERN, '');
  const errorTagMatch = withoutAnsi.trim().match(TOOL_USE_ERROR_TAG_PATTERN);
  const cleaned = errorTagMatch ? errorTagMatch[1].trim() : withoutAnsi;
  return cleaned.replace(MEDIA_TOKEN_DISPLAY_RE, '').trimEnd();
};

export const isTodoWriteToolName = (toolName: string | undefined): boolean => {
  if (!toolName) return false;
  return normalizeToolName(toolName) === 'todowrite';
};

export const isCronToolName = (toolName: string | undefined): boolean => {
  if (!toolName) return false;
  return normalizeToolName(toolName) === 'cron';
};

export const getCronToolSummary = (input: Record<string, unknown>): string | null => {
  const action = getToolInputString(input, ['action']);
  if (!action) return null;

  const job = input.job && typeof input.job === 'object'
    ? input.job as Record<string, unknown>
    : null;
  const jobName = job
    ? getToolInputString(job, ['name', 'id'])
    : null;
  const jobId = getToolInputString(input, ['jobId', 'id'])
    ?? (job ? getToolInputString(job, ['id']) : null);
  const wakeText = getToolInputString(input, ['text']);

  switch (action) {
    case 'add':
      return [action, jobName ?? jobId].filter(Boolean).join(' · ');
    case 'update':
    case 'remove':
    case 'run':
    case 'runs':
      return [action, jobId ?? jobName].filter(Boolean).join(' · ');
    case 'wake':
      return [action, wakeText].filter(Boolean).join(' · ');
    default:
      return action;
  }
};

export const formatStructuredText = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value;
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return value;
  }
};

export const toTrimmedString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

export const normalizeTodoStatus = (value: unknown): TodoStatus => {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/-/g, '_')
    : '';

  if (normalized === 'completed') return 'completed';
  if (normalized === 'in_progress' || normalized === 'running') return 'in_progress';
  if (normalized === 'pending' || normalized === 'todo') return 'pending';
  return 'unknown';
};

export const parseTodoWriteItems = (input: unknown): ParsedTodoItem[] | null => {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.todos)) return null;

  const parsedItems = record.todos
    .map((rawTodo) => {
      if (!rawTodo || typeof rawTodo !== 'object') {
        return null;
      }

      const todo = rawTodo as Record<string, unknown>;
      const activeForm = toTrimmedString(todo.activeForm);
      const content = toTrimmedString(todo.content);
      const primaryText = activeForm ?? content ?? i18nService.t('coworkTodoUntitled');
      const secondaryText = content && content !== primaryText ? content : null;

      return {
        primaryText,
        secondaryText,
        status: normalizeTodoStatus(todo.status),
      } satisfies ParsedTodoItem;
    })
    .filter((item): item is ParsedTodoItem => item !== null);

  return parsedItems.length > 0 ? parsedItems : null;
};

export const getTodoWriteSummary = (items: ParsedTodoItem[]): string => {
  const completedCount = items.filter((item) => item.status === 'completed').length;
  const inProgressCount = items.filter((item) => item.status === 'in_progress').length;
  const pendingCount = items.length - completedCount - inProgressCount;

  const summary = [
    `${items.length} ${i18nService.t('coworkTodoItems')}`,
    `${completedCount} ${i18nService.t('coworkTodoCompleted')}`,
    `${inProgressCount} ${i18nService.t('coworkTodoInProgress')}`,
    `${pendingCount} ${i18nService.t('coworkTodoPending')}`,
  ];

  const activeItem = items.find((item) => item.status === 'in_progress');
  if (activeItem) {
    summary.push(activeItem.primaryText);
  }

  return summary.join(' · ');
};

export const getToolInputSummary = (
  toolName: string | undefined,
  toolInput?: Record<string, unknown>
): string | null => {
  if (!toolName || !toolInput) return null;
  const input = toolInput as Record<string, unknown>;
  if (isTodoWriteToolName(toolName)) {
    const items = parseTodoWriteItems(input);
    return items ? getTodoWriteSummary(items) : null;
  }

  const normalizedToolName = normalizeToolName(toolName);

  switch (normalizedToolName) {
    case 'cron':
      return getCronToolSummary(input);
    case 'bash':
    case 'exec':
    case 'shell':
      return getToolInputString(input, ['command', 'cmd', 'script'])
        ?? getStringArray(input.commands);
    case 'read':
    case 'readfile':
    case 'write':
    case 'writefile':
    case 'edit':
    case 'editfile':
    case 'multiedit':
      return getToolInputString(input, ['file_path', 'path', 'filePath', 'target_file', 'targetFile'])
        ?? (
          typeof input.content === 'string' && input.content.trim()
            ? truncatePreview(input.content.split('\n')[0].trim())
            : null
        );
    case 'glob':
    case 'grep':
      return getToolInputString(input, ['pattern', 'query']);
    case 'task':
      return getToolInputString(input, ['description', 'task']);
    case 'webfetch':
      return getToolInputString(input, ['url']);
    case 'process': {
      const action = getToolInputString(input, ['action']);
      const sessionId = getToolInputString(input, ['sessionId', 'session_id']);
      if (action && sessionId) return `${action} · ${sessionId}`;
      return action ?? sessionId;
    }
    case 'sessionsspawn': {
      const spawnAgent = getToolInputString(input, ['agentId', 'agent_id']);
      const spawnTask = getToolInputString(input, ['task']);
      return [spawnAgent, spawnTask ? truncatePreview(spawnTask) : null].filter(Boolean).join(' · ');
    }
    default:
      return null;
  }
};

export const formatToolInput = (
  toolName: string | undefined,
  toolInput?: Record<string, unknown>
): string | null => {
  if (!toolInput) return null;
  const summary = getToolInputSummary(toolName, toolInput);
  if (summary && summary.trim()) {
    return summary;
  }
  return formatUnknown(toolInput);
};

export const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const getToolResultDisplay = (message: CoworkMessage): string => {
  if (hasText(message.content)) {
    return formatStructuredText(normalizeToolResultText(message.content));
  }
  if (hasText(message.metadata?.toolResult)) {
    return formatStructuredText(normalizeToolResultText(message.metadata?.toolResult ?? ''));
  }
  if (hasText(message.metadata?.error)) {
    return formatStructuredText(normalizeToolResultText(message.metadata?.error ?? ''));
  }
  return '';
};

export const getToolResultLineCount = (result: string): number => {
  if (!result) return 0;
  return result.split('\n').length;
};

// ── Message classification ───────────────────────────────────────────────────

export const isSilentAssistantMessage = (message: CoworkMessage): boolean => (
  message.type === 'assistant' && SILENT_TOKEN_RE.test(message.content.trim())
);

export const isContextCompactionMessage = (message: CoworkMessage): boolean => (
  message.type === 'system' && message.metadata?.kind === CoworkSystemMessageKind.ContextCompaction
);

export const isLegacyInternalCompactionSystemMessage = (message: CoworkMessage): boolean => (
  message.type === 'system'
  && !message.metadata?.kind
  && isInternalCompactionSystemText(message.content)
);

const isRenderableAssistantOrSystemMessage = (message: CoworkMessage): boolean => {
  if (isSilentAssistantMessage(message)) {
    return false;
  }
  if (isLegacyInternalCompactionSystemMessage(message)) {
    return false;
  }
  if (hasText(message.content) || hasText(message.metadata?.error)) {
    return true;
  }
  if (message.metadata?.isThinking) {
    return true;
  }
  return false;
};

const isVisibleAssistantTurnItem = (item: AssistantTurnItem): boolean => {
  if (item.type === 'assistant' || item.type === 'system') {
    return isRenderableAssistantOrSystemMessage(item.message);
  }
  if (item.type === 'tool_result') {
    return hasText(getToolResultDisplay(item.message));
  }
  return true;
};

export const getVisibleAssistantItems = (assistantItems: AssistantTurnItem[]): AssistantTurnItem[] =>
  assistantItems.filter(isVisibleAssistantTurnItem);

export const hasRenderableAssistantContent = (turn: ConversationTurn): boolean => (
  getVisibleAssistantItems(turn.assistantItems).length > 0
);

// ── Build pipeline ───────────────────────────────────────────────────────────

export const buildDisplayItems = (messages: CoworkMessage[]): DisplayItem[] => {
  const items: DisplayItem[] = [];
  const groupsByToolUseId = new Map<string, ToolGroupItem>();
  let pendingAdjacentGroup: ToolGroupItem | null = null;

  for (const message of messages) {
    if (isSilentAssistantMessage(message)) {
      continue;
    }
    if (isLegacyInternalCompactionSystemMessage(message)) {
      continue;
    }

    if (message.type === 'tool_use') {
      const group: ToolGroupItem = { type: 'tool_group', toolUse: message };
      items.push(group);

      const toolUseId = message.metadata?.toolUseId;
      if (typeof toolUseId === 'string' && toolUseId.trim()) {
        groupsByToolUseId.set(toolUseId, group);
      }
      pendingAdjacentGroup = group;
      continue;
    }

    if (message.type === 'tool_result') {
      let matched = false;
      const toolUseId = message.metadata?.toolUseId;
      if (typeof toolUseId === 'string' && groupsByToolUseId.has(toolUseId)) {
        const group = groupsByToolUseId.get(toolUseId);
        if (group) {
          group.toolResult = message;
          matched = true;
        }
      } else if (pendingAdjacentGroup && !pendingAdjacentGroup.toolResult) {
        pendingAdjacentGroup.toolResult = message;
        matched = true;
      }

      pendingAdjacentGroup = null;
      if (!matched) {
        items.push({ type: 'message', message });
      }
      continue;
    }

    pendingAdjacentGroup = null;
    items.push({ type: 'message', message });
  }

  return items;
};

export const buildConversationTurns = (items: DisplayItem[]): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;
  let orphanIndex = 0;

  const ensureTurn = (): ConversationTurn => {
    if (currentTurn) return currentTurn;
    const orphanTurn: ConversationTurn = {
      id: `orphan-${orphanIndex++}`,
      userMessage: null,
      assistantItems: [],
    };
    turns.push(orphanTurn);
    currentTurn = orphanTurn;
    return orphanTurn;
  };

  for (const item of items) {
    if (item.type === 'message' && item.message.type === 'user') {
      currentTurn = {
        id: item.message.id,
        userMessage: item.message,
        assistantItems: [],
      };
      turns.push(currentTurn);
      continue;
    }

    if (item.type === 'tool_group') {
      const turn = ensureTurn();
      turn.assistantItems.push({ type: 'tool_group', group: item });
      continue;
    }

    const message = item.message;
    if (isContextCompactionMessage(message) && currentTurn?.assistantItems.length) {
      currentTurn = null;
    }
    const turn = ensureTurn();

    if (message.type === 'assistant') {
      turn.assistantItems.push({ type: 'assistant', message });
      continue;
    }

    if (message.type === 'system') {
      turn.assistantItems.push({ type: 'system', message });
      continue;
    }

    if (message.type === 'tool_result') {
      turn.assistantItems.push({ type: 'tool_result', message });
      continue;
    }

    if (message.type === 'tool_use') {
      turn.assistantItems.push({
        type: 'tool_group',
        group: {
          type: 'tool_group',
          toolUse: message,
        },
      });
    }
  }

  return turns;
};

// ── Metadata helpers ─────────────────────────────────────────────────────────

export const getMessageModelLabel = (metadata?: CoworkMessageMetadata | null): string | null => {
  const model = typeof metadata?.model === 'string' ? metadata.model.trim() : '';
  if (!model) return null;
  return model.includes('/') ? (model.split('/').pop() || model) : model;
};

export const messageMetaClassName = (visible: boolean, align: 'left' | 'right' = 'left'): string => [
  'flex items-center gap-2 mt-1 text-[11px] text-zinc-400 dark:text-zinc-500 select-none transition-opacity duration-200',
  align === 'right' ? 'justify-end' : '',
  visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
].filter(Boolean).join(' ');

// ── Context compaction helpers ───────────────────────────────────────────────

export const getContextCompactionMessageLabel = (message: CoworkMessage, fallbackContent: string): string => {
  if (message.metadata?.mode === ContextCompactionMode.Manual && fallbackContent.trim()) {
    return fallbackContent;
  }

  switch (message.metadata?.status) {
    case ContextCompactionStatus.Running:
      return i18nService.t('coworkContextCompactionRunning');
    case ContextCompactionStatus.Retrying:
      return i18nService.t('coworkContextCompactionRetrying');
    case ContextCompactionStatus.Failed:
      return i18nService.t('coworkContextCompactionFailed');
    case ContextCompactionStatus.Completed:
      return i18nService.t('coworkContextCompactionCompleted');
    default:
      return fallbackContent.trim()
        ? fallbackContent
        : i18nService.t('coworkContextCompactionCompleted');
  }
};

