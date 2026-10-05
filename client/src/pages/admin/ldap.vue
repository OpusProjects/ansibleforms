<script setup>
import { toast } from 'vue-sonner';
import Profile from '@/lib/Profile';
import axios from 'axios';
import getSettings from '@/config/settings';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
import TokenStorage from '@/lib/TokenStorage';
import yaml from 'yaml';

const authenticated = ref(false);
const showTestModal = ref(false);
const currentLdap = ref(null);
const testUser = ref('');
const testPassword = ref('');
const testResult = ref(null);

function openTestModal(ldap) {
  currentLdap.value = ldap;
  testUser.value = '';
  testPassword.value = '';
  testResult.value = null;
  showTestModal.value = true;
}

function closeTestModal() {
  showTestModal.value = false;
  testUser.value = '';
  testPassword.value = '';
  testResult.value = null;
}

async function performTest() {
  if (!testUser.value || !testPassword.value) {
    toast.error(t('admin.ldap.provideBoth'));
    return;
  }

  try {
    const testData = {
      ...currentLdap.value,
      testuser: testUser.value,
      testpassword: testPassword.value,
    };
    const result = await axios.post(`/api/v2/ldap/check`, testData, TokenStorage.getAuthentication());
    testResult.value = result.data;
    toast.success(t('admin.ldap.connectionSuccessful'));
  } catch (err) {
    testResult.value = null;
    const errorMessage = err.response?.data?.error || err.message;
    const errorDetail = err.response?.data?.details || '';
    toast.error(errorDetail ? `${errorMessage}, ${errorDetail}` : errorMessage);
  }
}

const testResultYaml = computed(() => {
  if (!testResult.value) return '';
  return yaml.stringify(testResult.value);
});

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) {
    return;
  }
});
</script>
<template>
  <BsModal v-if="showTestModal" @close="closeTestModal">
    <template #title>
      {{ t('admin.ldap.testTitle') }}
    </template>
    <template #default>
      <p class="mt-3 fs-6">
        {{ t('admin.ldap.testDescription') }}
      </p>
      <BsInput
        v-model="testUser"
        :label="t('admin.ldap.testUsername')"
        type="text"
        :placeholder="t('admin.ldap.testUsernamePlaceholder')"
        class="mb-3"
      />
      <BsInput
        v-model="testPassword"
        :label="t('admin.ldap.testPassword')"
        type="password"
        :placeholder="t('admin.ldap.testPasswordPlaceholder')"
        class="mb-3"
      />
      <div v-if="testResult" class="alert alert-success mt-3">
        <h6><faIcon icon="circle-check" class="me-2" />{{ t('admin.ldap.successTitle') }}</h6>
        <div class="mt-3">
          <strong>{{ t('admin.ldap.userInfo') }}</strong>
          <pre
            class="bg-light p-3 mt-2 rounded"
            style="max-height: 300px; overflow-y: auto"
          ><code>{{ testResultYaml }}</code></pre>
        </div>
      </div>
    </template>
    <template #footer>
      <BsButton icon="check" @click="performTest">Test</BsButton>
    </template>
  </BsModal>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap container-xxl">
      <AppSidebar />
      <AppAdminSingle v-if="authenticated" apiVersion="2" :settings="settings.ldap" @test="openTestModal" />
    </main>
  </div>
</template>
<route lang="yaml">
meta:
  layout: settings
</route>
