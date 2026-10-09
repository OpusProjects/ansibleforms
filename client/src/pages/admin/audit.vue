<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { toast } from 'vue-sonner';
import axios from 'axios';
import TokenStorage from '@/lib/TokenStorage';
import Profile from '@/lib/Profile';
import Helpers from '@/lib/Helpers.js';
import { PILL } from '@/lib/tableCells';

const { t, te } = useI18n();

const authenticated = ref(false);
const loading = ref(false);
const records = ref([]);
const total = ref(0);
const offset = ref(0);
// seeded to match BsPagination's :perPage below, so its first emit is a no-op rather
// than an immediate refetch at a different size
const pageSize = ref(25);
// the (offset:limit) we last ASKED the server for. Comparing against what has already
// arrived is not enough : the pager can emit twice before the first response lands,
// and both emits would then pass the guard and fire duplicate requests.
const lastRequest = ref('');
const expanded = ref({});
const facets = ref({ actions: [], actors: [] });
// a failed load must not read as 'nothing has ever been recorded'
const loadFailed = ref(false);
// bumped to remount BsPagination so a filter change really does go back to page 1
const filterVersion = ref(0);

// filters : these decide WHAT the card shows, so they live in the header slot -
// the action buttons stay under the card (see AppSettings)
const filterActor = ref('');
const filterAction = ref('');
const filterOutcome = ref('');

// Null-prototype maps with explicit fallbacks. A plain object literal resolves
// `constructor` and `__proto__` to inherited members, which are truthy - so a row with
// outcome 'constructor' handed a function to t() and blanked the entire table. And an
// unrecognised outcome must never be DISPLAYED AS SUCCESS in an audit trail.
// the outcome as a pill of the shared tables (styles/tables.scss, lib/tableCells.js)
const outcomeBadge = Object.assign(Object.create(null), {
  success: PILL.green,
  failure: PILL.red,
  denied: PILL.amber,
});
const outcomeLabelKey = Object.assign(Object.create(null), {
  success: 'audit.outcomeSuccess',
  failure: 'audit.outcomeFailure',
  denied: 'audit.outcomeDenied',
});
// Actions are stored as machine strings ('settings.config.update') because that is what
// the filter matches on and what a support conversation quotes. This turns them into a
// sentence for reading. Every action the routes can produce has an entry ; anything that
// does not - a route added later - falls back to the raw string rather than a blank cell,
// which is also the only place the machine name is still shown.
function actionLabel(action) {
  if (!action) return '';
  const key = 'audit.actionLabels.' + String(action).replace(/[.-]/g, '_');
  return te(key) ? t(key) : action;
}

function badgeClass(outcome) {
  return outcomeBadge[outcome] || PILL.grey;
}
function outcomeText(outcome) {
  const key = outcomeLabelKey[outcome];
  // show the raw value rather than inventing a friendlier one we do not recognise
  return key ? t(key) : String(outcome ?? '');
}

// BsPagination is client side by design : it slices whatever dataList it is handed.
// The audit table is the one place in this app where loading every row is not an
// option, so it is fed the row INDEXES instead of the rows. It then renders the page
// buttons and the per-page selector exactly as every other table does, and the slice
// it emits tells us precisely which absolute rows to fetch from the server.
const pageIndexes = computed(() => Array.from({ length: total.value }, (_, i) => i));
// the rows shown, for the footer : 1-25 of 140
const pageRange = computed(() => {
  if (!total.value || !records.value.length) return t('dataTable.rangeOf', { from: 0, to: 0, total: total.value });
  return t('dataTable.rangeOf', {
    from: offset.value + 1,
    to: offset.value + records.value.length,
    total: total.value,
  });
});

