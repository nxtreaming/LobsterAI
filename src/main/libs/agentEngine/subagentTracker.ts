import crypto from 'node:crypto';

import type { SubagentRunStore } from '../../subagentRunStore';
import {
  extractGatewayMessageText,
  shouldSuppressHeartbeatText,
} from '../openclawHistory';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

/** Message format compatible with renderer CoworkMessage interface */
export interface SubagentCoworkMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    toolUseId?: string | null;
    isError?: boolean;
    [key: string]: unknown;
  };
}

export type GatewayClientLike = {
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number | null },
  ) => Promise<T>;
};

/**
 * Encapsulates all subagent (child session) tracking logic:
 * state maps, lifecycle detection, history fetching, and persistence.
 *
 * All in-memory maps are keyed by toolCallId (unique per spawn invocation)
 * to avoid collisions when multiple subagents share the same agentId.
 */
export class SubagentTracker {
  /** Maps toolCallId → OpenClaw session key for the subagent session */
  private readonly subagentSessionKeys = new Map<string, string>();
  /** Maps toolCallId → collected conversation messages (CoworkMessage format) */
  private readonly subagentMessages = new Map<string, SubagentCoworkMessage[]>();
  /** Maps toolCallId → agentId for correlating spawn start → result */
  private readonly subagentToolCallIdToAgentId = new Map<string, string>();
  /** Maps toolCallId → lifecycle status */
  private readonly subagentStatus = new Map<string, 'running' | 'done'>();
  /** Reverse map: agentId → Set of toolCallIds (for lookups from sessions_resume args) */
  private readonly agentIdToToolCallIds = new Map<string, Set<string>>();

  constructor(
    private readonly store: SubagentRunStore,
    private readonly getGatewayClient: () => GatewayClientLike | null,
  ) {}

  // ── Event hooks (called by adapter at key points) ──────────────────────

  /**
   * Called when a sessions_spawn tool call starts.
   * Tracks the subagent and persists the initial run record.
   * Uses toolCallId as the unique run identifier to avoid collisions
   * when multiple subagents share the same agentId.
   */
  onToolStart(
    toolCallId: string,
    args: Record<string, unknown>,
    sessionId: string,
  ): void {
    const agentId = typeof args?.agentId === 'string' && args.agentId
      ? args.agentId
      : typeof args?.taskName === 'string' && args.taskName
        ? args.taskName
        : typeof args?.label === 'string' && args.label
          ? args.label
          : toolCallId;
    const task = typeof args?.task === 'string' ? args.task : '';
    const label = typeof args?.label === 'string' ? args.label : undefined;
    if (agentId) {
      this.subagentStatus.set(toolCallId, 'running');
      if (!this.subagentMessages.has(toolCallId)) {
        this.subagentMessages.set(toolCallId, []);
      }
      this.subagentToolCallIdToAgentId.set(toolCallId, agentId);
      // Maintain reverse mapping for onResumeOrReadResult lookups
      let toolCallIds = this.agentIdToToolCallIds.get(agentId);
      if (!toolCallIds) {
        toolCallIds = new Set();
        this.agentIdToToolCallIds.set(agentId, toolCallIds);
      }
      toolCallIds.add(toolCallId);
      this.store.insertSubagentRun({
        id: toolCallId,
        parentSessionId: sessionId,
        sessionKey: null,
        agentId,
        task: task || null,
        label: label ?? null,
        status: 'running',
        createdAt: Date.now(),
      });
    }
  }

  /**
   * Called when a sessions_spawn tool result arrives.
   * Extracts childSessionKey and persists it.
   */
  onSpawnResult(toolCallId: string, resultText: string, _args: Record<string, unknown>): void {
    if (!resultText) return;
    try {
      const parsed = JSON.parse(resultText);
      const childSessionKey = typeof parsed?.childSessionKey === 'string' ? parsed.childSessionKey : '';
      if (toolCallId && childSessionKey && this.subagentToolCallIdToAgentId.has(toolCallId)) {
        this.subagentSessionKeys.set(toolCallId, childSessionKey);
        this.store.updateSubagentRunSessionKey(toolCallId, childSessionKey);
      }
    } catch { /* result may not be JSON */ }
  }

