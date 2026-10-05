<script setup>
import { toast } from 'vue-sonner';
import Profile from '@/lib/Profile';
import axios from 'axios';
import getSettings from '@/config/settings';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
import TokenStorage from '@/lib/TokenStorage';
import Helpers from '@/lib/Helpers';

const authenticated = ref(false);
const tests = ref({});

async function test_connection(item) {
  if (item) {
    if (!tests.value[item.id]) {
      try {
        tests.value[item.id] = t('admin.testing');
        const result = await axios.post(`/api/v2/awx/${item.id}/check`, {}, TokenStorage.getAuthentication());
        toast.success(result.data.result);
      } catch (err) {
        toast.error(Helpers.parseAxiosResponseError(err, t('admin.connectionFailed')));
      } finally {
        delete tests.value[item.id];
      }
    } else {
      toast.warning(t('admin.testInProgress'));
    }
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
      <AppAdminMulti
        v-if="authenticated"
        :settings="settings.aap"
        @test="test_connection"
        :busyItems="tests"
        :apiVersion="2"
      />
    </main>
  </div>
</template>
