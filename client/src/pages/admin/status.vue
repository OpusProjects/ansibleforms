<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { toast } from 'vue-sonner';
import axios from 'axios';
import TokenStorage from '@/lib/TokenStorage';
import Profile from '@/lib/Profile';
import Helpers from '@/lib/Helpers.js';
import Time from '@/lib/Time';

const { t } = useI18n();

const authenticated = ref(false);
const loading = ref(false);
const result = ref(null);
const checkedAt = ref(null);
const expanded = ref({});
// Checks is the default : a failure must be what you land on. The count of anything
// non-ok rides on the tab label, so a user sitting on the other tab still sees it.
const activeTab = ref('checks');

// the check keys come from the server (see health.model.js) and are turned into
// locale keys by concatenation, so 'health.checkDatabase' and friends look
// unreferenced to a plain grep
function checkLabel(key) {
  return t('health.check' + key.charAt(0).toUpperCase() + key.slice(1));
}

// Text badges (the header verdict, the summary strip) keep the app's subtle text-bg-*
// style - dark text on a pale background is legible and deliberate.
const badge = { ok: 'text-bg-success', warning: 'text-bg-warning', error: 'text-bg-danger' };
// The status dot and the disk bar carry NO text, so the colour IS the information and it
// has to survive on its own. Borrowing text-bg-*/bg-* made them near-invisible in the
// light theme (measured 1.08:1 for the bar, 1.36:1 for the dot, against a 3:1 minimum for
// non-text indicators) because .bg-success is themed to a subtle --af-bg-* value. These
// four are solid and clear 3:1 against BOTH the white and the dark card, so one set works
// in every theme without per-theme overrides.
const indicator = { ok: 'health-ind-ok', warning: 'health-ind-warning', error: 'health-ind-error' };
function indicatorClass(status) {
  return indicator[status] || 'health-ind-unknown';
}
const statusText = { ok: 'health.statusOk', warning: 'health.statusWarning', error: 'health.statusError' };

const overall = computed(() => result.value?.status || null);
const summary = computed(() => result.value?.summary || null);
const attention = computed(() => (summary.value?.warning || 0) + (summary.value?.error || 0));
const info = computed(() => result.value?.info || []);

// info labels are built by concatenation the same way check labels are, so
// 'health.infoDatabase' and friends look unreferenced to a plain grep
function infoLabel(key) {
  return t('health.info' + key.charAt(0).toUpperCase() + key.slice(1));
}

async function load() {
  loading.value = true;
  try {
    const res = await axios.get('/api/v2/health', TokenStorage.getAuthentication());
    result.value = res.data.result ?? res.data;
    checkedAt.value = Time.format(new Date(), 'HH:mm:ss');
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err, t('health.failedLoad')));
  } finally {
    loading.value = false;
  }
}

// the bar takes the colour of its own check, so a full disk is red without a second rule
function barClass(status) {
  return indicatorClass(status);
}

function toggle(key) {
  expanded.value[key] = !expanded.value[key];
}

// some values are timestamps (the last backup) : show them the way the rest of the
// app does rather than as a raw iso string, but leave anything else untouched
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
function displayValue(value) {
  // formatServerDate, not dayjs : these timestamps were already converted to the
  // application timezone server-side, so converting again in the browser would make
  // the last-backup date disagree with the backup's own folder name
  if (typeof value === 'string' && ISO.test(value)) return Helpers.formatServerDate(value);
  return value;
}

// a check's detail is either a plain string or a small structured object
function detailText(detail) {
  if (detail === null || detail === undefined) return '';
  if (typeof detail === 'string') return detail;
  return JSON.stringify(detail, null, 2);
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (authenticated.value) await load();
});
</script>

