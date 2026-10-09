<script setup>
import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue';
import Form from '@/lib/Form';
import Lock from '@/lib/Lock';
import { useAppStore } from '@/stores/app';
import Backup from '@/lib/Backup';
import Profile from '@/lib/Profile';
import YAML from 'yaml';
import { toast } from 'vue-sonner';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import Helpers from '@/lib/Helpers';
import BaseUrl from '@/lib/BaseUrl';
import axios from 'axios';
import TokenStorage from '@/lib/TokenStorage';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { availableIcons } from '@/config/icons';
import { editorStyle } from '@/config/editorStyle';
import {
  authProviders,
  roleOptionKeys,
  roleOptionDefaults,
  roleOptionLabel as roleOptionLabelFor,
  roleToEditable,
  serializeRole,
} from '@/config/roles';
import {
  coerceConstantValue,
  constantValueError,
  constantValueRows,
  constantsToArray,
  arrayToConstants,
  flattenConstants,
} from '@/config/constants';
import {
  isDefaultCategory,
  flattenCategories,
  canMoveUp,
  canMoveDown,
  canIndent,
  canOutdent,
  moveCategoryUp,
  moveCategoryDown,
  indentCategory,
  outdentCategory,
  movedCategoryPaths,
} from '@/config/categories';

dayjs.extend(relativeTime);

const { t, locale } = useI18n();

const categories = ref('');
const roles = ref('');
const constants = ref('');
const forms = ref({});
const formMeta = ref({});
const loaded = ref(false);
const lockLoading = ref(false);
const currentForm = ref(null);
// name is the internal key (warnings and the editors switch on it), label what the menu shows
// description is the line under the page title, as on the settings pages (the first three
// reuse those pages' own descriptions, so both places say the same)
const tabs = [
  {
    name: 'Categories',
    label: () => t('sidebar.categories'),
    description: () => t('settings.settingsPage.categoriesDescription'),
    icon: 'sitemap',
  },
  {
    name: 'Roles',
    label: () => t('sidebar.roles'),
    description: () => t('settings.settingsPage.rolesDescription'),
    icon: 'user-shield',
  },
  {
    name: 'Constants',
    label: () => t('sidebar.constants'),
    description: () => t('settings.settingsPage.constantsDescription'),
    icon: 'sliders-h',
  },
  {
    name: 'Forms',
    label: () => t('nav.forms'),
    description: () => t('designer.formsDescription'),
    icon: 'far,rectangle-list',
  }, // the header's Forms icon, outlined : the solid one is a dark blob at menu size
];
// the views in the menu, alphabetically by their (translated) label
const sortedTabs = computed(() => [...tabs].sort((a, b) => a.label().localeCompare(b.label(), locale.value)));
// the designer opens on the first view of the menu ; a link to a form (?form=) opens that form
const currentTab = ref(useRoute().query.form ? 'Forms' : sortedTabs.value[0].name);
const showWarnings = ref(false);
const action = ref(null);
const lock = ref(false);
const lockError = ref('');
const nextAction = ref(false);
const lockInterval = ref(null);
// set by onBeforeUnmount ; onMounted is async and checks it before arming the lock poll
const unmounted = ref(false);
const backups = ref([]);
const backupToRestore = ref(null);
const backupBeforeRestore = ref(false);
const authenticated = ref(false);

// ytt templating : any line starting (after optional whitespace) with '#@' is a ytt
// directive, so the stored config is a TEMPLATE. The test itself now lives on the server
// (GET /api/v2/config/templated) because only the raw stored text still carries the
// directives and this page cannot read it - see loadConfigTemplated.
const configTemplated = ref(false);

const editorTheme = ref(document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'monokai' : 'chrome');
const themeObserver = new MutationObserver(() => {
  editorTheme.value = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'monokai' : 'chrome';
});

const activeEditor = ref(null);
function onEditorInit(editor) {
  activeEditor.value = editor;
}
function editorUndo() {
  activeEditor.value?.undo();
}
function editorRedo() {
  activeEditor.value?.redo();
}
function editorFind() {
  activeEditor.value?.execCommand('replace');
}
function editorCut() {
  if (!activeEditor.value) return;
  const text = activeEditor.value.getSelectedText();
  if (text) {
    navigator.clipboard.writeText(text);
    activeEditor.value.session.remove(activeEditor.value.getSelectionRange());
  }
}
function editorCopy() {
  if (!activeEditor.value) return;
  const text = activeEditor.value.getSelectedText();
  if (text) navigator.clipboard.writeText(text);
}
async function editorPaste() {
  if (!activeEditor.value) return;
  const text = await navigator.clipboard.readText();
  if (text) activeEditor.value.insert(text);
}
function editorFormat() {
  const fmt = (val) => {
    try {
      return YAML.stringify(YAML.parse(val));
    } catch {
      return null;
    }
  };
  if (currentTab.value === 'Categories') {
    const r = fmt(categories.value);
    if (r) categories.value = r;
  } else if (currentTab.value === 'Roles') {
    const r = fmt(roles.value);
    if (r) roles.value = r;
  } else if (currentTab.value === 'Constants') {
    const r = fmt(constants.value);
    if (r) constants.value = r;
  } else if (currentTab.value === 'Forms' && currentForm.value) {
    const r = fmt(forms.value[currentForm.value]);
    if (r) forms.value[currentForm.value] = r;
  }
}

const route = useRoute();
const router = useRouter();
const store = useAppStore();

const treeWidthPct = ref(25);
function startResize(e) {
  e.preventDefault();
  const layout = e.target.closest('.designer-layout');
  if (!layout) return;
  const startX = e.clientX;
  const layoutRect = layout.getBoundingClientRect();
  const startPct = treeWidthPct.value;
  function onMove(ev) {
    const dx = ev.clientX - startX;
    const dPct = (dx / layoutRect.width) * 100;
    treeWidthPct.value = Math.min(50, Math.max(15, startPct - dPct));
    layout.style.gridTemplateColumns = `1fr 1rem ${treeWidthPct.value}%`;
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

const isValid = computed(() => {
  return warnings.value.length == 0;
});

// change detection : the designer is "dirty" when the parsed content differs
// from the last saved/loaded baseline. Comparing the PARSED content (not the
// raw text) is robust to whitespace/newline noise from the editor and matches
// what a save persists, so reverting an edit (eg type a char then erase it)
// clears the dirty state. The ace editor live-syncs its v-model on every edit,
// so this computed re-evaluates as you type.
const dirtyBaseline = ref(null);
function contentSnapshot() {
  return JSON.stringify({ c: categoriesObj.value, r: rolesObj.value, k: constantsObj.value, f: formsObj.value });
}
const baselineRaw = ref({ categories: '', roles: '', constants: '', forms: {} });
// The baseline as the buffers are RIGHT NOW. Split from applying it so a save can take
// the snapshot before it awaits - see saveForms.
function captureBaseline() {
  return {
    snapshot: contentSnapshot(),
    raw: {
      categories: categories.value,
      roles: roles.value,
      constants: constants.value,
      forms: { ...forms.value },
    },
  };
}
function applyBaseline(b) {
  dirtyBaseline.value = b.snapshot;
  baselineRaw.value = b.raw;
}
function setDirtyBaseline() {
  applyBaseline(captureBaseline());
}
const isDirty = computed(() => dirtyBaseline.value !== null && contentSnapshot() !== dirtyBaseline.value);

// PARSED content, the same comparison isDirty uses.
//
// This compared the raw text, so the two disagreed: pressing Enter at the end of a form,
// reindenting a block or typing a `# comment` changed forms[id] and painted the tree
// entry blue and italic ("unsaved"), while isDirty - which parses - stayed false, so
// Save, Diff and Revert were all disabled and neither the reload guard nor the route
// guard warned. The UI claimed an unsaved change and offered no way to act on it, then
// dropped it without a prompt.
//
// Parsed is the honest side: assembleForms() serializes the PARSED objects, so a
// whitespace or comment-only edit can never reach the server anyway - marking it unsaved
// promises something the save path cannot deliver.
function parsedForm(raw) {
  if (raw === undefined) return undefined;
  try {
    return JSON.stringify(YAML.parse(raw));
  } catch {
    // unparsable: fall back to the text
    return raw;
  }
}
function isFormDirty(id) {
  if (!baselineRaw.value.forms[id] && forms.value[id]) return true;
  if (!forms.value[id]) return false;
  return parsedForm(forms.value[id]) !== parsedForm(baselineRaw.value.forms[id]);
}

function editorRevert() {
  if (currentTab.value === 'Categories') {
    categories.value = baselineRaw.value.categories;
  } else if (currentTab.value === 'Roles') {
    roles.value = baselineRaw.value.roles;
  } else if (currentTab.value === 'Constants') {
    constants.value = baselineRaw.value.constants;
  } else if (currentTab.value === 'Forms' && currentForm.value) {
    if (baselineRaw.value.forms[currentForm.value] !== undefined) {
      forms.value[currentForm.value] = baselineRaw.value.forms[currentForm.value];
    }
  }
}

const showDiffModal = ref(false);
const diffSaved = ref('');
const diffCurrent = ref('');

// Read-modify-write the currently selected form through the yaml document API,
// so comments and formatting survive an edit made in one of the modals (a plain
// parse + stringify strips every comment the author typed). Same contract as
// the raw section helpers : a buffer that can't be parsed as a mapping aborts
// with a warning instead of being silently replaced.
function editCurrentFormDoc(mutate) {
  if (!currentForm.value || !forms.value[currentForm.value]) return false;
  try {
    const doc = YAML.parseDocument(forms.value[currentForm.value]);
    if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
    if (!YAML.isMap(doc.contents)) throw new Error('form is not a mapping');
    mutate(doc);
    forms.value[currentForm.value] = doc.toString();
    return true;
  } catch {
    toast.error(t('designer.badYamlUpdate'));
    return false;
  }
}

// Set or remove a key on a yaml map/document node, keeping the position (and
// any trailing comment) of a key that is already there.
function setDocValue(node, key, value) {
  if (value === undefined) node.delete(key);
  else node.set(key, value);
}

// Same, but a value that did not change is left alone : node.set() REPLACES the
// value node, which drops its quoting style and any comment written next to it.
// Used by the editors that rewrite every property of a node they reuse, so an
// apply without edits is a real no-op.
function setDocValueIfChanged(node, key, value) {
  if (node.get(key) === value) return;
  setDocValue(node, key, value);
}

// A comment written between a key and the first '-' of its sequence belongs to
// the SEQUENCE, not to the first item (yaml puts it in seq.commentBefore). Any
// editor that rebuilds the item list would leave it pinned to the top, where it
// then documents whatever item ends up first (or survives the deletion of the
// item it described). Moving it onto the first item keeps it with that item :
// it travels along on a reorder and disappears with a delete.
function hoistSeqComment(seq) {
  if (!YAML.isSeq(seq) || !seq.commentBefore) return;
  const first = seq.items[0];
  if (!first || typeof first !== 'object') return;
  first.commentBefore = first.commentBefore ? `${seq.commentBefore}\n${first.commentBefore}` : seq.commentBefore;
  seq.commentBefore = null;
}

// A subform can only hold a small subset of the form properties (see the
// 'subform' branch of server/schema/form_schema.json) : icon/image/tileClass/
// categories/roles/order are all forbidden, so the modals that write them are
// disabled for a subform instead of producing an unsaveable config.
const currentFormIsSubform = computed(() => {
  if (currentTab.value !== 'Forms' || !currentForm.value) return false;
  try {
    return YAML.parse(forms.value[currentForm.value])?.type === 'subform';
  } catch {
    return false;
  }
});

// Icon picker
const showIconPicker = ref(false);
const iconSearch = ref('');
const iconColorOptions = computed(() => [
  { value: '', label: t('designer.colorDefault') },
  { value: 'primary', label: t('designer.colorPrimary') },
  { value: 'secondary', label: t('designer.colorSecondary') },
  { value: 'success', label: t('designer.colorSuccess') },
  { value: 'danger', label: t('designer.colorDanger') },
  { value: 'warning', label: t('designer.colorWarning') },
  { value: 'info', label: t('designer.colorInfo') },
  { value: 'dark', label: t('designer.colorDark') },
  { value: 'white', label: t('designer.colorWhite') },
]);

const iconSizeOptions = computed(() => [
  { value: '', label: t('designer.sizeDefault') },
  { value: 'xs', label: 'XS' },
  { value: 'sm', label: 'SM' },
  { value: 'lg', label: 'LG' },
  { value: '2x', label: '2x' },
  { value: '3x', label: '3x' },
  { value: '5x', label: '5x' },
  { value: '7x', label: '7x' },
  { value: '10x', label: '10x' },
]);

const overlayPositionOptions = computed(() => [
  { value: 'top-left', label: t('designer.posTopLeft') },
  { value: 'top-right', label: t('designer.posTopRight') },
  { value: 'bottom-left', label: t('designer.posBottomLeft') },
  { value: 'bottom-right', label: t('designer.posBottomRight') },
]);

const iconForm = ref({
  icon: '',
  iconColor: '',
  iconSize: '',
  overlayIcon: '',
  overlayIconColor: 'success',
  overlayIconCircle: true,
  overlayIconText: '',
  overlayIconTextPosition: 'bottom-left',
  overlayIconTextColor: 'success',
});

const iconSections = ref({ icons: true, style: false, overlay: false });

const filteredIcons = computed(() => {
  if (!iconSearch.value) return availableIcons;
  const q = iconSearch.value.toLowerCase();
  return availableIcons.filter((i) => i.includes(q));
});

function openIconPicker() {
  if (currentTab.value !== 'Forms' || !currentForm.value) {
    toast.warning(t('designer.selectFormFirst'));
    return;
  }
  if (currentFormIsSubform.value) {
    toast.warning(t('designer.notForSubforms'));
    return;
  }
  try {
    const parsed = YAML.parse(forms.value[currentForm.value]);
    iconForm.value = {
      icon: parsed.icon || '',
      iconColor: parsed.iconColor || '',
      iconSize: parsed.iconSize || '',
      overlayIcon: parsed.overlayIcon || '',
      overlayIconColor: parsed.overlayIconColor || 'success',
      overlayIconCircle: parsed.overlayIconCircle !== false,
      overlayIconText: parsed.overlayIconText || '',
      overlayIconTextPosition: parsed.overlayIconTextPosition || 'bottom-left',
      overlayIconTextColor: parsed.overlayIconTextColor || 'success',
    };
  } catch {
    /* defaults are fine */
  }
  iconSearch.value = '';
  showIconPicker.value = true;
}

function pickIcon(iconName) {
  iconForm.value.icon = iconName;
}

function applyIconForm() {
  editCurrentFormDoc((doc) => {
    const props = [
      'icon',
      'iconColor',
      'iconSize',
      'overlayIcon',
      'overlayIconColor',
      'overlayIconCircle',
      'overlayIconText',
      'overlayIconTextPosition',
      'overlayIconTextColor',
    ];
    const defaults = {
      overlayIconColor: 'success',
      overlayIconCircle: true,
      overlayIconTextPosition: 'bottom-left',
      overlayIconTextColor: 'success',
    };
    for (const p of props) {
      const v = iconForm.value[p];
      if (v === '' || v === undefined || v === null) {
        doc.delete(p);
      } else if (p === 'overlayIconCircle') {
        if (v === true) doc.delete(p);
        else doc.set(p, v);
      } else if (defaults[p] && v === defaults[p] && !doc.get('overlayIcon') && !doc.get('overlayIconText')) {
        doc.delete(p);
      } else {
        doc.set(p, v);
      }
    }
    if (!doc.get('overlayIcon') && !doc.get('overlayIconText')) {
      doc.delete('overlayIconColor');
      doc.delete('overlayIconCircle');
      doc.delete('overlayIconTransform');
      doc.delete('overlayIconTextPosition');
      doc.delete('overlayIconTextColor');
    }
  });
  showIconPicker.value = false;
}

// Add category
const showAddCategory = ref(false);
const newCatName = ref('');
const newCatIcon = ref('bars');
const newCatParent = ref('');
const catIconSearch = ref('');

const filteredCatIcons = computed(() => {
  if (!catIconSearch.value) return availableIcons;
  const q = catIconSearch.value.toLowerCase();
  return availableIcons.filter((i) => i.includes(q));
});

function flattenCatNames(cats, prefix) {
  const result = [];
  for (const c of cats) {
    if (!c || !c.name) continue;
    const path = prefix ? prefix + '/' + c.name : c.name;
    result.push({ label: path, value: path });
    if (c.items && c.items.length > 0) {
      result.push(...flattenCatNames(c.items, path));
    }
  }
  return result;
}

const parentCatOptions = computed(() => {
  const cats = parseSeqYaml(categories.value);
  if (!cats) return [];
  return [{ label: t('designer.topLevel'), value: '' }, ...flattenCatNames(cats, '')];
});

function openAddCategory() {
  newCatName.value = '';
  newCatIcon.value = 'bars';
  newCatParent.value = '';
  catIconSearch.value = '';
  showAddCategory.value = true;
}

function findCatByPath(cats, path) {
  const parts = path.split('/');
  let current = cats;
  let target = null;
  for (const part of parts) {
    target = current.find((c) => c && c.name === part);
    if (!target) return null;
    current = target.items || [];
  }
  return target;
}

function doAddCategory() {
  const name = newCatName.value.trim();
  if (!name) {
    toast.warning(t('designer.categoryNameRequired'));
    return;
  }
  const icon = newCatIcon.value || 'bars';
  const cats = parseSeqYaml(categories.value);
  if (cats === null) {
    toast.error(t('designer.badYamlUpdate'));
    return;
  }

  if (newCatParent.value) {
    const parent = findCatByPath(cats, newCatParent.value);
    if (!parent) {
      toast.error(t('designer.badYamlUpdate'));
      return;
    }
    const siblings = parent.items || [];
    if (siblings.some((c) => c && c.name === name)) {
      toast.warning(t('designer.categoryExists'));
      return;
    }
    if (!parent.items) parent.items = [];
    parent.items.push({ name, icon });
    categories.value = YAML.stringify(cats);
  } else {
    if (cats.some((c) => c && c.name === name)) {
      toast.warning(t('designer.categoryExists'));
      return;
    }
    categories.value = appendToSeqYaml(categories.value, { name, icon });
  }
  showAddCategory.value = false;
}

// Edit categories
const showEditCategories = ref(false);
const editCats = ref([]);
const editCatIconIdx = ref(null);
const editCatIconSearch = ref('');

const filteredEditCatIcons = computed(() => {
  if (!editCatIconSearch.value) return availableIcons;
  const q = editCatIconSearch.value.toLowerCase();
  return availableIcons.filter((i) => i.includes(q));
});

// `_path` is the index path of the yaml node the row was cloned from, so the
// apply can write back into that very node (and keep its comments) even after
// the name was changed or the row was dragged to another position.
function cloneCats(cats, path = []) {
  return cats.map((c, i) => {
    const clone = { name: c.name || '', icon: c.icon || 'bars', _path: [...path, i] };
    if (c.items && c.items.length > 0) clone.items = cloneCats(c.items, [...path, i, 'items']);
    return clone;
  });
}

const flatEditCats = computed(() => flattenCategories(editCats.value));

// Reorganizing the tree : nesting could be built but never changed, so moving a
// category under another one meant deleting it and typing the subtree back.
// The icon picker is keyed on a FLAT index, which every one of these shifts -
// it would end up writing into a different category (same reason as
// editCatRemove).
function editCatMove(op, cat) {
  if (editCatIconIdx.value !== null) editCatIconIdx.value = null;
  op(editCats.value, cat);
}

// Paths that the edit has moved or renamed away. A form points at a category by
// path, so those forms stop appearing under it - said out loud rather than
// refused, because reorganizing on purpose is the normal case.
const editCatMovedPaths = computed(() => {
  let before;
  try {
    before = YAML.parse(categories.value) || [];
  } catch {
    before = [];
  }
  if (!Array.isArray(before)) before = [];
  return movedCategoryPaths(before, editCats.value);
});

// base_schema.json pins one entry : `categories` must CONTAIN exactly
// {name: Default, icon: bars}. Renaming that row, restyling it, deleting it or
// giving it subcategories makes EVERY save fail on a raw schema error, so the
// row is locked here the same way the settings categories page locks it
// (config/categories.js, isDefaultCategory - which the move rules also apply).
function isDefaultEditCat(cat, depth) {
  return isDefaultCategory(cat, depth);
}

function openEditCategories() {
  // an alias can't be written back (see catsHaveAlias) : refuse before the
  // modal shows the resolved content as if it were editable
  const doc = parseDocOrNull(categories.value);
  if (doc && catsHaveAlias(doc.contents)) {
    toast.warning(t('designer.aliasNotSupported'));
    return;
  }
  let cats = [];
  if (categories.value) {
    try {
      cats = YAML.parse(categories.value) || [];
    } catch {
      cats = [];
    }
  }
  if (!Array.isArray(cats)) cats = [];
  editCats.value = cloneCats(cats);
  editCatIconIdx.value = null;
  editCatIconSearch.value = '';
  showEditCategories.value = true;
}

function editCatPickIcon(flatIdx) {
  const row = flatEditCats.value[flatIdx];
  // the icon of the Default category is part of what the schema pins
  if (row && isDefaultEditCat(row.cat, row.depth)) return;
  editCatIconIdx.value = editCatIconIdx.value === flatIdx ? null : flatIdx;
  editCatIconSearch.value = '';
}

function editCatSelectIcon(flatIdx, icon) {
  flatEditCats.value[flatIdx].cat.icon = icon;
  editCatIconIdx.value = null;
}

function editCatAddSub(cat) {
  // the flat indices shift as soon as a row is inserted, so an open icon picker
  // would end up writing into another category (same reason as editCatRemove)
  if (editCatIconIdx.value !== null) editCatIconIdx.value = null;
  if (!cat.items) cat.items = [];
  cat.items.push({ name: '', icon: 'bars' });
}

function editCatRemove(cat) {
  if (editCatIconIdx.value !== null) editCatIconIdx.value = null;
  function removeFrom(list) {
    const idx = list.indexOf(cat);
    if (idx >= 0) {
      list.splice(idx, 1);
      return true;
    }
    for (const item of list) {
      if (item.items && removeFrom(item.items)) return true;
    }
    return false;
  }
  removeFrom(editCats.value);
}

// An Alias ('- *catA', 'items: *subs') is neither a Map nor a Seq, so the
// rebuild below cannot address it : it would create a brand new node from the
// few properties the modal shows, dropping everything else the anchor carries
// and expanding the alias. Refuse the edit instead.
function catsHaveAlias(node) {
  if (YAML.isAlias(node)) return true;
  if (!YAML.isSeq(node)) return false;
  for (const item of node.items) {
    if (YAML.isAlias(item)) return true;
    if (YAML.isMap(item) && catsHaveAlias(item.get('items'))) return true;
  }
  return false;
}

// Rebuild the category sequence on top of the nodes it was cloned from, so the
// comments of the entries that were not touched survive the edit.
function buildCleanCatNodes(doc, cats) {
  const nodes = [];
  for (const c of cats) {
    const name = (c.name || '').trim();
    if (!name) continue;
    let node = Array.isArray(c._path) ? doc.getIn(c._path) : null;
    if (YAML.isMap(node)) {
      setDocValueIfChanged(node, 'name', name);
      setDocValueIfChanged(node, 'icon', c.icon);
    } else {
      node = doc.createNode({ name, icon: c.icon });
    }
    const children = c.items && c.items.length > 0 ? buildCleanCatNodes(doc, c.items) : [];
    if (children.length > 0) {
      const sub = node.get('items');
      if (YAML.isSeq(sub)) {
        hoistSeqComment(sub);
        sub.items = children;
      } else node.set('items', doc.createNode(children));
    } else {
      node.delete('items');
    }
    nodes.push(node);
  }
  return nodes;
}

function applyEditCategories() {
  const doc = parseDocOrNull(categories.value);
  if (!doc) {
    toast.error(t('designer.badYamlUpdate'));
    return;
  }
  // the buffer could have changed since the modal opened : an alias must never
  // reach the rebuild
  if (catsHaveAlias(doc.contents)) {
    toast.warning(t('designer.aliasNotSupported'));
    return;
  }
  hoistSeqComment(doc.contents);
  const nodes = buildCleanCatNodes(doc, editCats.value);
  if (YAML.isSeq(doc.contents)) doc.contents.items = nodes;
  else doc.contents = doc.createNode(nodes);
  categories.value = doc.toString();
  showEditCategories.value = false;
}

// Roles : add / edit modals that read-modify-write the raw `roles` YAML string,
// exactly like the category modals do. isDirty/validate/save then react to the
// text change automatically.

// The role option labels are derived from the option name by the shared helper
// (both role editors use the same settings.settingsPage.roleOption<Key> keys).
function roleOptionLabel(key) {
  return roleOptionLabelFor(t, key);
}

function isRequiredRole(name) {
  return name === 'admin' || name === 'public';
}

// The 'public' role applies to everyone; the schema pins it to no groups/users.
function isPublicRole(name) {
  return name === 'public';
}

function blankRole() {
  return {
    name: '',
    groups: [],
    users: [],
    // start from the effective defaults : that is what a role without an
    // options block gets from the server. Starting all-off would now write an
    // explicit false for every flag (serializeRole spells them all out), which
    // silently takes permissions away - allowLogin: false even locks out every
    // member of the new role.
    options: roleOptionDefaults(''),
  };
}

// Parse a raw yaml sequence: [] when empty, null when unparsable or not a
// sequence (callers must abort then instead of silently wiping the section).
function parseSeqYaml(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    const v = YAML.parse(raw);
    if (v === null || v === undefined) return [];
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// Parse a raw section as a yaml document (the node tree, comments included).
// null when it can't be parsed, so callers abort instead of replacing content.
function parseDocOrNull(raw) {
  try {
    const doc = YAML.parseDocument(raw || '');
    return doc.errors.length > 0 ? null : doc;
  } catch {
    return null;
  }
}

// Append one item to a raw yaml sequence, preserving comments/formatting of
// the existing content via the document API (a plain parse+stringify would
// strip in-session hand-typed comments).
function appendToSeqYaml(raw, item) {
  if (!raw || !raw.trim()) return YAML.stringify([item]);
  const doc = YAML.parseDocument(raw);
  doc.contents.add(doc.createNode(item));
  return doc.toString();
}

function parseRolesYaml() {
  return parseSeqYaml(roles.value);
}

// Local directory : the same live lists the settings roles page offers
// (pages/admin/roles.vue). Only the 'local' provider has a directory to pick a
// member from, so a typo'd 'local/admins' grants nothing ; ldap/azuread/oidc
// have no such list here and stay free text. A failed fetch (a designer without
// user administration rights) leaves the lists empty, which degrades every
// picker back to a free text input instead of breaking the modal.
const localGroups = ref([]);
const localUsers = ref([]);
const sortedLocalGroups = computed(() => [...localGroups.value].sort());
const sortedLocalUsers = computed(() => [...localUsers.value].sort());

async function loadLocalGroups() {
  try {
    const result = await axios.get('/api/v2/group/', TokenStorage.getAuthentication());
    localGroups.value = (result.data.records || result.data).map((g) => g.name);
  } catch {
    localGroups.value = [];
  }
}

async function loadLocalUsers() {
  try {
    const result = await axios.get('/api/v2/user/', TokenStorage.getAuthentication());
    localUsers.value = (result.data.records || result.data).map((u) => u.username);
  } catch {
    localUsers.value = [];
  }
}

// The name a role already carries is always offered, even when the local
// directory no longer holds it : a select without a matching option shows blank
// and would write that blank back, silently dropping a member the designer only
// meant to look at.
function localGroupOptions(current) {
  const opts = sortedLocalGroups.value;
  return current && !opts.includes(current) ? [current, ...opts] : opts;
}
function localUserOptions(current) {
  const opts = sortedLocalUsers.value;
  return current && !opts.includes(current) ? [current, ...opts] : opts;
}
// a picked name belongs to the provider it was picked from : switching provider
// resets it (the same reset the settings roles page does)
function onRoleProviderChange(entry, type) {
  entry.name =
    entry.provider === 'local' ? (type === 'group' ? sortedLocalGroups.value[0] : sortedLocalUsers.value[0]) || '' : '';
}

// shared member-row helpers, used by both the add and edit modals
function roleAddGroup(role) {
  role.groups.push({ provider: 'local', name: sortedLocalGroups.value[0] || '' });
}
function roleRemoveGroup(role, idx) {
  role.groups.splice(idx, 1);
}
function roleAddUser(role) {
  role.users.push({ provider: 'local', name: sortedLocalUsers.value[0] || '' });
}
function roleRemoveUser(role, idx) {
  role.users.splice(idx, 1);
}

// Add role
const showAddRole = ref(false);
const newRole = ref(blankRole());

function openAddRole() {
  newRole.value = blankRole();
  showAddRole.value = true;
}

function doAddRole() {
  const name = newRole.value.name.trim();
  if (!name) {
    toast.warning(t('designer.roleNameRequired'));
    return;
  }
  const list = parseRolesYaml();
  // bad/typed-wrong yaml must abort, not silently replace the whole section
  if (list === null) {
    toast.error(t('designer.badYamlUpdate'));
    return;
  }
  if (list.some((r) => r && r.name === name)) {
    toast.warning(t('designer.roleExists'));
    return;
  }
  // Same rule as the roles editor (admin/roles.vue): 'admin' is a privilege bypass by
  // NAME - middleware.js and job.model.js test roles.includes("admin") regardless of the
  // option flags - so adding one here would grant admin to whatever groups were typed in.
  // The duplicate check above only catches it when the config already has an admin role.
  // 'public' is deliberately NOT blocked: the schema requires one, so a config that lost
  // it has to be repairable from here.
  if (name === 'admin') {
    toast.warning(t('settings.settingsPage.reservedRoleName', { name }));
    return;
  }
  roles.value = appendToSeqYaml(roles.value, serializeRole({ ...newRole.value, name }));
  showAddRole.value = false;
}

// the edit modals only make sense when the raw yaml actually holds content ;
// (categoriesObj/rolesObj/constantsObj can't be used here : they inject
// defaults for an empty editor). Bad yaml also disables : the raw editor is
// the recovery tool then.
function parsedOrNull(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    return YAML.parse(raw);
  } catch {
    return null;
  }
}
// the Add modals can only append to a parsable section (empty is fine) ;
// bad yaml disables Add so the modal can never wipe hand-edited content
const canAddCategories = computed(() => parseSeqYaml(categories.value) !== null);
const canAddRoles = computed(() => parseSeqYaml(roles.value) !== null);
const canAddConstants = computed(() => parseConstantsYaml() !== null);

const hasEditableCategories = computed(() => {
  const v = parsedOrNull(categories.value);
  return Array.isArray(v) && v.length > 0;
});
const hasEditableRoles = computed(() => {
  const v = parsedOrNull(roles.value);
  return Array.isArray(v) && v.length > 0;
});
const hasEditableConstants = computed(() => {
  const v = parsedOrNull(constants.value);
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
});

// Edit roles
const showEditRoles = ref(false);
const editRoles = ref([]);
const expandedEditRoles = ref({});
let editRoleUid = 0;

function openEditRoles() {
  // _required/_public are stamped ONCE at open (never evaluated against the
  // name being typed : a live check would disable the input mid-keystroke when
  // a custom name passes through 'admin'/'public')
  editRoles.value = (parseRolesYaml() || []).map((r) => ({
    _uid: ++editRoleUid,
    _required: isRequiredRole(r.name),
    _public: isPublicRole(r.name),
    ...roleToEditable(r),
  }));
  // all roles start collapsed ; the header row toggles each one
  expandedEditRoles.value = {};
  showEditRoles.value = true;
}

function toggleEditRole(uid) {
  expandedEditRoles.value[uid] = !expandedEditRoles.value[uid];
}

function editRoleRemove(idx) {
  editRoles.value.splice(idx, 1);
}

function applyEditRoles() {
  const names = editRoles.value.map((r) => r.name.trim());
  if (names.some((n) => !n)) {
    toast.warning(t('designer.roleNameRequired'));
    return;
  }
  if (new Set(names).size !== names.length) {
    toast.warning(t('designer.roleExists'));
    return;
  }
  // a custom role must not take over a built-in name
  if (editRoles.value.some((r) => !r._required && isRequiredRole(r.name.trim()))) {
    toast.warning(t('designer.roleExists'));
    return;
  }
  roles.value = YAML.stringify(editRoles.value.map((r) => serializeRole({ ...r, name: r.name.trim() })));
  showEditRoles.value = false;
}

// Constants : add / edit modals that read-modify-write the raw `constants` YAML
// string (a free-form key -> value object). Values round-trip through the same
// display/coerce rules as the admin constants page: objects/arrays show as
// JSON, unchanged values are preserved verbatim, edited/new values are coerced.

// {} when empty, null when unparsable or not a map (callers must abort then
// instead of silently wiping the section).
function parseConstantsYaml() {
  if (!constants.value || !constants.value.trim()) return {};
  try {
    const v = YAML.parse(constants.value);
    if (v === null || v === undefined) return {};
    return typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// Add constant
const showAddConstant = ref(false);
const newConstKey = ref('');
const newConstValue = ref('');
const newConstParent = ref('');

// The parent picker must NOT identify a constant by a dotted path : a key can
// itself contain a dot ('app.url'), and splitting that path apart invents a
// nested map instead of finding the parent the user picked. Each option
// therefore holds a direct reference to the map that owns it (the same row
// reference approach the settings constants page uses), and the select only
// carries its index. Both are captured when the modal opens, so the reference
// and the object the apply writes into are the same tree.
const addConstRoot = ref(null);
const addConstParents = ref([]);

function collectConstantParents(obj, prefix, result) {
  for (const [k, v] of Object.entries(obj)) {
    const label = prefix ? `${prefix}.${k}` : k;
    result.push({ label, owner: obj, key: k });
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      collectConstantParents(v, label, result);
    }
  }
  return result;
}

const hasAnyConstants = computed(() => {
  const obj = parseConstantsYaml();
  return obj && Object.keys(obj).length > 0;
});

// Forms reference a constant as $(path); nested ones use a dotted path, which the
// server resolves with Helpers.findExtravar (svm.lif.ip => data.svm.lif.ip). Only
// leaves are offered : inserting a reference to a whole map is never what a field
// wants.
function collectConstantLeaves(obj, prefix, result) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      collectConstantLeaves(v, path, result);
    } else {
      result.push({ path, value: v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '') });
    }
  }
  return result;
}
const insertableConstants = computed(() => {
  const obj = parseConstantsYaml();
  return obj ? collectConstantLeaves(obj, '', []) : [];
});
const showInsertConstant = ref(false);

