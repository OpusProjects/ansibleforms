<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { toast } from 'vue-sonner';
import { useVuelidate } from '@vuelidate/core';
import { required, helpers, email } from '@vuelidate/validators';
import Profile from '@/lib/Profile';
import axios from 'axios';
import TokenStorage from '@/lib/TokenStorage';
import Helpers from '@/lib/Helpers';
import { useI18n } from 'vue-i18n';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const authenticated = ref(false);
// the tab shown, kept in the url (?tab=) : a link or a bookmark opens it, Back returns to the last
const { activeTab } = useRouteTab('smtp', (key) => ['smtp', 'test'].includes(key));
const item = ref({});
const originalItem = ref(null);

const mailFields = ['mail_server', 'mail_port', 'mail_secure', 'mail_username', 'mail_password', 'mail_from'];

// The mail fields and the url are the settings the declarative config seed owns, so a
// seeded instance answers 403 here. This page is bespoke rather than AppAdminSingle, so
// it does not inherit that component's managed handling and needs its own.
const isManaged = computed(() => !!item.value?.managed);

const isDirty = computed(() => {
  if (originalItem.value === null) return false;
  return mailFields.some((f) => item.value[f] !== originalItem.value[f]);
});

const rules = computed(() => ({
  item: {
    mail_server: { required: helpers.withMessage(`${t('settings.mail.mailServer')} is required`, required) },
    mail_port: { required: helpers.withMessage(`${t('settings.mail.mailPort')} is required`, required) },
    mail_from: {
      required: helpers.withMessage(`${t('settings.mail.mailFrom')} is required`, required),
      email: helpers.withMessage(`${t('settings.mail.mailFrom')} must be a valid email`, email),
    },
  },
  test: {
    to: {
      required: helpers.withMessage(t('admin.mail.enterDestination'), required),
      email: helpers.withMessage(t('admin.mail.validEmail'), email),
    },
  },
}));

const test = ref({
  to: '',
  subject: 'Test Email from AnsibleForms',
  body: 'This is a test email sent from AnsibleForms.',
});
const $v = useVuelidate(rules, { item, test });

async function loadItem() {
  try {
    const result = await axios.get(`/api/v2/settings/`, TokenStorage.getAuthentication());
    item.value = result.data;
    item.value.mail_secure = !!item.value.mail_secure;
    originalItem.value = JSON.parse(JSON.stringify(item.value));
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err, 'Failed to load settings'));
  }
}

