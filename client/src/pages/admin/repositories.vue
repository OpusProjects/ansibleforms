<script setup>
import axios from 'axios';
import Profile from '@/lib/Profile';
import getSettings from '@/config/settings';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
import TokenStorage from '@/lib/TokenStorage';

const adminMulti = ref(null);
const authenticated = ref(false);

async function triggerClone(repo) {
  adminMulti.value.setItemProperty({ id: repo.name, key: 'status', value: 'running' });
  await axios.post(`/api/v2/repository/${repo.name}/clone`, {}, TokenStorage.getAuthentication());
  // wait 1 second to visually see the change
  await new Promise((r) => setTimeout(r, 1000));
  adminMulti.value.loadItems();
}
async function triggerSync(repo) {
  adminMulti.value.setItemProperty({ id: repo.name, key: 'status', value: 'running' });
  await axios.post(`/api/v2/repository/${repo.name}/sync`, {}, TokenStorage.getAuthentication()).catch(() => {});
  // wait 1 second to visually see the change
  await new Promise((r) => setTimeout(r, 1000));
  adminMulti.value.loadItems();
}
async function triggerReset(repo) {
  adminMulti.value.setItemProperty({ id: repo.name, key: 'status', value: 'running' });
  await axios.post(`/api/v2/repository/${repo.name}/reset`, {}, TokenStorage.getAuthentication());
  // wait 1 second to visually see the change
  await new Promise((r) => setTimeout(r, 1000));
  adminMulti.value.loadItems();
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
        ref="adminMulti"
        :settings="settings.repositories"
        :apiVersion="2"
        @trigger="triggerClone"
        @reset="triggerReset"
        @sync="triggerSync"
      />
    </main>
  </div>
</template>