function openInsertConstant() {
  showInsertConstant.value = true;
}
function insertConstant(path) {
  showInsertConstant.value = false;
  const editor = activeEditor.value;
  if (!editor) return;
  editor.insert(`$(${path})`);
  editor.focus();
}
// creating one is the same flow the Constants tab uses : it edits the constants
// section, not the current form, so it works from here unchanged.
function newConstantFromInsert() {
  showInsertConstant.value = false;
  openAddConstant();
}

function openAddConstant() {
  newConstKey.value = '';
  newConstValue.value = '';
  newConstParent.value = '';
  const obj = parseConstantsYaml();
  addConstRoot.value = obj;
  addConstParents.value = obj ? collectConstantParents(obj, '', []) : [];
  showAddConstant.value = true;
}

function doAddConstant() {
  const key = newConstKey.value.trim();
  if (!key) {
    toast.warning(t('designer.constantKeyRequired'));
    return;
  }
  const root = addConstRoot.value;
  if (!root) {
    toast.error(t('designer.badYamlUpdate'));
    return;
  }

  // a list or a map that cannot be parsed would be stored as its own yaml source
  // text, so `$(KEY)` would hand a form a string that merely looks like a list
  const valueError = constantValueError(newConstValue.value);
  if (valueError) {
    toast.warning(t('designer.constantValueInvalid', { key, error: valueError }));
    return;
  }

  const value = coerceConstantValue(newConstValue.value);
  const parent = newConstParent.value === '' ? null : addConstParents.value[Number(newConstParent.value)];
  if (newConstParent.value !== '' && !parent) {
    toast.error(t('designer.badYamlUpdate'));
    return;
  }

  let target = root;
  let dropped = '';
  if (parent) {
    const existing = parent.owner[parent.key];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      // a constant holds either a value or subkeys : the parent becomes a map, so
      // tell the user its value goes away instead of dropping it silently
      if (existing !== undefined && existing !== null) dropped = parent.label;
      target = {};
      parent.owner[parent.key] = target;
    } else {
      target = existing;
    }
  }
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    toast.warning(t('designer.constantExists'));
    return;
  }
  target[key] = value;

  constants.value = YAML.stringify(root);
  if (dropped) toast.warning(t('designer.constantParentValueDropped', { key: dropped }));
  showAddConstant.value = false;
}

// Edit constants
const showEditConstants = ref(false);
const editConsts = ref([]);

// stable identity per row : the flat list is re-derived on every change, so an
// index key would make vue reuse an input for another row when one is inserted
// or removed
let editConstUid = 0;
function stampConstUids(rows) {
  for (const row of rows) {
    row._uid = ++editConstUid;
    if (row.children) stampConstUids(row.children);
  }
  return rows;
}

function openEditConstants() {
  editConsts.value = stampConstUids(constantsToArray(parseConstantsYaml() || {}));
  showEditConstants.value = true;
}

const flatEditConsts = computed(() => flattenConstants(editConsts.value));

function editConstAddSub(row) {
  if (!row.children) row.children = [];
  // a constant holds either a value or subkeys : the tree is serialized
  // children-first, so a value left on a row that just gained subkeys would be
  // dropped on apply. Clear it so the table shows what will actually persist.
  row.value = '';
  row.children.push({ _uid: ++editConstUid, key: '', value: '', children: [] });
}

function editConstRemove(target, list) {
  if (!list) list = editConsts.value;
  const idx = list.indexOf(target);
  if (idx !== -1) {
    list.splice(idx, 1);
    return true;
  }
  for (const item of list) {
    if (item.children && editConstRemove(target, item.children)) return true;
  }
  return false;
}

function validateConstKeys(arr) {
  const keys = arr.map((c) => c.key.trim());
  if (keys.some((k) => !k)) return false;
  if (new Set(keys).size !== keys.length) return 'duplicate';
  for (const row of arr) {
    if (row.children && row.children.length > 0) {
      const sub = validateConstKeys(row.children);
      if (sub !== true) return sub;
    }
  }
  return true;
}

function trimConstKeys(arr) {
  return arr.map((r) => ({
    ...r,
    key: r.key.trim(),
    children: r.children ? trimConstKeys(r.children) : [],
  }));
}

// The first row whose value is meant to be a list or a map but cannot be parsed.
// Stored as-is it would be its own yaml SOURCE, which reads back as a string.
function findInvalidConstValue(arr) {
  for (const row of arr) {
    if (!(row.children && row.children.length > 0)) {
      const error = constantValueError(row.value);
      if (error) return { key: (row.key || '').trim(), error };
    }
    if (row.children && row.children.length > 0) {
      const invalid = findInvalidConstValue(row.children);
      if (invalid) return invalid;
    }
  }
  return null;
}

function applyEditConstants() {
  const valid = validateConstKeys(editConsts.value);
  if (valid === false) {
    toast.warning(t('designer.constantKeyRequired'));
    return;
  }
  if (valid === 'duplicate') {
    toast.warning(t('designer.constantExists'));
    return;
  }
  const invalid = findInvalidConstValue(editConsts.value);
  if (invalid) {
    toast.warning(t('designer.constantValueInvalid', invalid));
    return;
  }
  constants.value = YAML.stringify(arrayToConstants(trimConstKeys(editConsts.value)));
  showEditConstants.value = false;
}

// Tile background picker
const showTilePicker = ref(false);
const tileOptions = computed(() => [
  // 'none' is what makes a background removable again : without it a tileClass
  // could be set but never cleared from the ui
  { label: t('designer.tileNone'), value: '', color: 'transparent' },
  { label: t('designer.tileBlue'), value: 'bg-primary-subtle', color: '#cfe2ff' },
  { label: t('designer.tileGreen'), value: 'bg-success-subtle', color: '#d1e7dd' },
  { label: t('designer.tileRed'), value: 'bg-danger-subtle', color: '#f8d7da' },
  { label: t('designer.tileYellow'), value: 'bg-warning-subtle', color: '#fff3cd' },
  { label: t('designer.tileCyan'), value: 'bg-info-subtle', color: '#cff4fc' },
  { label: t('designer.tileGray'), value: 'bg-secondary-subtle', color: '#e2e3e5' },
  { label: t('designer.tileLight'), value: 'bg-light-subtle', color: '#fcfcfd' },
  { label: t('designer.tileDark'), value: 'bg-dark-subtle', color: '#ced4da' },
  { label: t('designer.tilePrimary'), value: 'bg-primary', color: '#0d6efd' },
  { label: t('designer.tileSuccess'), value: 'bg-success', color: '#198754' },
  { label: t('designer.tileDanger'), value: 'bg-danger', color: '#dc3545' },
  { label: t('designer.tileWarning'), value: 'bg-warning', color: '#ffc107' },
  { label: t('designer.tileInfo'), value: 'bg-info', color: '#0dcaf0' },
  { label: t('designer.tileInfoLight'), value: 'has-background-info-light', color: '#d0ecf5' },
]);

const currentFormTile = computed(() => {
  if (!currentForm.value || !forms.value[currentForm.value]) return null;
  try {
    return YAML.parse(forms.value[currentForm.value])?.tileClass || null;
  } catch {
    return null;
  }
});

const selectedTile = ref('');

function openTilePicker() {
  if (currentTab.value !== 'Forms' || !currentForm.value) {
    toast.warning(t('designer.selectFormFirst'));
    return;
  }
  if (currentFormIsSubform.value) {
    toast.warning(t('designer.notForSubforms'));
    return;
  }
  selectedTile.value = currentFormTile.value || '';
  showTilePicker.value = true;
}

function applyTile() {
  editCurrentFormDoc((doc) => {
    setDocValue(doc, 'tileClass', selectedTile.value || undefined);
  });
  showTilePicker.value = false;
}

// Image picker
const showImagePicker = ref(false);
const imageUrl = ref('');

function openImagePicker() {
  if (currentTab.value !== 'Forms' || !currentForm.value) {
    toast.warning(t('designer.selectFormFirst'));
    return;
  }
  if (currentFormIsSubform.value) {
    toast.warning(t('designer.notForSubforms'));
    return;
  }
  try {
    imageUrl.value = YAML.parse(forms.value[currentForm.value])?.image || '';
  } catch {
    imageUrl.value = '';
  }
  showImagePicker.value = true;
}

function applyImage() {
  editCurrentFormDoc((doc) => {
    setDocValue(doc, 'image', imageUrl.value.trim() || undefined);
  });
  showImagePicker.value = false;
}

// Categories picker
const showCatPicker = ref(false);
const selectedCats = ref([]);

function openCatPicker() {
  if (currentTab.value !== 'Forms' || !currentForm.value) {
    toast.warning(t('designer.selectFormFirst'));
    return;
  }
  if (currentFormIsSubform.value) {
    toast.warning(t('designer.notForSubforms'));
    return;
  }
  try {
    selectedCats.value = [...(YAML.parse(forms.value[currentForm.value])?.categories || [])];
  } catch {
    selectedCats.value = [];
  }
  showCatPicker.value = true;
}

function toggleCat(name) {
  const idx = selectedCats.value.indexOf(name);
  if (idx >= 0) selectedCats.value.splice(idx, 1);
  else selectedCats.value.push(name);
}

function applyCats() {
  editCurrentFormDoc((doc) => {
    setDocValue(doc, 'categories', selectedCats.value.length > 0 ? [...selectedCats.value] : undefined);
  });
  showCatPicker.value = false;
}

// Roles picker
const showRolePicker = ref(false);
const selectedRoles = ref([]);

function openRolePicker() {
  if (currentTab.value !== 'Forms' || !currentForm.value) {
    toast.warning(t('designer.selectFormFirst'));
    return;
  }
  if (currentFormIsSubform.value) {
    toast.warning(t('designer.notForSubforms'));
    return;
  }
  try {
    selectedRoles.value = [...(YAML.parse(forms.value[currentForm.value])?.roles || [])];
  } catch {
    selectedRoles.value = [];
  }
  showRolePicker.value = true;
}

function toggleRole(name) {
  const idx = selectedRoles.value.indexOf(name);
  if (idx >= 0) selectedRoles.value.splice(idx, 1);
  else selectedRoles.value.push(name);
}

function applyRoles() {
  editCurrentFormDoc((doc) => {
    setDocValue(doc, 'roles', selectedRoles.value.length > 0 ? [...selectedRoles.value] : undefined);
  });
  showRolePicker.value = false;
}

