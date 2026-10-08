<script setup>
import { toast } from 'vue-sonner';
import { ref, onMounted } from 'vue';
import getSettings from '@/config/settings';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
import Profile from '@/lib/Profile';
import axios from 'axios';
import TokenStorage from '@/lib/TokenStorage';
import Helpers from '@/lib/Helpers.js';

const adminMulti = ref(null);
const authenticated = ref(false);
const currentBackup = ref(null);
const showBackupDetails = ref(false);
const restores = ref({});
const backupFirst = ref(true);
const action = ref('');

function previewDetails(folder) {
  currentBackup.value = folder;
  showBackupDetails.value = true;
}

function offcanvasClose() {
  showBackupDetails.value = false;
}

// Separate from triggerRestore on purpose. The environment file is captured by every backup
// but never restored with one, because DB_HOST, the paths and the TLS locations in it describe
// the machine the backup was taken on - so this is an explicit, separate action.
async function triggerRestoreEnv(item) {
  try {
    const result = await axios.post(`/api/v2/backup/${item.folder}/restore-env`, {}, TokenStorage.getAuthentication());
    const data = result.data?.data ?? result.data;
    if (data?.restored) {
      toast.success(t('admin.backups.restoreEnvDone'));
    } else {
      toast.warning(data?.reason || t('admin.backups.notFound'));
    }
    restoreClose();
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

function restoreClose() {
  action.value = '';
  backupFirst.value = true;
}

function restoreOpen(folder) {
  currentBackup.value = folder;
  action.value = 'restore';
}

async function triggerRestore(item) {
  // the button is hidden for these, but the row action can still open the dialog :
  // never send a restore the server is going to refuse anyway
  if (item && !item.valid) {
    toast.error(t('admin.backups.incompleteDetail'));
    return;
  }
  // Read the choice BEFORE closing the dialog : restoreClose() resets backupFirst to
  // true, and it used to run first - so unticking "backup before restore" changed
  // nothing and a full mysqldump was taken every time. Worse than wasted work: the
  // model aborts the whole restore when that pre-backup fails, so a restore could be
  // refused because of a backup the user had explicitly declined.
  const withBackup = backupFirst.value;
  restoreClose();
  if (item) {
    if (!restores.value[item.folder]) {
      try {
        restores.value[item.folder] = t('admin.backups.restoring');
        const result = await axios.post(
          `/api/v2/backup/${item.folder}/restore?backupFirst=${withBackup}`,
          {},
          TokenStorage.getAuthentication(),
        );
        toast.success(result.data.message);
        adminMulti.value.loadItems();
      } catch (err) {
        const msg = Helpers.parseAxiosResponseError(err, t('admin.backups.restoreFailed'));
        toast.error(msg);
      } finally {
        // by FOLDER, the key it was set under. A backup record has no `id` at all
        // (describeBackup returns folder/date/description/valid), so this deleted
        // restores[undefined] and left the in-progress marker set for ever -
        // every later restore of that folder answered "restore in progress" and
        // the only way out was reloading the page.
        delete restores.value[item.folder];
      }
    } else {
      toast.warning(t('admin.backups.restoreInProgress'));
    }
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
});
</script>

<template>
  <BsModal v-if="action == 'restore'" @close="restoreClose">
    <template #title> {{ t('admin.backups.restoreTitle') }} {{ currentBackup.folder }} </template>
    <template #default>
      <div v-if="currentBackup && !currentBackup.valid" class="alert alert-warning mt-3 mb-0" role="alert">
        <strong>{{ t('admin.backups.incomplete') }}</strong
        ><br />
        {{ t('admin.backups.incompleteDetail') }}
      </div>
      <ul class="list-group list-group-flush mt-3">
        <li class="list-group-item">
          <strong>{{ t('admin.backups.folder') }}:</strong> {{ currentBackup.folder }}
        </li>
        <li class="list-group-item">
          <strong>{{ t('admin.backups.date') }}:</strong> {{ Helpers.formatServerDate(currentBackup.date) }}
        </li>
        <li class="list-group-item" v-if="currentBackup.description">
          <strong>{{ t('admin.backups.description') }}:</strong> {{ currentBackup.description }}
        </li>
        <li class="list-group-item">
          <strong>{{ t('admin.backups.backupFile') }}:</strong>
          <span v-if="currentBackup.backupFileExists">
            {{ t('admin.backups.exists') }} ({{ Helpers.humanFileSize(currentBackup.backupFileSize) }})
          </span>
          <span v-else>
            {{ t('admin.backups.notFound') }}
          </span>
        </li>
        <li class="list-group-item">
          <strong>{{ t('admin.backups.configYaml') }}:</strong>
          <span v-if="currentBackup.configYamlExists">
            {{ t('admin.backups.exists') }} ({{ Helpers.humanFileSize(currentBackup.configYamlSize) }})
          </span>
          <span v-else>
            {{ t('admin.backups.notFound') }}
          </span>
        </li>
        <li class="list-group-item">
          <strong>{{ t('admin.backups.envFile') }}:</strong>
          <span v-if="currentBackup.envFileExists">
            {{ t('admin.backups.exists') }} ({{ Helpers.humanFileSize(currentBackup.envFileSize) }})
            <div class="form-text">{{ t('admin.backups.envFileHelp') }}</div>
          </span>
          <span v-else>
            {{ t('admin.backups.notFound') }}
          </span>
        </li>
        <li class="list-group-item">
          <strong>{{ t('admin.backups.formsDirectory') }}:</strong>
          <span v-if="currentBackup.formsDirExists">
            {{ t('admin.backups.exists') }} ({{ t('admin.backups.fileCount', currentBackup.formsDirFileCount) }},
            {{ Helpers.humanFileSize(currentBackup.formsDirTotalSize) }})
          </span>
          <span v-else>
            {{ t('admin.backups.notFound') }}
          </span>
        </li>
      </ul>
      <br />
      <BsCheckbox v-model="backupFirst" :label="t('admin.backups.backupBeforeRestore')" class="mb-3" />
    </template>
    <template #footer>
      <BsButton
        v-if="currentBackup?.envFileExists"
        icon="file-import"
        colorClass="secondary"
        @click="triggerRestoreEnv(currentBackup)"
        >{{ t('admin.backups.restoreEnv') }}</BsButton
      >
      <BsButton v-if="currentBackup?.valid" icon="undo" @click="triggerRestore(currentBackup)">{{
        t('admin.backups.restoreTitle')
      }}</BsButton>
    </template>
  </BsModal>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppAdminMulti
        v-if="authenticated"
        ref="adminMulti"
        :settings="settings.backups"
        apiVersion="2"
        @trigger="restoreOpen"
        @preview="previewDetails"
        @reset="null"
      />
      <BsOffCanvas :title="t('admin.backups.backupDetails')" :show="showBackupDetails" @close="offcanvasClose">
        <div v-if="currentBackup">
          <div v-if="!currentBackup.valid" class="alert alert-warning" role="alert">
            <strong>{{ t('admin.backups.incomplete') }}</strong
            ><br />
            {{ t('admin.backups.incompleteDetail') }}
          </div>
          <ul class="list-group list-group-flush">
            <li class="list-group-item">
              <strong>{{ t('admin.backups.folder') }}:</strong> {{ currentBackup.folder }}
            </li>
            <li class="list-group-item">
              <strong>{{ t('admin.backups.date') }}:</strong> {{ Helpers.formatServerDate(currentBackup.date) }}
            </li>
            <li class="list-group-item" v-if="currentBackup.description">
              <strong>{{ t('admin.backups.description') }}:</strong> {{ currentBackup.description }}
            </li>
            <li class="list-group-item">
              <strong>{{ t('admin.backups.backupFile') }}:</strong>
              <span v-if="currentBackup.backupFileExists">
                {{ t('admin.backups.exists') }} ({{ Helpers.humanFileSize(currentBackup.backupFileSize) }})
              </span>
              <span v-else>
                {{ t('admin.backups.notFound') }}
              </span>
            </li>
            <li class="list-group-item">
              <strong>{{ t('admin.backups.configYaml') }}:</strong>
              <span v-if="currentBackup.configYamlExists">
                {{ t('admin.backups.exists') }} ({{ Helpers.humanFileSize(currentBackup.configYamlSize) }})
              </span>
              <span v-else>
                {{ t('admin.backups.notFound') }}
              </span>
            </li>
            <li class="list-group-item">
              <strong>{{ t('admin.backups.formsDirectory') }}:</strong>
              <span v-if="currentBackup.formsDirExists">
                {{ t('admin.backups.exists') }} ({{ t('admin.backups.fileCount', currentBackup.formsDirFileCount) }},
                {{ Helpers.humanFileSize(currentBackup.formsDirTotalSize) }})
              </span>
              <span v-else>
                {{ t('admin.backups.notFound') }}
              </span>
            </li>
          </ul>
        </div>
        <div v-else>
          {{ t('admin.loading') }}
        </div>
      </BsOffCanvas>
    </main>
  </div>
</template>
