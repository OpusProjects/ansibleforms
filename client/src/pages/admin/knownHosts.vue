<script setup>
import { ref } from 'vue';
import Profile from '@/lib/Profile';
import Helpers from '@/lib/Helpers';
import getSettings from '@/config/settings';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
import { toast } from 'vue-sonner';

const currentItem = ref(null);

const authenticated = ref(false);

function preview(item) {
  try {
    currentItem.value = item;
    // clipboard.writeSync(currentItem.value)
    Helpers.copyToClipboard(currentItem.value)
      .then(() => toast.success(t('admin.copiedToClipboard')))
      .catch(() => toast.error(t('admin.clipboardHttpsRequired')));
  } catch {
    toast.error(t('admin.clipboardHttpsRequired'));
  }
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
    <main class="d-flex flex-nowrap container-xxl">
      <AppSidebar />
      <AppAdminMulti v-if="authenticated" apiVersion="2" :settings="settings.knownhosts" @preview="preview" />
    </main>
  </div>
</template>
