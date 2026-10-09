/******************************************************************/
/*                                                                */
/*  The left menus' data loaded in the background once a user is  */
/*  known : the forms' categories, the jobs to count, the         */
/*  inventories. Even the first visit to a section then draws its */
/*  menu whole, at once, instead of filling it in. Only what the  */
/*  user may see, and only what is not remembered yet             */
/*  (lib/menuMemory.js).                                          */
/*                                                                */
/******************************************************************/
import axios from 'axios';
import Form from '@/lib/Form';
import TokenStorage from '@/lib/TokenStorage';
import { remembered } from '@/lib/menuMemory';

// as many jobs as the jobs list loads (pages/jobs.vue), so the counts it then shows are the same
const JOBS_COUNTED = 1000;

/**
 * Loads what the menus show, quietly : a failure only leaves that menu to load on its page.
 *
 * Args:
 *   store (object): the app store (the user's profile and options, the inventories switch).
 *
 * Returns:
 *   Promise<void>
 */
export async function preloadMenus(store) {
  const can = (option) => !!store?.profile?.options?.[option];
  const auth = TokenStorage.getAuthentication();
  const tasks = [];
  // ------------------------------------------------------------------
  // the forms' categories (every user has the Forms page)
  // ------------------------------------------------------------------
  const forms = remembered('forms', null);
  if (!forms.value) tasks.push(Form.list().then((config) => (forms.value = config)));
  // ------------------------------------------------------------------
  // the jobs, for the jobs menu's counts
  // ------------------------------------------------------------------
  const jobs = remembered('jobs', null);
  if (can('showJobs') && !jobs.value) {
    tasks.push(
      axios.get(`/api/v2/job?records=${JOBS_COUNTED}`, auth).then((r) => (jobs.value = r.data?.records || [])),
    );
  }
  // ------------------------------------------------------------------
  // the inventories : switched on, and the user's roles show them
  // ------------------------------------------------------------------
  const inventories = remembered('inventories', []);
  if (
    store?.profile?.options?.showInventories !== false &&
    store?.inventoriesEnabled !== false &&
    !inventories.value?.length
  ) {
    tasks.push(axios.get('/api/v2/inventory', auth).then((r) => (inventories.value = r.data?.records || [])));
  }
  await Promise.allSettled(tasks);
}
