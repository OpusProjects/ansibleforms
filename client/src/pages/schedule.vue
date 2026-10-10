<script setup>
/******************************************************************/
/*                                                                */
/*  A schedule's page (/jobs/schedules/<id>), opened from the     */
/*  schedules' list : the steps of its dialog as tabs, and what   */
/*  it said the last time, the tab kept in the url -              */
/*    Details      where it stands (last launch, the job it       */
/*                 started, state, last and next run), its name   */
/*                 and the form it runs                           */
/*    Schedule     once at a time, or on a cron schedule          */
/*    Extra vars   what it sends the form (YAML)                  */
/*  Under Last launch : the job it started (a link), or why it    */
/*  could not start one.                                          */
/*  Run now and Delete top right, beside Save. While it runs, its */
/*  state and output are re-read every 2 seconds.                 */
/*                                                                */
/******************************************************************/
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import Profile from '@/lib/Profile';
import TokenStorage from '@/lib/TokenStorage';
import Helpers from '@/lib/Helpers';
import { statusPill, schedulePill } from '@/config/settings';
import { editorStyle } from '@/config/editorStyle';
import { cronValidationMessage } from '@/config/cron';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authenticated = ref(false);
const loaded = ref(false);

// ─── the schedule ─────────────────────────────────────────────────────────────
const scheduleId = computed(() => String(route.params.id || ''));
const schedule = ref(null); // as saved
const edit = ref(null); // as edited
const formNames = ref([]); // the forms it can run
const EDITED = ['name', 'form', 'one_time_run', 'cron', 'run_at', 'extra_vars'];

/**
 * The fields of a schedule as this page edits them.
 *
 * Args:
 *   record (object): the schedule.
 *
 * Returns:
 *   object: the edited fields.
 */
function editable(record) {
  return {
    name: record.name ?? '',
    form: record.form ?? '',
    one_time_run: !!record.one_time_run,
    cron: record.cron ?? '',
    run_at: record.run_at ?? '',
    extra_vars: record.extra_vars ?? '',
  };
}

const dirty = computed(
  () =>
    !!schedule.value && EDITED.some((k) => String(edit.value[k] ?? '') !== String(editable(schedule.value)[k] ?? '')),
);
// leaving with the schedule changed and unsaved asks first
useUnsavedGuard(dirty, () => t('settings.common.unsavedChanges'));

const running = computed(() => ['running', 'queued'].includes(schedule.value?.state));
const cronError = computed(() =>
  edit.value && !edit.value.one_time_run ? cronValidationMessage(t, edit.value.cron) : null,
);
// what its last run said : the job it started (schedule.model writes "The schedule started
// job <id>."), or, when it started none, why
const startedJob = computed(() => schedule.value?.output?.match(/started job (\d+)/)?.[1] || null);
const launchError = computed(() =>
  schedule.value?.status === 'failed' ? (schedule.value.output || '').split('\n')[0] : '',
);

/**
 * Loads the schedule.
 *
 * Args:
 *   keepEdits (boolean): keep what is being edited (a refresh while it runs).
 */
async function load(keepEdits = false) {
  try {
    const res = await axios.get(
      `/api/v2/schedule/${encodeURIComponent(scheduleId.value)}`,
      TokenStorage.getAuthentication(),
    );
    const record = res.data.records ? res.data.records[0] : res.data;
    // when it runs next is worked out for the list only : read from there
    if (record?.id && !record.next_run) {
      const list = await axios.get('/api/v2/schedule/', TokenStorage.getAuthentication()).catch(() => null);
      const listed = (list?.data?.records || []).find((r) => String(r.id) === String(record.id));
      if (listed) record.next_run = listed.next_run;
    }
    schedule.value = record?.id ? record : null;
    if (schedule.value && (!keepEdits || !edit.value)) edit.value = editable(record);
  } catch {
    schedule.value = null;
  }
  loaded.value = true;
}

/**
 * Loads the forms a schedule can run, for the Form dropdown.
 */
async function loadForms() {
  const res = await axios.get('/api/v2/config/formnames/', TokenStorage.getAuthentication()).catch(() => null);
  formNames.value = (res?.data?.records || []).map((f) => ({ name: f.name }));
}

// while it runs : its state and output re-read every 2 seconds, until it is idle again
let poll = null;
function watchRun() {
  clearInterval(poll);
  poll = setInterval(async () => {
    await load(true);
    if (!running.value) clearInterval(poll);
  }, 2000);
}
onBeforeUnmount(() => clearInterval(poll));