async function updateItem() {
  $v.value.item.$touch();
  if ($v.value.item.$invalid) return;
  try {
    const { mail_server, mail_port, mail_secure, mail_username, mail_password, mail_from } = item.value;
    await axios.put(
      `/api/v2/settings/`,
      { mail_server, mail_port, mail_secure, mail_username, mail_password, mail_from },
      TokenStorage.getAuthentication(),
    );
    toast.success(t('settings.mail.label') + ' ' + t('settings.common.isUpdated'));
    await loadItem();
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

async function testConnection() {
  if ($v.value.test.$invalid) {
    $v.value.test.$touch();
    return;
  }
  try {
    const result = await axios.post(
      `/api/v2/settings/mailcheck`,
      { ...item.value, ...test.value },
      TokenStorage.getAuthentication(),
    );
    toast.success(result.data.message);
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

watch(
  () => item.value.mail_secure,
  (val, oldVal) => {
    if (oldVal !== undefined && (Number(item.value.mail_port) === 25 || Number(item.value.mail_port) === 587)) {
      item.value.mail_port = val ? 587 : 25;
    }
  },
);

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await loadItem();
});
</script>
<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="envelope"
        :title="t('sidebar.mail')"
        :description="t('settings.mail.description')"
      >
        <template #tabs>
          <ul class="nav nav-tabs mb-0">
            <li class="nav-item">
              <a
                class="nav-link"
                :class="{ active: activeTab === 'smtp' }"
                href="#"
                @click.prevent="activeTab = 'smtp'"
              >
                <FaIcon icon="server" class="me-1" />
                {{ t('settings.mail.smtpServer') }}
              </a>
            </li>
            <li class="nav-item">
              <a
                class="nav-link"
                :class="{ active: activeTab === 'test' }"
                href="#"
                @click.prevent="activeTab = 'test'"
              >
                <FaIcon icon="paper-plane" class="me-1" />
                {{ t('settings.mail.testMail') }}
              </a>
            </li>
          </ul>
        </template>
        <template #default>
          <div v-show="activeTab === 'smtp'">
            <div v-if="isManaged" class="alert alert-secondary py-2">
              <FaIcon icon="lock" class="me-2" />
              {{ t('settings.common.seedManagedNotice') }}
            </div>
            <div class="row">
              <div class="col">
                <BsInput
                  :disabled="isManaged"
                  :isFloating="false"
                  icon="server"
                  v-model="$v.item.mail_server.$model"
                  :label="t('settings.mail.mailServer')"
                  :required="true"
                  :help="t('settings.mail.mailServerHelp')"
                  :hasError="$v.item.mail_server.$invalid && $v.item.mail_server.$dirty"
                  :errors="$v.item.mail_server.$errors"
                />
              </div>
              <div class="col">
                <BsInput
                  :disabled="isManaged"
                  :isFloating="false"
                  icon="arrows-alt-v"
                  type="number"
                  v-model="$v.item.mail_port.$model"
                  :label="t('settings.mail.mailPort')"
                  :required="true"
                  :help="t('settings.mail.mailPortHelp')"
                  :hasError="$v.item.mail_port.$invalid && $v.item.mail_port.$dirty"
                  :errors="$v.item.mail_port.$errors"
                />
              </div>
            </div>
            <div class="row">
              <div class="col">
                <BsInput
                  :disabled="isManaged"
                  type="checkbox"
                  :isSwitch="true"
                  v-model="item.mail_secure"
                  :label="t('settings.mail.useTls')"
                  :help="t('settings.mail.useTlsHelp')"
                />
              </div>
            </div>
            <div class="row">
              <div class="col">
                <BsInput
                  :disabled="isManaged"
                  :isFloating="false"
                  icon="user"
                  v-model="item.mail_username"
                  :label="t('settings.mail.mailUsername')"
                  :help="t('settings.mail.mailUsernameHelp')"
                />
              </div>
              <div class="col">
                <BsInput
                  :disabled="isManaged"
                  :isFloating="false"
                  icon="key"
                  type="password"
                  v-model="item.mail_password"
                  :label="t('settings.mail.mailPassword')"
                  :help="t('settings.mail.mailPasswordHelp')"
                />
              </div>
            </div>
            <div class="row">
              <div class="col">
                <BsInput
                  :disabled="isManaged"
                  :isFloating="false"
                  icon="envelope"
                  type="email"
                  v-model="$v.item.mail_from.$model"
                  :label="t('settings.mail.mailFrom')"
                  :required="true"
                  :help="t('settings.mail.mailFromHelp')"
                  :hasError="$v.item.mail_from.$invalid && $v.item.mail_from.$dirty"
                  :errors="$v.item.mail_from.$errors"
                />
              </div>
            </div>
          </div>
          <div v-show="activeTab === 'test'">
            <div class="row">
              <div class="col">
                <BsInput
                  :isFloating="false"
                  v-model="$v.test.to.$model"
                  icon="envelope"
                  type="email"
                  :label="t('admin.mail.mailTo')"
                  :required="true"
                  :hasError="$v.test.to.$invalid && $v.test.to.$dirty"
                  :errors="$v.test.to.$errors"
                />
              </div>
            </div>
            <div class="row">
              <div class="col">
                <BsInput
                  :isFloating="false"
                  v-model="test.subject"
                  icon="heading"
                  :label="t('settings.mail.subject')"
                />
              </div>
            </div>
            <div class="row">
              <div class="col">
                <BsInput
                  :isFloating="false"
                  v-model="test.body"
                  icon="align-left"
                  type="textarea"
                  :label="t('settings.mail.body')"
                />
              </div>
            </div>
          </div>
        </template>
        <template #actions>
          <BsButton
            v-if="activeTab === 'smtp'"
            icon="save"
            :colorClass="isDirty && !isManaged ? 'primary' : 'secondary'"
            :disabled="!isDirty || isManaged"
            @click="updateItem()"
            >{{ t('settings.common.save') }}</BsButton
          >
          <BsButton
            v-else
            icon="paper-plane"
            :colorClass="test.to ? 'primary' : 'secondary'"
            :disabled="!test.to"
            @click="testConnection()"
            >{{ t('settings.mail.testMail') }}</BsButton
          >
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped>
:deep(.card-body) {
  padding-top: 1.25rem;
  /* see AppAdminSingle : one padding, no extra row padding stacked on it */
  padding-bottom: 1rem;
}
:deep(.card-body .row:last-child > .col > .mb-3) {
  margin-bottom: 0 !important;
}
:deep(.form-label:has(+ div > .form-check)) {
  display: none;
}
</style>