<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="heart-pulse"
        :title="t('health.title')"
        :description="t('health.description')"
      >
        <template #tabs>
          <!-- same markup as admin/settings.vue : AppSettings adds tab-card-flush-card to
               the card when this slot is filled, so the card joins the tabs -->
          <ul class="nav nav-tabs mb-0">
            <li class="nav-item">
              <a
                class="nav-link"
                :class="{ active: activeTab === 'checks' }"
                href="#"
                @click.prevent="activeTab = 'checks'"
              >
                <FaIcon icon="heart-pulse" class="me-1" />
                {{ t('health.sectionChecks') }}
                <span
                  v-if="attention"
                  class="badge ms-1"
                  :class="summary.error ? 'text-bg-danger' : 'text-bg-warning'"
                  >{{ attention }}</span
                >
              </a>
            </li>
            <li class="nav-item">
              <a
                class="nav-link"
                :class="{ active: activeTab === 'info' }"
                href="#"
                @click.prevent="activeTab = 'info'"
              >
                <FaIcon icon="circle-info" class="me-1" />
                {{ t('health.sectionInfo') }}
              </a>
            </li>
          </ul>
        </template>
        <template #feedback>
          <span v-if="overall" class="badge ms-3" :class="badge[overall]">{{ t(statusText[overall]) }}</span>
          <small v-if="checkedAt" class="text-muted ms-3">{{ t('health.checkedAt', { time: checkedAt }) }}</small>
        </template>
        <template #default>
          <div v-if="loading && !result" class="spinner-border" role="status">
            <span class="visually-hidden">{{ t('settings.common.loading') }}</span>
          </div>
          <table v-if="result && activeTab === 'checks'" class="table table-sm align-middle mb-0 health-table">
            <tbody>
              <template v-for="c in result.checks" :key="c.key">
                <tr>
                  <td style="width: 2.5rem">
                    <span class="badge rounded-pill" :class="indicatorClass(c.status)">&nbsp;</span>
                  </td>
                  <td class="fw-bold" style="width: 16rem">{{ checkLabel(c.key) }}</td>
                  <td>
                    {{ displayValue(c.value) }}
                    <!-- a percentage reads instantly as a bar and needs interpreting as text -->
                    <div
                      v-if="typeof c.detail?.usedPercent === 'number'"
                      class="progress health-bar mt-1"
                      role="presentation"
                    >
                      <div
                        class="progress-bar"
                        :class="barClass(c.status)"
                        :style="{ width: c.detail.usedPercent + '%' }"
                      ></div>
                    </div>
                  </td>
                  <td class="text-end health-action" style="width: 3rem">
                    <BsButton
                      v-if="c.detail"
                      :isIconButton="true"
                      colorClass="secondary"
                      cssClass="btn-sm"
                      :icon="expanded[c.key] ? 'chevron-up' : 'chevron-down'"
                      @click="toggle(c.key)"
                    />
                  </td>
                </tr>
                <!-- the detail row has to sit inside this same v-for, or every
                     expanded panel renders at the bottom of the table instead of
                     under the check it belongs to -->
                <tr v-if="expanded[c.key] && c.detail">
                  <td colspan="4" class="bg-body-tertiary">
                    <pre class="mb-0 font-monospace fs-6 health-detail">{{ detailText(c.detail) }}</pre>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>

          <!-- Facts, not verdicts. Deliberately WITHOUT a status dot : a green dot beside
               'MySQL 8.4.9' or 'file/repository' claims something was tested when nothing
               was. These are things you look up. -->
          <template v-if="result && activeTab === 'info' && info.length">
            <table class="table table-sm align-middle mb-0 health-table">
              <tbody>
                <template v-for="i in info" :key="i.key">
                  <tr>
                    <td class="fw-bold" style="width: 18.5rem">{{ infoLabel(i.key) }}</td>
                    <td>{{ displayValue(i.value) }}</td>
                    <td class="text-end health-action" style="width: 3rem">
                      <BsButton
                        v-if="i.detail"
                        :isIconButton="true"
                        colorClass="secondary"
                        cssClass="btn-sm"
                        :icon="expanded['i-' + i.key] ? 'chevron-up' : 'chevron-down'"
                        @click="toggle('i-' + i.key)"
                      />
                    </td>
                  </tr>
                  <tr v-if="expanded['i-' + i.key] && i.detail">
                    <td colspan="3" class="bg-body-tertiary">
                      <pre class="mb-0 font-monospace fs-6 health-detail">{{ detailText(i.detail) }}</pre>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </template>
        </template>
        <template #actions>
          <BsButton cssClass="ms-3" :icon="loading ? 'spinner' : 'refresh'" @click="load()">{{
            t('health.refresh')
          }}</BsButton>
        </template>
      </AppSettings>
    </main>
  </div>
</template>

<style scoped>
.health-bar {
  height: 4px;
  max-width: 12rem;
}
/* Solid indicator colours. Each clears 3:1 against white (light/color themes) AND
   against the dark card, so they need no per-theme variant :
     ok      #198754  4.53:1 / 3.40:1
     warning #b37700  3.78:1 / 4.08:1
     error   #dc3545  4.53:1 / 3.41:1
     unknown #6c757d  4.69:1 / 3.29:1
   Do NOT swap these for bg-success/text-bg-success - those are themed to subtle
   --af-bg-* values meant to sit behind dark TEXT, and as bare swatches they measured
   1.08:1 in the light theme. */
.health-ind-ok {
  background-color: #198754 !important;
}
.health-ind-warning {
  background-color: #b37700 !important;
}
.health-ind-error {
  background-color: #dc3545 !important;
}
.health-ind-unknown {
  background-color: #6c757d !important;
}
/* Every row is the same height whether or not it carries an expand button. Without this
   a row with a chevron is 40px and one without is 33px, so the list looks ragged.
   `height` on a table cell behaves as a minimum, so this lifts the short rows without
   capping the taller ones. */
.health-table tbody td.health-action {
  height: 40px;
}
/* Bootstrap draws a bottom border on every row. On the last one there is nothing left
   to separate it from, so it reads as a stray line floating above the card's padding. */
.health-table tbody tr:last-child > * {
  border-bottom-width: 0;
}
.health-detail {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
