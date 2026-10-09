<script setup>
/**
 * BsDataTable — selectable, filterable, paginated data table
 *
 * Props
 * ─────
 *  items          Array   Full dataset
 *  columns        Array   [{ key, label, filterable?, sortable?, render?(val,row)→string,
 *                           sortValue?(row)→number|string,
 *                           filterType?: 'number' | 'boolean' | 'gt0',
 *                           align?: 'end' (numbers : header, filter and cells to the right),
 *                           width?: a CSS width for the column (the rest share what is left),
 *                           hideBelow?: a width in px - the column is left out while the table
 *                             is narrower, so the wide ones keep room on a small screen }]
 *  pageSize       Number  Initial page size (default 25) — a page size the user
 *                         picked before (cookie, needs `name`) wins over it
 *  name           String  Cookie key for pagination and column persistence ; also
 *                         enables column presets (kept in this browser's localStorage)
 *  exportName     String  Base filename for the CSV export (omit to hide the button)
 *  (rowClickSelects false : a click opens the row, its dialog or its page ; its name column
 *   (linkColumn, else the first shown) is in the link blue, so the row says it opens)
 *  linkColumn     String  that column's key ; hidden, no column is blue
 *  rowSelectable  Function (row) → whether a row can be ticked (default : all) ; the others
 *                         get a greyed out checkbox, Select all and a range leave them out
 *  initialFilter  String  Initial text of the global search
 *  selectedIds    Set     Parent-owned Set of selected item ids (v-model:selectedIds)
 *  idKey          String  Field used as row id (default 'id')
 *  rowClickSelects Boolean A plain click on a row selects it (default) ; false leaves the
 *                         selection to the checkboxes and only emits row-click
 *  pagerTo        String  A selector the pager (the rows shown, the page boxes) moves to :
 *                         under the page's card (AppSettings' footer), as every table has it
 *  toolbarTo      String  A selector the toolbar (search, columns, export) moves to, such as
 *                         the page's title line, as the Forms page has its search there
 *  framed         Boolean The table in a bordered box : a grey header bar with small
 *                         uppercase labels, figures in tabular digits (the inventory pages)
 *
 * Emits
 * ─────
 *  update:selectedIds   Set   When selection changes
 *  row-click            item  When a row is single-clicked (after selection logic)

 */

import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import Helpers from '@/lib/Helpers';
import BsPagination from './BsPagination.vue';
import BsSearch from './BsSearch.vue';
import BsColumnPicker from './BsColumnPicker.vue';
import { parseNumberFilter, csvCell, htmlToText } from '@/lib/dataTable';

const { t } = useI18n();

const props = defineProps({
  items: { type: Array, required: true },
  columns: { type: Array, required: true },
  pageSize: { type: Number, default: 25 },
  name: { type: String, default: null },
  selectedIds: { type: Object, default: () => new Set() }, // Set
  idKey: { type: String, default: 'id' },
  selectable: { type: Boolean, default: true },
  rowSelectable: { type: Function, default: null },
  // the column shown in the link blue when a click opens the row (its name) ; hidden, none is
  linkColumn: { type: String, default: null },
  activeId: { type: [String, Number], default: null },
  exportName: { type: String, default: null },
  initialFilter: { type: String, default: '' },
  // with selectable : a plain click on a row selects it ; false keeps the selection to the
  // checkboxes and a click on a row only says so (row-click), as on a list that opens a row
  rowClickSelects: { type: Boolean, default: true },
  framed: { type: Boolean, default: false },
  toolbarTo: { type: String, default: null },
  pagerTo: { type: String, default: null },
});

const emit = defineEmits(['update:selectedIds', 'row-click']);

// ─── rows that cannot be ticked ───────────────────────────────────────────────
// rowSelectable(row) says which rows can be ticked (the roles the config must keep cannot) :
// their checkbox is greyed out, and every selection sent leaves them out, however it was made
// (a click, a range, Select all)
// the column in the link blue : the one named (linkColumn), else the first shown
const isLinkColumn = (col, index) => (props.linkColumn ? col.key === props.linkColumn : index === 0);

const canSelect = (item) => !props.rowSelectable || props.rowSelectable(item);

