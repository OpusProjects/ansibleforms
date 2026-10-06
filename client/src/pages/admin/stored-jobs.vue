<script setup>
import Profile from '@/lib/Profile';
import getSettings from '@/config/settings';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
import YAML from 'yaml';
import Time from '@/lib/Time';

const adminMulti = ref(null);
const authenticated = ref(false);
const currentStoredJob = ref(null);
const showStoredJobDetails = ref(false);

const formDataYaml = computed(() => {
  if (!currentStoredJob.value?.form_data) return '';
  try {
    const parsed = JSON.parse(currentStoredJob.value.form_data);
    return YAML.stringify(parsed);
  } catch (e) {
    console.error('Error parsing form data:', e);
    return t('admin.storedJobs.parseError') + ' ' + e.message;
  }
});

// in the user's time zone (Profile > Preferences)
const formatDateTime = (dateString) => {
  if (!dateString) return t('admin.storedJobs.never');
  return Time.format(dateString);
};

function previewDetails(storedJob) {
  currentStoredJob.value = storedJob;
  showStoredJobDetails.value = true;
}

function offcanvasClose() {
  showStoredJobDetails.value = false;
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) {
    return;
  }
});
</script>

<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppAdminMulti
        v-if="authenticated"
        apiVersion="2"
        ref="adminMulti"
        :settings="settings.stored_jobs"
        @preview="previewDetails"
      />
      <BsOffCanvas :title="t('admin.storedJobs.details')" :show="showStoredJobDetails" @close="offcanvasClose">
        <div v-if="currentStoredJob" class="stored-job-details">
          <div class="row mb-3">
            <div class="col-sm-3">
              <label class="form-label fw-bold">{{ t('admin.storedJobs.name') }}</label>
            </div>
            <div class="col-sm-9">{{ currentStoredJob.name }}</div>
          </div>
          <div class="row mb-3" v-if="currentStoredJob.description">
            <div class="col-sm-3">
              <label class="form-label fw-bold">{{ t('admin.storedJobs.description') }}</label>
            </div>
            <div class="col-sm-9">{{ currentStoredJob.description }}</div>
          </div>
          <div class="row mb-3">
            <div class="col-sm-3">
              <label class="form-label fw-bold">{{ t('admin.storedJobs.form') }}</label>
            </div>
            <div class="col-sm-9">{{ currentStoredJob.form_name }}</div>
          </div>
          <div class="row mb-3">
            <div class="col-sm-3">
              <label class="form-label fw-bold">{{ t('admin.storedJobs.user') }}</label>
            </div>
            <div class="col-sm-9">{{ currentStoredJob.username }}</div>
          </div>
          <div class="row mb-3">
            <div class="col-sm-3">
              <label class="form-label fw-bold">{{ t('admin.storedJobs.createdAt') }}</label>
            </div>
            <div class="col-sm-9">{{ formatDateTime(currentStoredJob.created_at) }}</div>
          </div>
          <div class="row mb-3">
            <div class="col-sm-3">
              <label class="form-label fw-bold">{{ t('admin.storedJobs.expiresAt') }}</label>
            </div>
            <div class="col-sm-9">{{ formatDateTime(currentStoredJob.expires_at) }}</div>
          </div>
          <div class="mb-3">
            <label class="form-label fw-bold">{{ t('admin.storedJobs.formData') }}</label>
            <pre
              v-highlightjs
              class="mt-2"
            ><code language="yaml" class="p-3 bg-light border rounded d-block">{{ formDataYaml }}</code></pre>
          </div>
        </div>
      </BsOffCanvas>
    </main>
  </div>
</template>