// ─── tabs ─────────────────────────────────────────────────────────────────────
const tabs = computed(() => [
  { key: 'details', label: t('settings.common.tabDetails'), icon: 'sliders' },
  { key: 'schedule', label: t('settings.schedules.stepSchedule'), icon: 'stopwatch' },
  { key: 'vars', label: t('settings.schedules.stepExtraVars'), icon: 'code' },
]);
const { activeTab } = useRouteTab('details', (key) => tabs.value.some((x) => x.key === key));

// the title : Schedules › <name>, each step a link
const crumbs = computed(() => [
  { title: t('settings.schedules.labelPlural'), icon: 'clock', to: '/jobs/schedules' },
  { title: schedule.value?.name || scheduleId.value, icon: 'clock', to: `/jobs/schedules/${scheduleId.value}` },
]);

// ─── actions ──────────────────────────────────────────────────────────────────
/**
 * Saves the fields of every tab : a one time run keeps its time and no cron, a recurring one
 * its cron.
 */
async function save() {
  const e = edit.value;
  if (!e.name.trim() || !e.form) {
    toast.warning(t('settings.schedules.fieldsRequired'));
    return;
  }
  if (cronError.value) {
    toast.warning(cronError.value);
    return;
  }
  const data = {
    name: e.name.trim(),
    form: e.form,
    one_time_run: e.one_time_run ? 1 : 0,
    cron: e.one_time_run ? '' : e.cron,
    run_at: e.one_time_run ? e.run_at : null,
    extra_vars: e.extra_vars,
  };
  try {
    await axios.put(`/api/v2/schedule/${encodeURIComponent(scheduleId.value)}`, data, TokenStorage.getAuthentication());
    toast.success(`${data.name} ${t('settings.common.isUpdated')}`);
    await load();
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

/**
 * Runs it now, then follows it until it is idle.
 */
async function runNow() {
  try {
    await axios.post(
      `/api/v2/schedule/${encodeURIComponent(scheduleId.value)}/launch`,
      {},
      TokenStorage.getAuthentication(),
    );
    schedule.value.state = 'queued';
    watchRun();
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

// Delete asks first
const confirmDelete = ref(false);

/**
 * Deletes the schedule, then goes back to the schedules.
 */
async function deleteSchedule() {
  confirmDelete.value = false;
  try {
    await axios.delete(`/api/v2/schedule/${encodeURIComponent(scheduleId.value)}`, TokenStorage.getAuthentication());
    schedule.value = null;
    router.push('/jobs/schedules');
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await Promise.all([load(), loadForms()]);
  if (running.value) watchRun();
});
</script>
<template>
  <BsModal v-if="confirmDelete" size="md" @close="confirmDelete = false">
    <template #title> {{ t('common.delete') }} {{ schedule?.name }} </template>
    <template #default>
      <p class="mb-0 fs-6 user-select-none">
        {{ t('settings.common.deleteConfirm') }} <strong>{{ schedule?.name }}</strong
        >?
      </p>
    </template>
    <template #footer>
      <BsButton icon="trash" @click="deleteSchedule()">{{ t('common.delete') }}</BsButton>
    </template>
  </BsModal>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppJobsSidebar />
      <AppSettings
        v-if="authenticated"
        icon="clock"
        :title="schedule?.name || scheduleId"
        :crumbs="crumbs"
        :description="t('settings.schedules.description')"
      >
        <template v-if="schedule" #tabs>
          <ul class="nav nav-tabs mb-0">
            <li v-for="tab in tabs" :key="tab.key" class="nav-item">
              <a
                class="nav-link"
                :class="{ active: activeTab === tab.key }"
                href="#"
                @click.prevent="activeTab = tab.key"
              >
                <FaIcon :icon="tab.icon" class="me-1" />
                {{ tab.label }}
              </a>
            </li>
          </ul>
        </template>
        <template #default>
          <div v-if="loaded && !schedule" class="empty-state">
            <FaIcon icon="clock" class="empty-state-icon" />
            <span>{{ t('settings.schedules.notFound', { id: scheduleId }) }}</span>
          </div>
          <div v-else-if="schedule && edit" class="af-schedule-tab">
            <!-- Details : where it stands, its name and the form it runs -->
            <template v-if="activeTab === 'details'">
              <!-- where it stands : each a field of the column, read only, as a repository's status -->
              <div class="mb-3">
                <div class="form-label fw-bold">{{ t('settings.schedules.lastLaunch') }}</div>
                <span v-html="statusPill(t, schedule.status)"></span>
                <!-- why it started no job -->
                <div v-if="launchError" class="form-text text-danger">{{ launchError }}</div>
                <div class="form-text">{{ t('settings.schedules.lastLaunchHelp') }}</div>
              </div>
              <!-- the job it started : opened to see how it ended -->
              <div v-if="startedJob" class="mb-3">
                <div class="form-label fw-bold">{{ t('settings.schedules.startedJobTitle') }}</div>
                <router-link :to="`/jobs/${startedJob}`" class="af-started-job"
                  ><FaIcon icon="file-lines" class="me-1" />{{
                    t('settings.schedules.startedJob', { id: startedJob })
                  }}</router-link
                >
                <div class="form-text">{{ t('settings.schedules.startedJobHelp') }}</div>
              </div>
              <div class="mb-3">
                <div class="form-label fw-bold">{{ t('settings.schedules.scheduleState') }}</div>
                <span v-html="schedulePill(t, schedule.state)"></span>
                <div class="form-text">{{ t('settings.schedules.scheduleStateHelp') }}</div>
              </div>
              <div class="mb-3">
                <div class="form-label fw-bold">{{ t('settings.fields.lastRun') }}</div>
                <span>{{ schedule.last_run ? Helpers.formatServerDate(schedule.last_run) : '–' }}</span>
              </div>
              <div class="mb-3">
                <div class="form-label fw-bold">{{ t('settings.schedules.nextRun') }}</div>
                <span>{{ schedule.next_run ? Helpers.formatServerDate(schedule.next_run) : '–' }}</span>
              </div>
              <BsInput
                class="af-schedule-field"
                v-model="edit.name"
                icon="heading"
                :isFloating="false"
                :required="true"
                :help="t('settings.repositories.helpName')"
                :label="t('settings.fields.name')"
              />
              <BsInput
                class="af-schedule-field"
                v-model="edit.form"
                type="select"
                icon="pen-to-square"
                :isFloating="false"
                :required="true"
                :values="formNames"
                valueKey="name"
                labelKey="name"
                :label="t('settings.fields.form')"
              />
            </template>
            <!-- Schedule : once at a time, or on a cron schedule -->
            <template v-else-if="activeTab === 'schedule'">
              <div class="form-check form-switch mb-3">
                <input
                  id="af-schedule-once"
                  v-model="edit.one_time_run"
                  class="form-check-input"
                  type="checkbox"
                  role="switch"
                />
                <label class="form-check-label" for="af-schedule-once">{{ t('settings.schedules.oneTimeRun') }}</label>
              </div>
              <div v-if="edit.one_time_run" class="af-schedule-field mb-0">
                <label class="form-label">{{ t('settings.schedules.runAt') }}</label>
                <BsDateTime v-model="edit.run_at" icon="calendar" dateType="datetime" :convertToUtc="true" teleport />
                <div class="form-text">{{ t('settings.schedules.runAtHelp') }}</div>
              </div>
              <div v-else class="af-schedule-cron mb-0">
                <BsCron v-model="edit.cron" icon="stopwatch" :hasError="!!cronError" />
                <div v-if="cronError" class="invalid-feedback d-block">{{ cronError }}</div>
              </div>
            </template>
            <!-- Extra vars : what it sends the form -->
            <template v-else>
              <BsInput
                v-model="edit.extra_vars"
                type="editor"
                lang="yaml"
                :style="editorStyle('40vh')"
                :isFloating="false"
                :help="t('settings.schedules.extraVarsHelp')"
                :label="t('settings.fields.extraVars')"
              />
            </template>
          </div>
        </template>
        <template v-if="schedule" #actions>
          <BsButton icon="play" cssClass="text-nowrap" :disabled="running" @click="runNow()">{{
            t('settings.schedules.runSchedule')
          }}</BsButton>
          <BsButton icon="trash" @click="confirmDelete = true">{{ t('common.delete') }}</BsButton>
          <BsButton icon="save" :colorClass="dirty ? 'primary' : 'secondary'" :disabled="!dirty" @click="save()">{{
            t('settings.common.save')
          }}</BsButton>
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped>
/* the wide fields' width of the record pages */
.af-schedule-field :deep(.input-group),
.af-schedule-field,
.af-schedule-cron {
  max-width: 40rem;
}
/* the tab ends a little above the card's edge, as every record's page (24px in all) */
.af-schedule-tab {
  padding-bottom: 0.5rem;
}
/* the job it started : the link blue of a list's name, underlined only when hovered */
.af-started-job {
  font-weight: 500;
  text-decoration: none;
}
.af-started-job:hover {
  text-decoration: underline;
}
</style>
