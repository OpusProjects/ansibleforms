<script setup>
import axios from 'axios';
import Profile from '@/lib/Profile';
import getSettings from '@/config/settings';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
import TokenStorage from '@/lib/TokenStorage';

const adminMulti = ref(null);
const currentSchedule = ref(null);
const showScheduleOutput = ref(false);
const authenticated = ref(false);

function previewOutput(schedule) {
  currentSchedule.value = schedule;
  showScheduleOutput.value = true;
}

function offcanvasClose() {
  showScheduleOutput.value = false;
}

async function triggerLaunch(schedule) {
  adminMulti.value.setItemProperty({ id: schedule.id, key: 'status', value: 'running' });
  await axios.post(`/api/v2/schedule/${schedule.id}/launch`, {}, TokenStorage.getAuthentication());
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
        apiVersion="2"
        ref="adminMulti"
        :settings="settings.schedules"
        @preview="previewOutput"
        @trigger="triggerLaunch"
      />
      <BsOffCanvas :title="t('admin.lastOutput')" :show="showScheduleOutput" @close="offcanvasClose">
        <pre>{{ currentSchedule?.output || t('admin.loading') }}</pre>
      </BsOffCanvas>
    </main>
  </div>
</template>
