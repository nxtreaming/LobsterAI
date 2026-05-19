import { type Artifact, type ArtifactType, ArtifactTypeValue } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';

/**
 * Normalize file path for deduplication comparison.
 * Handles Windows file:// URL leading slash and backslash differences.
 */
export function normalizeFilePathForDedup(p: string): string {
  // Strip leading / before drive letter (e.g. /D:/path from file:///D:/path)
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  // Unify separators and case for comparison
  return p.replace(/\\/g, '/').toLowerCase();
}

const EXTENSION_TO_ARTIFACT_TYPE: Record<string, ArtifactType> = {
  '.html': 'html',
  '.htm': 'html',
  '.svg': 'svg',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.mermaid': 'mermaid',
  '.mmd': 'mermaid',
  '.jsx': 'code',
  '.tsx': 'code',
  '.css': 'code',
  '.md': 'markdown',
  '.txt': 'text',
  '.log': 'text',
  '.csv': 'document',
  '.tsv': 'document',
  '.xls': 'document',
  '.docx': 'document',
  '.xlsx': 'document',
  '.pptx': 'document',
  '.pdf': 'document',
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const BINARY_DOCUMENT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.pdf', '.csv', '.tsv', '.xls']);
const LOCAL_SERVICE_URL_RE = /\bhttps?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:\/[^\s<>"'`)\]]*)?/gi;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
const LOCAL_SERVICE_TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：！？、]+$/;

export function getArtifactTypeFromExtension(ext: string): ArtifactType | null {
  return EXTENSION_TO_ARTIFACT_TYPE[ext.toLowerCase()] ?? null;
}

export function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export function isBinaryDocumentExtension(ext: string): boolean {
  return BINARY_DOCUMENT_EXTENSIONS.has(ext.toLowerCase());
}

function trimLocalServiceUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  while (url.endsWith(')') && !url.includes('(')) {
    url = url.slice(0, -1);
  }
  while (url.endsWith(']') && !url.includes('[')) {
    url = url.slice(0, -1);
  }
  return url.replace(LOCAL_SERVICE_TRAILING_PUNCTUATION_RE, '');
}

export function normalizeLocalServiceUrlForDedup(url: string): string {
  try {
    const parsed = new URL(trimLocalServiceUrl(url));
    const pathname = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return trimLocalServiceUrl(url).toLowerCase();
  }
}

function isLocalServiceUrl(url: string): boolean {
  try {
    const parsed = new URL(trimLocalServiceUrl(url));
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    if (!isHttp) return false;

    return parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '0.0.0.0' ||
      parsed.hostname === '[::1]' ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

function buildLocalServiceTitle(url: string, linkText?: string): string {
  const title = linkText?.trim();
  if (title && !/^https?:\/\//i.test(title)) {
    return title;
  }

  try {
    const parsed = new URL(url);
    const pathPart = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '');
    return pathPart || parsed.host;
  } catch {
    return url;
  }
}

export function parseLocalServiceUrlsFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const seenUrls = new Set<string>();
  let index = 0;

  const addUrl = (rawUrl: string, linkText?: string) => {
    const url = trimLocalServiceUrl(rawUrl);
    if (!url || !isLocalServiceUrl(url)) return;

    const normalized = normalizeLocalServiceUrlForDedup(url);
    if (seenUrls.has(normalized)) return;
    seenUrls.add(normalized);

    artifacts.push({
      id: `artifact-local-service-${messageId}-${index}`,
      messageId,
      sessionId,
      type: ArtifactTypeValue.LocalService,
      title: buildLocalServiceTitle(url, linkText),
      content: url,
      url,
      createdAt: Date.now(),
    });
    index++;
  };

  const markdownRe = new RegExp(MARKDOWN_LINK_RE.source, 'gi');
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownRe.exec(messageContent)) !== null) {
    addUrl(markdownMatch[2], markdownMatch[1]);
  }

  const urlRe = new RegExp(LOCAL_SERVICE_URL_RE.source, 'gi');
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRe.exec(messageContent)) !== null) {
    addUrl(urlMatch[0]);
  }

  return artifacts;
}

