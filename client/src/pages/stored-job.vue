<script setup>
/******************************************************************/
/*                                                                */
/*  A stored job's page (/jobs/stored/<id>), opened from the      */
/*  stored jobs' list : form values saved to run again, in tabs,  */
/*  the tab kept in the url -                                     */
/*    Details  its name and description, the form it is for, its */
/*             owner, when it was stored and when it expires      */
/*    Values   the form's values, as YAML, editable               */
/*  Open in form (the form, these values filled in) and Delete    */
/*  top right, beside Save.                                       */
/*                                                                */
/******************************************************************/
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import YAML from 'yaml';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import Profile from '@/lib/Profile';
import TokenStorage from '@/lib/TokenStorage';
import Helpers from '@/lib/Helpers';
import { editorStyle } from '@/config/editorStyle';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authenticated = ref(false);
const loaded = ref(false);

// ─── the stored job ───────────────────────────────────────────────────────────
const storedId = computed(() => String(route.params.id || ''));
const stored = ref(null); // as saved
const edit = ref(null); // as edited
const EDITED = ['name', 'description', 'never_expires', 'expires_at', 'values'];

/**
 * The form's values as YAML, for the editor : the stored JSON read back.
 *
 * Args:
 *   json (string): the stored form_data.
 *
 * Returns:
 *   string: the YAML ('' for none).
 */
function toYaml(json) {
  try {
    const parsed = JSON.parse(json || '{}');
    return parsed && Object.keys(parsed).length ? YAML.stringify(parsed) : '';
  } catch {
    return json || '';
  }
}

/**
 * The fields of a stored job as this page edits them.
 *
 * Args:
 *   record (object): the stored job.
 *
 * Returns:
 *   object: the edited fields.
 */
function editable(record) {
  return {
    name: record.name ?? '',
    description: record.description ?? '',
    never_expires: !record.expires_at,
    expires_at: record.expires_at ?? '',
    values: toYaml(record.form_data),
  };
}

const dirty = computed(
  () => !!stored.value && EDITED.some((k) => String(edit.value[k] ?? '') !== String(editable(stored.value)[k] ?? '')),
);
// leaving with the stored job changed and unsaved asks first
useUnsavedGuard(dirty, () => t('settings.common.unsavedChanges'));

// the values typed are YAML : a mistake is said under the editor, and nothing is saved
const valuesError = computed(() => {
  if (!edit.value) return '';
  try {
    const parsed = YAML.parse(edit.value.values || '{}');
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed)))
      return t('settings.storedJobs.valuesNotMap');
    return '';
  } catch (e) {
    return e.message;
  }
});

/**
 * Loads the stored job.
 */
async function load() {
  try {
    const res = await axios.get(
      `/api/v2/stored-jobs/${encodeURIComponent(storedId.value)}`,
      TokenStorage.getAuthentication(),
    );
    const record = res.data?.records ? res.data.records[0] : res.data;
    stored.value = record?.id ? record : null;
    edit.value = stored.value ? editable(record) : null;
  } catch {
    stored.value = null;
  }
  loaded.value = true;
}

// ─── tabs ─────────────────────────────────────────────────────────────────────
const tabs = computed(() => [
  { key: 'details', label: t('settings.common.tabDetails'), icon: 'sliders' },
  { key: 'values', label: t('settings.storedJobs.tabValues'), icon: 'code' },
]);
const { activeTab } = useRouteTab('details', (key) => tabs.value.some((x) => x.key === key));

// the title : Stored Jobs › <name>, each step a link
const crumbs = computed(() => [
  { title: t('settings.storedJobs.labelPlural'), icon: 'floppy-disk', to: '/jobs/stored' },
  { title: stored.value?.name || storedId.value, icon: 'floppy-disk', to: `/jobs/stored/${storedId.value}` },
]);

// ─── actions ──────────────────────────────────────────────────────────────────
/**
 * Saves the fields of every tab : the values back to the JSON the form's Load reads.
 */