  /**
   * Called when sessions_resume or sessions_read tool result arrives.
   * Marks matching subagent(s) as done.
   */
  onResumeOrReadResult(args: Record<string, unknown>): void {
    const agentId = typeof args?.agentId === 'string' ? args.agentId : '';
    if (!agentId) return;
    const toolCallIds = this.agentIdToToolCallIds.get(agentId);
    if (!toolCallIds) return;
    for (const tcId of toolCallIds) {
      if (this.subagentStatus.get(tcId) === 'running') {
        this.subagentStatus.set(tcId, 'done');
        this.store.updateSubagentRunStatus(tcId, 'done', Date.now());
      }
    }
  }

  /**
   * Called when backfill retrieves a sessions_spawn tool result text.
   * Extracts childSessionKey if not already known.
   */
  onBackfillResult(toolCallId: string, text: string): void {
    if (!this.subagentToolCallIdToAgentId.has(toolCallId)) return;
    if (this.subagentSessionKeys.has(toolCallId)) return;
    try {
      const parsed = JSON.parse(text);
      const childSessionKey = typeof parsed?.childSessionKey === 'string' ? parsed.childSessionKey : '';
      if (childSessionKey) {
        this.subagentSessionKeys.set(toolCallId, childSessionKey);
        this.store.updateSubagentRunSessionKey(toolCallId, childSessionKey);
        console.log('[SubagentTracker] session key from backfill:', toolCallId, childSessionKey);
      }
    } catch { /* not JSON */ }
  }

  /**
   * Detects announce-style runIds that signal subagent completion.
   * Announce runIds follow the pattern: announce:v<N>:agent:<parent>:subagent:<uuid>:<runUuid>
   * Returns true if the runId was an announce pattern (even if no matching subagent was found).
   */
  tryMarkDoneFromAnnounceRunId(runId: string): boolean {
    const match = runId.match(/^announce:.*:subagent:([0-9a-f-]+)/i);
    if (!match) return false;
    const subagentUuid = match[1];
    for (const [toolCallId, sessionKey] of this.subagentSessionKeys) {
      if (sessionKey.includes(subagentUuid)) {
        if (this.subagentStatus.get(toolCallId) !== 'done') {
          this.subagentStatus.set(toolCallId, 'done');
          this.store.updateSubagentRunStatus(toolCallId, 'done', Date.now());
          console.log('[SubagentTracker] marked subagent as done via announce:', toolCallId);
        }
        return true;
      }
    }
    console.debug('[SubagentTracker] announce runId detected but no matching subagent:', runId);
    return true;
  }

  /**
   * Clears all in-memory subagent tracking state.
   */
  onSessionDeleted(): void {
    this.subagentSessionKeys.clear();
    this.subagentMessages.clear();
    this.subagentStatus.clear();
    this.subagentToolCallIdToAgentId.clear();
    this.agentIdToToolCallIds.clear();
  }

  // ── Public query API ───────────────────────────────────────────────────

  /**
   * Returns persisted subagent runs for a parent session.
   * Merges in-memory status with database records for real-time accuracy.
   */
  listSubagentRuns(parentSessionId: string): Array<{
    id: string;
    agentId: string | null;
    task: string | null;
    label: string | null;
    sessionKey: string | null;
    status: 'running' | 'done' | 'error';
    createdAt: number;
  }> {
    const runs = this.store.listSubagentRuns(parentSessionId);
    return runs.map((run) => {
      const memoryStatus = this.subagentStatus.get(run.id);
      const memorySessionKey = this.subagentSessionKeys.get(run.id);
      return {
        id: run.id,
        agentId: run.agentId,
        task: run.task,
        label: run.label,
        sessionKey: memorySessionKey ?? run.sessionKey,
        status: memoryStatus ?? run.status,
        createdAt: run.createdAt,
      };
    });
  }

