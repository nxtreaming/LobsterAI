export const AgentDetailTab = {
  Prompt: 'prompt',
  Identity: 'identity',
  Skills: 'skills',
  Im: 'im',
} as const;

export type AgentDetailTab = typeof AgentDetailTab[keyof typeof AgentDetailTab];

export const AgentConfirmDialogVariant = {
  Unsaved: 'unsaved',
  Delete: 'delete',
} as const;

export type AgentConfirmDialogVariant = typeof AgentConfirmDialogVariant[keyof typeof AgentConfirmDialogVariant];