// Download YAML
function downloadYaml() {
  let content = '';
  let filename = 'config.yaml';
  if (currentTab.value === 'Categories') {
    content = categories.value;
    filename = 'categories.yaml';
  } else if (currentTab.value === 'Roles') {
    content = roles.value;
    filename = 'roles.yaml';
  } else if (currentTab.value === 'Constants') {
    content = constants.value;
    filename = 'constants.yaml';
  } else if (currentTab.value === 'Forms' && currentForm.value) {
    content = forms.value[currentForm.value] || '';
    const mapping = idmapping.value.find((x) => x.id === currentForm.value);
    filename = mapping?.source || 'form.yaml';
  }
  if (!content) return;
  const blob = new Blob([content], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Import YAML : the counterpart of the three downloads above. There is no server
// side import, so the forms are brought into the editor BUFFERS and the normal
// validate/save path applies to them like to anything else typed here. Nothing
// is touched before the whole file parses, and an existing form or file is never
// overwritten : a name that is taken is renamed, and the target file is picked
// in the modal.
const importInput = ref(null);
const showImportModal = ref(false);
const importFileName = ref('');
const importCandidates = ref([]);
const importTarget = ref('');
const importSkipped = ref(0);

// the files the import can go into. The base config is deliberately absent : since
// 7.0.0 every form lives in a file of its own.
const importFileOptions = computed(() => {
  const opts = files.value.filter(Boolean).map((f) => ({ value: f, label: f }));
  if (importFileName.value && !files.value.includes(importFileName.value)) {
    opts.unshift({ value: importFileName.value, label: `${importFileName.value} (${t('designer.importNewFile')})` });
  }
  return opts;
});

// the uploaded filename as a forms file the designer would accept (addFile uses
// the same shape) : anything else becomes a '-', an unusable result falls back
function importFileNameFrom(name) {
  const cleaned = String(name || '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[-.]+/, '');
  return /^[A-Za-z0-9._-]+\.(yaml|yml)$/.test(cleaned) ? cleaned : 'imported.yaml';
}

// Every form a yaml file holds, whatever shape it was downloaded in : one form
// per document (a single form download), several documents separated by '---' (a
// whole file), a full config with a `forms` list, or a bare list of forms.
function collectImportForms(docs) {
  const found = [];
  let skipped = 0;
  const push = (node) => {
    if (!YAML.isMap(node)) {
      skipped++;
      return;
    }
    const name = node.get('name');
    // a form without a name has nothing to be identified by, and the designer
    // would only flag it as a warning right after the import
    if (typeof name !== 'string' || !name.trim()) {
      skipped++;
      return;
    }
    found.push({ name: name.trim(), yaml: YAML.stringify(node) });
  };
  for (const doc of docs) {
    const contents = doc.contents;
    if (contents === null || contents === undefined) continue;
    if (YAML.isMap(contents)) {
      const list = contents.get('forms');
      if (YAML.isSeq(list)) {
        hoistSeqComment(list);
        list.items.forEach(push);
        continue;
      }
      push(contents);
    } else if (YAML.isSeq(contents)) {
      hoistSeqComment(contents);
      contents.items.forEach(push);
    } else {
      skipped++;
    }
  }
  return { found, skipped };
}

function openImport() {
  if (busyOrTemplated.value) {
    toast.warning(t('designer.readOnly'));
    return;
  }
  importInput.value?.click();
}

async function onImportFile(event) {
  const file = event.target.files?.[0];
  // clear the input, otherwise picking the very same file again fires no change
  event.target.value = '';
  if (!file) return;
  if (!/\.(yaml|yml)$/i.test(file.name)) {
    toast.error(t('designer.importNotYaml'));
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    toast.error(t('designer.importReadFailed'));
    return;
  }
  let docs;
  try {
    docs = YAML.parseAllDocuments(text);
  } catch {
    docs = [];
  }
  // it must parse as a whole before anything is offered : a half-read file would
  // import the forms it managed to read and silently drop the rest
  if (docs.length === 0 || docs.some((d) => d.errors.length > 0)) {
    toast.error(t('designer.importBadYaml'));
    return;
  }
  // the documents parse, but their SHAPE is still whatever was in the file :
  // walking it can throw on anything unexpected, and an uncaught throw here
  // leaves the file input half-consumed with no message at all
  let found, skipped;
  try {
    ({ found, skipped } = collectImportForms(docs));
  } catch {
    toast.error(t('designer.importBadYaml'));
    return;
  }
  if (found.length === 0) {
    toast.warning(t('designer.importNoForms'));
    return;
  }
  // a name that already exists (in the config or earlier in this same file) is
  // renamed, never merged onto the form that holds it
  const taken = idmapping.value.map((x) => x.name);
  const suffix = t('designer.importedSuffix');
  for (const entry of found) {
    entry.include = true;
    entry.finalName = entry.name;
    if (taken.includes(entry.finalName)) {
      entry.finalName = `${entry.name} (${suffix})`;
      let counter = 2;
      while (taken.includes(entry.finalName)) entry.finalName = `${entry.name} (${suffix} ${counter++})`;
    }
    taken.push(entry.finalName);
  }
  importFileName.value = importFileNameFrom(file.name);
  importCandidates.value = found;
  importSkipped.value = skipped;
  // the file the forms came from : an existing one to append to, otherwise a new
  // file of that name. Either way it is an option of the select.
  importTarget.value = importFileName.value;
  showImportModal.value = true;
}

// a file belongs to exactly one repository, so an imported form has to inherit
// it from the forms already in the target file. The save groups by source AND
// repository (see idmapping), so leaving it undefined splits the file in two
// and writes the imported forms outside the repository the file lives in.
function repositoryForSource(source) {
  return Object.values(formMeta.value).find((m) => m?.source === source && m?.repository)?.repository;
}

function doImport() {
  if (busyOrTemplated.value) {
    toast.warning(t('designer.readOnly'));
    return;
  }
  const selected = importCandidates.value.filter((x) => x.include);
  if (selected.length === 0) {
    toast.warning(t('designer.importNothingSelected'));
    return;
  }
  const target = importTarget.value;
  if (!target) {
    toast.warning(t('designer.importNoTarget'));
    return;
  }
  const targetRepo = repositoryForSource(target);
  const renamed = [];
  let firstId = null;
  for (const entry of selected) {
    const id = nextFormId();
    // the rename is written through the document api, so the comments the
    // imported form carries survive it
    let yaml = entry.yaml;
    if (entry.finalName !== entry.name) {
      const doc = YAML.parseDocument(entry.yaml);
      if (YAML.isMap(doc.contents)) {
        doc.set('name', entry.finalName);
        yaml = doc.toString();
      }
      renamed.push(`${entry.name} -> ${entry.finalName}`);
    }
    formMeta.value[id] = targetRepo ? { source: target, repository: targetRepo } : { source: target };
    forms.value[id] = yaml;
    if (!firstId) firstId = id;
  }
  collapsedPaths.value.delete(`file:${target}`);
  if (firstId) selectForm(firstId);
  showImportModal.value = false;
  toast.success(t('designer.importDone', { file: target }, selected.length));
  if (renamed.length > 0) toast.warning(t('designer.importRenamed', { details: renamed.join(', ') }));
}

// Field properties editor
const showFieldEditor = ref(false);
const fieldEditorRows = ref([]);
const fieldTypes = [
  'text',
  'textarea',
  'password',
  'checkbox',
  'enum',
  'number',
  'radio',
  'expression',
  'local',
  'local_out',
  'credential',
  'list',
  'datetime',
  'html',
  'file',
  'yaml',
];

// Mirror of the per-type `oneOf` of a FIELD in server/schema/form_schema.json,
// the same idea as forbiddenFormKeys one level up : a field type FORBIDS a set of
// keys, so a key the previous type left behind makes the whole config unsaveable
// with an opaque AJV error, while the editor no longer renders an input to
// remove it (eg an 'enum' turned into a 'text' keeps its `values`). A key is
// listed here when EVERY schema branch that accepts the type forbids it.
const forbiddenFieldKeys = {
  text: [
    'accept',
    'allowDelete',
    'allowInsert',
    'convertToUtc',
    'dateType',
    'dbConfig',
    'deleteMarker',
    'editable',
    'expression',
    'filterColumns',
    'horizontal',
    'insertMarker',
    'isHtml',
    'jq',
    'maxSize',
    'maxValue',
    'minSize',
    'minValue',
    'multiple',
    'outputObject',
    'pctColumns',
    'query',
    'refresh',
    'runLocal',
    'showDownloadButton',
    'showLoadButton',
    'sticky',
    'switch',
    'titleAdd',
    'titleEdit',
    'updateMarker',
    'values',
  ],
  textarea: [
    'accept',
    'allowDelete',
    'allowInsert',
    'asCredential',
    'convertToUtc',
    'dateType',
    'dbConfig',
    'deleteMarker',
    'editable',
    'expression',
    'filterColumns',
    'hide',
    'horizontal',
    'icon',
    'in',
    'insertMarker',
    'isHtml',
    'jq',
    'keydown',
    'maxLength',
    'maxSize',
    'maxValue',
    'minLength',
    'minSize',
    'minValue',
    'multiple',
    'notIn',
    'outputObject',
    'pctColumns',
    'query',
    'refresh',
    'regex',
    'runLocal',
    'sameAs',
    'showDownloadButton',
    'showLoadButton',
    'sticky',
    'switch',
    'titleAdd',
    'titleEdit',
    'updateMarker',
    'values',
  ],
  password: [
    'accept',
    'allowDelete',
    'allowInsert',
    'convertToUtc',
    'dateType',
    'dbConfig',
    'deleteMarker',
    'editable',
    'expression',
    'filterColumns',
    'horizontal',
    'insertMarker',
    'isHtml',
    'jq',
    'maxSize',
    'maxValue',
    'minSize',
    'minValue',
    'multiple',
    'outputObject',
    'pctColumns',
    'query',
    'refresh',
    'runLocal',
    'showDownloadButton',
    'showLoadButton',
    'sticky',
    'switch',
    'titleAdd',
    'titleEdit',
    'updateMarker',
    'values',
  ],
  checkbox: [
    'accept',
    'allowDelete',
    'allowInsert',
    'asCredential',
    'convertToUtc',
    'dateType',
    'dbConfig',
    'deleteMarker',
    'editable',
    'expression',
    'filterColumns',
    'hide',
    'horizontal',
    'insertMarker',
    'isHtml',
    'jq',
    'keydown',
    'maxLength',
    'maxSize',
    'maxValue',
    'minLength',
    'minSize',
    'minValue',
    'multiple',
    'outputObject',
    'pctColumns',
    'query',
    'refresh',
    'regex',
    'runLocal',
    'showDownloadButton',
    'showLoadButton',
    'sticky',
    'titleAdd',
    'titleEdit',
    'updateMarker',
    'values',
  ],
  enum: [
    'allowDelete',
    'allowInsert',
    'convertToUtc',
    'dateType',
    'deleteMarker',
    'editable',
    'hide',
    'insertMarker',
    'isHtml',
    'keydown',
    'maxLength',
    'maxSize',
    'maxValue',
    'minLength',
    'minSize',
    'minValue',
    'regex',
    'showDownloadButton',
    'showLoadButton',
    'switch',
    'titleAdd',
    'titleEdit',
    'updateMarker',
  ],
  number: [
    'accept',
    'allowDelete',
    'allowInsert',
    'asCredential',
    'convertToUtc',
    'dateType',
    'dbConfig',
    'deleteMarker',
    'editable',
    'expression',
    'filterColumns',
    'hide',
    'horizontal',
    'insertMarker',
    'isHtml',
    'jq',
    'maxLength',
    'maxSize',
    'minLength',
    'minSize',
    'multiple',
    'outputObject',
    'pctColumns',
    'query',
    'refresh',
    'runLocal',
    'showDownloadButton',
    'showLoadButton',
    'sticky',
    'switch',
    'titleAdd',
    'titleEdit',
    'updateMarker',
    'values',
  ],
  radio: [
    'accept',
    'allowDelete',
    'allowInsert',
    'asCredential',
    'convertToUtc',
    'dateType',
    'dbConfig',
    'deleteMarker',
    'editable',
    'expression',
    'filterColumns',
    'hide',
    'horizontal',
    'icon',
    'insertMarker',
    'isHtml',
    'jq',
    'keydown',
    'maxLength',
    'maxSize',
    'maxValue',
    'minLength',
    'minSize',
    'minValue',
    'multiple',
    'outputObject',
    'pctColumns',
    'query',
    'refresh',
    'regex',
    'runLocal',
    'showDownloadButton',
    'showLoadButton',
    'sticky',
    'switch',
    'titleAdd',
    'titleEdit',
    'updateMarker',
  ],
  expression: [
    'accept',
    'allowDelete',
    'allowInsert',
    'deleteMarker',
    'filterColumns',
    'horizontal',
    'insertMarker',
    'keydown',
    'maxSize',
    'maxValue',
    'minSize',
    'minValue',
    'multiple',
    'outputObject',
    'pctColumns',
    'showDownloadButton',
    'showLoadButton',
    'sticky',
    'switch',
    'titleAdd',
    'titleEdit',
    'updateMarker',
  ],
  local: [
    'accept',
    'allowDelete',
    'allowInsert',
    'dbConfig',
    'deleteMarker',
    'filterColumns',
    'horizontal',
    'insertMarker',
    'keydown',
    'maxSize',
    'maxValue',
    'minSize',
    'minValue',
    'multiple',
    'outputObject',
    'pctColumns',
    'showDownloadButton',
    'showLoadButton',
    'sticky',
    'switch',
    'titleAdd',
    'titleEdit',
    'updateMarker',
  ],
  local_out: [
    'accept',
    'allowDelete',
    'allowInsert',
    'dbConfig',
    'deleteMarker',
    'filterColumns',
    'horizontal',
    'insertMarker',
    'keydown',
    'maxSize',
    'maxValue',
    'minSize',
    'minValue',
    'multiple',
    'outputObject',
    'pctColumns',
    'showDownloadButton',
    'showLoadButton',
    'sticky',
    'switch',
    'titleAdd',
    'titleEdit',
    'updateMarker',
  ],
  credential: [
    'accept',
    'allowDelete',
    'allowInsert',
    'dbConfig',
    'deleteMarker',
    'filterColumns',
    'horizontal',
    'insertMarker',
    'keydown',
    'maxSize',
    'maxValue',
    'minSize',
    'minValue',
    'multiple',
    'outputObject',
    'pctColumns',
    'showDownloadButton',
    'showLoadButton',
    'sticky',
    'switch',
    'titleAdd',
    'titleEdit',
    'updateMarker',
    'values',
  ],
  list: [
    'accept',
    'asCredential',
    'convertToUtc',
    'dateType',
    'editable',
    'horizontal',
    'icon',
    'in',
    'isHtml',
    'keydown',
    'maxLength',
    'maxSize',
    'maxValue',
    'minLength',
    'minSize',
    'minValue',
    'multiple',
    'notIn',
    'outputObject',
    'refresh',
    'regex',
    'sameAs',
    'sticky',
    'switch',
    'values',
  ],
  datetime: [
    'accept',
    'columns',
    'filterColumns',
    'from',
    'maxLength',
    'maxSize',
    'maxValue',
    'minLength',
    'minSize',
    'minValue',
    'outputObject',
    'pctColumns',
    'previewColumn',
    'showDownloadButton',
    'showLoadButton',
    'switch',
    'titleAdd',
    'titleEdit',
    'valueColumn',
    'values',
  ],
  html: [
    'accept',
    'allowDelete',
    'allowInsert',
    'asCredential',
    'columns',
    'convertToUtc',
    'dateType',
    'dbConfig',
    'deleteMarker',
    'editable',
    'filterColumns',
    'help',
    'hide',
    'horizontal',
    'icon',
    'in',
    'insertMarker',
    'isHtml',
    'jq',
    'keydown',
    'maxLength',
    'maxSize',
    'maxValue',
    'minLength',
    'minSize',
    'minValue',
    'model',
    'multiple',
    'notIn',
    'outputObject',
    'pctColumns',
    'placeholder',
    'placeholderColumn',
    'previewColumn',
    'query',
    'refresh',
    'regex',
    'required',
    'sameAs',
    'showDownloadButton',
    'showLoadButton',
    'size',
    'sticky',
    'switch',
    'updateMarker',
    'validIf',
    'validIfNot',
    'valueColumn',
    'values',
  ],
  file: [
    'allowDelete',
    'allowInsert',
    'asCredential',
    'columns',
    'convertToUtc',
    'dateType',
    'dbConfig',
    'deleteMarker',
    'editable',
    'filterColumns',
    'hide',
    'horizontal',
    'in',
    'insertMarker',
    'isHtml',
    'jq',
    'keydown',
    'maxLength',
    'maxValue',
    'minLength',
    'minValue',
    'multiple',
    'notIn',
    'outputObject',
    'pctColumns',
    'placeholderColumn',
    'previewColumn',
    'query',
    'refresh',
    'runLocal',
    'sameAs',
    'showDownloadButton',
    'showLoadButton',
    'size',
    'sticky',
    'switch',
    'updateMarker',
    'validIf',
    'validIfNot',
    'valueColumn',
    'values',
  ],
  yaml: [
    'accept',
    'allowDelete',
    'allowInsert',
    'asCredential',
    'convertToUtc',
    'dateType',
    'deleteMarker',
    'editable',
    'filterColumns',
    'horizontal',
    'in',
    'insertMarker',
    'isHtml',
    'keydown',
    'maxLength',
    'maxSize',
    'maxValue',
    'minLength',
    'minSize',
    'minValue',
    'multiple',
    'notIn',
    'outputObject',
    'pctColumns',
    'regex',
    'sameAs',
    'sticky',
    'switch',
    'titleAdd',
    'titleEdit',
    'updateMarker',
    'values',
  ],
};

// Same source, the other way round : these types need at least one of the listed
// key sets ('enum' needs `values`, or `query` + `dbConfig`, or `expression`). The
// table cannot supply any of them - they are edited in the yaml - so a type
// change that leaves a field incomplete is reported instead of silently
// producing a config the server refuses. Types with a branch that requires
// nothing (text, textarea, password, checkbox, number, file, yaml) are absent.
const requiredFieldKeys = {
  enum: [['values'], ['query', 'dbConfig'], ['expression']],
  radio: [['values']],
  expression: [['expression'], ['value'], ['query', 'dbConfig']],
  local: [['expression'], ['value']],
  local_out: [['expression'], ['value']],
  credential: [['expression']],
  list: [['subform']],
  datetime: [['dateType']],
  html: [['expression']],
};

// also used by the template : a column for a key the row's type forbids must not
// render, it would only write a key the apply has to delete again
function fieldTypeAllows(type, key) {
  return !(forbiddenFieldKeys[type] || []).includes(key);
}

// The apply REPLACES the whole 'fields' sequence with what the table holds, so
// the editor may only open on a list it can read back faithfully. Read it as a
// node tree (not as parsed data) to tell such a list from one that must not be
// touched : a half-typed entry (a bare '-' parses to null) or an alias would be
// silently dropped, taking every field definition with it.
// Returns null when there is no form to edit (button disabled), { error } when a
// 'fields' list is there but unreadable (button enabled, the click explains), or
// { seq } when it can be edited - with seq null for a form that has no fields
// yet.
const fieldEditorSource = computed(() => {
  if (currentTab.value !== 'Forms' || !currentForm.value) return null;
  const doc = parseDocOrNull(forms.value[currentForm.value]);
  if (!doc || !YAML.isMap(doc.contents)) return null;
  const seq = doc.contents.get('fields');
  // 'fields: *commonFields' : rebuilding would expand the alias and drop the
  // properties of the anchor
  if (YAML.isAlias(seq)) return { error: 'alias' };
  // no 'fields' key at all, or an empty list : nothing to read back, but the
  // editor must still open. Deleting every row writes `fields: []` (which the
  // schema accepts), and Add field is then the only way back - refusing here
  // locked the editor out for good exactly when it was needed.
  if (seq === undefined || seq === null) return { seq: null };
  if (!YAML.isSeq(seq)) return { error: 'unreadable' };
  for (const item of seq.items) {
    if (YAML.isAlias(item)) return { error: 'alias' };
    if (!YAML.isMap(item)) return { error: 'unreadable' };
  }
  return { seq };
});

const currentFormHasFields = computed(() => fieldEditorSource.value !== null);

function fieldEditorRefused(src) {
  toast.warning(t(src?.error === 'alias' ? 'designer.aliasNotSupported' : 'designer.fieldsNotEditable'));
}

// Values editor : the `values` of ONE field row, edited in a panel under the
// table (the same inline pattern the categories editor uses for its icon
// picker). It holds the index of the row being edited, or null.
const fieldValuesIdx = ref(null);
let fieldValueUid = 0;

// Read a field's `values` node into editable entries. The schema
// (server/schema/form_schema.json, /formfield -> values) takes an ARRAY whose
// items are a STRING or an OBJECT, so an entry is edited either as plain text
// ('- Rome') or as a list of key/value pairs ('- name: Rome' + 'short: RO', or
// the '- value:/label:' pair a radio renders). Anything else - a nested
// map/sequence inside an entry, a non-string scalar, an alias - has no
// representation in this editor : it is kept as 'other', shown read-only and
// written back from its original node, untouched.
function readFieldValues(seq) {
  if (!YAML.isSeq(seq)) return [];
  return seq.items.map((item, i) => {
    const entry = {
      _uid: ++fieldValueUid,
      _origIndex: i,
      kind: 'other',
      text: '',
      _origText: '',
      pairs: [],
      preview: '',
    };
    if (YAML.isScalar(item) && typeof item.value === 'string') {
      entry.kind = 'string';
      entry.text = item.value;
      entry._origText = item.value;
    } else if (
      YAML.isMap(item) &&
      item.items.length > 0 &&
      item.items.every((p) => YAML.isScalar(p.key) && YAML.isScalar(p.value))
    ) {
      entry.kind = 'object';
      entry.pairs = item.items.map((p) => {
        const key = String(p.key.value ?? '');
        const value = p.value.value === null || p.value.value === undefined ? '' : String(p.value.value);
        return { _uid: ++fieldValueUid, key, value, _origKey: key, _origValue: value };
      });
    } else {
      try {
        entry.preview = JSON.stringify(YAML.isNode(item) ? item.toJSON() : item);
      } catch {
        entry.preview = '';
      }
    }
    return entry;
  });
}

// The signature of the edited list : an apply only rewrites `values` when this
// changed, so a field whose values were only looked at keeps its node - and with
// it every comment and quoting style inside the list.
function fieldValuesSnapshot(values) {
  return JSON.stringify((values || []).map((e) => [e._uid, e.kind, e.text, e.pairs.map((p) => [p.key, p.value])]));
}

// Text typed into a value property -> the scalar it spells. Same rule the field
// `default` uses : only a whole number that spells itself back exactly as typed
// is coerced, so '0755' and '1.50' stay strings. Entries themselves are never
// coerced - the schema only accepts a string or an object there.
function coerceFieldScalar(text) {
  const d = String(text ?? '').trim();
  if (d === 'true') return true;
  if (d === 'false') return false;
  const n = Number(d);
  if (d !== '' && Number.isInteger(n) && String(n) === d) return n;
  return String(text ?? '');
}

// Write the edited entries back onto the field node, rebuilding the sequence on
// top of the nodes it was read from : an entry that was not touched keeps its
// own node, so its comments and quoting survive an edit made elsewhere in the
// list (same contract as buildCleanCatNodes one level up).
function writeFieldValues(doc, node, entries) {
  const seq = node.get('values', true);
  const orig = YAML.isSeq(seq) ? seq : null;
  // a comment between 'values:' and the first '-' belongs to the sequence : move
  // it onto the first entry before the list is rebuilt
  if (orig) hoistSeqComment(orig);
  const nodes = [];
  for (const entry of entries) {
    const origNode = orig && entry._origIndex !== undefined ? orig.get(entry._origIndex, true) : null;
    if (entry.kind === 'other') {
      // nothing here can describe it : keep it exactly as it was
      if (origNode !== undefined && origNode !== null) nodes.push(origNode);
      continue;
    }
    if (entry.kind === 'string') {
      const text = entry.text.trim();
      if (!text) continue;
      // an untouched entry keeps its node, so '- "5"' does not lose its quotes
      if (YAML.isScalar(origNode) && entry.text === entry._origText) nodes.push(origNode);
      else nodes.push(doc.createNode(text));
      continue;
    }
    const map = YAML.isMap(origNode) ? origNode : doc.createNode({});
    const keys = [];
    for (const pair of entry.pairs) {
      const key = pair.key.trim();
      if (!key) continue;
      keys.push(key);
      // untouched pair : leave the value node alone (it keeps its quoting/comment)
      if (key === pair._origKey && pair.value === pair._origValue && map.has(key)) continue;
      setDocValueIfChanged(map, key, coerceFieldScalar(pair.value));
    }
    // whatever was renamed away or removed in the editor
    for (const p of [...map.items]) {
      const k = YAML.isScalar(p.key) ? String(p.key.value ?? '') : null;
      if (k !== null && !keys.includes(k)) map.delete(k);
    }
    // an object entry without a single property is not a value, it is an empty
    // mapping the schema would still accept but nothing can select
    if (map.items.length > 0) nodes.push(map);
  }
  if (nodes.length === 0) {
    node.delete('values');
  } else if (orig) {
    orig.items = nodes;
  } else {
    node.set('values', doc.createNode(nodes));
  }
}

// 'values: *commonValues' : the editor reads a list it cannot address, and an
// apply would replace the alias by whatever the panel shows - expanding it and
// dropping everything the anchor carries. Refuse to open, like the field and
// category editors do one level up.
function toggleFieldValues(i) {
  const row = fieldEditorRows.value[i];
  if (row?._valuesAlias) {
    toast.warning(t('designer.aliasNotSupported'));
    return;
  }
  fieldValuesIdx.value = fieldValuesIdx.value === i ? null : i;
}

function addFieldValue(kind) {
  const row = fieldEditorRows.value[fieldValuesIdx.value];
  if (!row) return;
  row.values.push(
    kind === 'object'
      ? {
          _uid: ++fieldValueUid,
          kind: 'object',
          text: '',
          _origText: '',
          pairs: [{ _uid: ++fieldValueUid, key: '', value: '', _origKey: null, _origValue: null }],
          preview: '',
        }
      : { _uid: ++fieldValueUid, kind: 'string', text: '', _origText: '', pairs: [], preview: '' },
  );
}

function removeFieldValue(entry) {
  const row = fieldEditorRows.value[fieldValuesIdx.value];
  if (!row) return;
  const idx = row.values.indexOf(entry);
  if (idx >= 0) row.values.splice(idx, 1);
}

// up/down rather than drag : the field rows themselves are already draggable, so
// a nested drag source inside a row would fight with it
function moveFieldValue(entry, delta) {
  const row = fieldEditorRows.value[fieldValuesIdx.value];
  if (!row) return;
  const idx = row.values.indexOf(entry);
  const to = idx + delta;
  if (idx < 0 || to < 0 || to >= row.values.length) return;
  row.values.splice(to, 0, row.values.splice(idx, 1)[0]);
}

function addFieldValuePair(entry) {
  entry.pairs.push({ _uid: ++fieldValueUid, key: '', value: '', _origKey: null, _origValue: null });
}

function removeFieldValuePair(entry, idx) {
  entry.pairs.splice(idx, 1);
}

// a new row starts from the same shape openFieldEditor builds, so the apply can
// tell an untouched values list (the snapshot) from an edited one
function addFieldRow() {
  fieldValuesIdx.value = null;
  fieldEditorRows.value.push({
    name: '',
    type: 'text',
    label: '',
    help: '',
    required: false,
    default: '',
    _defaultDisplay: '',
    output: true,
    values: [],
    _valuesSnapshot: fieldValuesSnapshot([]),
    _valuesAlias: false,
  });
}

function removeFieldRow(i) {
  // the indices shift as soon as a row goes : an open values panel would end up
  // editing another field (same reason as editCatRemove)
  fieldValuesIdx.value = null;
  fieldEditorRows.value.splice(i, 1);
}

// The default is shown as text but written back verbatim when it was not
// touched, so a quoted number keeps its quotes and a list/map default (which has
// no text representation in the table) is not flattened into a string.
function fieldDefaultDisplay(node) {
  if (node === undefined || node === null) return '';
  if (YAML.isScalar(node)) return node.value === null || node.value === undefined ? '' : String(node.value);
  if (YAML.isNode(node)) return JSON.stringify(node.toJSON());
  return String(node);
}

// Collect every subform name a form references : "list" and "yaml" fields point
// at one by name, wizard steps do too, and both nest (a subform's own list
// fields). `visited` guards against cycles (A -> B -> A). This mirrors the
// server side resolution (form.model.js, collectSubformsForForm), which the
// normal /form load relies on but a designer preview has to do itself.
function collectSubformNames(fields, byName, collected, visited) {
  if (!Array.isArray(fields)) return;
  for (const field of fields) {
    if ((field?.type === 'list' || field?.type === 'yaml') && field?.subform && !visited.has(field.subform)) {
      visited.add(field.subform);
      collected.add(field.subform);
      collectSubformNames(byName.get(field.subform)?.fields, byName, collected, visited);
    }
    // multistep forms nest their fields under step objects
    if (Array.isArray(field?.fields)) collectSubformNames(field.fields, byName, collected, visited);
  }
}

// Resolve the subforms of a form from the (possibly unsaved) designer buffers,
// the way the server inlines them on a normal load. A subform that is missing
// or has bad yaml is reported back instead of throwing, so the preview still
// opens (with a placeholder for that field, like the server does).
function resolveSubforms(form) {
  const byName = new Map();
  for (const f of formsObj.value) {
    if (f && f.type === 'subform' && f.name && !byName.has(f.name)) byName.set(f.name, f);
  }
  const names = new Set();
  const visited = new Set();
  collectSubformNames(form?.fields, byName, names, visited);
  if (Array.isArray(form?.wizard)) {
    for (const step of form.wizard) {
      if (step?.subform && !visited.has(step.subform)) {
        visited.add(step.subform);
        names.add(step.subform);
        collectSubformNames(byName.get(step.subform)?.fields, byName, names, visited);
      }
    }
  }
  const subforms = [];
  const missing = [];
  for (const name of names) {
    const sub = byName.get(name);
    if (sub) subforms.push(sub);
    else missing.push(name);
  }
  return { subforms, missing };
}

function previewForm() {
  if (!currentFormName.value || !currentForm.value) return;
  const yaml = forms.value[currentForm.value];
  if (!yaml) return;
  let parsed;
  try {
    parsed = YAML.parse(yaml);
  } catch {
    parsed = null;
  }
  // a comment-only / '---' buffer parses to null : there is nothing to preview
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    toast.error(t('designer.badYamlUpdate'));
    return;
  }
  const { subforms, missing } = resolveSubforms(parsed);
  if (missing.length > 0) {
    toast.warning(`${t('designer.previewMissingSubforms')}: ${missing.join(', ')}`);
  }
  sessionStorage.setItem(
    'designer-preview',
    JSON.stringify({ form: yaml, subforms, constants: constantsObj.value || {} }),
  );
  // the app can be hosted under a subpath (BASE_URL), like the router does
  window.open(`${BaseUrl}/form?form=${encodeURIComponent(currentFormName.value)}&preview=1`, '_blank');
}

function openFieldEditor() {
  const src = fieldEditorSource.value;
  if (!src) return;
  // never open on a list the apply cannot rebuild : the table would show what it
  // managed to read (possibly nothing) and Apply would make that the truth
  if (src.error) {
    fieldEditorRefused(src);
    return;
  }
  fieldValuesIdx.value = null;
  fieldEditorRows.value = (src.seq ? src.seq.items : []).map((item, i) => {
    const def = item.get('default', true);
    const display = fieldDefaultDisplay(def);
    const valuesNode = item.get('values', true);
    const values = readFieldValues(valuesNode);
    return {
      // stable identity of the field this row was built from : the apply must
      // recognise a renamed row as the same field, otherwise every property it
      // does not show (values, query, dependencies, regex, ...) would be lost
      _origIndex: i,
      _defaultDisplay: display,
      values,
      _valuesSnapshot: fieldValuesSnapshot(values),
      _valuesAlias: YAML.isAlias(valuesNode),
      name: String(item.get('name') ?? ''),
      type: String(item.get('type') ?? '') || 'text',
      label: String(item.get('label') ?? ''),
      help: String(item.get('help') ?? ''),
      required: item.get('required') === true,
      default: display,
      output: item.get('output') !== undefined ? item.get('output') !== false : true,
    };
  });
  showFieldEditor.value = true;
}

const fieldDragIdx = ref(null);

// the row indices shift while dragging, so an open values panel would follow the
// position rather than the field it was opened on : close it
function fieldDragStart(i) {
  fieldValuesIdx.value = null;
  fieldDragIdx.value = i;
}
function fieldDragOver(e, i) {
  e.preventDefault();
  if (fieldDragIdx.value === null || fieldDragIdx.value === i) return;
  const rows = fieldEditorRows.value;
  const moved = rows.splice(fieldDragIdx.value, 1)[0];
  rows.splice(i, 0, moved);
  fieldDragIdx.value = i;
}
function fieldDragEnd() {
  fieldDragIdx.value = null;
}

function applyFieldEditor() {
  // the buffer can have changed since the editor opened (the raw editor stays
  // live) : re-check, an apply on a list that can't be rebuilt would wipe it
  const src = fieldEditorSource.value;
  if (!src || src.error) {
    fieldEditorRefused(src);
    return;
  }
  const removed = [];
  const missing = [];
  const ok = editCurrentFormDoc((doc) => {
    const seq = doc.get('fields');
    // a comment between 'fields:' and the first '-' belongs to the sequence :
    // move it onto the first field before the list is rebuilt
    hoistSeqComment(seq);
    const nodes = [];
    for (const row of fieldEditorRows.value) {
      const name = row.name.trim();
      if (!name) continue;
      // match on the identity stamped when the editor opened, never on the
      // (possibly renamed) name : the original node carries every property the
      // editor does not show, plus its comments
      let node = YAML.isSeq(seq) && row._origIndex !== undefined ? seq.get(row._origIndex) : null;
      if (!YAML.isMap(node)) node = doc.createNode({ name, type: row.type });
      setDocValueIfChanged(node, 'name', name);
      setDocValueIfChanged(node, 'type', row.type);
      setDocValueIfChanged(node, 'label', row.label.trim() || undefined);
      // help/required are not rendered for a type that forbids them (html) : the
      // row still carries what an earlier type had, so don't write it back
      if (fieldTypeAllows(row.type, 'help')) setDocValueIfChanged(node, 'help', row.help.trim() || undefined);
      if (fieldTypeAllows(row.type, 'required'))
        setDocValueIfChanged(node, 'required', row.required ? true : undefined);
      // an untouched default keeps its node : that preserves the formatting of a
      // scalar ('5' stays quoted) and a list/map default the table can't show
      if (row.default !== row._defaultDisplay) {
        const d = row.default.trim();
        if (d) {
          if (d === 'true') node.set('default', true);
          else if (d === 'false') node.set('default', false);
          else {
            // the schema takes a string/boolean/array/integer/object default,
            // never a float, and Number() silently rewrites the text on top of
            // that ('0755' -> 755, '1e3' -> 1000, '1.50' -> 1.5). Only coerce
            // when the result is a whole number that spells itself back exactly
            // as typed, and keep the string in every other case.
            const n = Number(d);
            if (Number.isInteger(n) && String(n) === d) node.set('default', n);
            else node.set('default', d);
          }
        } else node.delete('default');
      }
      setDocValueIfChanged(node, 'output', row.output ? undefined : false);
      // `values` is only rewritten when the values panel actually changed it :
      // an untouched list keeps its own nodes, comments included. A type that
      // forbids it is skipped here and cleaned up by the loop below.
      if (
        fieldTypeAllows(row.type, 'values') &&
        !row._valuesAlias &&
        fieldValuesSnapshot(row.values) !== row._valuesSnapshot
      ) {
        writeFieldValues(doc, node, row.values);
      }
      // whatever the previous type left behind : the schema rejects the config
      // as a whole, so a type change has to clean up after itself here too.
      // Report it, these keys hold real work (values, query, columns, ...).
      const dropped = [];
      for (const key of forbiddenFieldKeys[row.type] || []) {
        if (node.has(key)) {
          node.delete(key);
          dropped.push(key);
        }
      }
      if (dropped.length > 0) removed.push(`${name} (${row.type}): ${dropped.join(', ')}`);
      // and what the new type needs but the table cannot provide
      const needs = requiredFieldKeys[row.type];
      if (needs && !needs.some((set) => set.every((key) => node.has(key)))) {
        missing.push(`${name} (${row.type}): ${needs.map((set) => set.join(' + ')).join(' | ')}`);
      }
      nodes.push(node);
    }
    if (YAML.isSeq(seq)) seq.items = nodes;
    else doc.set('fields', doc.createNode(nodes));
  });
  if (ok && removed.length > 0) {
    toast.warning(t('designer.fieldKeysRemoved', { details: removed.join(' | ') }));
  }
  if (ok && missing.length > 0) {
    toast.warning(t('designer.fieldKeysMissing', { details: missing.join(' | ') }));
  }
  showFieldEditor.value = false;
}

// Form settings editor
const showFormSettings = ref(false);
const formTypes = ['ansible', 'awx', 'multistep', 'subform'];
const formSettings = ref({});

// Mirror of the per-type `oneOf` in server/schema/form_schema.json : every form
// type FORBIDS a set of keys, so a key left behind by a type change makes the
// whole config unsaveable (with an opaque AJV error) while its input is no
// longer rendered to remove it. The modal therefore only writes the keys the
// selected type allows, and drops the ones it forbids.
const forbiddenFormKeys = {
  ansible: [
    'template',
    'awx',
    'steps',
    'awxCredentials',
    'executionEnvironment',
    'scm_branch',
    'instanceGroups',
    'expression',
  ],
  awx: ['playbook', 'playbookSubPath', 'ansibleCredentials', 'vaultCredentials', 'steps', 'expression'],
  multistep: [
    'playbook',
    'playbookSubPath',
    'runner',
    'template',
    'awx',
    'inventory',
    'tags',
    'limit',
    'check',
    'diff',
    'scm_branch',
    'executionEnvironment',
    'instanceGroups',
    'ansibleCredentials',
    'awxCredentials',
    'vaultCredentials',
    'key',
    'expression',
  ],
  subform: [
    'playbook',
    'playbookSubPath',
    'runner',
    'template',
    'awx',
    'steps',
    'expression',
    'roles',
    'categories',
    'notifications',
    'approval',
    'hasApproval',
    'onSubmit',
    'onSuccess',
    'onFailure',
    'onAbort',
    'onFinish',
    'inventory',
    'tags',
    'limit',
    'check',
    'diff',
    'scm_branch',
    'executionEnvironment',
    'instanceGroups',
    'ansibleCredentials',
    'awxCredentials',
    'vaultCredentials',
    'credentials',
    'abortable',
    'allowRelaunch',
    'launchValidation',
    'enableForChat',
    'verbose',
    'keepExtravars',
    'userExtravars',
    'image',
    'icon',
    'iconColor',
    'iconSize',
    'overlayIcon',
    'overlayIconTransform',
    'overlayIconColor',
    'overlayIconCircle',
    'overlayIconText',
    'overlayIconTextPosition',
    'overlayIconTextColor',
    'tileClass',
    'order',
  ],
};

// also used by the template : an input for a key the selected type forbids must
// not render, it would only write a key the apply has to delete again
// launch validation of a form : the instance's LAUNCH_VALIDATION, or stricter
const launchValidationOptions = computed(() => [
  { value: '', label: t('designer.formLaunchValidationDefault') },
  { value: 'log', label: 'log' },
  { value: 'enforce', label: 'enforce' },
]);

function formTypeAllows(key) {
  return !(forbiddenFormKeys[formSettings.value.type] || []).includes(key);
}

function openFormSettings() {
  if (currentTab.value !== 'Forms' || !currentForm.value) {
    toast.warning(t('designer.selectFormFirst'));
    return;
  }
  try {
    const parsed = YAML.parse(forms.value[currentForm.value]);
    formSettings.value = {
      name: parsed.name || '',
      type: parsed.type || 'ansible',
      description: parsed.description || '',
      playbook: parsed.playbook || '',
      runner: parsed.runner || '',
      template: parsed.template || '',
      inventory: parsed.inventory || '',
      tags: parsed.tags || '',
      limit: parsed.limit || '',
      order: parsed.order !== undefined ? parsed.order : '',
      help: parsed.help || '',
      showHelp: !!parsed.showHelp,
      check: !!parsed.check,
      diff: !!parsed.diff,
      allowRelaunch: !!parsed.allowRelaunch,
      launchValidation: ['log', 'enforce'].includes(parsed.launchValidation) ? parsed.launchValidation : '',
      enableForChat: parsed.enableForChat === true,
      hasWizard: Array.isArray(parsed.wizard) && parsed.wizard.length > 0,
      abortable: !!parsed.abortable,
      verbose: !!parsed.verbose,
      keepExtravars: !!parsed.keepExtravars,
      userExtravars: parsed.userExtravars || '',
      scmBranch: parsed.scm_branch || '',
      executionEnvironment: parsed.executionEnvironment || '',
      instanceGroups: Array.isArray(parsed.instanceGroups)
        ? parsed.instanceGroups.join(', ')
        : parsed.instanceGroups || '',
      ansibleCredentials: parsed.ansibleCredentials || '',
      vaultCredentials: parsed.vaultCredentials || '',
    };
  } catch {
    formSettings.value = {};
  }
  showFormSettings.value = true;
}

function applyFormSettings() {
  const s = formSettings.value;
  const removed = [];
  const ok = editCurrentFormDoc((doc) => {
    if (s.name.trim()) doc.set('name', s.name.trim());
    doc.set('type', s.type);
    setDocValue(doc, 'description', s.description.trim() || undefined);
    if (formTypeAllows('playbook')) setDocValue(doc, 'playbook', s.playbook.trim() || undefined);
    if (formTypeAllows('runner')) setDocValue(doc, 'runner', (s.runner || '').trim() || undefined);
    if (formTypeAllows('template')) setDocValue(doc, 'template', s.template.trim() || undefined);
    if (formTypeAllows('inventory')) setDocValue(doc, 'inventory', s.inventory.trim() || undefined);
    if (formTypeAllows('tags')) setDocValue(doc, 'tags', s.tags.trim() || undefined);
    if (formTypeAllows('limit')) setDocValue(doc, 'limit', s.limit.trim() || undefined);
    if (formTypeAllows('order'))
      setDocValue(doc, 'order', s.order !== '' && !isNaN(Number(s.order)) ? Number(s.order) : undefined);
    setDocValue(doc, 'help', s.help.trim() || undefined);
    setDocValue(doc, 'showHelp', s.showHelp ? true : undefined);
    if (formTypeAllows('check')) setDocValue(doc, 'check', s.check ? true : undefined);
    if (formTypeAllows('diff')) setDocValue(doc, 'diff', s.diff ? true : undefined);
    if (formTypeAllows('allowRelaunch')) setDocValue(doc, 'allowRelaunch', s.allowRelaunch ? true : undefined);
    if (formTypeAllows('launchValidation') && !s.hasWizard)
      setDocValue(doc, 'launchValidation', s.launchValidation || undefined);
    if (formTypeAllows('enableForChat') && !s.hasWizard)
      setDocValue(doc, 'enableForChat', s.enableForChat ? true : undefined);
    if (formTypeAllows('abortable')) setDocValue(doc, 'abortable', s.abortable ? true : undefined);
    if (formTypeAllows('verbose')) setDocValue(doc, 'verbose', s.verbose ? true : undefined);
    if (formTypeAllows('keepExtravars')) setDocValue(doc, 'keepExtravars', s.keepExtravars ? true : undefined);
    if (formTypeAllows('userExtravars')) setDocValue(doc, 'userExtravars', (s.userExtravars || '').trim() || undefined);
    if (formTypeAllows('scm_branch')) setDocValue(doc, 'scm_branch', s.scmBranch.trim() || undefined);
    if (formTypeAllows('executionEnvironment'))
      setDocValue(doc, 'executionEnvironment', s.executionEnvironment.trim() || undefined);
    if (formTypeAllows('instanceGroups')) {
      const ig = s.instanceGroups.trim();
      setDocValue(
        doc,
        'instanceGroups',
        ig
          ? ig
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
          : undefined,
      );
    }
    if (formTypeAllows('ansibleCredentials'))
      setDocValue(doc, 'ansibleCredentials', s.ansibleCredentials.trim() || undefined);
    if (formTypeAllows('vaultCredentials'))
      setDocValue(doc, 'vaultCredentials', s.vaultCredentials.trim() || undefined);
    // whatever the previous type left behind : the schema rejects the config as
    // a whole, so a type change has to clean up after itself. Report it, some of
    // these keys are written by other modals (icon, categories, roles, ...).
    for (const key of forbiddenFormKeys[s.type] || []) {
      if (doc.has(key)) {
        doc.delete(key);
        removed.push(key);
      }
    }
  });
  if (ok && removed.length > 0) {
    toast.warning(t('designer.typeKeysRemoved', { type: s.type, keys: removed.join(', ') }));
  }
  showFormSettings.value = false;
}

function editorDiff() {
  if (currentTab.value === 'Categories') {
    diffSaved.value = baselineRaw.value.categories || '';
    diffCurrent.value = categories.value;
  } else if (currentTab.value === 'Roles') {
    diffSaved.value = baselineRaw.value.roles || '';
    diffCurrent.value = roles.value;
  } else if (currentTab.value === 'Constants') {
    diffSaved.value = baselineRaw.value.constants || '';
    diffCurrent.value = constants.value;
  } else if (currentTab.value === 'Forms' && currentForm.value) {
    diffSaved.value = baselineRaw.value.forms[currentForm.value] || '';
    diffCurrent.value = forms.value[currentForm.value] || '';
  } else {
    return;
  }
  showDiffModal.value = true;
}

const diffLines = computed(() => {
  if (!showDiffModal.value) return [];
  const oldLines = diffSaved.value.split('\n');
  const newLines = diffCurrent.value.split('\n');
  const result = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = i < oldLines.length ? oldLines[i] : undefined;
    const n = i < newLines.length ? newLines[i] : undefined;
    if (o === n) {
      result.push({ type: 'same', text: o });
    } else {
      if (o !== undefined) result.push({ type: 'removed', text: o });
      if (n !== undefined) result.push({ type: 'added', text: n });
    }
  }
  return result;
});

const formTemplate = {
  name: 'New Form',
  type: 'ansible',
  playbook: 'dummy.yaml',
  description: '',
  roles: ['public'],
  categories: [],
  tileClass: 'has-background-info-light',
  fields: [
    {
      name: 'field1',
      type: 'text',
      label: 'field1',
    },
  ],
};

// computed values

const files = computed(() => {
  return formsObj.value.map((x) => x.source).filter((v, i, a) => a.indexOf(v) === i);
});

const folders = computed(() => {
  const set = new Set();
  for (const source of files.value) {
    if (source && source.includes('/')) {
      const parts = source.split('/');
      let path = '';
      for (let i = 0; i < parts.length - 1; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        set.add(path);
      }
    }
  }
  return [...set].sort();
});

const fileTreeFlat = computed(() => {
  const result = [];
  const tree = {};

  for (const source of files.value) {
    const filePath = source || '';
    const parts = filePath ? filePath.split('/') : [''];
    let current = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = { __children: {} };
      current = current[parts[i]].__children;
    }
    current[parts[parts.length - 1]] = { __file: true, source };
  }

  function walk(obj, depth, parentPath) {
    const keys = Object.keys(obj).sort((a, b) => {
      const aIsFolder = obj[a].__children && !obj[a].__file;
      const bIsFolder = obj[b].__children && !obj[b].__file;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.localeCompare(b);
    });
    for (const key of keys) {
      const node = obj[key];
      const nodePath = parentPath ? `${parentPath}/${key}` : key;
      if (node.__file) {
        result.push({
          type: 'file',
          name: key || null,
          source: node.source,
          depth,
          key: `file:${node.source || '__base__'}`,
        });
      } else {
        result.push({ type: 'folder', name: key, path: nodePath, depth, key: `folder:${nodePath}` });
        if (!collapsedPaths.value.has(`folder:${nodePath}`)) {
          walk(node.__children, depth + 1, nodePath);
        }
      }
    }
  }

  walk(tree, 0, '');
  if (treeFilter.value) {
    const q = treeFilter.value.toLowerCase();
    const matchingFiles = new Set();
    for (const m of idmapping.value) {
      if ((m.name || '').toLowerCase().includes(q)) {
        matchingFiles.add(m.source);
      }
    }
    return result.filter((item) => {
      if (item.type === 'folder') return true;
      return (item.name || '').toLowerCase().includes(q) || matchingFiles.has(item.source);
    });
  }
  return result;
});