async function onPageChange(slice, meta) {
  const nextOffset = slice.length ? slice[0] : 0;
  // The page size comes from the PAGER, not from the slice length.
  //
  // A slice shorter than the current size is ambiguous - it is either the last page or a
  // smaller size the user just chose - and the old `slice.length > pageSize` test resolved
  // that ambiguity one way only. So picking a LARGER size worked and picking a SMALLER one
  // did nothing: 10 is not > 25, the limit stayed 25, and the request was even suppressed
  // as a duplicate. The table then rendered 25 rows while the selector read 10, and every
  // page repeated 15 rows of the one before. BsPagination now reports its own state.
  const nextLimit = meta?.pageSize || (slice.length > pageSize.value ? slice.length : pageSize.value);
  // the pager re-emits whenever its slice recomputes - including immediately after
  // our own load() changed `total`. Without this guard that is an endless loop.
  if (`${nextOffset}:${nextLimit}` === lastRequest.value) return;
  offset.value = nextOffset;
  pageSize.value = nextLimit;
  await load();
}

// the audit table is the one place in this app where loading every row is not an
// option, so paging happens server side
async function load() {
  loading.value = true;
  lastRequest.value = `${offset.value}:${pageSize.value}`;
  try {
    const params = new URLSearchParams({ limit: String(pageSize.value), offset: String(offset.value) });
    if (filterActor.value) params.set('actor', filterActor.value);
    if (filterAction.value) params.set('action', filterAction.value);
    if (filterOutcome.value) params.set('outcome', filterOutcome.value);
    const res = await axios.get(`/api/v2/audit?${params.toString()}`, TokenStorage.getAuthentication());
    const data = res.data?.records !== undefined ? res.data : res.data?.result;
    records.value = data?.records || [];
    total.value = data?.total || 0;
    loadFailed.value = false;
    // Recover from an offset past the end. The retention sweep (or another admin) can
    // shrink the table under us; the empty branch then unmounts BsPagination, which is
    // the only thing that could have moved the offset - so the page would sit on
    // "nothing recorded yet" for ever, Refresh included. Step back to the last page
    // that exists and re-fetch.
    if (records.value.length === 0 && total.value > 0 && offset.value >= total.value) {
      offset.value = Math.max(0, (Math.ceil(total.value / pageSize.value) - 1) * pageSize.value);
      loading.value = false;
      return await load();
    }
  } catch (err) {
    loadFailed.value = true;
    toast.error(Helpers.parseAxiosResponseError(err, t('audit.failedLoad')));
  } finally {
    loading.value = false;
  }
}

async function loadFacets() {
  try {
    const res = await axios.get('/api/v2/audit/facets', TokenStorage.getAuthentication());
    facets.value = res.data?.actions !== undefined ? res.data : res.data?.result || { actions: [], actors: [] };
  } catch {
    facets.value = { actions: [], actors: [] };
  }
}

// changing a filter has to reset to the first page, or you can end up on an offset
// past the end of the newly filtered set and see nothing
async function applyFilters() {
  offset.value = 0;
  // remounting the pager is what actually resets it : resetting `offset` alone left the
  // pager holding its old page, which it then re-emitted and overrode us with. Same
  // trick BsDataTable uses for its filter row.
  filterVersion.value++;
  await load();
}

function toggle(id) {
  expanded.value[id] = !expanded.value[id];
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (authenticated.value) {
    await Promise.all([load(), loadFacets()]);
  }
});
</script>

