export const ArtifactTypeValue = {
  Html: 'html',
  Svg: 'svg',
  Image: 'image',
  Mermaid: 'mermaid',
  Code: 'code',
  Markdown: 'markdown',
  Text: 'text',
  Document: 'document',
  LocalService: 'local-service',
} as const;
export type ArtifactType = typeof ArtifactTypeValue[keyof typeof ArtifactTypeValue];

export const PREVIEWABLE_ARTIFACT_TYPES = new Set<ArtifactType>([
  ArtifactTypeValue.Html,
  ArtifactTypeValue.Svg,
  ArtifactTypeValue.Mermaid,
  ArtifactTypeValue.Image,
  ArtifactTypeValue.Markdown,
  ArtifactTypeValue.Text,
  ArtifactTypeValue.Document,
  ArtifactTypeValue.LocalService,
]);

export interface Artifact {
  id: string;
  messageId: string;
  sessionId: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  fileName?: string;
  filePath?: string;
  url?: string;
  createdAt: number;
}

export interface ArtifactMarker {
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  fullMatch: string;
}