  /**
   * Fetch conversation history for a subagent session.
   * Tries local cache first, then falls back to gateway RPC.
   * Note: runId parameter is the unique run identifier (toolCallId stored as DB id).
   */
  async getSubTaskHistory(
    parentSessionId: string,
    runId: string,
    sessionKey?: string,
  ): Promise<SubagentCoworkMessage[]> {
    // 1. Try locally collected messages (only serve cache if subagent is done)
    const status = this.subagentStatus.get(runId);
    const local = this.subagentMessages.get(runId);
    if (local && local.length > 0 && status === 'done') {
      return local;
    }

    // 2. Resolve session key from multiple sources
    let key = sessionKey || this.subagentSessionKeys.get(runId);

    // 2b. Try reading from persistent store if not in memory
    if (!key) {
      const runs = this.store.listSubagentRuns(parentSessionId);
      const matchingRun = runs.find((r) => r.id === runId || r.agentId === runId);
      if (matchingRun?.sessionKey) {
        key = matchingRun.sessionKey;
        this.subagentSessionKeys.set(runId, key);
      }
      // 2c. If runId didn't match directly, check if it's a UUID that appears in any session key
      if (!key) {
        const runWithKeyMatch = runs.find((r) =>
          r.sessionKey && r.sessionKey.includes(runId),
        );
        if (runWithKeyMatch?.sessionKey) {
          key = runWithKeyMatch.sessionKey;
          this.subagentSessionKeys.set(runId, key);
        }
      }
    }

    if (!key) {
      console.log('[SubagentTracker] getSubTaskHistory: no session key resolved for runId:', runId, 'parentSession:', parentSessionId);
      const discovered = await this.discoverSubagentSessionKey(runId);
      if (!discovered) return [];
      this.subagentSessionKeys.set(runId, discovered);
      return this.fetchSubagentHistory(discovered, runId);
    }

    console.log('[SubagentTracker] getSubTaskHistory: fetching history for runId:', runId, 'key:', key);
    return this.fetchSubagentHistory(key, runId);
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async discoverSubagentSessionKey(runId: string): Promise<string | null> {
    const client = this.getGatewayClient();
    if (!client) return null;
    // Also try the agentId for discovery (the run may have been registered with a meaningful agentId)
    const agentId = this.subagentToolCallIdToAgentId.get(runId) || runId;
    try {
      const result = await client.request<{ sessions?: unknown[] }>('sessions.list', {
        activeMinutes: 120,
      }, { timeoutMs: 5_000 });
      const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
      for (const session of sessions) {
        if (!isRecord(session)) continue;
        const key = typeof session.key === 'string' ? session.key : '';
        if (key.includes(`:${agentId}:`) || key.includes(`:${agentId}`)
            || key.includes(`subagent:${agentId}`)) {
          return key;
        }
      }
    } catch (error) {
      console.warn('[SubagentTracker] Failed to discover subagent session key:', error);
    }
    return null;
  }

  private async fetchSubagentHistory(
    sessionKey: string,
    runId: string,
  ): Promise<SubagentCoworkMessage[]> {
    const client = this.getGatewayClient();
    if (!client) return [];
    try {
      const history = await client.request<{ messages?: unknown[] }>('chat.history', {
        sessionKey,
        limit: 100,
      }, { timeoutMs: 10_000 });

      if (!Array.isArray(history?.messages) || history.messages.length === 0) {
        console.log('[SubagentTracker] fetchSubagentHistory: no messages returned for key:', sessionKey);
        return [];
      }

      console.log('[SubagentTracker] fetchSubagentHistory: got', history.messages.length, 'raw messages for key:', sessionKey);

      const messages: SubagentCoworkMessage[] = [];
      let ts = Date.now() - history.messages.length * 1000; // synthetic timestamps

      for (const raw of history.messages) {
        if (!isRecord(raw)) continue;
        const role = typeof raw.role === 'string' ? raw.role.trim().toLowerCase() : '';

        // Handle standard user/assistant/system messages
        if (role === 'user' || role === 'assistant' || role === 'system') {
          const text = extractGatewayMessageText(raw).trim();

          // For assistant messages with content array containing tool_use blocks
          if (role === 'assistant' && Array.isArray(raw.content)) {
            // Extract text parts first
            if (text && !shouldSuppressHeartbeatText(role, text)) {
              messages.push({
                id: crypto.randomUUID(),
                type: 'assistant',
                content: text,
                timestamp: ts++,
              });
            }
            // Extract tool_use blocks
            for (const block of raw.content as unknown[]) {
              if (!isRecord(block)) continue;
              const blockType = typeof block.type === 'string' ? block.type : '';
              if (blockType === 'tool_use' || blockType === 'tool_call' || blockType === 'toolCall') {
                const toolName = typeof block.name === 'string' ? block.name : 'tool';
                const toolInput = isRecord(block.input) ? block.input as Record<string, unknown> : {};
                const toolUseId = typeof block.id === 'string' ? block.id : null;
                messages.push({
                  id: crypto.randomUUID(),
                  type: 'tool_use',
                  content: '',
                  timestamp: ts++,
                  metadata: { toolName, toolInput, toolUseId },
                });
              }
            }
          } else if (text && !shouldSuppressHeartbeatText(role as 'user' | 'assistant' | 'system', text)) {
            const type = role === 'system' ? 'system' : role as 'user' | 'assistant';
            messages.push({
              id: crypto.randomUUID(),
              type,
              content: text,
              timestamp: ts++,
            });
          } else if (!text) {
            console.log('[SubagentTracker] dropped message with empty text, role:', role, 'keys:', Object.keys(raw).join(','));
          }
          continue;
        }

        // Handle tool result messages
        if (role === 'tool_result' || role === 'toolresult' || role === 'tool' || role === 'function') {
          const text = extractGatewayMessageText(raw).trim();
          const toolName = typeof raw.toolName === 'string' ? raw.toolName
            : typeof raw.tool_name === 'string' ? raw.tool_name
              : typeof raw.name === 'string' ? raw.name : '';
          const toolUseId = typeof raw.tool_use_id === 'string' ? raw.tool_use_id
            : typeof raw.toolCallId === 'string' ? raw.toolCallId : null;
          if (text) {
            messages.push({
              id: crypto.randomUUID(),
              type: 'tool_result',
              content: text,
              timestamp: ts++,
              metadata: { toolName: toolName || undefined, toolResult: text, toolUseId },
            });
          } else {
            console.log('[SubagentTracker] dropped tool result with empty text, role:', role);
          }
          continue;
        }

        // Handle messages with content arrays that contain tool_use blocks (no role field)
        if (!role && Array.isArray(raw.content)) {
          for (const block of raw.content as unknown[]) {
            if (!isRecord(block)) continue;
            const blockType = typeof block.type === 'string' ? block.type : '';
            if (blockType === 'tool_use' || blockType === 'tool_call' || blockType === 'toolCall') {
              const toolName = typeof block.name === 'string' ? block.name : 'tool';
              const toolInput = isRecord(block.input) ? block.input as Record<string, unknown> : {};
              const toolUseId = typeof block.id === 'string' ? block.id : null;
              messages.push({
                id: crypto.randomUUID(),
                type: 'tool_use',
                content: '',
                timestamp: ts++,
                metadata: { toolName, toolInput, toolUseId },
              });
            } else if (blockType === 'text' && typeof block.text === 'string' && block.text.trim()) {
              messages.push({
                id: crypto.randomUUID(),
                type: 'assistant',
                content: block.text.trim(),
                timestamp: ts++,
              });
            }
          }
          continue;
        }

        // Log completely unhandled messages
        console.log('[SubagentTracker] unhandled message, role:', role || '(empty)', 'keys:', Object.keys(raw).join(','));
      }

      // Cache locally
      this.subagentMessages.set(runId, messages);

      // Update status if we got messages and the session appears done
      if (messages.length > 0 && this.subagentStatus.get(runId) !== 'done') {
        this.subagentStatus.set(runId, 'done');
        this.store.updateSubagentRunStatus(runId, 'done', Date.now());
        console.log('[SubagentTracker] marked subagent as done via history fallback:', runId);
      }

      console.log('[SubagentTracker] fetchSubagentHistory: extracted', messages.length, 'display messages for runId:', runId);
      return messages;
    } catch (error) {
      console.warn('[SubagentTracker] Failed to fetch subagent history:', error);
      return [];
    }
  }
}
