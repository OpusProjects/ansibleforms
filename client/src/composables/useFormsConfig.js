import { ref, computed } from 'vue';
import axios from 'axios';
import { toast } from 'vue-sonner';
import TokenStorage from '@/lib/TokenStorage';
import Helpers from '@/lib/Helpers';
import yaml from 'yaml';
import { useI18n } from 'vue-i18n';
import {
  authProviders,
  roleOptionKeys,
  roleOptionDefaults,
  roleOptionLabel,
  parseProviderEntry,
  formatProviderEntry,
  roleToEditable,
  serializeRole,
} from '@/config/roles';
import { constantsToArray, arrayToConstants } from '@/config/constants';

// Detect ytt templating: any line starting (after optional whitespace) with `#@`
// is a ytt directive. Such configs are templates that must not be section-merged.
const yttDirectiveRegex = /^\s*#@/m;

// Row ids for v-for keys. An index key would keep the DOM node (and with it the
// focus and the IME composition state) on a row whose identity moved, so
// deleting a row above a focused input types into the wrong record.
let uidCounter = 0;
function nextUid() {
  return ++uidCounter;
}

// Stamp a missing _uid on every row of a tree. Internal keys (leading _) are
// stripped from the dirty snapshot and never serialized back to yaml.
function stampUids(rows, childKeys = []) {
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;
    if (!row._uid) row._uid = nextUid();
    for (const key of childKeys) {
      if (Array.isArray(row[key])) stampUids(row[key], childKeys);
    }
  }
}

// Parse a config.yaml string. Returns the parsed object, an empty skeleton
// for empty input, or null when a non-empty string fails to parse (so callers
// can treat a syntax error explicitly instead of silently wiping the config).
function parseConfig(yamlStr) {
  if (!yamlStr) return { categories: [], roles: [], constants: {} };
  try {
    return yaml.parse(yamlStr) || { categories: [], roles: [], constants: {} };
  } catch {
    return null;
  }
}

// Icon written for a category that has none. An empty string passes the schema
// but renders nothing (AppMenuItem does <FaIcon :icon="menu.icon">) and the
// designer refuses to save a category list whose first entry has no icon, so a
// missing icon must be materialized as a real one. Same default as the designer.
export const DEFAULT_CATEGORY_ICON = 'bars';

// Normalize the loaded categories, recursively : the schema requires both name
// and icon at every depth, so a subcategory that has no icon in the yaml must
// get one here too, otherwise saving fails validation on a field the user
// never touched.
function normalizeCategories(cats) {
  return (cats || []).map((c) => {
    const cat = { name: c.name || '', icon: c.icon || DEFAULT_CATEGORY_ICON };
    if (c.items) cat.items = normalizeCategories(c.items);
    return cat;
  });
}

// Rebuild the categories, recursively : the schema allows name/icon/items only,
// so subcategories must be rebuilt too instead of being passed through (they
// carry editor-internal keys like _uid). Names are trimmed : categories are
// addressed by their slash-joined path (a form's `categories: [Parent/Child]`,
// AppMenuItem.inCategory), which compares the names literally, so a stray space
// would leave the entry unreachable.
function buildCategories(cats) {
  return cats.map((c) => {
    const cat = { name: (c.name || '').trim(), icon: c.icon || DEFAULT_CATEGORY_ICON };
    if (c.items && c.items.length > 0) cat.items = buildCategories(c.items);
    return cat;
  });
}

function buildRoles(rolesList) {
  return rolesList.map(serializeRole);
}