/**
 * Sends a selection, without the rows that cannot be ticked.
 *
 * Args:
 *   ids (Set): the ids selected.
 */
function emitSelection(ids) {
  if (!props.rowSelectable) return emit('update:selectedIds', ids);
  const blocked = new Set(props.items.filter((i) => !canSelect(i)).map((i) => i[props.idKey]));
  emit('update:selectedIds', new Set([...ids].filter((id) => !blocked.has(id))));
}

// ─── Column visibility ───────────────────────────────────────────────────────
const hiddenColumns = ref(new Set());

// the table's width, followed as it changes : a column with `hideBelow` is left out while the
// table is narrower (the column picker's choices stay as they are)
const tableBox = ref(null);
const tableWidth = ref(Infinity);
let tableObserver = null;
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !tableBox.value) return;
  tableObserver = new ResizeObserver(([entry]) => {
    tableWidth.value = entry.contentRect.width;
  });
  tableObserver.observe(tableBox.value);
});
onBeforeUnmount(() => tableObserver?.disconnect());

const visibleColumns = computed(() =>
  props.columns.filter((c) => !hiddenColumns.value.has(c.key) && !(c.hideBelow && tableWidth.value < c.hideBelow)),
);

function toggleColumn(key) {
  const s = new Set(hiddenColumns.value);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  hiddenColumns.value = s;
  dropFiltersOfHidden(s);
  if (props.name) persistHiddenColumns(s);
}

// Drop the filter of every hidden column. The filter inputs are rendered only for VISIBLE
// columns while filteredItems applies every entry in columnFilters, so hiding a column you
// had filtered left the table filtered by an input that no longer existed - with the row
// count and "Select all" still reduced and no control to clear it. Column visibility is
// persisted in a cookie and the filters are not, so a reload silently changed the row
// count too.
function dropFiltersOfHidden(hiddenSet) {
  const stale = Object.keys(columnFilters.value).filter((k) => hiddenSet.has(k) && columnFilters.value[k]);
  if (!stale.length) return;
  const next = { ...columnFilters.value };
  stale.forEach((k) => delete next[k]);
  columnFilters.value = next;
}

// Stored as { hidden, known } : `known` is every column key that existed when the choice
// was saved. Without it a column added to the config later (a new defaultHidden field)
// looks the same as one the user deliberately showed - both are simply "not hidden" - and
// would come up visible instead of honouring its own defaultHidden. A legacy cookie (a bare
// array, no `known`) is read as it is, without hiding anything retroactively.
function persistHiddenColumns(hiddenSet) {
  const payload = { hidden: [...hiddenSet], known: props.columns.map((c) => c.key) };
  Helpers.setCookie(`dt_cols_${props.name}`, JSON.stringify(payload), 365);
}

// ─── Column presets (BsColumnPicker keeps them ; a chosen one lands here) ─────────
function applyPreset(s) {
  hiddenColumns.value = s;
  dropFiltersOfHidden(s);
  if (props.name) persistHiddenColumns(s);
}

