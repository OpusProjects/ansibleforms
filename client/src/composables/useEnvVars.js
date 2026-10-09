/******************************************************************/
/*                                                                */
/*  Some environment variables on a page of their own : loaded    */
/*  from and saved to /api/v2/config/env, as on Settings >        */
/*  AnsibleForms, but only the ones the page names (the MCP       */
/*  page, the chat assistant's switch). Each field is an          */
/*  AppEnvField.                                                  */
/*                                                                */
/******************************************************************/

import { ref, computed } from 'vue';
import axios from 'axios';
import { toast } from 'vue-sonner';
import TokenStorage from '@/lib/TokenStorage';
import Helpers from '@/lib/Helpers';

/**
 * Whether a variable can be written from the page. A field is a real input only then :
 * never for a refused variable, and never for one the real environment already sets,
 * because dotenv will not overwrite that and the save would silently do nothing.
 *
 * Args:
 *   e (Object): the variable, as GET /api/v2/config/env returns it.
 *
 * Returns:
 *   boolean: true when it can be saved.
 */
export function envEditable(e) {
  return e.editable !== 'refused' && !e.overridden;
}

/**
 * The named environment variables, their edits and their Save.
 *
 * Args:
 *   names (Array<string>): the variables of the page, in the order it shows them.
 *
 * Returns:
 *   Object: envItems (the variables, in that order), envEdits (the edited values, by name),
 *   envDirty, envRestartPending (the names a restart applies), loadEnvironmentVariables()
 *   and saveEnvironmentVariables().
 */
export function useEnvVars(names) {
  const env = ref([]);

  // The edited values, keyed by variable name. Seeded from what the server reports so
  // 'dirty' means 'differs from what is actually in effect', not 'has been touched'.
  const envEdits = ref({});
  const envBaseline = ref({});
  const envRestartPending = ref([]);

  // the page's variables, in its order ; one the server does not know is left out
  const envItems = computed(() => names.map((n) => env.value.find((e) => e.name === n)).filter(Boolean));

  const envSecret = computed(() => new Set(envItems.value.filter((e) => e.secret).map((e) => e.name)));
  const envDirtyNames = computed(() =>
    Object.keys(envEdits.value).filter((k) => {
      // a blank secret box means 'leave it alone', not 'set it to empty'
      if (envSecret.value.has(k) && String(envEdits.value[k] ?? '') === '') return false;
      return String(envEdits.value[k] ?? '') !== String(envBaseline.value[k] ?? '');
    }),
  );
  const envDirty = computed(() => envDirtyNames.value.length > 0);

  /**
   * Loads the variables, and seeds the edits with the page's ones (a secret's box empty).
   */
  async function loadEnvironmentVariables() {
    try {
      const result = await axios.get('/api/v2/config/env', TokenStorage.getAuthentication());
      env.value = Array.isArray(result.data) ? result.data : [];
      const edits = {};
      for (const e of envItems.value) if (envEditable(e)) edits[e.name] = e.secret ? '' : (e.value ?? '');
      envEdits.value = { ...edits };
      envBaseline.value = { ...edits };
    } catch (err) {
      toast.error(Helpers.parseAxiosResponseError(err));
    }
  }

  /**
   * Saves the changed variables only, then loads them again.
   */
  async function saveEnvironmentVariables() {
    const changed = envDirtyNames.value;
    if (changed.length === 0) return;
    const payload = {};
    for (const n of changed) payload[n] = envEdits.value[n] ?? '';
    try {
      const result = await axios.put('/api/v2/config/env', payload, TokenStorage.getAuthentication());
      toast.success(result.data.message);
      envRestartPending.value = result.data?.restartRequired || [];
      await loadEnvironmentVariables();
    } catch (err) {
      toast.error(Helpers.parseAxiosResponseError(err));
    }
  }

  return { envItems, envEdits, envDirty, envRestartPending, loadEnvironmentVariables, saveEnvironmentVariables };
}
