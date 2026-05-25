export const ClipboardIpc = {
  WriteImageFromFile: 'clipboard:writeImageFromFile',
  WriteImageFromDataUrl: 'clipboard:writeImageFromDataUrl',
} as const;

export type ClipboardIpc = typeof ClipboardIpc[keyof typeof ClipboardIpc];