// Restore column visibility from cookie
onMounted(() => {
  if (props.name) {
    const saved = Helpers.getCookie(`dt_cols_${props.name}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const hidden = new Set(Array.isArray(parsed) ? parsed : parsed.hidden || []);
        // a current column that is not in `known` did not exist when this was saved :
        // it gets its own default rather than "visible because it is not in the list"
        if (!Array.isArray(parsed) && Array.isArray(parsed.known)) {
          const known = new Set(parsed.known);
          props.columns.filter((c) => c.defaultHidden && !known.has(c.key)).forEach((c) => hidden.add(c.key));
        }
        hiddenColumns.value = hidden;
        return;
      } catch (e) {
        /* ignore */
      }
    }
  }
  // First-visit defaults:
  //  - columns marked `defaultHidden` are hidden out of the box but remain
  //    available in the column picker so the user can opt them in.
  //  - on narrow viewports, additionally hide `mobileHidden` columns.
  const initial = new Set(props.columns.filter((c) => c.defaultHidden).map((c) => c.key));
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767.98px)').matches) {
    props.columns.filter((c) => c.mobileHidden).forEach((c) => initial.add(c.key));
  }
  if (initial.size) hiddenColumns.value = initial;
});

// ─── Filter state (one per column + optional global) ─────────────────────────
const globalFilter = ref(props.initialFilter || '');
const columnFilters = ref({});

const filterableColumns = computed(() => visibleColumns.value.filter((c) => c.filterable));

// ─── Sort state ───────────────────────────────────────────────────────────────
const sortKey = ref(null);
const sortDir = ref(1); // 1 asc, -1 desc

function toggleSort(key) {
  if (sortKey.value === key) {
    sortDir.value = -sortDir.value;
  } else {
    sortKey.value = key;
    sortDir.value = 1;
  }
}

// ─── Filtered + sorted full list ─────────────────────────────────────────────
const filteredItems = computed(() => {
  let list = props.items;

  if (globalFilter.value.trim()) {
    const q = globalFilter.value.trim().toLowerCase();
    list = list.filter((item) =>
      props.columns.some((col) => {
        const v = cellText(item, col);
        return v.toLowerCase().includes(q);
      }),
    );
  }

  for (const [key, val] of Object.entries(columnFilters.value)) {
    if (val == null || val === '') continue;
    const col = props.columns.find((c) => c.key === key);
    if (!col) continue;
    if (col.filterType === 'boolean') {
      const want = val === 'yes';
      list = list.filter((item) => Boolean(item[col.key]) === want);
    } else if (col.filterType === 'gt0') {
      list = list.filter((item) => Number(item[col.key]) > 0);
    } else if (col.filterType === 'number' && parseNumberFilter(val)) {
      const test = parseNumberFilter(val);
      list = list.filter((item) => test(Number(item[col.key])));
    } else if (String(val).trim()) {
      const q = String(val).trim().toLowerCase();
      list = list.filter((item) => cellText(item, col).toLowerCase().includes(q));
    }
  }

  if (sortKey.value) {
    const key = sortKey.value;
    const col = props.columns.find((c) => c.key === key);
    const dir = sortDir.value;
    // numerically when both raw values are numbers - a text compare puts "10" before
    // "2" ; a column can bring sortValue(row) when its rendered text does not sort (dates)
    list = [...list].sort((a, b) => {
      const ra = col.sortValue ? col.sortValue(a) : a[col.key];
      const rb = col.sortValue ? col.sortValue(b) : b[col.key];
      if (typeof ra === 'number' && typeof rb === 'number') return (ra - rb) * dir;
      const ta = cellText(a, col).toLowerCase();
      const tb = cellText(b, col).toLowerCase();
      return ta < tb ? -dir : ta > tb ? dir : 0;
    });
  }

  return list;
});

// ─── Pagination ───────────────────────────────────────────────────────────────
const pageItems = ref([]);
// the toolbar buttons : the page's own buttons (BsButton : outline primary, normal size) in
// the framed bar, small and grey otherwise
const toolButton = computed(() => (props.framed ? 'btn-outline-primary' : 'btn-sm btn-outline-secondary'));
// the rows of the page among the filtered ones, for the pager : 1-25 of 140
const pageRange = computed(() => {
  const total = filteredItems.value.length;
  if (!total || !pageItems.value.length) return t('dataTable.rangeOf', { from: 0, to: 0, total });
  const from = (pagerState.value.page - 1) * pagerState.value.pageSize + 1;
  return t('dataTable.rangeOf', { from, to: from + pageItems.value.length - 1, total });
});

// where the pager is (page, page size), for the pager's range
const pagerState = ref({ page: 1, pageSize: props.pageSize });
function onPageChange(slice, state) {
  pageItems.value = slice;
  if (state) pagerState.value = state;
}

// When a FILTER changes, reset to first page by re-keying the paginator.
//
// This used to watch filteredItems, which returns props.items by identity when nothing is
// filtered - so replacing the parent array counted as "the filter changed". AppAdminMulti
// reloads every 60 seconds and does it in two steps (itemList = [], then the new array),
// so on Users, Credentials or Repositories the paginator was remounted twice a minute and
// the reader was thrown back to page 1 mid-read, on a timer, with no way to stop it.
// Sorting deliberately does not re-key either: the rows move, the page number still means
// something, and BsPagination's own watcher clamps it if the list shrank.
const filterVersion = ref(0);
watch(
  [globalFilter, columnFilters],
  () => {
    filterVersion.value++;
    anchorIndex = null;
  },
  { deep: true },
);
// a data replacement still invalidates the shift-select anchor - the row it pointed at
// may not be there any more - but it must not move the user's page
watch(filteredItems, () => {
  anchorIndex = null;
});

// ─── Cell rendering ───────────────────────────────────────────────────────────
// `cellText` returns RAW plain text — used for filtering, sorting, and export.
// `cellHtml` returns HTML for v-html — escapes raw values; render() output is
// trusted (it's developer-supplied JS in the column config, e.g. statusBadge).
function cellText(item, col) {
  if (!col) return '';
  const raw = item[col.key];
  if (col.render) {
    // render() may return HTML; for filtering/sorting strip tags to plain text.
    return htmlToText(col.render(raw, item));
  }
  if (raw == null) return '';
  return String(raw);
}

function cellHtml(item, col) {
  if (!col) return '';
  const raw = item[col.key];
  if (col.render) return String(col.render(raw, item) ?? '');
  if (raw == null) return '';
  return String(raw).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c],
  );
}

// Plain (unescaped, no HTML) cell value — used for tooltip on truncated cells.
function cellPlain(item, col) {
  if (!col) return '';
  const raw = item[col.key];
  if (col.render) {
    // Strip any HTML tags the renderer produced.
    return htmlToText(col.render(raw, item));
  }
  if (raw == null) return '';
  return String(raw);
}

// ─── Selection ────────────────────────────────────────────────────────────────
// filteredItems.indexOf(item) fails with Vue 3 Proxy wrapping — two proxies of
// the same object are not === equal. Use id-based lookup instead.
function filteredIndexOf(item) {
  const id = item[props.idKey];
  return filteredItems.value.findIndex((r) => r[props.idKey] === id);
}

let anchorIndex = null;

function onRowClick(event, item) {
  if (dragJustDone) {
    dragJustDone = false;
    return;
  }

  // Clicks inside the row-actions cell (3-dot menu) must not toggle row
  // selection. We do not use @click.stop on the cell because that would also
  // prevent the document-level click handler used by Bootstrap dropdowns from
  // firing — which lets two dropdowns stay open at once.
  if (event.target.closest && event.target.closest('.bs-dt-row-actions')) return;

  if (!props.selectable || !props.rowClickSelects) {
    emit('row-click', item);
    return;
  }

  const index = filteredIndexOf(item);
  if (index === -1) return;

  const id = item[props.idKey];
  const newSet = new Set(props.selectedIds);

  if (event.shiftKey && anchorIndex !== null) {
    const from = Math.min(anchorIndex, index);
    const to = Math.max(anchorIndex, index);
    if (event.ctrlKey || event.metaKey) {
      // Ctrl+Shift → toggle the range: add if clicked row is not selected, remove if it is
      const addRange = !props.selectedIds.has(id);
      for (let i = from; i <= to; i++) {
        const row = filteredItems.value[i];
        if (!row) continue;
        if (addRange) newSet.add(row[props.idKey]);
        else newSet.delete(row[props.idKey]);
      }
    } else {
      // Shift → replace entire selection with the range
      newSet.clear();
      for (let i = from; i <= to; i++) {
        const row = filteredItems.value[i];
        if (row) newSet.add(row[props.idKey]);
      }
    }
    // anchor does NOT move on shift-click
  } else if (event.ctrlKey || event.metaKey) {
    // Ctrl → toggle single row; anchor moves
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    anchorIndex = index;
  } else {
    // Plain → single select (click same row again = deselect)
    if (newSet.size === 1 && newSet.has(id)) newSet.clear();
    else {
      newSet.clear();
      newSet.add(id);
    }
    anchorIndex = index;
  }

  emitSelection(newSet);
  emit('row-click', item);
}

// ─── Drag-select ──────────────────────────────────────────────────────────────
// Drag becomes active only once the mouse enters a DIFFERENT row, so plain
// clicks and shift/ctrl-clicks are never intercepted.
const isDragging = ref(false);
let dragStart = null; // filteredItems index where mousedown fired
let dragAddMode = true;
let dragJustDone = false; // suppress the click event that follows drag-mouseup

function onRowMousedown(event, item) {
  if (event.button !== 0 || !props.rowClickSelects) return;
  const index = filteredIndexOf(item);
  if (index === -1) return;
  dragStart = index;
  dragAddMode = !props.selectedIds.has(item[props.idKey]);
}

function onRowMouseenter(item) {
  if (dragStart === null) return;
  const index = filteredIndexOf(item);
  if (index === -1 || index === dragStart) return;
  isDragging.value = true;
  applyDragSelection(index);
}

function onTableMouseup() {
  if (isDragging.value) {
    isDragging.value = false;
    dragJustDone = true;
  }
  dragStart = null;
}

function applyDragSelection(endIndex) {
  if (dragStart === null) return;
  const from = Math.min(dragStart, endIndex);
  const to = Math.max(dragStart, endIndex);
  const newSet = new Set(props.selectedIds);
  for (let i = from; i <= to; i++) {
    const id = filteredItems.value[i]?.[props.idKey];
    if (id == null) continue;
    if (dragAddMode) newSet.add(id);
    else newSet.delete(id);
  }
  emitSelection(newSet);
}

// the rows of the page, and of the filter, that can be ticked
const selectablePage = computed(() => pageItems.value.filter(canSelect));
const selectableFiltered = computed(() => filteredItems.value.filter(canSelect));
const allOnPageSelected = computed(() => {
  if (!selectablePage.value.length) return false;
  return selectablePage.value.every((item) => props.selectedIds.has(item[props.idKey]));
});

function toggleSelectAll() {
  const newSet = new Set(props.selectedIds);
  if (allOnPageSelected.value) {
    selectablePage.value.forEach((item) => newSet.delete(item[props.idKey]));
  } else {
    selectablePage.value.forEach((item) => newSet.add(item[props.idKey]));
  }
  emitSelection(newSet);
}

function selectAll() {
  emitSelection(new Set(selectableFiltered.value.map((i) => i[props.idKey])));
}

function clearSelection() {
  emitSelection(new Set());
}

// ─── CSV export ───────────────────────────────────────────────────────────────
// The filtered rows, every column, as the plain text the table shows. CSV rather than
// .xlsx : no library, and Excel opens it. The BOM makes Excel read it as UTF-8.
// a spacer column (`spacer: true`) only takes up the width left : no data, not exported and
// not in the Columns menu
const dataColumns = computed(() => props.columns.filter((c) => !c.spacer));

function exportCsv() {
  const lines = [dataColumns.value.map((c) => csvCell(c.label)).join(',')];
  for (const item of filteredItems.value) {
    lines.push(dataColumns.value.map((col) => csvCell(cellPlain(item, col))).join(','));
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (props.exportName || 'export') + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div class="bs-data-table" :class="{ 'af-table-frame': framed }">
    <!-- Toolbar : on the page's title line with toolbarTo, else the frame's top bar when framed -->
    <Teleport defer :to="toolbarTo || 'body'" :disabled="!toolbarTo">
      <!-- on the title line (toolbarTo) : right aligned, the search narrowing first, and the
           buttons wrapping onto another row only when even that does not make room -->
      <div
        class="d-flex align-items-center gap-2"
        :class="toolbarTo ? 'bs-dt-toolbar-moved flex-wrap' : framed ? 'bs-dt-toolbar flex-wrap' : 'mb-2 flex-wrap'"
      >
        <!-- Global search -->
        <!-- framed : the search of the Forms page (grey icon box, clear button) -->
        <BsSearch v-if="framed" v-model="globalFilter" class="af-table-search" :placeholder="t('common.filter')" />
        <input
          v-else
          v-model="globalFilter"
          type="search"
          class="form-control form-control-sm"
          style="max-width: 220px"
          :placeholder="t('common.search')"
        />

        <!-- Selection info + bulk helpers -->
        <span v-if="selectable && selectedIds.size" class="text-muted small">
          {{ selectedIds.size }} {{ t('dataTable.selected') }}
        </span>
        <!-- the selection's buttons in the style of the toolbar's others (Columns, Export CSV) -->
        <button v-if="selectable && selectedIds.size" class="btn" :class="toolButton" @click="clearSelection">
          <font-awesome-icon icon="xmark" class="me-1" />{{ t('dataTable.clearSelection') }}
        </button>
        <button
          v-if="selectable && selectedIds.size < selectableFiltered.length"
          class="btn"
          :class="toolButton"
          @click="selectAll"
        >
          <font-awesome-icon icon="check-double" class="me-1" />{{
            t('dataTable.selectAll', { count: selectableFiltered.length })
          }}
        </button>

        <!-- Bulk actions slot -->
        <slot v-if="selectable" name="bulk-actions" :selectedIds="selectedIds" :count="selectedIds.size" />

        <div class="ms-auto d-flex align-items-center gap-2">
          <!-- Column picker, with presets -->
          <BsColumnPicker
            :columns="dataColumns"
            :hidden="hiddenColumns"
            :name="name"
            :buttonClass="toolButton"
            @toggle="toggleColumn"
            @apply="applyPreset"
          />

          <!-- CSV export -->
          <button v-if="exportName" class="btn" :class="toolButton" @click="exportCsv">
            <font-awesome-icon icon="file-csv" class="me-1" />{{ t('dataTable.export') }}
          </button>
        </div>
      </div>
    </Teleport>

    <!-- Table -->
    <div ref="tableBox" class="table-responsive" style="overflow: visible">
      <table
        :class="{ 'af-table': framed }"
        class="table table-sm table-hover mb-0 bs-dt-table"
        @mouseleave="onTableMouseup"
        @mouseup="onTableMouseup"
      >
        <thead>
          <!-- Column headers -->
          <tr>
            <!-- Select-all checkbox -->
            <th v-if="selectable" class="text-center bs-dt-select">
              <input
                type="checkbox"
                class="form-check-input"
                :checked="allOnPageSelected"
                :indeterminate="selectedIds.size > 0 && !allOnPageSelected"
                @change="toggleSelectAll"
              />
            </th>
            <th
              v-for="col in visibleColumns"
              :key="col.key"
              :class="{ 'bs-dt-sortable': col.sortable, 'text-end': col.align === 'end' }"
              @click="col.sortable ? toggleSort(col.key) : undefined"
              :style="{ userSelect: 'none', whiteSpace: 'nowrap', width: col.width || null }"
            >
              {{ col.label }}
              <span v-if="col.sortable" class="text-muted ms-1" style="font-size: 0.7em">
                <template v-if="sortKey === col.key">
                  <font-awesome-icon :icon="sortDir === 1 ? 'sort-up' : 'sort-down'" />
                </template>
                <template v-else>
                  <font-awesome-icon icon="sort" class="opacity-25" />
                </template>
              </span>
            </th>
            <!-- Row actions header -->
            <th v-if="$slots['row-actions']" style="width: 3.5rem"></th>
          </tr>
          <!-- Per-column filter row -->
          <tr v-if="filterableColumns.length" class="bs-dt-filter-row">
            <th v-if="selectable" class="bs-dt-select"></th>
            <th v-for="col in visibleColumns" :key="'f-' + col.key" :class="{ 'text-end': col.align === 'end' }">
              <select
                v-if="col.filterable && col.filterType === 'boolean'"
                v-model="columnFilters[col.key]"
                class="form-select form-select-sm"
                @click.stop
              >
                <option value="">{{ t('dataTable.filterAll') }}</option>
                <option value="yes">{{ t('common.yes') }}</option>
                <option value="no">{{ t('common.no') }}</option>
              </select>
              <select
                v-else-if="col.filterable && col.filterType === 'gt0'"
                v-model="columnFilters[col.key]"
                class="form-select form-select-sm"
                @click.stop
              >
                <option value="">{{ t('dataTable.filterAll') }}</option>
                <option value="gt0">{{ t('dataTable.filterGt0') }}</option>
              </select>
              <input
                v-else-if="col.filterable"
                v-model="columnFilters[col.key]"
                type="search"
                class="form-control form-control-sm"
                :placeholder="col.filterType === 'number' ? t('dataTable.filterNumberHint') : col.label"
                :title="col.filterType === 'number' ? t('dataTable.filterNumberHelp') : null"
                @click.stop
              />
            </th>
            <th v-if="$slots['row-actions']"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in pageItems"
            :key="item[idKey]"
            :class="{ 'bs-dt-selected': selectedIds.has(item[idKey]) || item[idKey] === activeId }"
            class="bs-dt-row"
            @click="onRowClick($event, item)"
            @mousedown="onRowMousedown($event, item)"
            @mouseenter="onRowMouseenter(item)"
          >
            <td v-if="selectable" class="text-center bs-dt-select" @click.stop>
              <input
                type="checkbox"
                class="form-check-input"
                :checked="selectedIds.has(item[idKey])"
                :disabled="!canSelect(item)"
                @change.stop="
                  () => {
                    const s = new Set(selectedIds);
                    if (s.has(item[idKey])) s.delete(item[idKey]);
                    else s.add(item[idKey]);
                    emitSelection(s);
                  }
                "
              />
            </td>
            <td
              v-for="(col, cIdx) in visibleColumns"
              :key="col.key"
              :class="{ 'text-end': col.align === 'end', 'af-row-open': !rowClickSelects && isLinkColumn(col, cIdx) }"
              :title="col.type !== 'checkbox' ? cellPlain(item, col) : null"
            >
              <template v-if="col.type === 'checkbox'">
                <font-awesome-icon v-if="item[col.key]" icon="check" class="text-success" />
              </template>
              <span v-else v-html="cellHtml(item, col)" />
            </td>
            <td v-if="$slots['row-actions']" class="bs-dt-row-actions">
              <slot name="row-actions" :item="item" />
            </td>
          </tr>
          <tr v-if="!pageItems.length">
            <td
              :colspan="visibleColumns.length + (selectable ? 1 : 0) + ($slots['row-actions'] ? 1 : 0)"
              class="text-center text-muted py-3"
            >
              {{ t('common.noData') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- The pager : the rows shown on the left, the page size and boxes on the right ; under
         the page's card with pagerTo (styles/tables.scss, .af-table-pager), else under the table -->
    <Teleport defer :to="pagerTo || 'body'" :disabled="!pagerTo">
      <div class="af-table-pager" :class="{ 'af-table-pager-inline': !pagerTo }">
        <span class="af-table-count">{{ pageRange }}</span>
        <BsPagination
          :key="filterVersion"
          :dataList="filteredItems"
          :perPage="pageSize"
          :buttonsShown="7"
          :name="name"
          @change="onPageChange"
        />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* the selection column : as wide as a checkbox and the cell's padding (framed tables give
   their first cell more, styles/tables.scss). Never cut with an ellipsis like the other
   cells : the space after the checkbox alone overflowed it and drew a … beside the box */
.bs-dt-select {
  width: 2rem;
}
.bs-dt-table tbody td.bs-dt-select.bs-dt-select,
.bs-dt-table thead th.bs-dt-select.bs-dt-select {
  /* the class twice : the rule that cuts every cell (below) is as specific otherwise, and
     comes later, so it won in the rows */
  overflow: visible;
  text-overflow: clip;
}
.bs-dt-toolbar {
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--bs-border-color);
}
/* framed (styles/tables.scss) : the fixed layout's cells keep the shared padding */
.af-table td,
.af-table th {
  padding-left: 0.9rem;
  padding-right: 0.9rem;
}
.af-table th:first-child,
.af-table td:first-child {
  padding-left: 1.25rem;
}
/* (.bs-dt-table too : above the plain table's filter row rule below) */
.af-table.bs-dt-table thead tr.bs-dt-filter-row th {
  padding: 0.35rem 0.9rem;
  background: var(--bs-body-bg);
}
.af-table.bs-dt-table thead tr.bs-dt-filter-row th:first-child {
  padding-left: 1.25rem;
}
/* a right-aligned number sits against the next column's left-aligned text : keep them apart,
   on both sides of the gap ; the last column keeps the same room on its right */
th.text-end:has(+ th:not(.text-end)),
td.text-end:has(+ td:not(.text-end)),
th.text-end:last-child,
td.text-end:last-child {
  padding-right: 1.5rem;
}
.text-end + th:not(.text-end),
.text-end + td:not(.text-end) {
  padding-left: 1.5rem;
}
.bs-dt-sortable {
  cursor: pointer;
}
.bs-dt-sortable:hover {
  background: var(--bs-tertiary-bg);
}
.bs-dt-table {
  /* Slightly more breathing room than table-sm provides. */
  --bs-table-cell-padding-y: 0.45rem;
  --bs-table-cell-padding-x: 0.65rem;
  /* Fixed layout so columns share the container width and never push the
     table beyond the viewport. Combined with the ellipsis rules below this
     truncates any over-long content. */
  table-layout: fixed;
  width: 100%;
}
.bs-dt-table td,
.bs-dt-table th {
  vertical-align: middle;
  border-color: var(--bs-border-color-translucent);
}
/* Truncate any over-long cell/header content with ellipsis. The full value is
   shown in the cell's `title` tooltip. Skip the row-actions column so the
   3-dot dropdown trigger isn't clipped. */
.bs-dt-table tbody td:not(.bs-dt-row-actions),
.bs-dt-table thead th {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bs-dt-table tbody td:not(.bs-dt-row-actions) > span {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
/* Header row: bottom border only, no vertical separators between columns. */
.bs-dt-table thead th {
  border-top: 0;
  border-left: 0;
  border-right: 0;
  border-bottom: 1px solid var(--bs-border-color);
  background: transparent;
  font-weight: 600;
  text-transform: none;
}
/* Filter row: tighter, subtle background, no borders — the inputs themselves
   provide the visual structure. */
.bs-dt-table thead tr.bs-dt-filter-row th {
  border-bottom: 1px solid var(--bs-border-color-translucent);
  background: var(--bs-tertiary-bg);
  /* Align input visually with body-cell text: shave ~2px off the left/right
     so the input border sits flush with the column's text gutter. */
  padding: 0.25rem 0.2rem;
}
.bs-dt-table thead tr.bs-dt-filter-row .form-control-sm {
  font-size: 0.8rem;
  padding: 0.15rem 0.4rem;
  background: var(--bs-body-bg);
  border-color: var(--bs-border-color-translucent);
}
/* Body rows: horizontal separators only, no vertical column lines. */
.bs-dt-table tbody td {
  border-left: 0;
  border-right: 0;
  border-top: 0;
  border-bottom: 1px solid var(--bs-border-color-translucent);
}
.bs-dt-row {
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}

/* Selected / active row — dark bg + light fg in both light and dark modes.
   Uses Bootstrap CSS vars so it follows the theme but stays high-contrast. */
.bs-dt-table tbody tr.bs-dt-selected > td {
  --bs-table-bg: var(--bs-secondary-bg);
  --bs-table-color: var(--bs-body-color);
  background-color: var(--bs-secondary-bg);
  color: var(--bs-body-color);
}
[data-bs-theme='dark'] .bs-dt-table tbody tr.bs-dt-selected > td {
  --bs-table-bg: #2b3035;
  --bs-table-color: #f8f9fa;
  background-color: #2b3035;
  color: #f8f9fa;
}
.bs-dt-table tbody tr.bs-dt-selected > td a,
.bs-dt-table tbody tr.bs-dt-selected > td .text-muted {
  color: inherit !important;
}
.bs-dt-table tbody tr.bs-dt-selected > td :deep(a),
.bs-dt-table tbody tr.bs-dt-selected > td :deep(.text-muted) {
  color: inherit !important;
}

/* Dropdown menus rendered from row-actions slot: scoped styles must use :deep
   to reach slotted content authored in the parent component. */
:deep(.dropdown-menu .dropdown-item:hover),
:deep(.dropdown-menu .dropdown-item:focus) {
  background-color: var(--bs-tertiary-bg);
  color: var(--bs-body-color);
}
[data-bs-theme='dark'] :deep(.dropdown-menu .dropdown-item:hover),
[data-bs-theme='dark'] :deep(.dropdown-menu .dropdown-item:focus) {
  background-color: #495057;
  color: #f8f9fa;
}
:deep(.dropdown-menu .dropdown-item.disabled),
:deep(.dropdown-menu .dropdown-item:disabled) {
  opacity: 0.5;
  pointer-events: none;
  background-color: transparent !important;
}
</style>
