import type { Agent } from '../coworkStore';

type BuildManagedAgentEntriesInput = {
  agents: Agent[];
  fallbackPrimaryModel: string;
};

export function buildManagedAgentEntries({
  agents,
  fallbackPrimaryModel,
}: BuildManagedAgentEntriesInput): Array<Record<string, unknown>> {
  return agents
    .filter((agent) => agent.id !== 'main' && agent.enabled)
    .map((agent) => ({
      id: agent.id,
      ...(agent.name || agent.icon ? {
        identity: {
          ...(agent.name ? { name: agent.name } : {}),
          ...(agent.icon ? { emoji: agent.icon } : {}),
        },
      } : {}),
      ...(agent.skillIds && agent.skillIds.length > 0 ? { skills: agent.skillIds } : {}),
      model: {
        primary: agent.model.trim() || fallbackPrimaryModel,
      },
    }));
}