const formsObj = computed(() => {
  // Assemble the saved forms in per-file DISPLAY order, so drag-to-reorder
  // (which only updates formOrderMap) is persisted in the saved file. The
  // ordered source list is derived from idmapping (which depends only on
  // forms/formMeta) rather than from `files` (which is derived from this
  // computed), to avoid a circular computed dependency.
  const sources = [];
  for (const m of idmapping.value) {
    if (!sources.includes(m.source)) sources.push(m.source);
  }
  const orderedIds = sources.flatMap((s) => formIdsForSave(s));
  // safety net : keep any ids not covered by formnames (eg unparsable forms)
  for (const id of Object.keys(forms.value)) {
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }
  return orderedIds.map((x) => {
    try {
      var result = YAML.parse(forms.value[x]);
      if (result.name) {
        const meta = formMeta.value[x];
        if (meta?.source) result.source = meta.source;
        if (meta?.repository) result.repository = meta.repository;
        return result;
      } else {
        throw new Error('parsing issue');
      }
    } catch {
      // same as idmapping : the file a form belongs to is known from formMeta and does
      // not depend on its yaml parsing. It also keeps the plain-assembly fallback from
      // writing an unparsable form out under a "Parsing issues" source.
      return { name: x, source: formMeta.value[x]?.source };
    }
  });
});

function flattenCatsForPicker(cats, parentPath, depth) {
  const result = [];
  for (const c of cats) {
    if (!c || !c.name) continue;
    const path = parentPath ? parentPath + '/' + c.name : c.name;
    result.push({ name: c.name, icon: c.icon, path, depth });
    if (c.items && c.items.length > 0) {
      result.push(...flattenCatsForPicker(c.items, path, depth + 1));
    }
  }
  return result;
}

const flatCategoriesForPicker = computed(() => {
  const cats = categoriesObj.value;
  if (!cats) return [];
  return flattenCatsForPicker(cats, '', 0);
});

// Only a shape the server would reject outright is refused here : the section
// must be a yaml sequence. Anything beyond that (an entry without an icon, an
// entry the designer did not write, ...) is the schema's business - the base
// schema accepts an empty icon, which the settings categories page legitimately
// writes, and refusing it here blocked EVERY save of the whole designer.
const categoriesObj = computed(() => {
  if (!categories.value) {
    return [{ name: 'Default', icon: 'bars' }];
  }
  try {
    var result = YAML.parse(categories.value);
    if (Array.isArray(result)) {
      return result;
    } else {
      throw new Error('parsing issue');
    }
  } catch {
    return undefined;
  }
});

const rolesObj = computed(() => {
  if (!roles.value) {
    return [
      { name: 'admin', groups: ['local/admins'] },
      { name: 'public', groups: [] },
    ];
  }
  try {
    var result = YAML.parse(roles.value);
    // same contract as categoriesObj : a sequence is all that is checked. The
    // base schema lets a role carry `users` INSTEAD of `groups`, so demanding
    // groups on the first role refused a perfectly valid configuration.
    if (Array.isArray(result)) {
      return result;
    } else {
      throw new Error('parsing issue');
    }
  } catch {
    return undefined;
  }
});

const constantsObj = computed(() => {
  if (!constants.value) {
    return {};
  }
  try {
    var result = YAML.parse(constants.value);
    return result;
  } catch {
    return undefined;
  }
});

const idmapping = computed(() => {
  if (!forms.value) {
    return {};
  }
  return Object.keys(forms.value).map((x) => {
    try {
      var tmp = YAML.parse(forms.value[x]);
      if (tmp && tmp.name) {
        return { id: x, source: formMeta.value[x]?.source, name: tmp.name, icon: tmp.icon };
      } else {
        throw new Error("A form must have a few basic properties, like 'name'");
      }
    } catch (err) {
      // Which FILE a form lives in is metadata (formMeta), not something read out of
      // its yaml - so keep it even when the yaml does not parse. Reporting the source
      // as "Parsing issues" moved the form into a group of that name in the tree on
      // every keystroke that left the document invalid, which is every keystroke
      // halfway through a line. The parse failure is carried by `issue` instead, and
      // the warnings panel reports it from there.
      return { id: x, source: formMeta.value[x]?.source, name: x, issue: err.message };
    }
  });
});

const currentFormName = computed(() => {
  return idmapping.value.find((x) => x.id == currentForm.value)?.name || null;
});

const lockAge = computed(() => {
  if (lock.value?.lock) {
    return dayjs(lock.value.lock.created).fromNow();
  } else {
    return '';
  }
});

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A warning is rendered with v-html (two lines : a title and an explanation), so
// build it from translated text here instead of hardcoding english markup. Every
// value that comes from the config is escaped before it goes in ; the translated
// text itself is ours and carries no markup.
function warning(title, ...details) {
  return `<span class="text-danger fw-bold">${title}</span><br><span>${details.join('<br>')}</span>`;
}

// A warning carries where it was raised, so the panel can take you there :
// `formId` for anything about one form, `tab` for the config sections that have
// no form of their own (bad categories/roles/constants).
function formWarning(html, formId) {
  return { html, formId, tab: 'Forms' };
}
function tabWarning(html, tab) {
  return { html, formId: null, tab };
}

// The form a warning names, by name : the field-duplicate check runs on the
// parsed forms, which carry no designer id of their own.
function formIdByName(name) {
  return idmapping.value.find((x) => x.name === name)?.id || null;
}

// Take the user to what a warning is about : the form (switching to the Forms
// tab and expanding the file that holds it, which the tree may have collapsed),
// or the section it belongs to.
function goToWarning(w) {
  if (w.formId && forms.value[w.formId] !== undefined) {
    currentTab.value = 'Forms';
    const source = idmapping.value.find((x) => x.id === w.formId)?.source;
    collapsedPaths.value.delete(`file:${source || '__base__'}`);
    selectForm(w.formId);
  } else if (w.tab) {
    currentTab.value = w.tab;
  } else {
    return;
  }
  showWarnings.value = false;
}

// the base schema pins one category : `categories` must CONTAIN exactly
// {name: Default, icon: bars}. Renaming it, restyling it, giving it children or
// dropping it makes every save fail on a raw schema error, so catch it here (the
// Edit categories modal protects that row, the raw yaml editor cannot).
function hasDefaultCategory(cats) {
  return (
    Array.isArray(cats) &&
    cats.some((c) => c && c.name === 'Default' && c.icon === 'bars' && Object.keys(c).length === 2)
  );
}

const warnings = computed(() => {
  var warnings = [];
  var names = idmapping.value.map((x) => x.name);
  var dups = names.filter((item, index) => names.indexOf(item) !== index);
  var empties = idmapping.value.filter((item, _index) => !item.name);
  // a parse failure is carried by `issue` now, not by a replaced source : the form
  // keeps the file it belongs to so the tree does not move it while you type
  var parsing = idmapping.value.filter((item) => item.issue);
  var badsource = idmapping.value.filter(
    (item) => item.source && !(item.source.endsWith('.yaml') || item.source.endsWith('.yml')),
  );
  warnings = warnings.concat(
    dups.map((x) =>
      // a duplicate is by definition several forms : point at the first one
      // carrying the name, the other is one click away in the same file
      formWarning(
        warning(t('designer.warnFormDuplicate', { name: escHtml(x) }), t('designer.warnUniqueFormName')),
        formIdByName(x),
      ),
    ),
  );
  warnings = warnings.concat(
    empties.map((x) => formWarning(warning(t('designer.warnEmptyFormName'), t('designer.warnUniqueFormName')), x.id)),
  );
  warnings = warnings.concat(
    parsing.map((x) =>
      formWarning(warning(t('designer.warnBadFormYaml', { name: escHtml(x.name) }), escHtml(x.issue)), x.id),
    ),
  );
  warnings = warnings.concat(
    badsource.map((x) =>
      formWarning(
        warning(
          t('designer.warnBadSource', { name: escHtml(x.name) }),
          t('designer.warnBadSourceHint'),
          t('designer.warnBadSourceKeep'),
        ),
        x.id,
      ),
    ),
  );
  if (!categoriesObj.value) {
    warnings.push(
      tabWarning(warning(t('designer.warnBadCategories'), t('designer.warnBadCategoriesHint')), 'Categories'),
    );
  } else if (!hasDefaultCategory(categoriesObj.value)) {
    warnings.push(
      tabWarning(warning(t('designer.warnNoDefaultCategory'), t('designer.warnNoDefaultCategoryHint')), 'Categories'),
    );
  }
  if (!rolesObj.value) {
    warnings.push(tabWarning(warning(t('designer.warnBadRoles'), t('designer.warnBadRolesHint')), 'Roles'));
  }
  if (!constantsObj.value) {
    warnings.push(tabWarning(warning(t('designer.warnBadConstants'), t('designer.warnBadConstantsHint')), 'Constants'));
  }
  // check field dups
  (formsObj.value || []).forEach((item) => {
    var fields = [];
    if (item.fields) {
      item.fields.forEach((item2) => {
        fields.push(item2.name);
      });
      var dups = Helpers.findDuplicates(fields);
      dups.forEach((item2, _i) => {
        warnings.push(
          formWarning(
            warning(
              t('designer.warnFieldDuplicate', { field: escHtml(item2), form: escHtml(item.name) }),
              t('designer.warnUniqueFieldName'),
            ),
            formIdByName(item.name),
          ),
        );
      });
    }
  });
  return warnings;
});

// methods

async function loadForms() {
  try {
    const formConfig = await Form.loadAll();
    forms.value = {};
    formMeta.value = {};
    // Drag order belongs to the document that was on screen, and form ids are POSITIONAL
    // (form_0, form_1, ...) so they are reused by the next load. Keeping the map across a
    // reload therefore applied one document's ordering to a different one - silently
    // rearranging forms the user never touched, including after a discard.
    formOrderMap.value = {};
    categories.value = YAML.stringify(formConfig.categories);
    roles.value = YAML.stringify(formConfig.roles);
    if (formConfig.constants) {
      constants.value = YAML.stringify(formConfig.constants);
    }
    formConfig.forms.forEach((f, i) => {
      const id = `form_${i}`;
      formMeta.value[id] = { source: f.source, repository: f.repository };
      delete f.source;
      delete f.repository;
      forms.value[id] = YAML.stringify(f);
    });
    selectDefaultForm();
    for (const source of files.value) {
      collapsedPaths.value.add(`file:${source || '__base__'}`);
    }
    const sel = idmapping.value.find((x) => x.id === currentForm.value);
    if (sel) {
      collapsedPaths.value.delete(`file:${sel.source || '__base__'}`);
    }
    loaded.value = true;
    // the freshly loaded content is the clean baseline (only on success, so a
    // failed/partial load doesn't mark a blank designer as "clean" and saveable)
    setDirtyBaseline();
  } catch (err) {
    // a (re)load failed after the content was cleared : don't leave a blank
    // editor paired with a stale baseline (that reads as dirty and would let a
    // save overwrite the repo with empty content). Drop back to the not-loaded
    // state with no baseline, so the editor is hidden and Save stays disabled.
    loaded.value = false;
    dirtyBaseline.value = null;
    toast.error(err.message);
  }
}

async function loadLock() {
  try {
    lock.value = await Lock.get();
    lockError.value = '';
    // the header's Designer link shows the lock too : keep it in step with this poll
    store.designerLock = lock.value;
  } catch (err) {
    if (err?.response?.status === 403 && err?.response?.data?.error) {
      lockError.value = err.response.data.error;
    } else {
      toast.error(err.message);
    }
  }
}

async function loadBackups() {
  try {
    backups.value = await Backup.load();
  } catch (err) {
    toast.error(err.message);
  }
}

function selectDefaultForm() {
  currentForm.value = idmapping.value[0]?.id || null;
  if (route.query.form) {
    // find form in forms by name
    const f = idmapping.value.find((x) => x.name == route.query.form);
    if (f) {
      currentForm.value = f.id;
    }
  }
}

function isCurrentTab(name) {
  return currentTab.value == name;
}

function selectTab(name) {
  currentTab.value = name;
}

// the page title : the open view's name and icon once the designer is started, the lock
// before that
const pageTitle = computed(() => {
  if (!lock.value || lock.value.free) return { title: t('designer.lockTitle'), icon: 'lock' };
  const tab = tabs.find((x) => x.name === currentTab.value);
  return tab ? { title: tab.label(), icon: tab.icon } : { title: t('designer.title'), icon: 'pen-to-square' };
});

// the line under the title describes the open view once the designer is started, and
// what the designer is for until then
const tabDescription = computed(() => {
  if (!lock.value || lock.value.free) return t('designer.offDescription');
  return tabs.find((tab) => tab.name === currentTab.value)?.description() || '';
});

// the left menu : one entry per view ; until the designer is started (locked) the entries
// are shown greyed out, so it is clear what the designer holds but nothing can be opened
const sidebarSections = computed(() => {
  const started = !!lock.value && !lock.value.free;
  return [
    {
      title: '',
      items: sortedTabs.value.map((tab) => ({
        title: tab.label(),
        icon: tab.icon,
        active: started && isCurrentTab(tab.name),
        disabled: !started,
        action: () => selectTab(tab.name),
      })),
    },
  ];
});

function isCurrentForm(id) {
  return currentForm.value == id;
}

function selectForm(id) {
  // select the form by id
  currentForm.value = id;
  // get the name and update the route
  if (currentFormName.value) {
    const query = { ...route.query };
    query.form = currentFormName.value;
    router.push({ query });
  }
}

function deleteForm(id) {
  selectForm(id);
  action.value = 'delete';
}

const collapsedPaths = ref(new Set());
const treeSearch = ref(false);
const treeFilter = ref('');
const treeSearchInput = ref(null);

// the search box is only in the dom once treeSearch is on : focus it after vue
// has rendered it, otherwise the toggle just shows an input nobody can type in
// without clicking it first
function toggleTreeSearch() {
  treeSearch.value = !treeSearch.value;
  if (!treeSearch.value) {
    treeFilter.value = '';
    return;
  }
  nextTick(() => treeSearchInput.value?.focus());
}

function toggleCollapse(key) {
  if (collapsedPaths.value.has(key)) {
    collapsedPaths.value.delete(key);
  } else {
    collapsedPaths.value.add(key);
  }
}

function isCollapsed(key) {
  return collapsedPaths.value.has(key);
}

// every collapsible row of the tree : the files (a file holds its forms) and the
// folders. Derived from the sources/folders themselves, so a key of a file that
// is gone never keeps the toggle in the wrong state.
const allTreeKeys = computed(() => {
  const keys = files.value.map((s) => `file:${s || '__base__'}`);
  for (const f of folders.value) keys.push(`folder:${f}`);
  return keys;
});
const allTreeCollapsed = computed(
  () => allTreeKeys.value.length > 0 && allTreeKeys.value.every((k) => collapsedPaths.value.has(k)),
);

function toggleCollapseAll() {
  if (allTreeCollapsed.value) {
    collapsedPaths.value.clear();
  } else {
    for (const key of allTreeKeys.value) collapsedPaths.value.add(key);
  }
}

const dragFormId = ref(null);
const formOrderMap = ref({});
const dropTargetId = ref(null);

function onDragStart(id, event) {
  dragFormId.value = id;
  event.dataTransfer.effectAllowed = 'move';
}

function onDropOnFile(targetSource, event) {
  event.preventDefault();
  const id = dragFormId.value;
  if (!id || !forms.value[id]) return;
  if (formMeta.value[id]?.source === targetSource) return;
  if (!formMeta.value[id]) formMeta.value[id] = {};
  formMeta.value[id].source = targetSource;
  dragFormId.value = null;
  dropTargetId.value = null;
}

function onDropOnForm(targetId, event) {
  event.preventDefault();
  event.stopPropagation();
  const dragId = dragFormId.value;
  dropTargetId.value = null;
  if (!dragId || dragId === targetId) {
    dragFormId.value = null;
    return;
  }
  const dragMap = idmapping.value.find((x) => x.id === dragId);
  const targetMap = idmapping.value.find((x) => x.id === targetId);
  if (!dragMap || !targetMap) {
    dragFormId.value = null;
    return;
  }
  if (dragMap.source !== targetMap.source) {
    if (!formMeta.value[dragId]) formMeta.value[dragId] = {};
    formMeta.value[dragId].source = targetMap.source;
    dragFormId.value = null;
    return;
  }
  const key = dragMap.source ?? '__base__';
  let order = formOrderMap.value[key];
  if (!order) {
    order = formnames(dragMap.source).map((f) => f.id);
  } else {
    order = [...order];
  }
  const fromIdx = order.indexOf(dragId);
  if (fromIdx >= 0) order.splice(fromIdx, 1);
  const insertIdx = order.indexOf(targetId);
  order.splice(insertIdx >= 0 ? insertIdx : order.length, 0, dragId);
  formOrderMap.value = { ...formOrderMap.value, [key]: order };
  dragFormId.value = null;
}

function onFormDragOver(targetId, event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  dropTargetId.value = targetId;
}

function onDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

const ctxMenu = ref({ show: false, x: 0, y: 0, target: null });
const showRenameModal = ref(false);
const renameValue = ref('');
const renameSource = ref(null);
const showMoveModal = ref(false);
const moveFormId = ref(null);
const moveTarget = ref('');

function openContextMenu(event, target) {
  event.preventDefault();
  ctxMenu.value = { show: true, x: event.clientX, y: event.clientY, target };
}

function closeContextMenu() {
  ctxMenu.value = { ...ctxMenu.value, show: false };
}

function ctxRenameFile() {
  const source = ctxMenu.value.target.source;
  closeContextMenu();
  // the base file is not a file on disk (see confirmDeleteFile) : renaming it
  // would move every base form into a named file, which is not a rename
  if (!source) return;
  renameSource.value = source;
  renameValue.value = source;
  showRenameModal.value = true;
}

// Move a file's manual drag ordering with the file.
//
// formOrderMap is keyed by the file source, and nothing re-keyed it when a file was
// renamed or moved to a folder - every form's source was rewritten while the map kept
// the old key. explicitOrder(newName) was then null, so the tree snapped straight back
// to alphabetical and the save order silently fell back to document order: a manual
// ordering was lost with no message, and the stale entry stayed in the map for ever.
function moveFormOrder(oldSource, newSource) {
  const from = oldSource ?? '__base__';
  const to = newSource ?? '__base__';
  if (from === to) return;
  const order = formOrderMap.value[from];
  const next = { ...formOrderMap.value };
  delete next[from];
  if (order) next[to] = order;
  formOrderMap.value = next;
}

function doRenameFile() {
  const newName = (renameValue.value || '').trim();
  // the base file has no filename to rename (see ctxRenameFile)
  if (!renameSource.value || !newName || newName === renameSource.value) {
    showRenameModal.value = false;
    return;
  }
  if (!/^[A-Za-z0-9_./-]+\.(yaml|yml)$/.test(newName)) {
    toast.error(t('designer.newFileInvalid'));
    return;
  }
  moveFormOrder(renameSource.value, newName);
  for (const id of Object.keys(forms.value)) {
    if (formMeta.value[id]?.source === renameSource.value) {
      formMeta.value[id].source = newName;
    }
  }
  showRenameModal.value = false;
}

// A form name must be unique across the whole config (the designer warns
// otherwise), so a copy gets the first free '<name> (copy)' / '(copy N)'.
// `taken` carries the names handed out earlier in the same operation : a file
// copy renames several forms before any of them exists.
function uniqueFormName(baseName, taken = []) {
  let name = `${baseName} (copy)`;
  let counter = 2;
  while (idmapping.value.some((x) => x.name === name) || taken.includes(name)) {
    name = `${baseName} (copy ${counter++})`;
  }
  return name;
}

// The filename of a copy. Parentheses and spaces are not allowed in a forms
// filename (addFile pins the shape), hence '-copy' rather than ' (copy)'.
function uniqueFileName(source) {
  const dot = source.lastIndexOf('.');
  const base = dot > 0 ? source.slice(0, dot) : source;
  const ext = dot > 0 ? source.slice(dot) : '.yaml';
  let name = `${base}-copy${ext}`;
  let counter = 2;
  while (files.value.includes(name)) name = `${base}-copy-${counter++}${ext}`;
  return name;
}

// the next free internal id ; the ids are only a handle on the buffer, the file
// a form belongs to lives in formMeta
function nextFormId() {
  let idx = Object.keys(forms.value).length;
  while (forms.value[`form_${idx}`]) idx++;
  return `form_${idx}`;
}

function ctxDuplicateForm() {
  const srcId = ctxMenu.value.target.id;
  closeContextMenu();
  if (!forms.value[srcId]) return;
  try {
    const parsed = YAML.parse(forms.value[srcId]);
    parsed.name = uniqueFormName(parsed.name || 'Form');
    const newId = nextFormId();
    formMeta.value[newId] = { ...formMeta.value[srcId] };
    forms.value[newId] = YAML.stringify(parsed);
    currentForm.value = newId;
  } catch (err) {
    toast.error(t('designer.badYamlDuplicate'));
  }
}

// Duplicate a whole file : a copy of every form it holds, under a free filename
// and with free form names. Written through the document api, so the comments of
// the originals travel along (unlike the form-level duplicate, which predates
// those helpers and round-trips through parse/stringify).
function ctxDuplicateFile() {
  const source = ctxMenu.value.target.source;
  closeContextMenu();
  if (busyOrTemplated.value) {
    toast.warning(t('designer.readOnly'));
    return;
  }
  // the base file is not a file on disk (see confirmDeleteFile) : there is
  // nothing to copy it to
  if (!source) return;
  const formIds = Object.keys(forms.value).filter((id) => formMeta.value[id]?.source === source);
  if (formIds.length === 0) return;
  const newSource = uniqueFileName(source);
  const taken = [];
  let failed = 0;
  let firstId = null;
  for (const srcId of formIds) {
    const doc = parseDocOrNull(forms.value[srcId]);
    if (!doc || !YAML.isMap(doc.contents)) {
      failed++;
      continue;
    }
    const baseName = doc.get('name');
    const copyName = uniqueFormName(typeof baseName === 'string' && baseName ? baseName : 'Form', taken);
    taken.push(copyName);
    doc.set('name', copyName);
    const newId = nextFormId();
    formMeta.value[newId] = { source: newSource };
    forms.value[newId] = doc.toString();
    if (!firstId) firstId = newId;
  }
  if (firstId) {
    collapsedPaths.value.delete(`file:${newSource}`);
    selectForm(firstId);
  }
  if (failed > 0) toast.warning(t('designer.badYamlDuplicate'));
  if (firstId) toast.success(t('designer.fileDuplicated', { file: newSource }));
}

function ctxMoveToFile() {
  moveFormId.value = ctxMenu.value.target.id;
  const currentSource = idmapping.value.find((x) => x.id === moveFormId.value)?.source;
  moveTarget.value = files.value.find((f) => f !== currentSource) || '';
  closeContextMenu();
  showMoveModal.value = true;
}

function ctxAddFormToFile() {
  const source = ctxMenu.value.target.source;
  closeContextMenu();
  addForm(source);
}

function ctxDownloadFile() {
  const source = ctxMenu.value.target.source;
  closeContextMenu();
  const formIds = Object.keys(forms.value).filter((id) => formMeta.value[id]?.source === source);
  const content = formIds.map((id) => forms.value[id]).join('\n---\n');
  if (!content) return;
  const blob = new Blob([content], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = source || 'forms.yaml';
  a.click();
  URL.revokeObjectURL(url);
}

const fileToDelete = ref(null);

function confirmDeleteFile(source) {
  // the base file is not a file on disk (the forms without a `source` live in
  // the main config) : there is nothing to delete, so don't open a modal whose
  // Delete button would do nothing
  if (!source) return;
  fileToDelete.value = source;
  action.value = 'deleteFile';
}

function doDeleteFile() {
  const source = fileToDelete.value;
  // never leave the modal open on a Delete that can't do anything
  if (!source) {
    action.value = null;
    return;
  }
  const formIds = Object.keys(forms.value).filter((id) => formMeta.value[id]?.source === source);
  if (formIds.length) {
    formIds.forEach((id) => {
      delete forms.value[id];
      delete formMeta.value[id];
    });
    selectDefaultForm();
  }
  fileToDelete.value = null;
  action.value = null;
}

function ctxDeleteFile() {
  const source = ctxMenu.value.target.source;
  closeContextMenu();
  confirmDeleteFile(source);
}

const showMoveFileModal = ref(false);
const moveFileSource = ref(null);
const moveFileTarget = ref('');

const moveFileFolderOptions = computed(() => {
  if (!moveFileSource.value) return [];
  const currentFolder = moveFileSource.value.includes('/')
    ? moveFileSource.value.substring(0, moveFileSource.value.lastIndexOf('/'))
    : '';
  const opts = [{ value: '', label: '/ (root)' }];
  for (const f of folders.value) {
    if (f !== currentFolder) opts.push({ value: f, label: f });
  }
  return opts;
});

function ctxMoveFileToFolder() {
  const source = ctxMenu.value.target.source;
  closeContextMenu();
  // the base file has no file to move (see confirmDeleteFile)
  if (!source) return;
  moveFileSource.value = source;
  const currentFolder = source.includes('/') ? source.substring(0, source.lastIndexOf('/')) : '';
  moveFileTarget.value = folders.value.find((f) => f !== currentFolder) || '';
  showMoveFileModal.value = true;
}

function doMoveFileToFolder() {
  const source = moveFileSource.value;
  if (source == null) return;
  const fileName = source.includes('/') ? source.substring(source.lastIndexOf('/') + 1) : source;
  const newSource = moveFileTarget.value ? `${moveFileTarget.value}/${fileName}` : fileName;
  if (newSource === source) {
    showMoveFileModal.value = false;
    return;
  }
  moveFormOrder(source, newSource);
  for (const id of Object.keys(forms.value)) {
    if (formMeta.value[id]?.source === source) {
      formMeta.value[id].source = newSource;
    }
  }
  showMoveFileModal.value = false;
  moveFileSource.value = null;
}

function openNewFileInFolder(folder) {
  newFileName.value = folder + '/';
  showNewFile.value = true;
}

function confirmDeleteFolder(folder) {
  const sources = files.value.filter((s) => s && s.startsWith(folder + '/'));
  if (!sources.length) return;
  fileToDelete.value = folder;
  action.value = 'deleteFolder';
}

function doDeleteFolder() {
  const folder = fileToDelete.value;
  if (!folder) return;
  const sources = files.value.filter((s) => s && s.startsWith(folder + '/'));
  for (const source of sources) {
    const formIds = Object.keys(forms.value).filter((id) => formMeta.value[id]?.source === source);
    formIds.forEach((id) => {
      delete forms.value[id];
      delete formMeta.value[id];
    });
  }
  selectDefaultForm();
  fileToDelete.value = null;
  action.value = null;
}

function ctxAddFileToFolder() {
  const folder = ctxMenu.value.target.path;
  closeContextMenu();
  openNewFileInFolder(folder);
}

function ctxDeleteFolder() {
  const folder = ctxMenu.value.target.path;
  closeContextMenu();
  confirmDeleteFolder(folder);
}

function ctxDeleteFormFromMenu() {
  const id = ctxMenu.value.target.id;
  closeContextMenu();
  deleteForm(id);
}

function doMoveToFile() {
  showMoveModal.value = false;
  if (!moveFormId.value || !forms.value[moveFormId.value]) return;
  if (!formMeta.value[moveFormId.value]) formMeta.value[moveFormId.value] = {};
  if (moveTarget.value) formMeta.value[moveFormId.value].source = moveTarget.value;
  else delete formMeta.value[moveFormId.value].source;
}

const moveFileOptions = computed(() => {
  if (!moveFormId.value) return [];
  const currentSource = idmapping.value.find((x) => x.id === moveFormId.value)?.source;
  return files.value.filter((f) => f !== currentSource).map((f) => ({ value: f, label: f || t('designer.baseFile') }));
});

function addForm(file) {
  // add a new form to the forms list
  // check if the form "New Form" already exists

  if (idmapping.value.find((x) => x.name == 'New Form')) {
    toast.error(t('designer.newFormExists'));
    return false;
  }

  let idx = Object.keys(forms.value).length;
  while (forms.value[`form_${idx}`]) idx++;
  const id = `form_${idx}`;
  formMeta.value[id] = { source: file };
  forms.value[id] = YAML.stringify({ ...formTemplate });
  currentForm.value = id;
  collapsedPaths.value.delete(`file:${file || '__base__'}`);
  return true;
}

function doDeleteForm() {
  // delete the form by id from forms list. Keyed on the id, not on the name : a
  // form whose yaml doesn't parse has no name of its own (currentFormName falls
  // back to the internal id) and deleting it is exactly what is wanted then.
  if (currentForm.value) {
    delete forms.value[currentForm.value];
    delete formMeta.value[currentForm.value];
    // select default form
    selectDefaultForm();
  }
  action.value = null;
}

function restore() {
  // start from no selection : a leftover pick from a previous open points at a
  // backup that a restore since then may have replaced
  backupToRestore.value = null;
  action.value = 'restore';
}

// Key-sorted JSON, so two documents can be compared for STRUCTURE regardless of the
// order their keys happen to be written in.
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value ?? null);
}