async function save() {
  const e = edit.value;
  if (!e.name.trim()) {
    toast.warning(t('settings.storedJobs.nameRequired'));
    return;
  }
  if (valuesError.value) {
    toast.warning(valuesError.value);
    return;
  }
  const data = {
    name: e.name.trim(),
    description: e.description.trim(),
    expires_at: e.never_expires ? null : e.expires_at || null,
    form_data: JSON.stringify(YAML.parse(e.values || '{}') || {}),
  };
  try {
    await axios.put(
      `/api/v2/stored-jobs/${encodeURIComponent(storedId.value)}`,
      data,
      TokenStorage.getAuthentication(),
    );
    toast.success(`${data.name} ${t('settings.common.isUpdated')}`);
    await load();
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

/**
 * Opens its form with these values filled in (the form page reads ?storedJob=).
 */
function openInForm() {
  router.push({ path: '/form', query: { form: stored.value.form_name, storedJob: stored.value.id } });
}

// Delete asks first
const confirmDelete = ref(false);

/**
 * Deletes the stored job, then goes back to the stored jobs.
 */
async function deleteStored() {
  confirmDelete.value = false;
  try {
    await axios.delete(`/api/v2/stored-jobs/${encodeURIComponent(storedId.value)}`, TokenStorage.getAuthentication());
    stored.value = null;
    router.push('/jobs/stored');
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await load();
});
</script>
<template>
  <BsModal v-if="confirmDelete" size="md" @close="confirmDelete = false">
    <template #title> {{ t('common.delete') }} {{ stored?.name }} </template>
    <template #default>
      <p class="mb-0 fs-6 user-select-none">
        {{ t('settings.common.deleteConfirm') }} <strong>{{ stored?.name }}</strong
        >?
      </p>
    </template>
    <template #footer>
      <BsButton icon="trash" @click="deleteStored()">{{ t('common.delete') }}</BsButton>
    </template>
  </BsModal>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppJobsSidebar />
      <AppSettings
        v-if="authenticated"
        icon="floppy-disk"
        :title="stored?.name || storedId"
        :crumbs="crumbs"
        :description="t('settings.storedJobs.description')"
      >
        <template v-if="stored" #tabs>
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
          <div v-if="loaded && !stored" class="empty-state">
            <FaIcon icon="floppy-disk" class="empty-state-icon" />
            <span>{{ t('settings.storedJobs.notFound', { id: storedId }) }}</span>
          </div>
          <div v-else-if="stored && edit" class="af-stored-tab">
            <!-- Details : what it is, whose, and for how long -->
            <template v-if="activeTab === 'details'">
              <BsInput
                class="af-stored-field"
                v-model="edit.name"
                icon="heading"
                :isFloating="false"
                :required="true"
                :label="t('settings.fields.name')"
              />
              <BsInput
                class="af-stored-field"
                v-model="edit.description"
                icon="info-circle"
                :isFloating="false"
                :label="t('settings.fields.description')"
              />
              <!-- when it was stored : read only -->
              <!-- its form : a dropdown greyed out, its one choice the form - the values are that
                   form's, another form would not read them -->
              <BsInput
                class="af-stored-field"
                :modelValue="stored.form_name"
                type="select"
                icon="pen-to-square"
                :isFloating="false"
                :disabled="true"
                :values="[{ name: stored.form_name }]"
                valueKey="name"
                labelKey="name"
                :help="t('settings.storedJobs.formHelp')"
                :label="t('settings.fields.form')"
              />
              <!-- whose it is : a field greyed out, as the form above -->
              <BsInput
                class="af-stored-field"
                :modelValue="stored.username"
                icon="user"
                :isFloating="false"
                :disabled="true"
                :label="t('settings.storedJobs.owner')"
              />
              <div class="mb-3">
                <div class="form-label fw-bold">{{ t('settings.fields.createdAt') }}</div>
                <span>{{ stored.created_at ? Helpers.formatServerDate(stored.created_at) : '–' }}</span>
              </div>
              <!-- when it expires : never, or a date -->
              <!-- the tab's last field : no margin under it (the tab's own padding ends it), and
                   the switch's only above the date it opens -->
              <div class="mb-0">
                <div class="form-label fw-bold">{{ t('settings.fields.expiresAt') }}</div>
                <div class="form-check form-switch" :class="edit.never_expires ? 'mb-0' : 'mb-2'">
                  <input
                    id="af-stored-never"
                    v-model="edit.never_expires"
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                  />
                  <label class="form-check-label" for="af-stored-never">{{
                    t('settings.storedJobs.neverExpires')
                  }}</label>
                </div>
                <div v-if="!edit.never_expires" class="af-stored-field">
                  <BsDateTime
                    v-model="edit.expires_at"
                    icon="calendar"
                    dateType="datetime"
                    :convertToUtc="true"
                    teleport
                  />
                </div>
              </div>
            </template>
            <!-- Values : the form's values, as YAML -->
            <template v-else>
              <BsInput
                v-model="edit.values"
                type="editor"
                lang="yaml"
                :style="editorStyle('40vh')"
                :isFloating="false"
                :help="t('settings.storedJobs.valuesHelp')"
                :label="t('settings.storedJobs.tabValues')"
              />
              <div v-if="valuesError" class="invalid-feedback d-block mt-n2">{{ valuesError }}</div>
            </template>
          </div>
        </template>
        <template v-if="stored" #actions>
          <BsButton icon="play" cssClass="text-nowrap" :disabled="dirty" @click="openInForm()">{{
            t('settings.storedJobs.openInForm')
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
.af-stored-field :deep(.input-group),
.af-stored-field {
  max-width: 40rem;
}
/* the tab ends a little above the card's edge, as every record's page (24px in all) */
.af-stored-tab {
  padding-bottom: 0.5rem;
}
</style>
