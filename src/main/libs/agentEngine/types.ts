import type { OpenClawSessionPatch } from '../../../common/openclawSession';
import type { CoworkMessage, CoworkSessionStatus } from '../../coworkStore';

export type CoworkAgentEngine = 'openclaw';

export type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: Record<string, unknown>[];
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };

export const ENGINE_SWITCHED_CODE = 'ENGINE_SWITCHED';

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string | null;
}

export interface CoworkRuntimeEvents {
  message: (sessionId: string, message: CoworkMessage, beforeMessageId?: string) => void;
  messageUpdate: (sessionId: string, messageId: string, content: string, metadata?: Record<string, unknown>) => void;
  sessionStatus: (sessionId: string, status: CoworkSessionStatus) => void;
  contextUsageUpdate: (sessionId: string, usage: CoworkContextUsage) => void;
  contextMaintenance: (sessionId: string, active: boolean) => void;
  permissionRequest: (sessionId: string, request: PermissionRequest) => void;
  complete: (sessionId: string, claudeSessionId: string | null) => void;
  error: (sessionId: string, error: string) => void;
  sessionStopped: (sessionId: string) => void;
}

export type CoworkContextUsage = {
  sessionId: string;
  sessionKey?: string;
  usedTokens?: number;
  contextTokens?: number;
  percent?: number;
  compactionCount?: number;
  status: 'unknown' | 'normal' | 'warning' | 'danger' | 'compacting';
  latestCompactionCheckpointId?: string;
  latestCompactionReason?: string;
  latestCompactionCreatedAt?: number;
  model?: string;
  updatedAt: number;
};

export type CoworkImageAttachment = {
  name: string;
  mimeType: string;
  base64Data: string;
};

export type CoworkMediaSelection = {
  mode: 'auto' | 'image' | 'video' | 'none';
  modelId?: string;
  modelName?: string;
  imageModelId?: string;
  videoModelId?: string;
};

export type CoworkStartOptions = {
  skipInitialUserMessage?: boolean;
  skillIds?: string[];
  systemPrompt?: string;
  autoApprove?: boolean;
  workspaceRoot?: string;
  confirmationMode?: 'modal' | 'text';
  imageAttachments?: CoworkImageAttachment[];
  agentId?: string;
  mediaSelection?: CoworkMediaSelection;
};

export type CoworkContinueOptions = {
  systemPrompt?: string;
  skillIds?: string[];
  imageAttachments?: CoworkImageAttachment[];
  mediaSelection?: CoworkMediaSelection;
};

export interface CoworkRuntime {
  on<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this;
  off<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this;
  startSession(sessionId: string, prompt: string, options?: CoworkStartOptions): Promise<void>;
  continueSession(sessionId: string, prompt: string, options?: CoworkContinueOptions): Promise<void>;
  patchSession?(sessionId: string, patch: OpenClawSessionPatch): Promise<void>;
  getContextUsage?(sessionId: string): Promise<CoworkContextUsage | null>;
  compactContext?(sessionId: string): Promise<{ compacted: boolean; reason?: string; usage?: CoworkContextUsage | null }>;
  stopSession(sessionId: string): void;
  stopAllSessions(): void;
  respondToPermission(requestId: string, result: PermissionResult): void;
  isSessionActive(sessionId: string): boolean;
  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null;
  onSessionDeleted?(sessionId: string): void;
}