/**
 * Build the config document the save posts, KEEPING the comments the user typed.
 *
 * This used to be YAML.stringify() over the parsed objects, so every comment, blank line
 * and anchor in the editor was dropped by every save - including comments that were in
 * the file before the designer ever opened it. The visual editors (categories, roles,
 * constants) go out of their way to preserve them through the document API; the
 * designer's own save silently threw them away.
 *
 * The yaml library keeps comments on the nodes it parses, and a node can be re-hosted in
 * another document, so each section and each form is parsed as a DOCUMENT and its
 * contents node is placed into the outer one. `source` and `repository` are injected the
 * same way (doc.set on the parsed node), because the server routes each form to its file
 * by those and the editor buffers do not carry them.
 *
 * The result is then re-parsed and compared, key-sorted, against the object assembly this
 * replaced. Any difference at all - an unparsable buffer, an anchor that does not survive
 * re-hosting, anything unforeseen - falls back to that assembly. Losing comments is a
 * papercut; writing a structurally different config would be data loss, so the fallback
 * is what makes this safe to do at all.
 */
function assembleFormsPlain() {
  return YAML.stringify({
    categories: categoriesObj.value,
    roles: rolesObj.value,
    constants: constantsObj.value,
    forms: formsObj.value,
  });
}

function assembleForms() {
  const plain = assembleFormsPlain();
  try {
    const sources = [];
    for (const m of idmapping.value) if (!sources.includes(m.source)) sources.push(m.source);
    const orderedIds = sources.flatMap((s) => formIdsForSave(s));
    for (const id of Object.keys(forms.value)) if (!orderedIds.includes(id)) orderedIds.push(id);

    const out = new YAML.Document({});
    const section = (raw, fallback) => {
      const doc = YAML.parseDocument(raw ?? '');
      if (doc.errors.length || doc.contents == null) return out.createNode(fallback);
      return doc.contents;
    };
    out.set('categories', section(categories.value, categoriesObj.value));
    out.set('roles', section(roles.value, rolesObj.value));
    out.set('constants', section(constants.value, constantsObj.value));

    const seq = out.createNode([]);
    for (const id of orderedIds) {
      const doc = YAML.parseDocument(forms.value[id] ?? '');
      if (doc.errors.length || doc.contents == null) return plain; // an unparsable form: use the safe path
      const meta = formMeta.value[id];
      if (meta?.source) doc.set('source', meta.source);
      if (meta?.repository) doc.set('repository', meta.repository);
      seq.items.push(doc.contents);
    }
    out.set('forms', seq);

    const text = out.toString();
    // structural equality or nothing
    if (canonicalJson(YAML.parse(text)) !== canonicalJson(YAML.parse(plain))) return plain;
    return text;
  } catch {
    return plain;
  }
}

function resetAction() {
  action.value = null;
  nextAction.value = false; // clear any pending callback so a later flow can't fire a stale one
}

async function setLock(proceed = true) {
  if (!proceed) {
    resetAction();
    return;
  }
  try {
    loaded.value = false;
    lockLoading.value = true;
    await Lock.set(true);
    await loadLock();
    await loadForms();
    await loadBackups();
  } catch (err) {
    toast.error(err.message);
    lock.value = undefined;
    // `loaded` is only ever set back to true inside loadForms(), which is never reached
    // when Lock.set throws - and the panel renders a spinner while `lock && !lock.free &&
    // !loaded`. So losing a race for the lock (someone else took it between the 5s poll
    // and the click, answered 423) left an endless spinner that only a page reload
    // cleared. Restore it here: the buffers are still in memory and must stay reachable.
    loaded.value = true;
  } finally {
    lockLoading.value = false;
  }
}

async function restoreBackup() {
  // the button is disabled without a selection ; keep the guard anyway, there is
  // nothing to restore from and dereferencing it throws
  if (!backupToRestore.value?.file) {
    toast.warning(t('designer.selectBackupFirst'));
    return;
  }
  // Confirm first when there are unsaved edits, exactly as pullAndReload does.
  //
  // loadAll() replaces every buffer, so restoring a backup threw away whatever was in the
  // editor with no prompt at all - while the sibling operation that does the same thing
  // from a repository goes through withReloadConfirm. (withReloadConfirm is a function
  // declaration, so calling it from above its definition is fine.)
  withReloadConfirm(async () => {
    try {
      await Backup.restore(backupToRestore.value.file, backupBeforeRestore.value);
      toast.success(t('designer.backupRestored'));
      await loadAll();
      action.value = null;
    } catch (err) {
      toast.error(err.message);
    }
  });
}

/**
 * The lock switch is STATE driven, not DOM driven.
 *
 * It is bound with :checked (one way) and a @change handler, so the browser flips the box
 * itself and Vue only re-renders if `lock.match` actually changes. Cancel the unsaved
 * changes confirmation, or let the request fail, and the box stayed flipped while the lock
 * was untouched - the designer then read "Locked by me" with no lock, and the next save
 * answered 423 for no visible reason.
 *
 * Putting the DOM back immediately makes the real lock state the only thing that can move
 * the switch: the reload inside setLock/deleteLock re-renders it once the answer is known.
 */
function onLockToggle(event) {
  const held = !!lock.value?.match;
  if (event?.target) event.target.checked = held;
  if (held) releaseLock();
  else setLock();
}

async function releaseLock() {
  try {
    // if dirty, we need to ask for confirmation, it means you are releasing the designer with unsaved changes
    if (isDirty.value) {
      action.value = 'dirty';
      nextAction.value = async (proceed) => {
        resetAction();
        await deleteLock(proceed);
      };
      return;
    }
    // if not dirty, just release the lock
    await deleteLock();
  } catch (err) {
    toast.error(err.message);
    lock.value = undefined;
  }
}

async function deleteLock(proceed = true) {
  if (!proceed) {
    resetAction();
    return;
  }
  try {
    // release the lock and reload the data
    loaded.value = false;
    await Lock.release();
    await loadAll();
  } catch (err) {
    toast.error(err.message);
    lock.value = undefined;
    // same as setLock : a failed release must not leave the editor behind a spinner with
    // the in-memory buffers unreachable
    loaded.value = true;
  }
}

async function unLock() {
  action.value = 'forceUnlock';
  nextAction.value = async (proceed) => {
    resetAction();
    if (!proceed) return;
    // the server takes the lock only when it is free (another user's answers 423), so a
    // force unlock releases the other user's lock first, then takes it
    try {
      await Lock.release();
    } catch (err) {
      toast.error(err.message);
      return;
    }
    await setLock(proceed);
  };
}

// forms repositories (issue #414) : the forms live in git, the designer
// saves into the working trees and 'Push to repo' commits & pushes them
const formsRepos = ref([]);
const configRepo = ref(''); // the repository that holds config.yaml
const stagedForms = ref(false); // new forms saved but not yet pushed to a repo
const configInDatabase = ref(false); // true when forms_yaml is stored in and served from the database

const isConfigTab = computed(() => ['Categories', 'Roles', 'Constants'].includes(currentTab.value));
// whether an editor is currently mounted and targeting real content : config
// tabs always mount one once loaded ; the Forms tab only when a form is
// selected. Gates the editor toolbar actions (undo/cut/format/diff/...), which
// would otherwise act on a stale, hidden editor instance (activeEditor is set
// by the last @init and survives unmounts).
const editorTarget = computed(() => {
  if (!loaded.value) return false;
  if (isConfigTab.value) return true;
  return currentTab.value === 'Forms' && !!currentForm.value && forms.value[currentForm.value] !== undefined;
});
const dbOnlyMode = computed(() => configInDatabase.value && formsRepos.value.length === 0);
// repo mode with the base config in the database : a restore only affects the
// config (categories/roles/constants), the forms stay in git
const repoConfigMode = computed(() => configInDatabase.value && formsRepos.value.length > 0);
// the restore action is available whenever there is something to snapshot :
// local mode (no repos) or the base config lives in the database
const canRestore = computed(() => formsRepos.value.length === 0 || configInDatabase.value);
const syncing = ref(false);
const loadingRepos = ref(false);
const showPushModal = ref(false);
const pushRepo = ref(''); // "" means all repositories
const showLoadModal = ref(false);
const loadRepo = ref('');

// unpushed work : a repository with uncommitted/unpushed changes, or new forms
// still staged. Drives the "you have unpushed changes" indicator on Save (repository).
const hasUnpushed = computed(() => stagedForms.value || formsRepos.value.some((r) => r.dirty));
// a push or load is in flight : gate other actions that would race it
const busy = computed(() => syncing.value || loadingRepos.value);
// gate for everything that WRITES : the same in-flight guard, plus the ytt
// template case where the designer only holds an expansion of the real config
const busyOrTemplated = computed(() => busy.value || configTemplated.value);

async function loadFormsRepos() {
  try {
    const result = await axios.get(`/api/v2/forms-repos`, TokenStorage.getAuthentication());
    formsRepos.value = result.data?.repositories || [];
    configRepo.value = result.data?.configRepo || '';
    stagedForms.value = !!result.data?.staged;
  } catch (err) {
    // a transient failure must not wipe the repo list (it would hide the push
    // button and the unpushed indicator for work that is still unpushed)
  }
}

async function loadConfigMode() {
  try {
    const result = await axios.get('/api/v2/config/mode', TokenStorage.getAuthentication());
    configInDatabase.value = !!result.data?.configInDatabase;
  } catch (err) {
    // non-critical; default to false
  }
}

