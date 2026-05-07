import { expect, test } from 'vitest';

import coworkReducer, { addSession, setConfig, updateCurrentSessionModelOverride } from './coworkSlice';

test('defaults hidden OpenClaw session policy to thirty days', () => {
  const state = coworkReducer(undefined, { type: 'init' });

  expect(state.config.openClawSessionPolicy).toEqual({
    keepAlive: '30d',
  });
  expect(state.config.skipMissedJobs).toBe(true);
});

test('setConfig preserves loaded OpenClaw session policy', () => {
  const state = coworkReducer(undefined, setConfig({
    workingDirectory: '/tmp',
    systemPrompt: '',
    executionMode: 'local',
    agentEngine: 'openclaw',
    memoryEnabled: true,
    memoryImplicitUpdateEnabled: true,
    memoryLlmJudgeEnabled: false,
    memoryGuardLevel: 'strict',
    memoryUserMemoriesMaxItems: 12,
    skipMissedJobs: false,
    embeddingEnabled: false,
    embeddingProvider: 'openai',
    embeddingModel: '',
    embeddingLocalModelPath: '',
    embeddingVectorWeight: 0.7,
    embeddingRemoteBaseUrl: '',
    embeddingRemoteApiKey: '',
    openClawSessionPolicy: {
      keepAlive: '365d',
    },
  }));

  expect(state.config.openClawSessionPolicy.keepAlive).toBe('365d');
});

test('updateCurrentSessionModelOverride only patches the active session', () => {
  const session = {
    id: 'session-1',
    title: 'Test Session',
    claudeSessionId: null,
    status: 'completed' as const,
    pinned: false,
    cwd: '/tmp',
    systemPrompt: '',
    modelOverride: 'openai/gpt-5.4',
    executionMode: 'local' as const,
    activeSkillIds: [],
    agentId: 'main',
    messages: [],
    messagesOffset: 0,
    totalMessages: 0,
    createdAt: 1,
    updatedAt: 1,
  };

  const activeState = coworkReducer(
    coworkReducer(undefined, addSession(session)),
    updateCurrentSessionModelOverride({
      sessionId: 'session-1',
      modelOverride: 'lobsterai-server/qwen3.6-plus-YoudaoInner',
    }),
  );

  expect(activeState.currentSession?.modelOverride).toBe('lobsterai-server/qwen3.6-plus-YoudaoInner');

  const ignoredState = coworkReducer(
    activeState,
    updateCurrentSessionModelOverride({
      sessionId: 'session-2',
      modelOverride: 'moonshot/kimi-k2.6',
    }),
  );

  expect(ignoredState.currentSession?.modelOverride).toBe('lobsterai-server/qwen3.6-plus-YoudaoInner');
});
