<script setup>
import { ref, onMounted } from 'vue';
// import { toast } from 'vue-sonner';
import Profile from '@/lib/Profile';
// import axios from 'axios';
import getSettings from '@/config/settings';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
// import TokenStorage from '@/lib/TokenStorage';

//
const authenticated = ref(false);

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
      <div class="d-flex flex-column w-100">
        <AppAdminMulti v-if="authenticated" :apiVersion="2" :settings="settings.oauth2_providers" />
        <div class="alert alert-warning m-3" role="alert">
          <h5 class="alert-heading">
            <i class="fas fa-exclamation-triangle"></i> {{ t('admin.oauth2.callbackWarningTitle') }}
          </h5>
          <p class="mb-0">
            <strong>{{ t('admin.oauth2.callbackWarningEditNote') }}</strong
            >, {{ t('admin.oauth2.callbackWarningUpdated') }}
          </p>
          <ul class="mb-0 mt-2">
            <li>
              <strong>{{ t('admin.oauth2.entraId') }}</strong> <code>/api/v2/auth/azureadoauth2/callback</code>
            </li>
            <li>
              <strong>{{ t('admin.oauth2.openId') }}</strong> <code>/api/v2/auth/oidc/callback</code>
            </li>
          </ul>
          <p class="mb-0 mt-2">
            <strong>{{ t('admin.oauth2.actionRequired') }}</strong> {{ t('admin.oauth2.actionRequiredMsg') }}
          </p>
        </div>
        <div class="accordion m-3" id="providerHelpAccordion">
          <div class="accordion-item">
            <h2 class="accordion-header" id="headingEntraId">
              <button
                class="accordion-button collapsed"
                type="button"
                data-bs-toggle="collapse"
                data-bs-target="#collapseEntraId"
                aria-expanded="false"
                aria-controls="collapseEntraId"
              >
                {{ t('admin.oauth2.entraIdHelp') }}
              </button>
            </h2>
            <div
              id="collapseEntraId"
              class="accordion-collapse collapse"
              aria-labelledby="headingEntraId"
              data-bs-parent="#providerHelpAccordion"
            >
              <div class="accordion-body">
                <strong>{{ t('admin.oauth2.requiredPermissions') }}</strong
                ><br />
                <ul>
                  <li>{{ t('admin.oauth2.delegatedUserRead') }}</li>
                  <li>{{ t('admin.oauth2.delegatedGroupRead') }}</li>
                </ul>
                <strong>{{ t('admin.oauth2.requiredGroupClaims') }}</strong>
                <ul>
                  <li>{{ t('admin.oauth2.securityGroups') }}</li>
                  <li>{{ t('admin.oauth2.accessSamAccount') }}</li>
                </ul>
              </div>
            </div>
          </div>
          <div class="accordion-item">
            <h2 class="accordion-header" id="headingOpenId">
              <button
                class="accordion-button collapsed"
                type="button"
                data-bs-toggle="collapse"
                data-bs-target="#collapseOpenId"
                aria-expanded="false"
                aria-controls="collapseOpenId"
              >
                {{ t('admin.oauth2.openIdHelp') }}
              </button>
            </h2>
            <div
              id="collapseOpenId"
              class="accordion-collapse collapse"
              aria-labelledby="headingOpenId"
              data-bs-parent="#providerHelpAccordion"
            >
              <div class="accordion-body">
                <strong>{{ t('admin.oauth2.openIdNotice') }}</strong> {{ t('admin.oauth2.openIdTestedWith') }}
              </div>
            </div>
          </div>
          <!-- Add more accordion-item blocks here for other providers as needed -->
        </div>
      </div>
    </main>
  </div>
</template>