// Is the STORED config a ytt template ? It cannot be answered from the designer
// buffers : those come from Form.load, which runs the config through ytt when
// USE_YTT is on, so what the designer holds is the EXPANSION and the directives
// are already gone. Even with ytt off the directives are yaml comments, which
// the parse+stringify roundtrip of loadForms drops just the same. Only the raw
// text still has them, and /api/v2/settings/config is the one endpoint that
// returns it (the database copy or the file on disk, un-expanded). A hit puts
// the designer in read-only : a save would write the expansion over the
// template and destroy it, exactly what the settings pages refuse to do.
async function loadConfigTemplated() {
  try {
    // /config/templated, not /settings/config : the settings endpoint needs settings
    // access, so a designer without it got a 403 here, the catch answered "not
    // templated", and their next save wrote the ytt EXPANSION over the template and
    // destroyed it. This one is designer-accessible and returns only the boolean.
    const result = await axios.get('/api/v2/config/templated', TokenStorage.getAuthentication());
    configTemplated.value = !!result.data?.templated;
    if (configTemplated.value) toast.warning(t('settings.settingsPage.configTemplated'));
  } catch (err) {
    // fail CLOSED. Unanswered means unknown, and the cost of guessing wrong is an
    // unrecoverable overwrite of a templated config ; read-only is recoverable by a
    // reload. The designer without settings rights is no longer the reason we get here.
    configTemplated.value = true;
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

// the default push target : the config-origin repository (config.yaml lives
// there), falling back to the first forms repository
function defaultRepo() {
  return configRepo.value || formsRepos.value[0]?.name || '';
}

// re-read the forms from disk (working trees + staging) into the designer,
// discarding any in-memory edits
async function reloadFromDisk() {
  forms.value = {};
  categories.value = '';
  roles.value = '';
  constants.value = '';
  currentForm.value = null;
  await loadForms(); // sets a fresh baseline => isDirty false
}

// reload helper that warns when there are unsaved edits (they would be lost)
function withReloadConfirm(run) {
  if (isDirty.value) {
    action.value = 'confirmReload';
    nextAction.value = async (proceed) => {
      resetAction();
      if (proceed) await run();
    };
  } else {
    run();
  }
}

// the load dropdown options : one entry per forms repository
const loadRepoOptions = computed(() => formsRepos.value.map((r) => ({ value: r.name, label: r.name })));

// Load (repository) : with several repos open a chooser (pick one, or load
// from all) ; with a single repo pull it directly
function loadRepository() {
  if (formsRepos.value.length > 1) {
    // default to the config-origin repo, consistent with Save (repository)
    loadRepo.value = defaultRepo();
    showLoadModal.value = true;
  } else {
    pullAndReload();
  }
}

// pull the given forms repository (or all when name is omitted) from its
// remote, then reload the designer
function pullAndReload(name) {
  showLoadModal.value = false;
  withReloadConfirm(async () => {
    loadingRepos.value = true;
    try {
      const url = name ? `/api/v2/forms-repos/pull/${encodeURIComponent(name)}` : `/api/v2/forms-repos/pull`;
      await axios.post(url, {}, TokenStorage.getAuthentication());
      stagedForms.value = false;
      await reloadFromDisk();
      toast.success(t('designer.loadDone'));
    } catch (err) {
      const error = err.response?.data?.error || err.message;
      const details = err.response?.data?.details;
      toast.error(details ? `${error}: ${details}` : error);
    } finally {
      loadingRepos.value = false;
      await loadFormsRepos(); // refresh the unpushed indicator
      await loadLock(); // the lock poll was suppressed while busy : re-verify now
    }
  });
}

// the dropdown options : one entry per forms repository
const pushRepoOptions = computed(() => formsRepos.value.map((r) => ({ value: r.name, label: r.name })));

function pushToRepo() {
  if (isDirty.value) {
    toast.warning(t('designer.syncSaveFirst'));
    return;
  }
  if (formsRepos.value.length > 1) {
    // several forms repositories : choose one (default to the config-origin repo)
    pushRepo.value = defaultRepo();
    showPushModal.value = true;
  } else {
    syncRepos();
  }
}

async function syncRepos(name) {
  showPushModal.value = false;
  syncing.value = true;
  try {
    const url = name ? `/api/v2/forms-repos/sync/${encodeURIComponent(name)}` : `/api/v2/forms-repos/sync`;
    await axios.post(url, {}, TokenStorage.getAuthentication());
    toast.success(t('designer.syncDone'));
  } catch (err) {
    const error = err.response?.data?.error || err.message;
    const details = err.response?.data?.details;
    toast.error(details ? `${error}: ${details}` : error);
  } finally {
    syncing.value = false;
    await loadFormsRepos(); // refresh the unpushed indicator
    await loadLock(); // the lock poll was suppressed while busy : re-verify now
  }
}

// create a new forms file : a file only exists through a form pointing at it,
// so this adds a new form with the given filename as its source. In repository
// mode the new file is staged and assigned to a repository later, on push.
const showNewFile = ref(false);
const newFileName = ref('');

function openNewFile() {
  newFileName.value = '';
  showNewFile.value = true;
}

function openNewFolder() {
  newFileName.value = 'new-folder/forms.yaml';
  showNewFile.value = true;
}

function addFile() {
  const name = (newFileName.value || '').trim();
  if (!/^[A-Za-z0-9._/-]+\.(yaml|yml)$/.test(name)) {
    toast.error(t('designer.newFileInvalid'));
    return;
  }
  if (files.value.includes(name)) {
    toast.error(t('designer.newFileExists'));
    return;
  }
  if (!addForm(name)) return; // addForm refused (eg "New Form" already exists)
  if (name.includes('/')) {
    const parts = name.split('/');
    let path = '';
    for (let i = 0; i < parts.length - 1; i++) {
      path = path ? `${path}/${parts[i]}` : parts[i];
      collapsedPaths.value.delete(`folder:${path}`);
    }
  }
  showNewFile.value = false;
  newFileName.value = '';
}

async function validateForms() {
  try {
    const formConfig = assembleForms();
    await Form.validate(formConfig);
    toast.success(t('designer.formsValid'));
  } catch (err) {
    toast.error(err.message);
  }
}

async function saveForms(close = false) {
  if (busy.value) return; // a push/load is in flight : ignore (e.g. Ctrl+S)
  // the buffers are the ytt EXPANSION of the stored template : saving them would
  // replace the template with its output (see loadConfigTemplated)
  if (configTemplated.value) {
    toast.warning(t('settings.settingsPage.configTemplated'));
    if (close) resetAction();
    return;
  }
  if (!lock.value?.match) {
    toast.error(t('designer.readOnly'));
    // close the dirty modal like the two sibling early-returns do : without this its
    // "Save and close" button was dead - a toast appeared and the modal just sat there,
    // which is what you get when someone force-unlocks while you are editing
    if (close) resetAction();
    return;
  }
  // if there are warnings, show them and do not save
  if (warnings.value.length > 0) {
    showWarnings.value = true;
    toast.warning(t('designer.fixWarnings'));
    // 'Save and close' cannot go through : close the dirty modal instead of
    // leaving it stranded behind the warnings panel with a callback that can
    // never fire. The user stays in the designer, with the warnings in view.
    if (close) resetAction();
    return;
  }
  if (!isDirty.value) {
    toast.info(t('designer.noChanges'));
    return;
  }
  try {
    const formConfig = assembleForms();
    // Capture the baseline BEFORE awaiting, from the same buffers that were just
    // assembled into formConfig. It used to be taken after the save resolved, reading the
    // LIVE refs - so anything typed while the request was in flight (a repo-backed save
    // commits and pushes, easily over a second, and nothing makes the editor read-only)
    // became the clean baseline. isDirty went false, Save greyed out, the unsaved marker
    // cleared and the navigation guard stopped warning, for an edit that was never sent.
    const baseline = captureBaseline();

    // save the forms with axios async
    await Form.save(formConfig);

    applyBaseline(baseline); // the content that was actually POSTED is the new baseline
    toast.success(t('designer.formsSaved'));
    // the save took a server-side snapshot (Form.save backs up whenever there is
    // something to snapshot, the same condition canRestore describes) : refresh
    // the list, otherwise the backup you most want to undo to is missing from
    // Restore until the page is reloaded
    if (canRestore.value) await loadBackups();
    if (formsRepos.value.length > 0) await loadFormsRepos(); // saved to a working tree => now unpushed
    if (close && typeof nextAction.value === 'function') {
      const cb = nextAction.value;
      nextAction.value = false;
      try {
        cb(true);
      } catch (err) {
        toast.error(err.message);
      }
    }
  } catch (err) {
    toast.error(err.message);
  }
}

/** The order the user dragged a file's forms into, or null when they never did. */
function explicitOrder(file) {
  return formOrderMap.value[file ?? '__base__'] || null;
}

function byExplicitOrder(order) {
  return (a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
  };
}

/**
 * The order a file's forms are WRITTEN in.
 *
 * This used to be formnames(), the DISPLAY order, whose fallback is alphabetical - so
 * opening the designer and saving without touching anything rewrote every forms file
 * with its forms alphabetised. On a repository-backed config that is a whole-file diff
 * on every save, burying the real change and churning git history.
 *
 * Document order is idmapping's own order : forms.value is keyed form_0, form_1, ... in
 * the order the loader returned them. Only an explicit drag overrides it.
 */
function formIdsForSave(file) {
  const items = idmapping.value.filter((x) => x.source === file);
  const order = explicitOrder(file);
  if (!order) return items.map((x) => x.id);
  return [...items].sort(byExplicitOrder(order)).map((x) => x.id);
}

function formnames(file) {
  // copy before sorting : the array from filter() is fresh, but returning a sorted copy
  // keeps this safe if that ever changes
  const items = [...idmapping.value.filter((x) => x.source === file)];
  const order = explicitOrder(file);
  if (order) {
    return items.sort(byExplicitOrder(order));
  }
  return items.sort((a, b) => ((a.name || '').toLowerCase() > (b.name || '').toLowerCase() && 1) || -1);
}

async function loadAll() {
  await loadLock();
  await loadForms();
  await loadBackups();
}

// Unsaved work : the designer keeps everything in memory until Save, so leaving
// the page throws it away. Two guards, because they cover different exits.
// 1. reload / tab close / external link : only the browser's own prompt can stop
//    that, and it needs preventDefault (returnValue for the older engines).
function onBeforeUnload(e) {
  if (!isDirty.value) return;
  e.preventDefault();
  e.returnValue = '';
}
// 2. in-app navigation (navbar, sidebar, browser back) : reuse the dirty modal,
//    so the user gets the same Save-and-close / Close-without-saving choice as
//    when releasing the lock. The navigation is replayed once confirmed.
const leaveConfirmed = ref(false);
const pendingRoute = ref(null);

onBeforeRouteLeave((to) => {
  if (!isDirty.value || leaveConfirmed.value) return true;
  pendingRoute.value = to.fullPath;
  action.value = 'dirty';
  nextAction.value = async (proceed) => {
    resetAction();
    if (!proceed) return;
    // skip this guard on the replay, otherwise it would ask again forever
    leaveConfirmed.value = true;
    router.push(pendingRoute.value);
  };
  return false;
});

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) {
    return;
  }
  await loadAll();
  await Promise.all([loadFormsRepos(), loadConfigMode(), loadConfigTemplated(), loadLocalGroups(), loadLocalUsers()]);
  // The awaits above mean onBeforeUnmount can already have run - leaving the designer
  // before those requests finish is easy, and the route guard allows it because
  // dirtyBaseline is still null. It cleared a lockInterval that did not exist yet, and
  // then this line installed one on a destroyed component: it polled every 5s for the
  // rest of the SPA session, accumulated one per visit, popped its error toasts on
  // unrelated pages, and pinned the component and its buffers in memory.
  if (unmounted.value) return;
  lockInterval.value = setInterval(async () => {
    // skip the poll while a push/load is in flight : a lock refresh that races
    // a sync can pull the rug out from under the in-flight operation
    if (busy.value) return;
    await loadLock();
  }, 5000);
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload);
  unmounted.value = true;
  if (lockInterval.value) clearInterval(lockInterval.value);
  themeObserver.disconnect();
});
</script>
<template>
  <AppNav />
  <div class="af-fill-page designer-page">
    <main class="d-flex flex-nowrap af-settings-layout af-with-sidebar">
      <!-- the designer's views (categories, roles, constants, forms) : a left menu like
           the settings pages, listed once the designer is started -->
      <BsSidebar :sections="sidebarSections" storageKey="af_designer_sidebar_collapsed" />
      <!-- Modal - delete verify -->
      <BsModal v-if="action == 'delete'" @close="resetAction()">
        <template #title> {{ t('designer.deleteForm') }} {{ currentFormName }} </template>
        <template #default>
          <p class="mt-3 fs-6 user-select-none">
            {{ t('designer.deleteConfirm') }} <strong>{{ currentFormName }}</strong
            >?
          </p>
        </template>
        <template #footer>
          <BsButton icon="trash" @click="doDeleteForm()">{{ t('common.delete') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - delete file verify -->
      <BsModal
        v-if="action == 'deleteFile'"
        @close="
          resetAction();
          fileToDelete = null;
        "
      >
        <template #title> {{ t('designer.deleteFile') }} </template>
        <template #default>
          <p class="mt-3 fs-6 user-select-none">
            {{ t('designer.deleteFileConfirm') }} <strong>{{ fileToDelete }}</strong
            >?
          </p>
        </template>
        <template #footer>
          <BsButton icon="trash" @click="doDeleteFile()">{{ t('common.delete') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - delete folder verify -->
      <BsModal
        v-if="action == 'deleteFolder'"
        @close="
          resetAction();
          fileToDelete = null;
        "
      >
        <template #title> {{ t('designer.deleteFolder') }} </template>
        <template #default>
          <p class="mt-3 fs-6 user-select-none">
            {{ t('designer.deleteFolderConfirm') }} <strong>{{ fileToDelete }}</strong
            >?
          </p>
        </template>
        <template #footer>
          <BsButton icon="trash" @click="doDeleteFolder()">{{ t('common.delete') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - new file -->
      <BsModal v-if="showNewFile" @close="showNewFile = false">
        <template #title> {{ t('designer.newFileTitle') }} </template>
        <template #default>
          <BsInput
            :isFloating="false"
            v-model="newFileName"
            :label="t('designer.newFileLabel')"
            placeholder="my-forms.yaml"
            icon="file"
            :help="t('designer.newFileHelp')"
            @keyup_enter="addFile()"
          />
        </template>
        <template #footer>
          <BsButton icon="plus" @click="addFile()">{{ t('common.create') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - import a yaml file -->
      <BsModal v-if="showImportModal" @close="showImportModal = false" size="lg">
        <template #title> {{ t('designer.importTitle') }} </template>
        <template #default>
          <p class="text-muted small mb-3">{{ t('designer.importHelp') }}</p>
          <BsInput
            :isFloating="false"
            type="select"
            icon="file"
            v-model="importTarget"
            :values="importFileOptions"
            name="importTarget"
            :label="t('designer.targetFile')"
            class="mb-3"
          />
          <div class="d-flex flex-column gap-2">
            <div v-for="(entry, i) in importCandidates" :key="'imp-' + i" class="form-check">
              <input class="form-check-input" type="checkbox" v-model="entry.include" :id="'imp-chk-' + i" />
              <label class="form-check-label d-flex align-items-center gap-2" :for="'imp-chk-' + i" role="button">
                <span>{{ entry.finalName }}</span>
                <!-- a name that is taken is imported under a new one, the form
                     that holds it is never touched -->
                <span v-if="entry.finalName !== entry.name" class="badge bg-warning-subtle text-warning-emphasis">{{
                  t('designer.importRenamedBadge', { name: entry.name })
                }}</span>
              </label>
            </div>
          </div>
          <p v-if="importSkipped > 0" class="text-muted small mt-3 mb-0">
            {{ t('designer.importSkipped', importSkipped) }}
          </p>
        </template>
        <template #footer>
          <BsButton icon="file-import" @click="doImport()">{{ t('designer.import') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - choose repository to push -->
      <BsModal v-if="showPushModal" @close="showPushModal = false">
        <template #title> {{ t('designer.pushChooseTitle') }} </template>
        <template #default>
          <BsInput
            :isFloating="false"
            type="select"
            icon="code-branch"
            v-model="pushRepo"
            :values="pushRepoOptions"
            name="pushRepo"
            :label="t('designer.pushRepoLabel')"
          />
        </template>
        <template #footer>
          <!-- symmetric with the load modal : syncRepos() without a name pushes
               every repository in one call -->
          <BsButton icon="code-branch" @click="syncRepos(pushRepo)">{{ t('designer.commitSync') }}</BsButton>
          <BsButton icon="code-branch" @click="syncRepos()">{{ t('designer.pushAll') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - choose repository to load -->
      <BsModal v-if="showLoadModal" @close="showLoadModal = false">
        <template #title> {{ t('designer.loadChooseTitle') }} </template>
        <template #default>
          <BsInput
            :isFloating="false"
            type="select"
            icon="code-branch"
            v-model="loadRepo"
            :values="loadRepoOptions"
            name="loadRepo"
            :label="t('designer.pushRepoLabel')"
          />
        </template>
        <template #footer>
          <BsButton icon="cloud-arrow-down" @click="pullAndReload(loadRepo)">{{ t('designer.loadFromRepo') }}</BsButton>
          <BsButton icon="cloud-arrow-down" @click="pullAndReload()">{{ t('designer.loadAll') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - force unlock-->
      <BsModal v-if="action == 'forceUnlock'" @close="resetAction()">
        <template #title> {{ t('designer.forceUnlock') }} </template>
        <template #default>
          <p class="mt-3 fs-6 user-select-none">
            {{ t('designer.forceUnlockConfirm') }}<br />
            {{ t('designer.forceUnlockWarning') }}<br /><br />
            {{ t('designer.forceUnlockCare') }}
          </p>
        </template>
        <template #footer>
          <BsButton icon="unlock" @click="nextAction(true)">{{ t('designer.forceUnlock') }}</BsButton>
        </template>
      </BsModal>

      <!-- modal - dirty -->
      <BsModal v-if="action == 'dirty'" @close="resetAction()">
        <template #title> {{ t('designer.unsavedChanges') }} </template>
        <template #default>
          <p class="mt-3 fs-6 user-select-none">
            {{ t('designer.unsavedConfirm') }}<br />{{ t('designer.unsavedNote') }}
          </p>
        </template>
        <template #footer>
          <!-- 'proceed' means "go ahead and discard" for both flows this modal
               serves : release the lock and reload, or leave the page. Passing
               false here made the button a no-op that only closed the dialog,
               which since the route guard exists means unsaved changes trapped
               you on the page - the modal's own @close is the cancel path. -->
          <BsButton icon="times" @click="nextAction(true)">{{ t('designer.closeWithoutSaving') }}</BsButton>
          <BsButton icon="save" @click="saveForms(true)">{{ t('designer.saveAndClose') }}</BsButton>
        </template>
      </BsModal>

      <!-- modal - confirm reload (discards unsaved changes) -->
      <BsModal v-if="action == 'confirmReload'" @close="nextAction(false)">
        <template #title> {{ t('designer.reloadTitle') }} </template>
        <template #default>
          <p class="mt-3 fs-6 user-select-none">{{ t('designer.reloadConfirm') }}</p>
        </template>
        <template #footer>
          <BsButton icon="times" @click="nextAction(false)">{{ t('common.cancel') }}</BsButton>
          <BsButton icon="download" @click="nextAction(true)">{{ t('designer.reloadDiscard') }}</BsButton>
        </template>
      </BsModal>

      <BsModal v-if="action == 'restore'" @close="resetAction()">
        <template #title> {{ t('designer.restoreBackup') }} </template>
        <template #default>
          <div v-if="repoConfigMode" class="text-muted mb-2">{{ t('designer.restoreConfigOnly') }}</div>
          <div v-if="backups.length === 0" class="text-muted">{{ t('designer.noBackups') }}</div>
          <template v-else>
            <BsInput
              type="select_advanced"
              v-model="backupToRestore"
              :values="backups"
              :required="true"
              name="backup"
              :label="t('designer.backup')"
              :sticky="true"
              :hasError="!backupToRestore"
            />
            <BsInput type="checkbox" v-model="backupBeforeRestore" :label="t('designer.backupBeforeRestore')" />
          </template>
        </template>
        <template #footer>
          <!-- nothing picked : restoring would dereference a null backup -->
          <BsButton
            icon="undo"
            :disabled="!backupToRestore"
            @click="
              restoreBackup();
              resetAction();
            "
            >{{ t('designer.restore') }}</BsButton
          >
        </template>
      </BsModal>

      <!-- Modal - rename file -->
      <BsModal v-if="showRenameModal" @close="showRenameModal = false">
        <template #title> {{ t('designer.renameFile') }} </template>
        <template #default>
          <BsInput
            :isFloating="false"
            v-model="renameValue"
            :label="t('designer.newFileLabel')"
            icon="file"
            @keyup_enter="doRenameFile()"
          />
        </template>
        <template #footer>
          <BsButton icon="check" @click="doRenameFile()">{{ t('designer.rename') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - move form to file -->
      <BsModal v-if="showMoveModal" @close="showMoveModal = false">
        <template #title> {{ t('designer.moveToFile') }} </template>
        <template #default>
          <BsInput
            :isFloating="false"
            type="select"
            icon="file"
            v-model="moveTarget"
            :values="moveFileOptions"
            :label="t('designer.targetFile')"
          />
        </template>
        <template #footer>
          <BsButton icon="check" @click="doMoveToFile()">{{ t('designer.move') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - move file to folder -->
      <BsModal v-if="showMoveFileModal" @close="showMoveFileModal = false">
        <template #title> {{ t('designer.moveFileToFolder') }} </template>
        <template #default>
          <p class="fs-6 user-select-none mb-3">{{ moveFileSource }}</p>
          <BsInput
            :isFloating="false"
            type="select"
            icon="folder"
            v-model="moveFileTarget"
            :values="moveFileFolderOptions"
            :label="t('designer.targetFolder')"
          />
        </template>
        <template #footer>
          <BsButton icon="check" @click="doMoveFileToFolder()">{{ t('designer.move') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - diff -->
      <BsModal v-if="showDiffModal" @close="showDiffModal = false">
        <template #title> {{ t('designer.diff') }} </template>
        <template #default>
          <div class="diff-view">
            <div v-for="(line, i) in diffLines" :key="'diff-' + i" class="diff-line" :class="'diff-' + line.type">
              <span class="diff-marker">{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}</span>
              <span>{{ line.text }}</span>
            </div>
            <div v-if="diffLines.length === 0" class="text-muted p-3">{{ t('designer.noChanges') }}</div>
          </div>
        </template>
      </BsModal>

      <!-- Modal - icon picker -->
      <BsModal v-if="showIconPicker" @close="showIconPicker = false">
        <template #title> {{ t('designer.chooseIcon') }} </template>
        <template #default>
          <!-- Preview -->
          <div class="icon-section-header mb-2">
            <span class="fw-semibold">{{ t('designer.preview') }}</span>
          </div>
          <div
            class="d-flex align-items-center justify-content-center py-3 mb-3 rounded"
            style="background: var(--bs-tertiary-bg)"
          >
            <FaIcon
              v-if="iconForm.icon"
              :icon="iconForm.icon"
              :size="iconForm.iconSize || '3x'"
              :color="iconForm.iconColor || undefined"
              :overlayIcon="iconForm.overlayIcon || undefined"
              :overlayIconColor="iconForm.overlayIconColor"
              :overlayIconCircle="iconForm.overlayIconCircle"
              :overlayIconText="iconForm.overlayIconText || undefined"
              :overlayIconTextPosition="iconForm.overlayIconTextPosition"
              :overlayIconTextColor="iconForm.overlayIconTextColor"
            />
            <span v-else class="text-muted">{{ t('designer.noIconSelected') }}</span>
          </div>

          <!-- Icons section -->
          <div class="icon-section-header mb-2" role="button" @click="iconSections.icons = !iconSections.icons">
            <FaIcon :icon="iconSections.icons ? 'chevron-down' : 'chevron-right'" class="me-2 tree-chevron" size="xs" />
            <span class="fw-semibold">{{ t('designer.chooseIcon') }}</span>
          </div>
          <div v-if="iconSections.icons" class="mb-2">
            <BsInput
              :isFloating="false"
              v-model="iconSearch"
              :label="t('designer.searchIcons')"
              icon="magnifying-glass"
              placeholder="search..."
            />
            <div class="icon-grid mt-2">
              <div
                v-for="ic in filteredIcons"
                :key="'icon-' + ic"
                class="icon-cell"
                :class="{ 'icon-selected': iconForm.icon === ic }"
                role="button"
                :title="ic"
                @click="pickIcon(ic)"
              >
                <FaIcon :icon="ic" size="xl" />
                <small class="icon-label">{{ ic }}</small>
              </div>
            </div>
            <div v-if="filteredIcons.length === 0" class="text-muted text-center py-3">
              {{ t('designer.noIconsFound') }}
            </div>
          </div>

          <!-- Color & Size section -->
          <div class="icon-section-header mb-2" role="button" @click="iconSections.style = !iconSections.style">
            <FaIcon :icon="iconSections.style ? 'chevron-down' : 'chevron-right'" class="me-2 tree-chevron" size="xs" />
            <span class="fw-semibold">{{ t('designer.colorAndSize') }}</span>
          </div>
          <div v-if="iconSections.style" class="mb-2">
            <div class="row g-2">
              <div class="col-6">
                <BsInput
                  :isFloating="false"
                  type="select"
                  v-model="iconForm.iconColor"
                  :values="iconColorOptions"
                  :label="t('designer.iconColor')"
                  icon="droplet"
                />
              </div>
              <div class="col-6">
                <BsInput
                  :isFloating="false"
                  type="select"
                  v-model="iconForm.iconSize"
                  :values="iconSizeOptions"
                  :label="t('designer.iconSize')"
                  icon="up-right-and-down-left-from-center"
                />
              </div>
            </div>
          </div>

          <!-- Overlay section -->
          <div class="icon-section-header mb-2" role="button" @click="iconSections.overlay = !iconSections.overlay">
            <FaIcon
              :icon="iconSections.overlay ? 'chevron-down' : 'chevron-right'"
              class="me-2 tree-chevron"
              size="xs"
            />
            <span class="fw-semibold">{{ t('designer.overlaySettings') }}</span>
          </div>
          <div v-if="iconSections.overlay" class="mb-2">
            <div class="row g-2">
              <div class="col-6">
                <BsInput
                  :isFloating="false"
                  v-model="iconForm.overlayIcon"
                  :label="t('designer.overlayIcon')"
                  icon="layer-group"
                  placeholder="e.g. check, bolt"
                />
              </div>
              <div class="col-6">
                <BsInput
                  :isFloating="false"
                  type="select"
                  v-model="iconForm.overlayIconColor"
                  :values="iconColorOptions.filter((o) => o.value)"
                  :label="t('designer.overlayColor')"
                  icon="droplet"
                />
              </div>
            </div>
            <div class="py-1 mb-2">
              <BsInput
                :isFloating="false"
                :isInline="true"
                type="checkbox"
                v-model="iconForm.overlayIconCircle"
                :isSwitch="true"
                :label="t('designer.overlayCircle')"
              />
            </div>
            <div class="row g-2">
              <div class="col-4">
                <BsInput
                  :isFloating="false"
                  v-model="iconForm.overlayIconText"
                  :label="t('designer.overlayText')"
                  icon="font"
                  placeholder="e.g. NEW"
                />
              </div>
              <div class="col-4">
                <BsInput
                  :isFloating="false"
                  type="select"
                  v-model="iconForm.overlayIconTextPosition"
                  :values="overlayPositionOptions"
                  :label="t('designer.overlayPosition')"
                  icon="arrows-up-down-left-right"
                />
              </div>
              <div class="col-4">
                <BsInput
                  :isFloating="false"
                  type="select"
                  v-model="iconForm.overlayIconTextColor"
                  :values="iconColorOptions.filter((o) => o.value)"
                  :label="t('designer.overlayTextColor')"
                  icon="droplet"
                />
              </div>
            </div>
          </div>
        </template>
        <template #footer>
          <BsButton icon="check" @click="applyIconForm()">{{ t('common.apply') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - add category -->
      <BsModal v-if="showAddCategory" @close="showAddCategory = false">
        <template #title> {{ t('designer.addCategory') }} </template>
        <template #default>
          <BsInput
            :isFloating="false"
            v-model="newCatName"
            :label="t('designer.categoryName')"
            icon="tag"
            :placeholder="t('designer.categoryNamePlaceholder')"
            class="mb-3"
          />
          <BsInput
            v-if="parentCatOptions.length > 1"
            :isFloating="false"
            type="select"
            icon="sitemap"
            v-model="newCatParent"
            :values="parentCatOptions"
            valueKey="value"
            labelKey="label"
            :label="t('designer.parentCategory')"
            class="mb-3"
          />
          <div class="fw-semibold mb-2">{{ t('designer.chooseIcon') }}</div>
          <div class="d-flex align-items-center gap-2 mb-3 p-2 rounded" style="background: var(--bs-tertiary-bg)">
            <FaIcon :icon="newCatIcon" size="2x" />
            <span class="text-muted">{{ newCatIcon }}</span>
          </div>
          <BsInput
            :isFloating="false"
            v-model="catIconSearch"
            :label="t('designer.searchIcons')"
            icon="magnifying-glass"
            placeholder="search..."
            class="mb-2"
          />
          <div class="icon-grid">
            <div
              v-for="ic in filteredCatIcons"
              :key="'caticon-' + ic"
              class="icon-cell"
              :class="{ 'icon-selected': newCatIcon === ic }"
              role="button"
              :title="ic"
              @click="newCatIcon = ic"
            >
              <FaIcon :icon="ic" size="xl" />
              <small class="icon-label">{{ ic }}</small>
            </div>
          </div>
          <div v-if="filteredCatIcons.length === 0" class="text-muted text-center py-3">
            {{ t('designer.noIconsFound') }}
          </div>
        </template>
        <template #footer>
          <BsButton icon="plus" @click="doAddCategory()">{{ t('designer.addCategory') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - edit categories -->
      <BsModal v-if="showEditCategories" @close="showEditCategories = false">
        <template #title> {{ t('designer.editCategories') }} </template>
        <template #default>
          <div v-if="editCats.length === 0" class="text-muted text-center py-3">{{ t('designer.noCategories') }}</div>
          <!-- a form references a category by its PATH, so a move or a rename leaves
               those forms pointing at something that is no longer there -->
          <div v-if="editCatMovedPaths.length > 0" class="alert alert-warning py-2" role="alert">
            {{ t('settings.settingsPage.categoryPathsChanged', { paths: editCatMovedPaths.join(', ') }) }}
          </div>
          <div
            v-for="(row, idx) in flatEditCats"
            :key="'editcat-' + idx"
            class="d-flex align-items-end gap-2 mb-2"
            :style="{ paddingLeft: row.depth * 1 + 'rem' }"
          >
            <FaIcon
              v-if="row.depth > 0"
              icon="level-up-alt"
              class="text-muted fa-rotate-90 flex-shrink-0"
              style="font-size: 0.75rem; margin-bottom: 0.75rem"
            />
            <div class="flex-shrink-0">
              <label v-if="idx === 0" class="form-label fw-bold">{{ t('designer.categoryIcon') }}</label>
              <div class="d-flex align-items-center gap-3">
                <span
                  :role="isDefaultEditCat(row.cat, row.depth) ? undefined : 'button'"
                  class="d-flex align-items-center justify-content-center rounded flex-shrink-0"
                  :class="{ 'border border-primary': editCatIconIdx === idx }"
                  style="width: 2.5rem; height: calc(2.25rem + 2px); background: var(--bs-tertiary-bg)"
                  :title="t('designer.chooseIcon')"
                  @click="editCatPickIcon(idx)"
                >
                  <FaIcon :icon="row.cat.icon" size="lg" />
                </span>
                <select
                  class="form-select"
                  style="width: 12rem"
                  v-model="row.cat.icon"
                  :disabled="isDefaultEditCat(row.cat, row.depth)"
                >
                  <option v-for="ic in availableIcons" :key="'selicon-' + idx + '-' + ic" :value="ic">{{ ic }}</option>
                </select>
              </div>
            </div>
            <div class="flex-grow-1">
              <label v-if="idx === 0" class="form-label fw-bold">{{ t('designer.categoryName') }}</label>
              <input
                type="text"
                class="form-control"
                v-model="row.cat.name"
                :disabled="isDefaultEditCat(row.cat, row.depth)"
              />
            </div>
            <!-- the schema pins the Default category : no rename, no restyle, no
                 delete and no subcategories (same rule as the settings page) -->
            <template v-if="!isDefaultEditCat(row.cat, row.depth)">
              <!-- reorganize : indent makes the row above the parent, outdent lifts it
                   back out. Greyed instead of hidden so the row does not reshuffle. -->
              <span
                :role="canMoveUp(editCats, row.cat) ? 'button' : undefined"
                class="d-flex align-items-center justify-content-center flex-shrink-0 rounded border"
                :class="canMoveUp(editCats, row.cat) ? 'border-secondary' : 'border-secondary-subtle opacity-50'"
                style="width: 2.5rem; height: calc(2.25rem + 2px)"
                @click="canMoveUp(editCats, row.cat) && editCatMove(moveCategoryUp, row.cat)"
                :title="t('designer.moveUp')"
              >
                <font-awesome-icon icon="chevron-up" style="color: var(--bs-secondary)" />
              </span>
              <span
                :role="canMoveDown(editCats, row.cat) ? 'button' : undefined"
                class="d-flex align-items-center justify-content-center flex-shrink-0 rounded border"
                :class="canMoveDown(editCats, row.cat) ? 'border-secondary' : 'border-secondary-subtle opacity-50'"
                style="width: 2.5rem; height: calc(2.25rem + 2px)"
                @click="canMoveDown(editCats, row.cat) && editCatMove(moveCategoryDown, row.cat)"
                :title="t('designer.moveDown')"
              >
                <font-awesome-icon icon="chevron-down" style="color: var(--bs-secondary)" />
              </span>
              <span
                :role="canIndent(editCats, row.cat) ? 'button' : undefined"
                class="d-flex align-items-center justify-content-center flex-shrink-0 rounded border"
                :class="canIndent(editCats, row.cat) ? 'border-secondary' : 'border-secondary-subtle opacity-50'"
                style="width: 2.5rem; height: calc(2.25rem + 2px)"
                @click="canIndent(editCats, row.cat) && editCatMove(indentCategory, row.cat)"
                :title="t('settings.settingsPage.indentCategory')"
              >
                <font-awesome-icon icon="indent" style="color: var(--bs-secondary)" />
              </span>
              <span
                :role="canOutdent(editCats, row.cat) ? 'button' : undefined"
                class="d-flex align-items-center justify-content-center flex-shrink-0 rounded border"
                :class="canOutdent(editCats, row.cat) ? 'border-secondary' : 'border-secondary-subtle opacity-50'"
                style="width: 2.5rem; height: calc(2.25rem + 2px)"
                @click="canOutdent(editCats, row.cat) && editCatMove(outdentCategory, row.cat)"
                :title="t('settings.settingsPage.outdentCategory')"
              >
                <font-awesome-icon icon="outdent" style="color: var(--bs-secondary)" />
              </span>
              <span
                role="button"
                class="d-flex align-items-center justify-content-center flex-shrink-0 rounded border border-secondary"
                style="width: 2.5rem; height: calc(2.25rem + 2px)"
                @click="editCatAddSub(row.cat)"
                :title="t('designer.addSubcategory')"
              >
                <font-awesome-icon icon="plus" style="color: var(--bs-secondary)" />
              </span>
              <span
                role="button"
                class="d-flex align-items-center justify-content-center flex-shrink-0 rounded border border-danger"
                style="width: 2.5rem; height: calc(2.25rem + 2px)"
                @click="editCatRemove(row.cat)"
                :title="t('common.delete')"
              >
                <font-awesome-icon icon="trash" style="color: var(--bs-danger)" />
              </span>
            </template>
            <span
              v-else
              class="badge bg-secondary-subtle text-muted d-flex align-items-center flex-shrink-0"
              style="height: calc(2.25rem + 2px)"
              >{{ t('settings.settingsPage.requiredItem') }}</span
            >
          </div>
          <div v-if="editCatIconIdx !== null" class="mt-2 p-3 rounded" style="background: var(--bs-tertiary-bg)">
            <div class="fw-semibold mb-2">
              {{ t('designer.chooseIcon') }}: {{ flatEditCats[editCatIconIdx]?.cat?.name || '' }}
            </div>
            <BsInput
              :isFloating="false"
              v-model="editCatIconSearch"
              :label="t('designer.searchIcons')"
              icon="magnifying-glass"
              placeholder="search..."
              class="mb-2"
            />
            <div class="icon-grid">
              <div
                v-for="ic in filteredEditCatIcons"
                :key="'ecicon-' + ic"
                class="icon-cell"
                :class="{ 'icon-selected': flatEditCats[editCatIconIdx]?.cat?.icon === ic }"
                role="button"
                :title="ic"
                @click="editCatSelectIcon(editCatIconIdx, ic)"
              >
                <FaIcon :icon="ic" size="xl" />
                <small class="icon-label">{{ ic }}</small>
              </div>
            </div>
            <div v-if="filteredEditCatIcons.length === 0" class="text-muted text-center py-3">
              {{ t('designer.noIconsFound') }}
            </div>
          </div>
        </template>
        <template #footer>
          <BsButton icon="check" @click="applyEditCategories()">{{ t('common.apply') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - add role -->
      <BsModal v-if="showAddRole" @close="showAddRole = false">
        <template #title> {{ t('designer.addRole') }} </template>
        <template #default>
          <BsInput :isFloating="false" v-model="newRole.name" :label="t('designer.roleName')" icon="tag" class="mb-3" />
          <label class="form-label fw-bold">{{ t('settings.settingsPage.groups') }}</label>
          <div
            v-for="(grp, gIdx) in newRole.groups"
            :key="'addgrp-' + gIdx"
            class="d-flex align-items-center gap-2 mb-2"
          >
            <select
              class="form-select provider-select"
              v-model="grp.provider"
              @change="onRoleProviderChange(grp, 'group')"
            >
              <option v-for="p in authProviders" :key="p" :value="p">{{ p }}</option>
            </select>
            <!-- only 'local' has a directory to pick from ; ldap/azuread/oidc
                 stay free text, and so does local when the list could not be
                 fetched (a designer without user administration rights) -->
            <select v-if="grp.provider === 'local' && sortedLocalGroups.length" class="form-select" v-model="grp.name">
              <option v-for="g in localGroupOptions(grp.name)" :key="'addgrpopt-' + gIdx + '-' + g" :value="g">
                {{ g }}
              </option>
            </select>
            <input v-else class="form-control" v-model="grp.name" placeholder="groupname" />
            <button class="btn btn-sm btn-outline-danger" @click="roleRemoveGroup(newRole, gIdx)">
              <FaIcon icon="times" />
            </button>
          </div>
          <div :class="[newRole.groups.length > 0 ? 'mt-3' : 'mt-1', 'mb-4']">
            <BsButton icon="plus" @click="roleAddGroup(newRole)">{{ t('settings.settingsPage.addGroup') }}</BsButton>
          </div>
          <label class="form-label fw-bold">{{ t('settings.settingsPage.users') }}</label>
          <div
            v-for="(usr, uIdx) in newRole.users"
            :key="'adduser-' + uIdx"
            class="d-flex align-items-center gap-2 mb-2"
          >
            <select
              class="form-select provider-select"
              v-model="usr.provider"
              @change="onRoleProviderChange(usr, 'user')"
            >
              <option v-for="p in authProviders" :key="p" :value="p">{{ p }}</option>
            </select>
            <select v-if="usr.provider === 'local' && sortedLocalUsers.length" class="form-select" v-model="usr.name">
              <option v-for="u in localUserOptions(usr.name)" :key="'adduseropt-' + uIdx + '-' + u" :value="u">
                {{ u }}
              </option>
            </select>
            <input v-else class="form-control" v-model="usr.name" placeholder="username" />
            <button class="btn btn-sm btn-outline-danger" @click="roleRemoveUser(newRole, uIdx)">
              <FaIcon icon="times" />
            </button>
          </div>
          <div :class="[newRole.users.length > 0 ? 'mt-3' : 'mt-1', 'mb-4']">
            <BsButton icon="plus" @click="roleAddUser(newRole)">{{ t('settings.settingsPage.addUser') }}</BsButton>
          </div>
          <label class="form-label fw-bold">{{ t('settings.settingsPage.options') }}</label>
          <div class="row row-cols-2 row-cols-md-3 g-0 role-options mb-3">
            <div v-for="optKey in roleOptionKeys" :key="'addopt-' + optKey" class="col">
              <BsInput
                type="checkbox"
                :isSwitch="true"
                v-model="newRole.options[optKey]"
                :label="roleOptionLabel(optKey)"
              />
            </div>
          </div>
        </template>
        <template #footer>
          <BsButton icon="plus" @click="doAddRole()">{{ t('designer.addRole') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - edit roles -->
      <BsModal v-if="showEditRoles" @close="showEditRoles = false">
        <template #title> {{ t('designer.editRoles') }} </template>
        <template #default>
          <div v-if="editRoles.length === 0" class="text-muted text-center py-3">{{ t('designer.noRoles') }}</div>
          <div v-for="(role, rIdx) in editRoles" :key="'editrole-' + role._uid" class="border rounded mb-2">
            <div
              class="d-flex align-items-center justify-content-between px-3 py-2 role-header"
              @click="toggleEditRole(role._uid)"
            >
              <div class="d-flex align-items-center gap-2">
                <FaIcon :icon="expandedEditRoles[role._uid] ? 'chevron-down' : 'chevron-right'" class="text-muted" />
                <strong>{{ role.name || '(unnamed)' }}</strong>
                <span v-if="role._required" class="badge bg-secondary-subtle text-muted">{{
                  t('settings.settingsPage.requiredItem')
                }}</span>
              </div>
              <button
                v-if="!role._required"
                class="btn btn-sm btn-outline-danger"
                @click.stop="editRoleRemove(rIdx)"
                :title="t('common.delete')"
              >
                <FaIcon icon="trash" />
              </button>
            </div>
            <div v-show="expandedEditRoles[role._uid]" class="px-3 pb-3">
              <div class="mb-3">
                <label class="form-label fw-bold">{{ t('designer.roleName') }}</label>
                <input type="text" class="form-control" v-model="role.name" :disabled="role._required" />
              </div>
              <template v-if="!role._public">
                <label class="form-label fw-bold">{{ t('settings.settingsPage.groups') }}</label>
                <div
                  v-for="(grp, gIdx) in role.groups"
                  :key="'egrp-' + rIdx + '-' + gIdx"
                  class="d-flex align-items-center gap-2 mb-2"
                >
                  <select
                    class="form-select provider-select"
                    v-model="grp.provider"
                    @change="onRoleProviderChange(grp, 'group')"
                  >
                    <option v-for="p in authProviders" :key="p" :value="p">{{ p }}</option>
                  </select>
                  <select
                    v-if="grp.provider === 'local' && sortedLocalGroups.length"
                    class="form-select"
                    v-model="grp.name"
                  >
                    <option
                      v-for="g in localGroupOptions(grp.name)"
                      :key="'egrpopt-' + rIdx + '-' + gIdx + '-' + g"
                      :value="g"
                    >
                      {{ g }}
                    </option>
                  </select>
                  <input v-else class="form-control" v-model="grp.name" placeholder="groupname" />
                  <button class="btn btn-sm btn-outline-danger" @click="roleRemoveGroup(role, gIdx)">
                    <FaIcon icon="times" />
                  </button>
                </div>
                <div :class="[role.groups.length > 0 ? 'mt-3' : 'mt-1', 'mb-4']">
                  <BsButton icon="plus" @click="roleAddGroup(role)">{{ t('settings.settingsPage.addGroup') }}</BsButton>
                </div>
                <label class="form-label fw-bold">{{ t('settings.settingsPage.users') }}</label>
                <div
                  v-for="(usr, uIdx) in role.users"
                  :key="'euser-' + rIdx + '-' + uIdx"
                  class="d-flex align-items-center gap-2 mb-2"
                >
                  <select
                    class="form-select provider-select"
                    v-model="usr.provider"
                    @change="onRoleProviderChange(usr, 'user')"
                  >
                    <option v-for="p in authProviders" :key="p" :value="p">{{ p }}</option>
                  </select>
                  <select
                    v-if="usr.provider === 'local' && sortedLocalUsers.length"
                    class="form-select"
                    v-model="usr.name"
                  >
                    <option
                      v-for="u in localUserOptions(usr.name)"
                      :key="'euseropt-' + rIdx + '-' + uIdx + '-' + u"
                      :value="u"
                    >
                      {{ u }}
                    </option>
                  </select>
                  <input v-else class="form-control" v-model="usr.name" placeholder="username" />
                  <button class="btn btn-sm btn-outline-danger" @click="roleRemoveUser(role, uIdx)">
                    <FaIcon icon="times" />
                  </button>
                </div>
                <div :class="[role.users.length > 0 ? 'mt-3' : 'mt-1', 'mb-4']">
                  <BsButton icon="plus" @click="roleAddUser(role)">{{ t('settings.settingsPage.addUser') }}</BsButton>
                </div>
              </template>
              <p v-else class="text-muted small mt-1 mb-4">{{ t('settings.settingsPage.publicRoleNote') }}</p>
              <label class="form-label fw-bold">{{ t('settings.settingsPage.options') }}</label>
              <div class="row row-cols-2 row-cols-md-3 g-0 role-options mb-2">
                <div v-for="optKey in roleOptionKeys" :key="'eopt-' + rIdx + '-' + optKey" class="col">
                  <BsInput
                    type="checkbox"
                    :isSwitch="true"
                    v-model="role.options[optKey]"
                    :label="roleOptionLabel(optKey)"
                  />
                </div>
              </div>
            </div>
          </div>
        </template>
        <template #footer>
          <BsButton icon="check" @click="applyEditRoles()">{{ t('common.apply') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - add constant -->
      <BsModal v-if="showAddConstant" @close="showAddConstant = false">
        <template #title> {{ t('designer.addConstant') }} </template>
        <template #default>
          <div class="mb-3">
            <label class="form-label fw-bold">{{ t('designer.parentConstant') }}</label>
            <select class="form-select" v-model="newConstParent" :disabled="!hasAnyConstants">
              <option value="">{{ t('designer.topLevel') }}</option>
              <option v-for="(p, idx) in addConstParents" :key="'constparent-' + idx" :value="String(idx)">
                {{ p.label }}
              </option>
            </select>
          </div>
          <BsInput
            :isFloating="false"
            v-model="newConstKey"
            :label="t('settings.settingsPage.key')"
            icon="tag"
            placeholder="CONSTANT_NAME"
            class="mb-3"
          />
          <BsInput
            :isFloating="false"
            type="textarea"
            :rows="3"
            v-model="newConstValue"
            :label="t('settings.settingsPage.value')"
            icon="pen"
            :placeholder="t('settings.settingsPage.constantValuePlaceholder')"
          />
        </template>
        <template #footer>
          <BsButton icon="plus" @click="doAddConstant()">{{ t('designer.addConstant') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - edit constants -->
      <BsModal v-if="showEditConstants" @close="showEditConstants = false">
        <template #title> {{ t('designer.editConstants') }} </template>
        <template #default>
          <div v-if="editConsts.length === 0" class="text-muted text-center py-3">
            {{ t('settings.settingsPage.noConstants') }}
          </div>
          <div
            v-for="(entry, idx) in flatEditConsts"
            :key="'editconst-' + entry.row._uid"
            class="d-flex align-items-end gap-2 mb-2"
            :style="{ paddingLeft: entry.depth * 1 + 'rem' }"
          >
            <FaIcon
              v-if="entry.depth > 0"
              icon="level-up-alt"
              class="text-muted fa-rotate-90 flex-shrink-0"
              style="font-size: 0.75rem; margin-bottom: 0.75rem"
            />
            <div class="flex-shrink-0" style="width: 14rem">
              <label v-if="idx === 0 || flatEditConsts[idx - 1].depth !== entry.depth" class="form-label fw-bold">{{
                t('settings.settingsPage.key')
              }}</label>
              <input type="text" class="form-control" v-model="entry.row.key" />
            </div>
            <div class="flex-grow-1">
              <template v-if="entry.row.children && entry.row.children.length > 0">
                <label v-if="idx === 0 || flatEditConsts[idx - 1].depth !== entry.depth" class="form-label fw-bold">{{
                  t('settings.settingsPage.value')
                }}</label>
                <div class="form-control bg-body-tertiary text-muted fst-italic" style="cursor: default">
                  {{ t('settings.settingsPage.subkeyCount', entry.row.children.length) }}
                </div>
              </template>
              <template v-else>
                <label v-if="idx === 0 || flatEditConsts[idx - 1].depth !== entry.depth" class="form-label fw-bold">{{
                  t('settings.settingsPage.value')
                }}</label>
                <textarea
                  class="form-control"
                  :rows="constantValueRows(entry.row.value)"
                  v-model="entry.row.value"
                  :placeholder="t('settings.settingsPage.constantValuePlaceholder')"
                ></textarea>
              </template>
            </div>
            <div class="d-flex gap-2 flex-shrink-0" style="margin-bottom: 1px">
              <span
                role="button"
                class="d-flex align-items-center justify-content-center rounded border border-secondary"
                style="width: 2.25rem; height: calc(2.25rem + 2px)"
                @click="editConstAddSub(entry.row)"
                :title="t('settings.settingsPage.addSubkey')"
              >
                <font-awesome-icon icon="plus" style="color: var(--bs-secondary)" />
              </span>
              <span
                role="button"
                class="d-flex align-items-center justify-content-center rounded border border-danger"
                style="width: 2.25rem; height: calc(2.25rem + 2px)"
                @click="editConstRemove(entry.row)"
                :title="t('common.delete')"
              >
                <font-awesome-icon icon="trash" style="color: var(--bs-danger)" />
              </span>
            </div>
          </div>
        </template>
        <template #footer>
          <BsButton icon="check" @click="applyEditConstants()">{{ t('common.apply') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - tile background picker -->
      <BsModal v-if="showTilePicker" @close="showTilePicker = false">
        <template #title> {{ t('designer.chooseBackground') }} </template>
        <template #default>
          <div class="tile-grid">
            <div
              v-for="opt in tileOptions"
              :key="'tile-' + opt.value"
              class="tile-cell"
              :class="{ 'tile-selected': selectedTile === opt.value }"
              role="button"
              :title="opt.value"
              @click="selectedTile = opt.value"
            >
              <div class="tile-swatch" :style="{ backgroundColor: opt.color }"></div>
              <small class="tile-label">{{ opt.label }}</small>
            </div>
          </div>
        </template>
        <template #footer>
          <BsButton icon="check" @click="applyTile()">{{ t('common.apply') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - image picker -->
      <BsModal v-if="showImagePicker" @close="showImagePicker = false">
        <template #title> {{ t('designer.chooseImage') }} </template>
        <template #default>
          <BsInput
            :isFloating="false"
            v-model="imageUrl"
            :label="t('designer.imageUrl')"
            icon="link"
            placeholder="https://... or data:image/..."
          />
          <div
            v-if="imageUrl"
            class="d-flex justify-content-center mt-3 p-3 rounded"
            style="background: var(--bs-tertiary-bg)"
          >
            <img :src="imageUrl" style="max-width: 100%; max-height: 200px; object-fit: contain" />
          </div>
        </template>
        <template #footer>
          <BsButton icon="check" @click="applyImage()">{{ t('common.apply') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - form settings -->
      <BsModal v-if="showFormSettings" @close="showFormSettings = false" size="lg">
        <template #title> {{ t('designer.formSettings') }} </template>
        <template #default>
          <div class="row g-3">
            <div class="col-md-8">
              <BsInput :isFloating="false" v-model="formSettings.name" :label="t('designer.formName')" icon="tag" />
            </div>
            <div class="col-md-4">
              <label class="form-label">{{ t('designer.formType') }}</label>
              <select class="form-select" v-model="formSettings.type">
                <option v-for="ft in formTypes" :key="ft" :value="ft">{{ ft }}</option>
              </select>
            </div>
            <div class="col-12">
              <BsInput
                :isFloating="false"
                v-model="formSettings.description"
                :label="t('designer.formDescription')"
                icon="align-left"
              />
            </div>
            <div class="col-md-6" v-if="formSettings.type === 'ansible'">
              <BsInput
                :isFloating="false"
                v-model="formSettings.playbook"
                :label="t('designer.formPlaybook')"
                icon="play"
              />
            </div>
            <div class="col-md-6" v-if="formSettings.type === 'ansible' || formSettings.type === 'awx'">
              <BsInput
                :isFloating="false"
                v-model="formSettings.runner"
                :label="t('designer.formRunner')"
                :help="t('designer.formRunnerHelp')"
                icon="rocket"
              />
            </div>
            <div class="col-md-6" v-if="formSettings.type === 'awx'">
              <BsInput
                :isFloating="false"
                v-model="formSettings.template"
                :label="t('designer.formTemplate')"
                icon="layer-group"
              />
            </div>
            <!-- only the keys the selected type allows are editable : the schema
                 forbids the others for that type (see forbiddenFormKeys) -->
            <div class="col-md-6" v-if="formTypeAllows('inventory')">
              <BsInput
                :isFloating="false"
                v-model="formSettings.inventory"
                :label="t('designer.formInventory')"
                icon="server"
              />
            </div>
            <template v-if="formSettings.type === 'awx'">
              <div class="col-md-4">
                <BsInput
                  :isFloating="false"
                  v-model="formSettings.scmBranch"
                  :label="t('designer.formScmBranch')"
                  icon="code-branch"
                />
              </div>
              <div class="col-md-4">
                <BsInput
                  :isFloating="false"
                  v-model="formSettings.executionEnvironment"
                  :label="t('designer.formExecEnv')"
                  icon="box"
                />
              </div>
              <div class="col-md-4">
                <BsInput
                  :isFloating="false"
                  v-model="formSettings.instanceGroups"
                  :label="t('designer.formInstanceGroups')"
                  icon="server"
                />
              </div>
            </template>
            <div class="col-md-6" v-if="formTypeAllows('ansibleCredentials')">
              <BsInput
                :isFloating="false"
                v-model="formSettings.ansibleCredentials"
                :label="t('designer.formAnsibleCreds')"
                icon="key"
              />
            </div>
            <div class="col-md-6" v-if="formTypeAllows('vaultCredentials')">
              <BsInput
                :isFloating="false"
                v-model="formSettings.vaultCredentials"
                :label="t('designer.formVaultCreds')"
                icon="lock"
              />
            </div>
            <div class="col-md-4" v-if="formTypeAllows('tags')">
              <BsInput :isFloating="false" v-model="formSettings.tags" :label="t('designer.formTags')" icon="tags" />
            </div>
            <div class="col-md-4" v-if="formTypeAllows('limit')">
              <BsInput
                :isFloating="false"
                v-model="formSettings.limit"
                :label="t('designer.formLimit')"
                icon="filter"
              />
            </div>
            <div class="col-md-4" v-if="formTypeAllows('order')">
              <BsInput
                :isFloating="false"
                v-model="formSettings.order"
                :label="t('designer.formOrder')"
                icon="sort"
                type="number"
              />
            </div>
            <div class="col-md-4" v-if="formTypeAllows('launchValidation') && !formSettings.hasWizard">
              <BsInput
                :isFloating="false"
                type="select"
                v-model="formSettings.launchValidation"
                name="launchValidation"
                :values="launchValidationOptions"
                :label="t('designer.formLaunchValidation')"
                :help="t('designer.formLaunchValidationHelp')"
                icon="shield-halved"
              />
            </div>
            <div class="col-md-4" v-if="formTypeAllows('userExtravars')">
              <BsInput
                :isFloating="false"
                v-model="formSettings.userExtravars"
                :label="t('designer.formUserExtravars')"
                :help="t('designer.formUserExtravarsHelp')"
                icon="user-shield"
                placeholder="username,email,type"
              />
            </div>
            <div class="col-12">
              <BsInput
                :isFloating="false"
                type="textarea"
                v-model="formSettings.help"
                :label="t('designer.helpText')"
                icon="circle-question"
                rows="3"
              />
            </div>
            <div class="col-12" style="margin-top: 0.25rem">
              <div class="d-flex flex-wrap gap-4">
                <BsInput
                  :isFloating="false"
                  :isInline="true"
                  type="checkbox"
                  v-model="formSettings.showHelp"
                  :isSwitch="true"
                  :label="t('designer.showHelpByDefault')"
                />
                <BsInput
                  v-if="formTypeAllows('check')"
                  :isFloating="false"
                  :isInline="true"
                  type="checkbox"
                  v-model="formSettings.check"
                  :isSwitch="true"
                  :label="t('designer.formCheck')"
                />
                <BsInput
                  v-if="formTypeAllows('diff')"
                  :isFloating="false"
                  :isInline="true"
                  type="checkbox"
                  v-model="formSettings.diff"
                  :isSwitch="true"
                  :label="t('designer.formDiff')"
                />
                <BsInput
                  v-if="formTypeAllows('allowRelaunch')"
                  :isFloating="false"
                  :isInline="true"
                  type="checkbox"
                  v-model="formSettings.allowRelaunch"
                  :isSwitch="true"
                  :label="t('designer.formAllowRelaunch')"
                />
                <BsInput
                  v-if="formTypeAllows('abortable')"
                  :isFloating="false"
                  :isInline="true"
                  type="checkbox"
                  v-model="formSettings.abortable"
                  :isSwitch="true"
                  :label="t('designer.formAbortable')"
                />
                <BsInput
                  v-if="formTypeAllows('enableForChat') && !formSettings.hasWizard"
                  :isFloating="false"
                  :isInline="true"
                  type="checkbox"
                  v-model="formSettings.enableForChat"
                  :isSwitch="true"
                  :label="t('designer.formChat')"
                />
                <BsInput
                  v-if="formTypeAllows('verbose')"
                  :isFloating="false"
                  :isInline="true"
                  type="checkbox"
                  v-model="formSettings.verbose"
                  :isSwitch="true"
                  :label="t('designer.formVerbose')"
                />
                <BsInput
                  v-if="formTypeAllows('keepExtravars')"
                  :isFloating="false"
                  :isInline="true"
                  type="checkbox"
                  v-model="formSettings.keepExtravars"
                  :isSwitch="true"
                  :label="t('designer.formKeepExtravars')"
                />
              </div>
            </div>
          </div>
        </template>
        <template #footer>
          <BsButton icon="check" @click="applyFormSettings()">{{ t('common.apply') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - categories picker -->
      <BsModal v-if="showCatPicker" @close="showCatPicker = false" size="lg">
        <template #title> {{ t('designer.assignCategories') }} </template>
        <template #default>
          <div v-if="flatCategoriesForPicker && flatCategoriesForPicker.length" class="d-flex flex-column gap-2">
            <!-- the indent has to ADD to Bootstrap's own `.form-check` padding-left
                 (1.5em) : that padding is what holds the checkbox, which is floated
                 with `margin-left: -1.5em`. Setting padding-left to the bare indent
                 overrode it, so a depth-0 row got 0 padding and its checkbox hung
                 outside the modal's left edge. -->
            <div
              v-for="row in flatCategoriesForPicker"
              :key="'cat-' + row.path"
              class="form-check"
              role="button"
              @click="toggleCat(row.path)"
              :style="{ paddingLeft: `calc(1.5em + ${row.depth * 1.25}rem)` }"
            >
              <input
                class="form-check-input"
                type="checkbox"
                :checked="selectedCats.includes(row.path)"
                @click.stop="toggleCat(row.path)"
              />
              <label class="form-check-label d-flex align-items-center gap-2" role="button">
                <FaIcon :icon="row.icon || 'folder'" />
                <span>{{ row.name }}</span>
              </label>
            </div>
          </div>
          <div v-else class="text-muted">{{ t('designer.noCategories') }}</div>
        </template>
        <template #footer>
          <BsButton icon="check" @click="applyCats()">{{ t('common.apply') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - insert a constant reference into the form -->
      <BsModal v-if="showInsertConstant" @close="showInsertConstant = false" size="lg">
        <template #title> {{ t('designer.insertConstant') }} </template>
        <template #default>
          <p class="text-muted small mb-3">{{ t('designer.insertConstantHelp') }}</p>
          <div v-if="insertableConstants.length" class="list-group">
            <button
              v-for="c in insertableConstants"
              :key="'ins-' + c.path"
              type="button"
              class="list-group-item list-group-item-action d-flex justify-content-between align-items-center gap-3"
              @click="insertConstant(c.path)"
            >
              <code class="text-nowrap">$({{ c.path }})</code>
              <span class="text-muted small text-truncate">{{ c.value }}</span>
            </button>
          </div>
          <div v-else class="text-muted">{{ t('designer.noConstants') }}</div>
        </template>
        <template #footer>
          <BsButton icon="plus" @click="newConstantFromInsert()">{{ t('designer.addConstant') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - roles picker -->
      <BsModal v-if="showRolePicker" @close="showRolePicker = false" size="lg">
        <template #title> {{ t('designer.assignRoles') }} </template>
        <template #default>
          <div v-if="rolesObj && rolesObj.length" class="d-flex flex-column gap-2">
            <div
              v-for="role in rolesObj"
              :key="'role-' + role.name"
              class="form-check"
              role="button"
              @click="toggleRole(role.name)"
            >
              <input
                class="form-check-input"
                type="checkbox"
                :checked="selectedRoles.includes(role.name)"
                @click.stop="toggleRole(role.name)"
              />
              <label class="form-check-label" role="button">{{ role.name }}</label>
            </div>
          </div>
          <div v-else class="text-muted">{{ t('designer.noRoles') }}</div>
        </template>
        <template #footer>
          <BsButton icon="check" @click="applyRoles()">{{ t('common.apply') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - field properties editor -->
      <BsModal v-if="showFieldEditor" @close="showFieldEditor = false" size="xl">
        <template #title> {{ t('designer.fieldProperties') }} </template>
        <template #default>
          <div class="table-responsive">
            <table class="table table-sm table-bordered mb-0 field-editor-table">
              <thead>
                <tr>
                  <th style="width: 30px"></th>
                  <th>{{ t('designer.fieldName') }}</th>
                  <th>{{ t('designer.fieldType') }}</th>
                  <th class="text-center" style="width: 70px">{{ t('designer.fieldValues') }}</th>
                  <th>{{ t('designer.fieldLabel') }}</th>
                  <th>{{ t('designer.fieldHelp') }}</th>
                  <th>{{ t('designer.fieldDefault') }}</th>
                  <th class="text-center" style="width: 60px">{{ t('designer.fieldRequired') }}</th>
                  <th class="text-center" style="width: 60px">{{ t('designer.fieldOutput') }}</th>
                  <th style="width: 50px"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, i) in fieldEditorRows"
                  :key="i"
                  draggable="true"
                  @dragstart="fieldDragStart(i)"
                  @dragover="fieldDragOver($event, i)"
                  @dragend="fieldDragEnd"
                  :class="{ 'field-drag-over': fieldDragIdx === i }"
                >
                  <td class="text-center align-middle field-grip" role="button">
                    <FaIcon icon="grip-vertical" class="text-muted" size="sm" />
                  </td>
                  <td><input class="form-control form-control-sm font-monospace" v-model="row.name" /></td>
                  <td>
                    <select class="form-select form-select-sm" v-model="row.type">
                      <option v-for="ft in fieldTypes" :key="ft" :value="ft">{{ ft }}</option>
                    </select>
                  </td>
                  <!-- an 'enum'/'radio' is unsaveable without `values`, and the
                       list is the one property that has no cell of its own : it
                       opens in a panel under the table -->
                  <td class="text-center align-middle">
                    <button
                      v-if="fieldTypeAllows(row.type, 'values')"
                      class="btn btn-sm"
                      :class="
                        fieldValuesIdx === i
                          ? 'btn-primary'
                          : row.values.length
                            ? 'btn-outline-primary'
                            : 'btn-outline-secondary'
                      "
                      @click="toggleFieldValues(i)"
                      :title="t('designer.editValues')"
                    >
                      <FaIcon icon="list-ul" size="sm" /> {{ row.values.length }}
                    </button>
                  </td>
                  <td><input class="form-control form-control-sm" v-model="row.label" /></td>
                  <!-- an input for a key the type forbids would only write a key
                       the apply has to delete again (html forbids help/required) -->
                  <td>
                    <input
                      v-if="fieldTypeAllows(row.type, 'help')"
                      class="form-control form-control-sm"
                      v-model="row.help"
                    />
                  </td>
                  <td><input class="form-control form-control-sm" v-model="row.default" /></td>
                  <td class="text-center align-middle">
                    <input
                      v-if="fieldTypeAllows(row.type, 'required')"
                      type="checkbox"
                      class="form-check-input"
                      v-model="row.required"
                    />
                  </td>
                  <td class="text-center align-middle">
                    <input type="checkbox" class="form-check-input" v-model="row.output" />
                  </td>
                  <td class="text-center align-middle">
                    <button class="btn btn-sm btn-outline-danger" @click="removeFieldRow(i)">
                      <FaIcon icon="trash" size="sm" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- the values of one field : a string entry is plain text, an object
               entry is a list of key/value pairs (the schema takes either) -->
          <div
            v-if="
              fieldValuesIdx !== null &&
              fieldEditorRows[fieldValuesIdx] &&
              fieldTypeAllows(fieldEditorRows[fieldValuesIdx].type, 'values')
            "
            class="mt-3 p-3 rounded field-values-panel"
          >
            <div class="d-flex justify-content-between align-items-center mb-2">
              <span class="fw-semibold"
                >{{ t('designer.fieldValues') }} :
                {{ fieldEditorRows[fieldValuesIdx].name || fieldEditorRows[fieldValuesIdx].type }}</span
              >
              <button
                class="btn btn-sm btn-outline-secondary"
                @click="fieldValuesIdx = null"
                :title="t('common.close')"
              >
                <FaIcon icon="times" size="sm" />
              </button>
            </div>
            <div v-if="fieldEditorRows[fieldValuesIdx].values.length === 0" class="text-muted small mb-2">
              {{ t('designer.noFieldValues') }}
            </div>
            <div
              v-for="entry in fieldEditorRows[fieldValuesIdx].values"
              :key="'fv-' + entry._uid"
              class="d-flex align-items-start gap-2 mb-2"
            >
              <div class="d-flex flex-column gap-1 flex-shrink-0">
                <button
                  class="btn btn-sm btn-outline-secondary py-0"
                  @click="moveFieldValue(entry, -1)"
                  :title="t('designer.moveUp')"
                >
                  <FaIcon icon="chevron-up" size="xs" />
                </button>
                <button
                  class="btn btn-sm btn-outline-secondary py-0"
                  @click="moveFieldValue(entry, 1)"
                  :title="t('designer.moveDown')"
                >
                  <FaIcon icon="chevron-down" size="xs" />
                </button>
              </div>
              <div class="flex-grow-1 min-w-0">
                <input
                  v-if="entry.kind === 'string'"
                  class="form-control form-control-sm"
                  v-model="entry.text"
                  :placeholder="t('settings.settingsPage.value')"
                />
                <template v-else-if="entry.kind === 'object'">
                  <div
                    v-for="(pair, pi) in entry.pairs"
                    :key="'fvp-' + pair._uid"
                    class="d-flex align-items-center gap-2 mb-1"
                  >
                    <input
                      class="form-control form-control-sm font-monospace"
                      style="max-width: 12rem"
                      v-model="pair.key"
                      :placeholder="t('settings.settingsPage.key')"
                    />
                    <input
                      class="form-control form-control-sm"
                      v-model="pair.value"
                      :placeholder="t('settings.settingsPage.value')"
                    />
                    <button
                      class="btn btn-sm btn-outline-danger"
                      @click="removeFieldValuePair(entry, pi)"
                      :title="t('common.delete')"
                    >
                      <FaIcon icon="times" size="sm" />
                    </button>
                  </div>
                  <button class="btn btn-sm btn-outline-secondary" @click="addFieldValuePair(entry)">
                    <FaIcon icon="plus" size="sm" class="me-1" />{{ t('designer.addValueProperty') }}
                  </button>
                </template>
                <!-- a nested map/list (or an alias) has no shape here : it is kept
                     as it is, only its position and its removal are editable -->
                <div
                  v-else
                  class="form-control form-control-sm bg-body-tertiary text-muted fst-italic text-truncate"
                  :title="t('designer.valueNotEditable')"
                >
                  {{ entry.preview || t('designer.valueNotEditable') }}
                </div>
              </div>
              <button
                class="btn btn-sm btn-outline-danger flex-shrink-0"
                @click="removeFieldValue(entry)"
                :title="t('common.delete')"
              >
                <FaIcon icon="trash" size="sm" />
              </button>
            </div>
            <div class="d-flex gap-2 mt-2">
              <BsButton icon="plus" @click="addFieldValue('string')">{{ t('designer.addValue') }}</BsButton>
              <BsButton icon="plus" @click="addFieldValue('object')">{{ t('designer.addValueObject') }}</BsButton>
            </div>
          </div>
          <div class="d-flex justify-content-end mt-2">
            <BsButton icon="plus" colorClass="primary" cssClass="btn-sm" @click="addFieldRow()">{{
              t('designer.addField')
            }}</BsButton>
          </div>
        </template>
        <template #footer>
          <BsButton icon="check" @click="applyFieldEditor()">{{ t('common.apply') }}</BsButton>
        </template>
      </BsModal>

      <!-- Context menu -->
      <Teleport to="body">
        <div
          v-if="ctxMenu.show"
          class="ctx-menu"
          :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
          @click="closeContextMenu()"
        >
          <template v-if="ctxMenu.target?.type === 'file'">
            <div class="ctx-item" @click="ctxAddFormToFile()">
              <FaIcon icon="plus" class="me-2" size="sm" />{{ t('designer.addForm') }}
            </div>
            <hr class="ctx-divider" />
            <div class="ctx-item" :class="{ 'ctx-item-disabled': !ctxMenu.target?.source }" @click="ctxRenameFile()">
              <FaIcon icon="pen" class="me-2" size="sm" />{{ t('designer.renameFile') }}
            </div>
            <!-- the base file is not a file on disk : it can't be duplicated -->
            <div class="ctx-item" :class="{ 'ctx-item-disabled': !ctxMenu.target?.source }" @click="ctxDuplicateFile()">
              <FaIcon icon="copy" class="me-2" size="sm" />{{ t('designer.duplicateFile') }}
            </div>
            <div class="ctx-item" @click="ctxDownloadFile()">
              <FaIcon icon="download" class="me-2" size="sm" />{{ t('designer.downloadFile') }}
            </div>
            <!-- the base file is not a file on disk : it can't be moved or deleted -->
            <div
              class="ctx-item"
              :class="{ 'ctx-item-disabled': folders.length === 0 || !ctxMenu.target?.source }"
              @click="ctxMoveFileToFolder()"
            >
              <FaIcon icon="arrow-right" class="me-2" size="sm" />{{ t('designer.moveFileToFolder') }}
            </div>
            <hr class="ctx-divider" />
            <div
              class="ctx-item ctx-item-danger"
              :class="{ 'ctx-item-disabled': !ctxMenu.target?.source }"
              @click="ctxDeleteFile()"
            >
              <FaIcon icon="trash" class="me-2" size="sm" />{{ t('designer.deleteFile') }}
            </div>
          </template>
          <template v-if="ctxMenu.target?.type === 'folder'">
            <div class="ctx-item" @click="ctxAddFileToFolder()">
              <FaIcon icon="plus" class="me-2" size="sm" />{{ t('designer.newFile') }}
            </div>
            <hr class="ctx-divider" />
            <div class="ctx-item ctx-item-danger" @click="ctxDeleteFolder()">
              <FaIcon icon="trash" class="me-2" size="sm" />{{ t('designer.deleteFolder') }}
            </div>
          </template>
          <template v-if="ctxMenu.target?.type === 'form'">
            <div class="ctx-item" @click="ctxDuplicateForm()">
              <FaIcon icon="copy" class="me-2" size="sm" />{{ t('designer.duplicateForm') }}
            </div>
            <div class="ctx-item" @click="ctxMoveToFile()">
              <FaIcon icon="arrow-right" class="me-2" size="sm" />{{ t('designer.moveToFile') }}
            </div>
            <hr class="ctx-divider" />
            <div class="ctx-item ctx-item-danger" @click="ctxDeleteFormFromMenu()">
              <FaIcon icon="trash" class="me-2" size="sm" />{{ t('designer.deleteForm') }}
            </div>
          </template>
        </div>
        <div
          v-if="ctxMenu.show"
          class="ctx-backdrop"
          @click="closeContextMenu()"
          @contextmenu.prevent="closeContextMenu()"
        ></div>
      </Teleport>

      <BsOffCanvas
        v-if="showWarnings"
        :show="true"
        icon="triangle-exclamation"
        :title="t('designer.warnings')"
        @close="showWarnings = false"
      >
        <template #default>
          <!-- a warning takes you to what it is about : the form it names, or
               the config tab that holds the section -->
          <p
            v-for="(w, i) in warnings"
            :key="'warning' + i"
            class="mb-3 warning-entry"
            role="button"
            :title="t('designer.warnGoTo')"
            v-html="w.html"
            @click="goToWarning(w)"
          ></p>
        </template>
      </BsOffCanvas>
      <!-- titled after the open view, like the jobs and profile pages ; until the designer is
           started (nothing can be opened yet) after the lock it needs -->
      <AppSettings v-if="authenticated" :title="pageTitle.title" :description="tabDescription" :icon="pageTitle.icon">
        <template #feedback>
          <Transition appear>
            <div v-if="warnings.length > 0" class="ms-2">
              <button @click="showWarnings = !showWarnings" class="btn btn-warning me-3">
                <span class="me-2">
                  <font-awesome-icon icon="exclamation-triangle" />
                </span>
                <span class="mr-1"
                  >{{ showWarnings ? t('designer.hideWarnings') : t('designer.hasWarnings') }}
                  {{ t('designer.warnings') }}
                </span>
              </button>
            </div>
          </Transition>
        </template>
        <!-- the designer's on/off switch, on the right of the title row -->
        <template #headerActions>
          <template v-if="lock">
            <popper v-if="lock.lock && !lock.match">
              <div class="form-check form-switch d-inline-flex align-items-center ms-3 mb-0">
                <input class="form-check-input" type="checkbox" :checked="true" @change="unLock()" role="button" />
                <label
                  class="form-check-label text-warning"
                  style="margin-left: 0.75rem"
                  role="button"
                  @click="unLock()"
                >
                  <font-awesome-icon icon="lock" size="sm" class="me-1" />{{ lock.lock.username }}
                </label>
              </div>
              <template #content>
                {{ t('designer.user') }}: {{ lock.lock.username }}<br />
                {{ t('designer.type') }}: {{ lock.lock.type }}<br />
                {{ t('designer.created') }}: {{ lockAge }}<br />
                <small class="text-muted">{{ t('designer.clickToForceUnlock') }}</small>
              </template>
            </popper>
            <div v-else class="form-check form-switch d-inline-flex align-items-center ms-3 mb-0">
              <input
                class="form-check-input"
                type="checkbox"
                :checked="lock.match"
                @change="onLockToggle"
                role="button"
              />
              <label
                class="form-check-label"
                :class="lock.match ? 'text-success' : ''"
                style="margin-left: 0.75rem"
                role="button"
                @click="onLockToggle"
              >
                <font-awesome-icon :icon="lock.match ? 'lock' : 'unlock'" size="sm" class="me-1" />{{
                  lock.match ? t('designer.lockedByMe') : t('designer.startDesigner')
                }}
              </label>
            </div>
          </template>
        </template>
        <template #default>
          <!-- loading : the page's loading indicator, centered in the card, which fills the page -->
          <AppPageLoading v-if="lockLoading || (lock && !lock.free && !loaded)" contained />
          <div
            v-else-if="lock && lock.free"
            class="d-flex flex-column align-items-center justify-content-center py-5 text-muted"
          >
            <FaIcon icon="unlock" style="font-size: 2.5rem; opacity: 0.3" class="mb-3" />
            <p class="mb-3 fw-semibold" style="font-size: 1.2rem">{{ t('designer.notLocked') }}</p>
            <p class="fs-6 mb-0">{{ t('designer.notLockedHint') }}</p>
          </div>
          <div v-else>
            <!-- the file picker of the import : hidden, openImport() clicks it -->
            <input ref="importInput" type="file" accept=".yaml,.yml,text/yaml" class="d-none" @change="onImportFile" />
            <!-- Every gap in the card matches its side padding : the card's 1px border plus
                 the body's 16px = 17px from the card edge. Above the buttons that is all there
                 is (no padding here) ; below them this 9px is followed by the 8px bottom
                 margin of the empty <label> BsInput always renders, 17px again ; and under
                 the editor the wrapper's margin is removed (see the global style block), so
                 the editor ends 17px above the card's bottom edge as well. -->
            <div class="d-flex align-items-center flex-wrap gap-2" style="padding-top: 0; padding-bottom: 9px">
              <small
                v-if="lockError !== ''"
                class="d-inline-flex px-2 py-1 fw-semibold text-warning-emphasis bg-warning-subtle border border-warning-subtle rounded-2"
                >{{ lockError }}</small
              >
              <!-- the stored config is a ytt template : what the designer holds
                     is its expansion, so nothing here may be written back -->
              <small
                v-if="configTemplated"
                class="d-inline-flex px-2 py-1 fw-semibold text-warning-emphasis bg-warning-subtle border border-warning-subtle rounded-2"
                >{{ t('settings.settingsPage.configTemplated') }}</small
              >
              <template v-if="lock && lock.match">
                <div class="d-flex gap-1 flex-wrap designer-toolbar">
                  <template v-if="dbOnlyMode && isConfigTab">
                    <BsButton
                      :colorClass="busy ? 'secondary' : 'primary'"
                      icon="check"
                      :isIconButton="true"
                      @click="validateForms"
                      :disabled="busy"
                      :title="t('designer.validate')"
                    />
                    <BsButton
                      :colorClass="!isValid || !isDirty || busyOrTemplated ? 'secondary' : 'orange'"
                      icon="save"
                      :isIconButton="true"
                      @click="saveForms"
                      :disabled="!isValid || !isDirty || busyOrTemplated"
                      :title="t('designer.save')"
                    />
                    <BsButton
                      v-if="canRestore"
                      :colorClass="busyOrTemplated ? 'secondary' : 'primary'"
                      icon="trash-arrow-up"
                      :isIconButton="true"
                      @click="restore"
                      :disabled="busyOrTemplated"
                      :title="t('designer.restore')"
                    />
                  </template>
                  <template v-else>
                    <BsButton
                      :colorClass="busyOrTemplated ? 'secondary' : 'primary'"
                      v-if="currentTab == 'Forms'"
                      icon="file-circle-plus"
                      :isIconButton="true"
                      @click="openNewFile()"
                      :disabled="busyOrTemplated"
                      :title="t('designer.newFile')"
                    />
                    <!-- the counterpart of Download : a local .yaml/.yml is read
                           into the editor buffers, so Save/validate applies to it -->
                    <BsButton
                      :colorClass="busyOrTemplated ? 'secondary' : 'primary'"
                      v-if="currentTab == 'Forms'"
                      icon="file-import"
                      :isIconButton="true"
                      @click="openImport()"
                      :disabled="busyOrTemplated"
                      :title="t('designer.import')"
                    />
                    <BsButton
                      :colorClass="busy ? 'secondary' : 'primary'"
                      v-if="formsRepos.length > 0"
                      icon="cloud-arrow-down"
                      :isIconButton="true"
                      @click="loadRepository"
                      :disabled="busy"
                      :title="loadingRepos ? t('designer.loading') : t('designer.loadRepository')"
                    />
                    <BsButton
                      :colorClass="busy ? 'secondary' : 'primary'"
                      icon="check"
                      :isIconButton="true"
                      @click="validateForms"
                      :disabled="busy"
                      :title="t('designer.validate')"
                    />
                    <BsButton
                      :colorClass="!isValid || !isDirty || busyOrTemplated ? 'secondary' : 'orange'"
                      icon="save"
                      :isIconButton="true"
                      @click="saveForms"
                      :disabled="!isValid || !isDirty || busyOrTemplated"
                      :title="formsRepos.length > 0 ? t('designer.saveLocal') : t('designer.save')"
                    />
                    <BsButton
                      v-if="formsRepos.length > 0"
                      :colorClass="isDirty || busyOrTemplated || !hasUnpushed ? 'secondary' : 'orange'"
                      icon="code-branch"
                      :isIconButton="true"
                      @click="pushToRepo"
                      :disabled="isDirty || busyOrTemplated || !hasUnpushed"
                      :title="syncing ? t('designer.syncing') : t('designer.saveRepository')"
                    />
                    <BsButton
                      v-if="canRestore"
                      :colorClass="busyOrTemplated ? 'secondary' : 'primary'"
                      icon="trash-arrow-up"
                      :isIconButton="true"
                      @click="restore"
                      :disabled="busyOrTemplated"
                      :title="t('designer.restore')"
                    />
                  </template>
                  <BsButton
                    :colorClass="busy || !editorTarget ? 'secondary' : 'primary'"
                    icon="rotate-left"
                    :isIconButton="true"
                    @click="editorUndo"
                    :disabled="busy || !editorTarget"
                    :title="t('designer.undo')"
                  />
                  <BsButton
                    :colorClass="busy || !editorTarget ? 'secondary' : 'primary'"
                    icon="rotate-right"
                    :isIconButton="true"
                    @click="editorRedo"
                    :disabled="busy || !editorTarget"
                    :title="t('designer.redo')"
                  />
                  <BsButton
                    :colorClass="busy || !editorTarget ? 'secondary' : 'primary'"
                    icon="scissors"
                    :isIconButton="true"
                    @click="editorCut"
                    :disabled="busy || !editorTarget"
                    :title="t('designer.cut')"
                  />
                  <BsButton
                    :colorClass="busy || !editorTarget ? 'secondary' : 'primary'"
                    icon="copy"
                    :isIconButton="true"
                    @click="editorCopy"
                    :disabled="busy || !editorTarget"
                    :title="t('designer.copy')"
                  />
                  <BsButton
                    :colorClass="busy || !editorTarget ? 'secondary' : 'primary'"
                    icon="paste"
                    :isIconButton="true"
                    @click="editorPaste"
                    :disabled="busy || !editorTarget"
                    :title="t('designer.paste')"
                  />
                  <BsButton
                    :colorClass="busy || !editorTarget ? 'secondary' : 'primary'"
                    icon="indent"
                    :isIconButton="true"
                    @click="editorFormat"
                    :disabled="busy || !editorTarget"
                    :title="t('designer.format')"
                  />
                  <BsButton
                    :colorClass="busy || !editorTarget ? 'secondary' : 'primary'"
                    icon="magnifying-glass"
                    :isIconButton="true"
                    @click="editorFind"
                    :disabled="busy || !editorTarget"
                    :title="t('designer.findReplace')"
                  />
                  <BsButton
                    :colorClass="busy || !isDirty || !editorTarget ? 'secondary' : 'primary'"
                    icon="right-left"
                    :isIconButton="true"
                    @click="editorDiff"
                    :disabled="busy || !isDirty || !editorTarget"
                    :title="t('designer.diff')"
                  />
                  <template v-if="currentTab === 'Categories'">
                    <BsButton
                      :colorClass="busyOrTemplated || !canAddCategories ? 'secondary' : 'primary'"
                      icon="plus"
                      :isIconButton="true"
                      @click="openAddCategory"
                      :disabled="busyOrTemplated || !canAddCategories"
                      :title="t('designer.addCategory')"
                    />
                    <BsButton
                      :colorClass="busyOrTemplated || !hasEditableCategories ? 'secondary' : 'primary'"
                      icon="pencil"
                      :isIconButton="true"
                      @click="openEditCategories"
                      :disabled="busyOrTemplated || !hasEditableCategories"
                      :title="t('designer.editCategories')"
                    />
                  </template>
                  <template v-if="currentTab === 'Roles'">
                    <BsButton
                      :colorClass="busyOrTemplated || !canAddRoles ? 'secondary' : 'primary'"
                      icon="plus"
                      :isIconButton="true"
                      @click="openAddRole"
                      :disabled="busyOrTemplated || !canAddRoles"
                      :title="t('designer.addRole')"
                    />
                    <BsButton
                      :colorClass="busyOrTemplated || !hasEditableRoles ? 'secondary' : 'primary'"
                      icon="pencil"
                      :isIconButton="true"
                      @click="openEditRoles"
                      :disabled="busyOrTemplated || !hasEditableRoles"
                      :title="t('designer.editRoles')"
                    />
                  </template>
                  <template v-if="currentTab === 'Constants'">
                    <BsButton
                      :colorClass="busyOrTemplated || !canAddConstants ? 'secondary' : 'primary'"
                      icon="plus"
                      :isIconButton="true"
                      @click="openAddConstant"
                      :disabled="busyOrTemplated || !canAddConstants"
                      :title="t('designer.addConstant')"
                    />
                    <BsButton
                      :colorClass="busyOrTemplated || !hasEditableConstants ? 'secondary' : 'primary'"
                      icon="pencil"
                      :isIconButton="true"
                      @click="openEditConstants"
                      :disabled="busyOrTemplated || !hasEditableConstants"
                      :title="t('designer.editConstants')"
                    />
                  </template>
                  <template v-if="currentTab === 'Forms'">
                    <!-- pencil, not sliders : FA7 aliases `sliders-h` to `sliders`, and the
                           constants button uses the settings-menu's sliders-h icon, so both
                           rendered the same glyph in this toolbar -->
                    <BsButton
                      :colorClass="busyOrTemplated || !currentForm ? 'secondary' : 'primary'"
                      icon="pencil"
                      :isIconButton="true"
                      @click="openFormSettings"
                      :disabled="busyOrTemplated || !currentForm"
                      :title="t('designer.formSettings')"
                    />
                    <!-- a subform can hold none of these properties (the schema
                           forbids icon/image/tileClass/categories/roles for it) -->
                    <BsButton
                      :colorClass="busyOrTemplated || !currentForm || currentFormIsSubform ? 'secondary' : 'primary'"
                      icon="icons"
                      :isIconButton="true"
                      @click="openIconPicker"
                      :disabled="busyOrTemplated || !currentForm || currentFormIsSubform"
                      :title="currentFormIsSubform ? t('designer.notForSubforms') : t('designer.chooseIcon')"
                    />
                    <BsButton
                      :colorClass="busyOrTemplated || !currentForm || currentFormIsSubform ? 'secondary' : 'primary'"
                      icon="palette"
                      :isIconButton="true"
                      @click="openTilePicker"
                      :disabled="busyOrTemplated || !currentForm || currentFormIsSubform"
                      :title="currentFormIsSubform ? t('designer.notForSubforms') : t('designer.chooseBackground')"
                    />
                    <BsButton
                      :colorClass="busyOrTemplated || !currentForm || currentFormIsSubform ? 'secondary' : 'primary'"
                      icon="image"
                      :isIconButton="true"
                      @click="openImagePicker"
                      :disabled="busyOrTemplated || !currentForm || currentFormIsSubform"
                      :title="currentFormIsSubform ? t('designer.notForSubforms') : t('designer.chooseImage')"
                    />
                    <BsButton
                      :colorClass="busyOrTemplated || !currentForm || currentFormIsSubform ? 'secondary' : 'primary'"
                      icon="th-list"
                      :isIconButton="true"
                      @click="openCatPicker"
                      :disabled="busyOrTemplated || !currentForm || currentFormIsSubform"
                      :title="currentFormIsSubform ? t('designer.notForSubforms') : t('designer.assignCategories')"
                    />
                    <BsButton
                      :colorClass="busyOrTemplated || !currentForm || currentFormIsSubform ? 'secondary' : 'primary'"
                      icon="user-shield"
                      :isIconButton="true"
                      @click="openRolePicker"
                      :disabled="busyOrTemplated || !currentForm || currentFormIsSubform"
                      :title="currentFormIsSubform ? t('designer.notForSubforms') : t('designer.assignRoles')"
                    />
                    <!-- insert a $(constant) at the cursor, or create one : needs an
                           editor to insert into, hence the editorTarget guard the
                           cut/copy/paste buttons use rather than currentForm -->
                    <BsButton
                      :colorClass="busy || !editorTarget ? 'secondary' : 'primary'"
                      icon="sliders-h"
                      :isIconButton="true"
                      @click="openInsertConstant"
                      :disabled="busy || !editorTarget"
                      :title="t('designer.insertConstant')"
                    />
                    <BsButton
                      :colorClass="busyOrTemplated || !currentFormHasFields ? 'secondary' : 'primary'"
                      icon="list-check"
                      :isIconButton="true"
                      @click="openFieldEditor"
                      :disabled="busyOrTemplated || !currentFormHasFields"
                      :title="t('designer.fieldProperties')"
                    />
                    <BsButton
                      :colorClass="busy || !currentForm ? 'secondary' : 'primary'"
                      icon="eye"
                      :isIconButton="true"
                      @click="previewForm"
                      :disabled="busy || !currentForm"
                      :title="t('designer.previewForm')"
                    />
                  </template>
                  <BsButton
                    :colorClass="busy || !editorTarget ? 'secondary' : 'primary'"
                    icon="download"
                    :isIconButton="true"
                    @click="downloadYaml"
                    :disabled="busy || !editorTarget"
                    :title="t('designer.download')"
                  />
                  <BsButton
                    :colorClass="busy || !isDirty || !editorTarget ? 'secondary' : 'primary'"
                    icon="clock-rotate-left"
                    :isIconButton="true"
                    @click="editorRevert"
                    :disabled="busy || !isDirty || !editorTarget"
                    :title="t('designer.revert')"
                  />
                </div>
              </template>
              <small
                v-if="lock && !lock.match && !lock.free"
                class="d-inline-flex px-2 py-1 fw-semibold text-warning-emphasis bg-warning-subtle border border-warning-subtle rounded-2"
                >{{ t('designer.readOnly') }}</small
              >
            </div>
            <div
              class="designer-layout"
              :style="currentTab == 'Forms' ? { gridTemplateColumns: `1fr 1rem ${treeWidthPct}%` } : undefined"
            >
              <div class="designer-editor">
                <div v-if="loaded && currentTab == 'Categories'">
                  <BsInput
                    type="editor"
                    :isFloating="false"
                    v-model="categories"
                    @save="saveForms()"
                    @init="onEditorInit"
                    lang="yaml"
                    :theme="editorTheme"
                    :liveSync="true"
                    :style="editorStyle('100%')"
                  />
                </div>
                <div v-if="loaded && currentTab == 'Roles'">
                  <BsInput
                    type="editor"
                    :isFloating="false"
                    v-model="roles"
                    @save="saveForms()"
                    @init="onEditorInit"
                    lang="yaml"
                    :theme="editorTheme"
                    :liveSync="true"
                    :style="editorStyle('100%')"
                  />
                </div>
                <div v-if="loaded && currentTab == 'Constants'">
                  <BsInput
                    type="editor"
                    :isFloating="false"
                    v-model="constants"
                    @save="saveForms()"
                    @init="onEditorInit"
                    lang="yaml"
                    :theme="editorTheme"
                    :liveSync="true"
                    :style="editorStyle('100%')"
                  />
                </div>
                <div v-if="currentTab == 'Forms'">
                  <template v-if="loaded">
                    <!-- nothing selected (or the selection was just deleted) : the
                       pane would be blank, so say what to do with it -->
                    <div
                      v-if="!editorTarget"
                      class="d-flex flex-column align-items-center justify-content-center py-5 text-muted"
                    >
                      <FaIcon icon="pen-to-square" style="font-size: 2.5rem; opacity: 0.3" class="mb-3" />
                      <p class="mb-3 fw-semibold" style="font-size: 1.2rem">{{ t('designer.noFormSelected') }}</p>
                      <p class="fs-6 mb-0">{{ t('designer.noFormSelectedHint') }}</p>
                    </div>
                    <!-- ONE editor, keyed by the form it edits. This used to be rendered
                       inside v-for="f in files", and `files` is derived from the PARSED
                       yaml : the moment a keystroke left the document invalid the form's
                       source flipped to "Parsing issues", the enclosing v-for key changed
                       with it, and vue tore the editor down and mounted a new one - so
                       typing an incomplete line (which every line is, halfway through
                       typing it) threw away the ace instance along with the cursor and the
                       focus. Keying on currentForm keeps the editor alive while the yaml
                       is broken, and still gives each form its own instance - and its own
                       undo stack - when you switch forms. -->
                    <div v-if="editorTarget" :key="'formeditor-' + currentForm">
                      <BsInput
                        type="editor"
                        :isFloating="false"
                        v-model="forms[currentForm]"
                        @save="saveForms()"
                        @init="onEditorInit"
                        lang="yaml"
                        :theme="editorTheme"
                        :liveSync="true"
                        :style="editorStyle('100%')"
                      />
                    </div>
                  </template>
                </div>
              </div>
              <div v-if="currentTab == 'Forms'" class="designer-resize" @mousedown="startResize"></div>
              <div v-if="currentTab == 'Forms'" class="designer-tree">
                <div class="file-tree-panel">
                  <div class="file-tree-header d-flex justify-content-between align-items-center">
                    <span><FaIcon icon="folder-tree" class="me-2" size="sm" />{{ t('designer.fileExplorer') }}</span>
                    <span class="d-flex gap-2">
                      <span
                        role="button"
                        class="tree-add-btn"
                        @click="toggleCollapseAll()"
                        :title="allTreeCollapsed ? t('designer.expandAll') : t('designer.collapseAll')"
                        ><FaIcon :icon="allTreeCollapsed ? 'angles-down' : 'angles-up'"
                      /></span>
                      <span role="button" class="tree-add-btn" @click="toggleTreeSearch()" :title="t('designer.search')"
                        ><FaIcon icon="magnifying-glass"
                      /></span>
                      <span role="button" class="tree-add-btn" @click="openNewFolder()" :title="t('designer.newFolder')"
                        ><FaIcon icon="folder"
                      /></span>
                      <span role="button" class="tree-add-btn" @click="openNewFile()" :title="t('designer.newFile')"
                        ><FaIcon icon="file"
                      /></span>
                    </span>
                  </div>
                  <div v-if="treeSearch" class="tree-search-bar">
                    <input
                      type="text"
                      class="form-control form-control-sm"
                      v-model="treeFilter"
                      :placeholder="t('designer.search') + '...'"
                      ref="treeSearchInput"
                    />
                  </div>
                  <div class="file-tree-content">
                    <template v-for="(item, idx) in fileTreeFlat" :key="'tree-' + idx">
                      <div
                        v-if="item.type === 'folder'"
                        class="d-flex justify-content-between align-items-center py-1 tree-node"
                        role="button"
                        :style="{ paddingLeft: item.depth * 1.25 + 'rem' }"
                        @click="toggleCollapse(item.key)"
                        @contextmenu="openContextMenu($event, { type: 'folder', name: item.name, path: item.path })"
                      >
                        <span class="d-flex align-items-center min-w-0">
                          <FaIcon
                            :icon="isCollapsed(item.key) ? 'chevron-right' : 'chevron-down'"
                            class="me-1 flex-shrink-0 tree-chevron"
                            size="xs"
                          />
                          <FaIcon
                            :icon="isCollapsed(item.key) ? 'folder' : 'folder-open'"
                            class="tree-folder-icon me-2 flex-shrink-0"
                          />
                          <span class="fw-bold text-truncate" :title="item.name">{{ item.name }}</span>
                        </span>
                        <span class="d-flex gap-2 flex-shrink-0 ms-2">
                          <span
                            role="button"
                            class="tree-add-btn"
                            @click.stop="openNewFileInFolder(item.path)"
                            :title="t('designer.newFile')"
                            ><FaIcon icon="file"
                          /></span>
                          <span
                            role="button"
                            class="tree-del-btn"
                            @click.stop="confirmDeleteFolder(item.path)"
                            :title="t('designer.deleteFolder')"
                            ><FaIcon icon="times"
                          /></span>
                        </span>
                      </div>
                      <template v-else>
                        <div
                          class="d-flex justify-content-between align-items-center py-1 tree-node"
                          :class="{ 'tree-drop-target': dragFormId && dragFormId !== null }"
                          :style="{ paddingLeft: item.depth * 1.25 + 'rem' }"
                          @click="toggleCollapse(item.key)"
                          @contextmenu="openContextMenu($event, { type: 'file', source: item.source, name: item.name })"
                          @dragover="onDragOver"
                          @drop="onDropOnFile(item.source, $event)"
                          role="button"
                        >
                          <span class="d-flex align-items-center min-w-0">
                            <FaIcon
                              :icon="isCollapsed(item.key) ? 'chevron-right' : 'chevron-down'"
                              class="me-1 flex-shrink-0 tree-chevron"
                              size="xs"
                            />
                            <FaIcon icon="file-code" class="text-secondary me-2 flex-shrink-0" />
                            <span class="fw-semibold text-truncate" :title="item.name || t('designer.baseFile')">{{
                              item.name || t('designer.baseFile')
                            }}</span>
                          </span>
                          <span class="d-flex gap-2 flex-shrink-0 ms-2">
                            <span
                              role="button"
                              class="tree-add-btn"
                              @click.stop="addForm(item.source)"
                              :title="t('designer.addForm')"
                            >
                              <FaIcon icon="plus" />
                            </span>
                            <!-- no delete for the base file : it is not a file on disk -->
                            <span
                              v-if="item.source"
                              role="button"
                              class="tree-del-btn"
                              @click.stop="confirmDeleteFile(item.source)"
                              :title="t('designer.deleteFile')"
                            >
                              <FaIcon icon="times" />
                            </span>
                          </span>
                        </div>
                        <template v-if="!isCollapsed(item.key) || treeFilter">
                          <div
                            v-for="n in formnames(item.source).filter(
                              (f) => !treeFilter || (f.name || '').toLowerCase().includes(treeFilter.toLowerCase()),
                            )"
                            :key="n.id"
                            class="d-flex justify-content-between align-items-center py-1 tree-node tree-form"
                            :class="{
                              'tree-active': isCurrentForm(n.id),
                              'tree-dirty': isFormDirty(n.id),
                              'tree-drop-above': dropTargetId === n.id && dragFormId,
                            }"
                            :style="{ paddingLeft: (item.depth + 1) * 1.25 + 'rem' }"
                            role="button"
                            draggable="true"
                            @click="selectForm(n.id)"
                            @contextmenu="openContextMenu($event, { type: 'form', id: n.id, name: n.name })"
                            @dragstart="onDragStart(n.id, $event)"
                            @dragend="
                              dragFormId = null;
                              dropTargetId = null;
                            "
                            @dragover="onFormDragOver(n.id, $event)"
                            @drop="onDropOnForm(n.id, $event)"
                            @dragleave="dropTargetId === n.id && (dropTargetId = null)"
                          >
                            <span class="d-flex align-items-center min-w-0">
                              <FaIcon v-if="n.icon" :icon="n.icon" class="me-2 flex-shrink-0" />
                              <span class="text-truncate" :title="n.name">{{ n.name }}</span>
                            </span>
                            <span role="button" class="tree-del-btn flex-shrink-0 ms-2" @click.stop="deleteForm(n.id)">
                              <FaIcon icon="times" />
                            </span>
                          </div>
                        </template>
                      </template>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style lang="scss" scoped>
.role-header {
  cursor: pointer;
  user-select: none;
}
.role-header:hover {
  background-color: var(--bs-tertiary-bg);
}
.provider-select {
  width: 130px;
  flex-shrink: 0;
}
.role-options {
  margin-top: -0.5rem;
}
.role-options :deep(.mb-3) {
  margin-bottom: -0.5rem !important;
}
.designer-layout {
  display: grid;
  grid-template-columns: 1fr 1rem 25%;
  align-items: start;
}
.designer-layout:not(:has(.designer-tree)) {
  grid-template-columns: 1fr;
}
.designer-editor {
  min-width: 0;
}
.designer-resize {
  cursor: col-resize;
  align-self: stretch;
  // matches the editor column's own top offset, which is the 0.5rem bottom margin
  // of the empty <label> BsInput renders above the ace box - so the handle, the
  // tree and the editor all start on the same line
  margin-top: 0.5rem;
  position: relative;
  &::after {
    content: '';
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 1px;
    background: transparent;
    transition: background 0.15s;
  }
  &:hover::after {
    background: var(--bs-border-color);
  }
}
.designer-tree {
  max-height: 80vh;
  // the panel scrolls its file list, not itself : the header with its buttons (and the
  // search bar) stay in place, and the scrollbar starts below them
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  // see .designer-resize : aligns the panel's top edge with the ace box
  margin-top: 0.5rem;
  // its bottom edge already lines up : the editor's wrapper has no bottom margin here (see
  // the global style block), so the grid row ends where the ace box ends
}
@media (max-width: 991.98px) {
  .designer-layout {
    grid-template-columns: 1fr !important;
  }
  .designer-resize,
  .designer-tree {
    display: none;
  }
}
.file-tree-panel {
  background: var(--bs-tertiary-bg);
  border: 1px solid rgba(var(--bs-emphasis-color-rgb), 0.25);
  border-radius: 0.375rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 100%;
}
.file-tree-header,
.tree-search-bar {
  flex-shrink: 0;
}
.file-tree-header {
  font-size: 0.9rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--bs-secondary-color);
  // 0.5rem on the right, the file list's own padding, so these buttons line up with the
  // buttons of the rows below
  padding: 0.5rem 0.5rem 0.5rem 0.75rem;
  background: var(--bs-card-bg, var(--bs-body-bg));
  border-bottom: 1px solid rgba(var(--bs-emphasis-color-rgb), 0.25);
}
.tree-search-bar {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid rgba(var(--bs-emphasis-color-rgb), 0.25);
}
.file-tree-content {
  padding: 0.25rem 0.5rem;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.tree-add-btn,
.tree-del-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  font-size: 0.9rem;
  border-radius: 0.25rem;
  flex-shrink: 0;
}
.tree-add-btn {
  color: var(--bs-secondary-color);
  border: 1px solid var(--bs-secondary-color);
  &:hover {
    background: var(--bs-secondary-color);
    color: #fff;
  }
}
.tree-del-btn {
  color: var(--bs-danger);
  border: 1px solid var(--bs-danger);
  &:hover {
    background: var(--bs-danger);
    color: #fff;
  }
}
.tree-node {
  border-radius: 0.25rem;
  // no space on the right : the row's buttons sit on its right edge, so the highlight of
  // the selected row ends on the edge of its buttons (the header's buttons line up with them)
  min-width: 0;
}
.tree-drop-above {
  border-top: 2px solid var(--bs-primary);
}
// a file row is a valid drop target while a form is being dragged
.tree-drop-target {
  outline: 1px dashed var(--bs-primary);
  outline-offset: -1px;
}
.tree-node:hover {
  background-color: var(--bs-tertiary-bg);
}
.tree-form:hover {
  background-color: rgba(var(--bs-primary-rgb), 0.3);
}
.tree-active {
  background-color: var(--bs-primary-bg-subtle);
  font-weight: 600;
}
.tree-active:hover {
  background-color: rgba(var(--bs-primary-rgb), 0.35);
}
/* on the selected row the delete button gets a light red fill (the ✕ stays red, white on
   light red would be unreadable), so the row's action stands out from the blue ; hover
   still turns it solid red with a white ✕ */
.tree-active .tree-del-btn:not(:hover) {
  background-color: var(--bs-danger-bg-subtle);
}
.tree-dirty > span > span.text-truncate {
  color: var(--bs-primary);
  font-style: italic;
}
.tree-chevron {
  width: 0.75rem;
  color: var(--bs-secondary-color);
}
// a folder is folder yellow in every theme : it used text-warning, which the themes tone
// down for warning text (nearly black on the light theme, nearly white on the dark one)
.tree-folder-icon {
  color: #f0b429;
}
.diff-view {
  max-height: 60vh;
  overflow: auto;
  font-family: monospace;
  font-size: 0.85rem;
  border: 1px solid var(--bs-border-color);
  border-radius: 0.375rem;
}
.diff-line {
  white-space: pre;
  padding: 0 0.5rem;
  line-height: 1.5;
}
.diff-marker {
  display: inline-block;
  width: 1rem;
  user-select: none;
  color: var(--bs-secondary-color);
}
.diff-added {
  background-color: rgba(40, 167, 69, 0.15);
}
.diff-added .diff-marker {
  color: var(--bs-success);
}
.diff-removed {
  background-color: rgba(220, 53, 69, 0.15);
}
.diff-removed .diff-marker {
  color: var(--bs-danger);
}
.icon-section-header {
  display: flex;
  align-items: center;
  padding: 0.5rem 0;
  margin-bottom: 0.25rem;
  user-select: none;
}
.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
  gap: 0.25rem;
}
.icon-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  padding: 0.85rem 0.25rem 0.5rem;
  border-radius: 0.375rem;
  border: 2px solid transparent;
  cursor: pointer;
}
.icon-cell:hover {
  background-color: var(--bs-tertiary-bg);
}
.icon-selected {
  border-color: var(--bs-primary);
  background-color: var(--bs-primary-bg-subtle);
}
.icon-label {
  font-size: 0.85rem;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  color: var(--bs-secondary-color);
}
.tile-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.5rem;
}
.tile-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem;
  border-radius: 0.375rem;
  border: 2px solid transparent;
  cursor: pointer;
}
.tile-cell:hover {
  border-color: var(--bs-border-color);
}
.tile-selected {
  border-color: var(--bs-primary);
}
.tile-swatch {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 0.375rem;
  border: 1px solid var(--bs-border-color);
}
.tile-label {
  font-size: 0.75rem;
  color: var(--bs-secondary-color);
}
.v-enter-from {
  opacity: 0;
  translate: -100px 0;
}

.v-enter-to {
  opacity: 1;
  translate: 0 0;
}

.v-leave-from {
  opacity: 1;
  translate: 0 0;
}

.v-leave-to {
  opacity: 0;
  translate: 100px 0;
}

// a flex item defaults to min-width:auto, which keeps it from shrinking below
// its content : without this the text-truncate inside never gets to ellipsis and
// a long form/file name overflows the tree column (bootstrap has no such utility)
.min-w-0 {
  min-width: 0;
}
.field-editor-table {
  table-layout: fixed;
}
.field-grip {
  cursor: grab;
}
.field-drag-over td {
  border-top: 2px solid var(--bs-primary);
}
.field-values-panel {
  background: var(--bs-tertiary-bg);
  border: 1px solid var(--bs-border-color);
}
.warning-entry {
  border-radius: 0.25rem;
  padding: 0.25rem 0.5rem;
  margin-left: -0.5rem;
}
.warning-entry:hover {
  background-color: var(--bs-tertiary-bg);
}
</style>
<style>
/* The editors fill whatever height the viewport leaves over instead of a
   hard-coded 75vh, so they end at the card and the card ends just short of the
   bottom of the screen. `af-fill-page` (bootstrap-override.scss) already turns
   the chain from this page's wrapper down to the AppSettings card body into a
   flex column; these rules continue it through the designer's own wrappers and
   into BsInput/AceEditor, which is why they live in the global block - a scoped
   rule cannot reach another component's DOM.
   The `:has(.ace_editor)` selector is what keeps it robust: it matches exactly
   the wrappers that lead to the visible editor, so the empty divs the Forms
   v-for renders for every non-selected form claim no space (giving all of them
   flex-grow would split the height between them). */
/* af-fill-page sizes the card body but leaves it a block container (on /logs it
   is just the scroll pane), so its child would not stretch - make it a column
   here, otherwise every flex rule below it is ignored and the editor collapses
   back to its content height. */
.designer-page > main > .section > .container-fluid > .card > .card-body,
.designer-page > main > .section > .container-fluid > .card > .card-body > div,
.designer-page .designer-editor,
.designer-page .designer-editor div:has(.ace_editor) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
/* the grid is a flex item here, and its columns must be full height (default
   `align-items: start` would collapse them back to content height) */
.designer-page .designer-layout {
  flex: 1 1 auto;
  min-height: 0;
  align-items: stretch;
}
/* the editor's BsInput wrapper keeps no bottom margin : the card body's own padding is
   the gap under the editor, the same as the card's side padding */
.designer-page .card-body .mb-3:has(.ace_editor) {
  margin-bottom: 0 !important;
}
/* breathing room between the bottom of the card and the bottom of the screen ;
   flexbox subtracts item margins before handing out the free space, so the card
   shrinks by this much rather than overflowing */
.designer-page > main > .section > .container-fluid > .card {
  margin-bottom: 1rem;
}
.ctx-menu {
  position: fixed;
  z-index: 1060;
  min-width: 10rem;
  background: var(--bs-body-bg);
  border: 1px solid var(--bs-border-color);
  border-radius: 0.375rem;
  box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.15);
  padding: 0.25rem 0;
}
.ctx-item {
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
  white-space: nowrap;
}
.ctx-item:hover {
  background-color: var(--bs-tertiary-bg);
}
.ctx-item-disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}
.ctx-divider {
  margin: 0.25rem 0;
  border-color: var(--bs-secondary-color);
  opacity: 0.5;
}
.ctx-item-danger {
  color: var(--bs-danger);
}
.ctx-item-danger:hover {
  background-color: var(--bs-danger-bg-subtle);
}
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1059;
}
/* the designer toolbar only : keep the pointer events so a disabled button still
   shows its title (why it is disabled). Never widen this beyond .designer-toolbar,
   bootstrap relies on pointer-events:none as the activation guard of .btn.disabled */
.designer-toolbar > .btn:disabled,
.designer-toolbar > .btn.disabled {
  pointer-events: auto;
  cursor: not-allowed;
}
</style>
<route lang="yaml">
meta:
  layout: standard
</route>
