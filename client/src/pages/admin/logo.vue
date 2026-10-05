<script setup>
import axios from 'axios';
import { toast } from 'vue-sonner';
import TokenStorage from '@/lib/TokenStorage';
import State from '@/lib/State';
import Profile from '@/lib/Profile';
import { useAppStore } from '@/stores/app';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useAppStore();
const authenticated = ref(false);
const fileInput = ref(null);
const selectedFile = ref(null);
const preview = ref(null);
const busy = ref(false);

// keep in sync with the server (logo.controller.js) ; the server re-validates
// the type with magic-byte sniffing and enforces the size limit anyway
const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
const maxBytes = 900 * 1024;

function onFileChange(e) {
  selectedFile.value = null;
  preview.value = null;
  const file = e.target.files?.[0];
  if (!file) return;
  if (!allowedTypes.includes(file.type)) {
    toast.error(t('logo.invalidType'));
    fileInput.value.value = '';
    return;
  }
  if (file.size > maxBytes) {
    toast.error(t('logo.tooLarge'));
    fileInput.value.value = '';
    return;
  }
  selectedFile.value = file;
  const reader = new FileReader();
  reader.onload = () => {
    preview.value = reader.result;
  };
  reader.readAsDataURL(file);
}

function clearPreview() {
  selectedFile.value = null;
  preview.value = null;
  fileInput.value.value = '';
}

async function upload() {
  if (!selectedFile.value) return;
  busy.value = true;
  try {
    const formData = new FormData();
    formData.append('logo', selectedFile.value);
    await axios.post(`/api/v2/logo`, formData, TokenStorage.getAuthenticationMultipart());
    toast.success(t('logo.uploaded'));
    selectedFile.value = null;
    preview.value = null;
    fileInput.value.value = '';
    await State.loadLogo();
  } catch (err) {
    const error = err.response?.data?.error || err.message;
    const details = err.response?.data?.details;
    toast.error(details ? `${error}: ${details}` : error);
  } finally {
    busy.value = false;
  }
}

async function removeLogo() {
  busy.value = true;
  try {
    await axios.delete(`/api/v2/logo`, TokenStorage.getAuthentication());
    toast.success(t('logo.removed'));
    await State.loadLogo();
  } catch (err) {
    const error = err.response?.data?.error || err.message;
    const details = err.response?.data?.details;
    toast.error(details ? `${error}: ${details}` : error);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
});
</script>
<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap container-xxl">
      <AppSidebar />
      <AppSettings v-if="authenticated" icon="image" :title="t('logo.title')" :description="t('logo.description')">
        <template #actions>
          <BsButton
            icon="upload"
            :colorClass="!selectedFile || busy ? 'secondary' : 'primary'"
            :disabled="!selectedFile || busy"
            @click="upload()"
            >{{ t('logo.uploadButton') }}</BsButton
          >
          <BsButton
            v-if="store.customLogo && !store.logoIsDefault"
            cssClass="ms-3"
            icon="trash"
            :disabled="busy"
            @click="removeLogo()"
            >{{ t('logo.remove') }}</BsButton
          >
        </template>
        <template #default>
          <div class="row">
            <div class="col-md-6">
              <label class="form-label fw-bold mb-2">{{ t('logo.current') }}</label>
              <div class="logo-display-box">
                <img v-if="store.customLogo" :src="store.customLogo" class="logo-preview" />
                <span v-else class="text-muted fst-italic">{{ t('logo.default') }}</span>
              </div>
            </div>
            <div v-if="preview" class="col-md-6">
              <label class="form-label fw-bold mb-2">{{ t('logo.newLogo') }}</label>
              <div class="logo-display-box position-relative">
                <button type="button" class="btn-close btn-close-preview" @click="clearPreview"></button>
                <img :src="preview" class="logo-preview" />
              </div>
            </div>
          </div>
          <hr class="my-3" />
          <div>
            <input
              ref="fileInput"
              class="form-control"
              style="max-width: 400px"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              @change="onFileChange"
            />
          </div>
          <div class="form-text mt-3">{{ t('logo.constraints') }}</div>
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped lang="scss">
.logo-preview {
  max-width: 200px;
  max-height: 40px;
}
/* an svg without width/height has no size of its own (see .logo in BsNavBar.vue) */
.logo-preview[src^='data:image/svg+xml'] {
  height: 40px;
  width: auto;
}
.btn-close-preview {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  font-size: 0.6rem;
  opacity: 0.5;
  &:hover {
    opacity: 1;
  }
}
.logo-display-box {
  background-color: var(--bs-tertiary-bg);
  border: 1px dashed var(--bs-border-color);
  border-radius: 0.375rem;
  padding: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 5rem;
}
</style>
