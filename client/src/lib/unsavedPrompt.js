/******************************************************************/
/*                                                                */
/*  The Unsaved changes question : one for the whole app, shown   */
/*  by AppUnsavedDialog (App.vue) and asked by useUnsavedGuard    */
/*  when a page with unsaved changes is left.                     */
/*                                                                */
/******************************************************************/
import { reactive } from 'vue';

// what the dialog shows : open or not, its message, and who waits for the answer
export const unsavedPrompt = reactive({ open: false, message: '', resolve: null });

/**
 * Asks whether to leave the page and lose its unsaved changes.
 *
 * Args:
 *   message (string): the question.
 *
 * Returns:
 *   Promise<boolean>: true to leave, false to stay.
 */
export function askToLeave(message) {
  // a question still open (a second navigation before the first was answered) : it stays
  unsavedPrompt.resolve?.(false);
  return new Promise((resolve) => {
    Object.assign(unsavedPrompt, { open: true, message, resolve });
  });
}

/**
 * Answers the question and closes the dialog.
 *
 * Args:
 *   leave (boolean): leave the page (true) or stay on it (false).
 */
export function answerUnsaved(leave) {
  const resolve = unsavedPrompt.resolve;
  Object.assign(unsavedPrompt, { open: false, message: '', resolve: null });
  resolve?.(leave);
}