export function useFormsConfig() {
  const { t } = useI18n();

  const item = ref({});
  const categories = ref([]);
  const roles = ref([]);
  const constants = ref([]);
  const originalSnapshot = ref(null);
  const parseError = ref(false);
  const isTemplated = ref(false);
  const loadError = ref('');
  // sha256 of the config we loaded, sent back on save so the server can refuse
  // (409) when someone else changed the config in the meantime.
  const baseHash = ref(null);

  async function load() {
    try {
      loadError.value = '';
      const result = await axios.get('/api/v2/settings/config', TokenStorage.getAuthentication());
      item.value = result.data;
      baseHash.value = result.data.baseHash || null;
      // ytt-templated configs are read-only here: a section merge would still
      // corrupt the template. Show the parsed data but block edits/saves.
      isTemplated.value = yttDirectiveRegex.test(item.value.forms_yaml || '');
      if (isTemplated.value) {
        toast.warning(t('settings.settingsPage.configTemplated'));
      }
      const config = parseConfig(item.value.forms_yaml);
      if (config === null) {
        parseError.value = true;
        toast.error(t('settings.settingsPage.configParseError'));
        return;
      }
      parseError.value = false;
      categories.value = normalizeCategories(config.categories);
      roles.value = (config.roles || []).map(roleToEditable);
      constants.value = constantsToArray(config.constants);
      // stamp the row ids before anything renders : a v-for keyed on an
      // undefined _uid would warn about duplicate keys and share state between
      // rows on that first render
      stampUids(categories.value, ['items']);
      stampUids(roles.value, ['groups', 'users']);
      stampUids(constants.value, ['children']);
      originalSnapshot.value = {
        categories: JSON.stringify(categories.value, stripInternal),
        roles: JSON.stringify(roles.value, stripInternal),
        constants: JSON.stringify(constants.value, stripInternal),
      };
    } catch (err) {
      // Without a snapshot nothing can ever be dirty, so Save would stay dead
      // forever : make the failure explicit and put the editor in read-only.
      loadError.value = Helpers.parseAxiosResponseError(err);
      toast.error(loadError.value);
    }
  }

  /**
   * @returns {Promise<boolean>} whether the config was actually written.
   *
   * It used to swallow every error and return undefined, so a caller could not tell a
   * 423/409 from a success. roles.vue then re-stamped its reserved-name flags after a
   * FAILED save, which disabled the name input and the delete button on a role the user
   * had just renamed to 'public' - unrecoverable without a reload, which discarded
   * everything.
   */
  async function save(successLabel) {
    try {
      // Re-read the raw yaml so the section merge below applies to the current
      // document (comments and untouched sections included). baseHash is NOT
      // refreshed from this read : it must stay the hash of what the user
      // started editing, otherwise the server could never detect a conflict.
      const current = await axios.get('/api/v2/settings/config', TokenStorage.getAuthentication());
      const rawYaml = current.data.forms_yaml || '';

      // Defense in depth: never section-merge into a ytt template.
      if (yttDirectiveRegex.test(rawYaml)) {
        isTemplated.value = true;
        toast.warning(t('settings.settingsPage.configTemplated'));
        return false;
      }

      // Edit the document in place so comments, anchors and every section we
      // don't touch (e.g. the whole `forms:` block) are preserved verbatim.
      const doc = yaml.parseDocument(rawYaml);
      if (doc.errors.length > 0) {
        toast.error(t('settings.settingsPage.configParseError'));
        return false;
      }

      if (isCategoriesDirty.value) {
        doc.set('categories', doc.createNode(buildCategories(categories.value)));
      }
      if (isRolesDirty.value) {
        doc.set('roles', doc.createNode(buildRoles(roles.value)));
      }
      if (isConstantsDirty.value) {
        doc.set('constants', doc.createNode(arrayToConstants(constants.value)));
      }

      const payload = { forms_yaml: doc.toString() };
      if (baseHash.value) payload.baseHash = baseHash.value;
      await axios.put('/api/v2/settings/config', payload, TokenStorage.getAuthentication());
      toast.success((successLabel || t('settings.settingsPage.label')) + ' ' + t('settings.common.isUpdated'));
      await load();
      return true;
    } catch (err) {
      // 409 : the stored config no longer matches the one we loaded, someone else saved
      // in the meantime.
      //
      // This used to be a dead end. baseHash stayed at the value the server had just
      // rejected, so every following save 409'd too and the only way out was a reload -
      // which threw away everything the user had just done. Re-read the current hash so
      // a SECOND, deliberate save can go through, and say so: the first click is refused
      // and informs, the second overwrites on purpose.
      if (err.response?.status === 409) {
        try {
          const fresh = await axios.get('/api/v2/settings/config', TokenStorage.getAuthentication());
          baseHash.value = fresh.data.baseHash || '';
          toast.error(t('settings.common.configChangedElsewhereRetry'));
        } catch {
          // could not re-read : leave baseHash alone, a reload is the only safe way out
          toast.error(t('settings.common.configChangedElsewhere'));
        }
        return false;
      }
      toast.error(Helpers.parseAxiosResponseError(err));
      return false;
    }
  }

  function stripInternal(key, value) {
    if (typeof key === 'string' && key.startsWith('_')) return undefined;
    return value;
  }

  const isCategoriesDirty = computed(() => {
    if (!originalSnapshot.value) return false;
    return JSON.stringify(categories.value, stripInternal) !== originalSnapshot.value.categories;
  });

  const isRolesDirty = computed(() => {
    if (!originalSnapshot.value) return false;
    return JSON.stringify(roles.value, stripInternal) !== originalSnapshot.value.roles;
  });

  const isConstantsDirty = computed(() => {
    if (!originalSnapshot.value) return false;
    return JSON.stringify(constants.value, stripInternal) !== originalSnapshot.value.constants;
  });

  return {
    item,
    categories,
    roles,
    constants,
    parseError,
    isTemplated,
    loadError,
    load,
    save,
    nextUid,
    isCategoriesDirty,
    isRolesDirty,
    isConstantsDirty,
    roleOptionKeys,
    roleOptionDefaults,
    // bound to this composable's translator so pages can call it with the key only
    roleOptionLabel: (key) => roleOptionLabel(t, key),
    authProviders,
    parseProviderEntry,
    formatProviderEntry,
  };
}
