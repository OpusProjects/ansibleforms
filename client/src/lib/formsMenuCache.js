/******************************************************************/
/*                                                                */
/*  The forms menu's last categories and forms (Form.list), kept  */
/*  between pages : going from the Forms page to a form, or back, */
/*  the menu draws at once with what it had, then takes the new   */
/*  list - it does not empty and refill (a blink) on every page.  */
/*                                                                */
/******************************************************************/
import { shallowRef } from 'vue';

/** The last Form.list answer of this tab, or null before the first one. */
export const cachedFormConfig = shallowRef(null);
