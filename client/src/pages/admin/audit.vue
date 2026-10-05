<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { toast } from 'vue-sonner';
import axios from 'axios';
import TokenStorage from '@/lib/TokenStorage';
import Profile from '@/lib/Profile';
import Helpers from '@/lib/Helpers.js';

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
const outcomeBadge = Object.assign(Object.create(null), {
  success: 'text-bg-success',
  failure: 'text-bg-danger',
  denied: 'text-bg-warning',
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
  return outcomeBadge[outcome] || 'text-bg-secondary';
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
    <main class="d-flex flex-nowrap container-xxl">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="clipboard-list"
        :title="t('audit.title')"
        :description="t('audit.description')"
      >
        <template #default>
          <!-- Filters live INSIDE the card, in the exact toolbar shape BsDataTable uses:
               same wrapper classes, and the controls pushed right with ms-auto the way
               it positions its column picker (see BsDataTable's toolbar). -->
          <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
            <div class="ms-auto d-flex gap-2">
              <select
                v-model="filterActor"
                class="form-select form-select-sm"
                style="width: auto"
                @change="applyFilters"
              >
                <option value="">{{ t('audit.allActors') }}</option>
                <option v-for="a in facets.actors" :key="'ac-' + a" :value="a">{{ a }}</option>
              </select>
              <select
                v-model="filterAction"
                class="form-select form-select-sm"
                style="width: auto"
                @change="applyFilters"
              >
                <option value="">{{ t('audit.allActions') }}</option>
                <option v-for="a in facets.actions" :key="'an-' + a" :value="a">{{ actionLabel(a) }}</option>
              </select>
              <select
                v-model="filterOutcome"
                class="form-select form-select-sm"
                style="width: auto"
                @change="applyFilters"
              >
                <option value="">{{ t('audit.allOutcomes') }}</option>
                <option value="success">{{ t('audit.outcomeSuccess') }}</option>
                <option value="failure">{{ t('audit.outcomeFailure') }}</option>
                <option value="denied">{{ t('audit.outcomeDenied') }}</option>
              </select>
            </div>
          </div>
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
            <!-- same wrapper, classes and cell metrics as BsDataTable, so the audit
                 table reads as one of the app's tables. Its .bs-dt-table rules are
                 scoped to that component, so the metrics are repeated below rather
                 than borrowed - a scoped class cannot cross a component boundary. -->
            <div class="table-responsive" style="overflow: visible">
              <table class="table table-sm table-hover mb-0 audit-table">
                <thead>
                  <tr>
                    <th style="width: 12rem">{{ t('audit.time') }}</th>
                    <th style="width: 10rem">{{ t('audit.actor') }}</th>
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
                      <td>{{ r.target }}</td>
                      <td>
                        <span class="badge" :class="badgeClass(r.outcome)">{{ outcomeText(r.outcome) }}</span>
                      </td>
                      <td class="font-monospace small text-muted">{{ r.ip }}</td>
                      <td class="text-end">
                        <BsButton
                          v-if="r.detail"
                          :isIconButton="true"
                          colorClass="secondary"
                          cssClass="btn-sm"
                          :icon="expanded[r.id] ? 'chevron-up' : 'chevron-down'"
                          @click="toggle(r.id)"
                        />
                      </td>
                    </tr>
                    <tr v-if="expanded[r.id] && r.detail">
                      <td colspan="7" class="bg-body-tertiary">
                        <pre class="mb-0 font-monospace fs-6 audit-detail">{{ JSON.stringify(r.detail, null, 2) }}</pre>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
            <div class="mt-2">
              <BsPagination
                :key="filterVersion"
                :dataList="pageIndexes"
                :perPage="25"
                :buttonsShown="7"
                name="audit"
                @change="onPageChange"
              />
            </div>
          </template>
        </template>
        <template #actions>
          <BsButton cssClass="ms-3" :icon="loading ? 'spinner' : 'refresh'" @click="load()">{{
            t('audit.refresh')
          }}</BsButton>
        </template>
      </AppSettings>
    </main>
  </div>
</template>

<style scoped>
/* Mirrors BsDataTable's .bs-dt-table metrics. Those rules live in that component's
   scoped block, so they cannot reach this markup - repeating them here is what keeps
   the two tables looking identical. */
.audit-table {
  --bs-table-cell-padding-y: 0.45rem;
  --bs-table-cell-padding-x: 0.65rem;
}
.audit-table td,
.audit-table th {
  vertical-align: middle;
  border-color: var(--bs-border-color-translucent);
}
/* Only some rows carry a detail chevron, and a btn-sm made those rows 40px against 33px
   for the rest - so the row height told you which rows had a detail before you read them.
   A floor on the cell (height acts as a minimum in table layout) levels them; the detail
   row below is excluded because its content sets its own height. */
.audit-row td {
  height: 40px;
}
.audit-detail {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