<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="clipboard-list"
        :title="t('audit.title')"
        :description="t('audit.description')"
      >
        <!-- the filters on the title line, as the other tables have their search and columns -->
        <template #headerActions>
          <div class="d-flex align-items-center gap-2">
            <select v-model="filterActor" class="form-select" style="width: auto" @change="applyFilters">
              <option value="">{{ t('audit.allActors') }}</option>
              <option v-for="a in facets.actors" :key="'ac-' + a" :value="a">{{ a }}</option>
            </select>
            <select v-model="filterAction" class="form-select" style="width: auto" @change="applyFilters">
              <option value="">{{ t('audit.allActions') }}</option>
              <option v-for="a in facets.actions" :key="'an-' + a" :value="a">{{ actionLabel(a) }}</option>
            </select>
            <select v-model="filterOutcome" class="form-select" style="width: auto" @change="applyFilters">
              <option value="">{{ t('audit.allOutcomes') }}</option>
              <option value="success">{{ t('audit.outcomeSuccess') }}</option>
              <option value="failure">{{ t('audit.outcomeFailure') }}</option>
              <option value="denied">{{ t('audit.outcomeDenied') }}</option>
            </select>
            <!-- after the filters, as the server log has its Refresh on the title line -->
            <BsButton cssClass="text-nowrap" :icon="loading ? 'spinner' : 'refresh'" @click="load()">{{
              t('audit.refresh')
            }}</BsButton>
          </div>
        </template>
        <template #default>
          <div v-if="loading && records.length === 0" class="spinner-border" role="status">
            <span class="visually-hidden">{{ t('settings.common.loading') }}</span>
          </div>
          <div v-else-if="loadFailed" class="text-center text-muted py-4">
            <div class="fw-bold">{{ t('audit.failedLoad') }}</div>
          </div>
          <div v-else-if="records.length === 0" class="text-center text-muted py-4">
            <div class="fw-bold">{{ t('audit.empty') }}</div>
            <small>{{ t('audit.emptyHint') }}</small>
          </div>
          <template v-else>
            <!-- the shared look of the tables (styles/tables.scss) : running to the card's
                 edges, a grey header bar, the pager in a footer bar -->
            <div class="af-table-frame">
              <div class="table-responsive" style="overflow: visible">
                <table class="table table-sm table-hover mb-0 af-table audit-table">
                  <thead>
                    <tr>
                      <th style="width: 14rem">{{ t('audit.time') }}</th>
                      <th style="width: 15rem">{{ t('audit.actor') }}</th>
                      <th>{{ t('audit.action') }}</th>
                      <th style="width: 18rem">{{ t('audit.target') }}</th>
                      <th style="width: 7rem">{{ t('audit.outcome') }}</th>
                      <th style="width: 10rem">{{ t('audit.ip') }}</th>
                      <th style="width: 3rem"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="r in records" :key="r.id">
                      <tr class="audit-row">
                        <td class="font-monospace">{{ Helpers.formatServerDate(r.created_at) }}</td>
                        <td>
                          <span v-if="r.actor">{{ r.actor }}</span>
                          <span v-else class="text-muted fst-italic">{{ t('audit.system') }}</span>
                        </td>
                        <td>{{ actionLabel(r.action) }}</td>
                        <td class="audit-target">{{ r.target }}</td>
                        <td>
                          <span class="badge rounded-pill fw-semibold af-pill" :class="badgeClass(r.outcome)"
                            ><span class="af-pill-label">{{ outcomeText(r.outcome) }}</span></span
                          >
                        </td>
                        <td class="font-monospace small text-muted">{{ r.ip }}</td>
                        <td class="text-end">
                          <!-- a plain icon : a button would make the rows with a detail taller -->
                          <a
                            v-if="r.detail"
                            href="#"
                            class="text-body-secondary af-audit-toggle"
                            @click.prevent="toggle(r.id)"
                            ><FaIcon :icon="expanded[r.id] ? 'chevron-up' : 'chevron-down'"
                          /></a>
                        </td>
                      </tr>
                      <tr v-if="expanded[r.id] && r.detail">
                        <td colspan="7" class="bg-body-tertiary">
                          <pre class="mb-0 font-monospace fs-6 audit-detail">{{
                            JSON.stringify(r.detail, null, 2)
                          }}</pre>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
              <div class="af-table-footer">
                <span class="af-table-count me-auto">{{ pageRange }}</span>
                <BsPagination
                  :key="filterVersion"
                  :dataList="pageIndexes"
                  :perPage="25"
                  :buttonsShown="7"
                  name="audit"
                  @change="onPageChange"
                />
              </div>
            </div>
          </template>
        </template>
      </AppSettings>
    </main>
  </div>
</template>

<style scoped>
/* the audit table : the shared look (styles/tables.scss) ; its detail row keeps its text
   whole and wrapped */
.audit-detail {
  white-space: pre-wrap;
  word-break: break-word;
  text-box: none;
}
.audit-row td {
  white-space: nowrap;
}
/* the target may be long : it wraps, the other cells stay on one line */
.audit-row td.audit-target {
  white-space: normal;
  overflow-wrap: anywhere;
}
.af-audit-toggle {
  padding: 0 0.25rem;
}
</style>