export const MEDIA_TOKEN_RE = /\bMEDIA:\s*`?([^`\n]+?)`?\s*$/gim;

export function parseMediaTokensFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(MEDIA_TOKEN_RE.source, 'gim');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    let filePath = match[1].trim();
    if (!filePath) continue;

    if (filePath.startsWith('file:///')) {
      filePath = filePath.slice(7);
    } else if (filePath.startsWith('file://')) {
      filePath = filePath.slice(7);
    }

    // Strip leading / before Windows drive letter (e.g. /D:/path from file:///D:/path)
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    const ext = getFileExtension(filePath);
    const artifactType = getArtifactTypeFromExtension(ext);
    if (!artifactType) continue;

    const fileName = getFileName(filePath);

    artifacts.push({
      id: `artifact-media-${messageId}-${index}`,
      messageId,
      sessionId,
      type: artifactType,
      title: fileName,
      content: '',
      fileName,
      filePath,
      createdAt: Date.now(),
    });

    index++;
  }

  return artifacts;
}

const FILE_LINK_RE = /\[([^\]]+)\]\(file:\/\/([^)]+)\)/g;

export function stripFileLinksFromText(text: string): string {
  return text.replace(/\[([^\]]+)\]\(file:\/\/([^)]+)\)/g, '');
}

const BARE_FILE_PATH_RE = /(?:^|[\s"'`(])(\/?(?:[^\s"'`()\[\]]+\/)*[^\s"'`()\[\]]+\.(?:docx|xlsx|pptx|pdf|md|txt|log|csv))(?:[\s"'`)]|$)/gm;

export function parseFilePathsFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
  idPrefix = 'artifact-path',
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(BARE_FILE_PATH_RE.source, 'gm');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    let filePath = match[1];

    if (filePath.startsWith('file:///')) {
      filePath = filePath.slice(7);
    } else if (filePath.startsWith('file://')) {
      filePath = filePath.slice(7);
    } else if (filePath.startsWith('file:/')) {
      filePath = filePath.slice(5);
    }

    // Strip leading / before Windows drive letter (e.g. /D:/path from file:///D:/path)
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    const ext = getFileExtension(filePath);
    const artifactType = getArtifactTypeFromExtension(ext);
    if (!artifactType) continue;

    const fileName = getFileName(filePath);

    artifacts.push({
      id: `${idPrefix}-${messageId}-${index}`,
      messageId,
      sessionId,
      type: artifactType,
      title: fileName,
      content: '',
      fileName,
      filePath,
      createdAt: Date.now(),
    });

    index++;
  }

  return artifacts;
}

export function parseFileLinksFromMessage(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(FILE_LINK_RE.source, 'g');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    const linkText = match[1];
    let filePath: string;
    try {
      filePath = decodeURIComponent(match[2]);
    } catch {
      filePath = match[2];
    }
    // Strip leading / before Windows drive letter (e.g. /D:/path from file:///D:/path)
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }
    const ext = getFileExtension(filePath);
    const artifactType = getArtifactTypeFromExtension(ext);
    if (!artifactType) continue;

    const fileName = getFileName(filePath);

    artifacts.push({
      id: `artifact-link-${messageId}-${index}`,
      messageId,
      sessionId,
      type: artifactType,
      title: linkText || fileName,
      content: '',
      fileName,
      filePath,
      createdAt: Date.now(),
    });

    index++;
  }

  return artifacts;
}

const WRITE_TOOL_NAMES = new Set(['write', 'writefile', 'write_file']);

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[_\s]/g, '');
}

function extractFilePath(toolInput: Record<string, unknown>): string | null {
  for (const key of ['file_path', 'path', 'filePath', 'target_file', 'targetFile']) {
    const val = toolInput[key];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  return null;
}

function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}

export function parseToolArtifact(
  toolUseMsg: CoworkMessage,
  toolResultMsg: CoworkMessage | undefined,
  sessionId: string,
): Artifact | null {
  const toolName = toolUseMsg.metadata?.toolName;
  if (!toolName || !WRITE_TOOL_NAMES.has(normalizeToolName(toolName))) {
    return null;
  }

  if (toolResultMsg?.metadata?.isError) {
    return null;
  }

  const toolInput = toolUseMsg.metadata?.toolInput as Record<string, unknown> | undefined;
  if (!toolInput) return null;

  const filePath = extractFilePath(toolInput);
  if (!filePath) return null;

  const ext = getFileExtension(filePath);
  const artifactType = getArtifactTypeFromExtension(ext);
  if (!artifactType) return null;

  const fileName = getFileName(filePath);
  const isImage = isImageExtension(ext);
  const isBinaryDoc = isBinaryDocumentExtension(ext);
  const content = (isImage || isBinaryDoc) ? '' : (typeof toolInput.content === 'string' ? toolInput.content : '');

  return {
    id: `artifact-tool-${toolUseMsg.id}`,
    messageId: toolUseMsg.id,
    sessionId,
    type: artifactType,
    title: fileName,
    content,
    fileName,
    filePath,
    createdAt: toolUseMsg.timestamp || Date.now(),
  };
}
