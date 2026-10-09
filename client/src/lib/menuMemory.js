/******************************************************************/
/*                                                                */
/*  What the left menus showed last, kept for the tab : the       */
/*  forms' categories, the inventories, the jobs counted. A menu  */
/*  draws at once with it when its page opens, then takes the     */
/*  fresh data - it does not empty and refill (a blink) every     */
/*  time its section is entered. Forgotten at logout : it is the  */
/*  user's data.                                                  */
/*                                                                */
/******************************************************************/
import { shallowRef } from 'vue';

const memory = new Map();

/**
 * The remembered value of a menu, shared by every page that shows it.
 *
 * Args:
 *   key (string): the menu's name.
 *   initial (*): the value before anything was remembered.
 *
 * Returns:
 *   Ref: the value ; set it to remember the new one.
 */
export function remembered(key, initial = null) {
  if (!memory.has(key)) memory.set(key, shallowRef(initial));
  return memory.get(key);
}

/** Forgets every menu's data (a logout : the next user's menus start empty). */
export function forgetMenus() {
  memory.clear();
}
