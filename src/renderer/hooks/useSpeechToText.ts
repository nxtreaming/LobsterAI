/**
 * Trigger the OS-level voice dictation.
 *
 * Windows: simulates Win+H via main-process IPC.
 * macOS: simulates Fn+Fn via main-process IPC.
 *
 * The system dictation UI appears and types recognized text
 * directly into the currently focused input element.
 */
export async function triggerSystemDictation(): Promise<void> {
  try {
    const result = await window.electron.voice.triggerDictation();
    if (!result.success) {
      console.warn('[Voice] triggerDictation failed:', result.error);
    }
  } catch (err) {
    console.warn('[Voice] triggerDictation error:', err);
  }
}
