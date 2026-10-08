<script setup>
import State from '@/lib/State';
import axios from 'axios';
import { useAppStore } from '@/stores/app';
import { toast } from 'vue-sonner';
import { useRoute, useRouter } from 'vue-router';
import TokenStorage from '@/lib/TokenStorage';
import Navigate from '@/lib/Navigate';

const store = useAppStore();

const route = useRoute();
const router = useRouter();

// redirect to login page if not oidc
var userType = store.profile?.type || 'local';

// For OIDC, get logout URL first before clearing tokens
if (userType == 'oidc') {
  axios
    .get(`/api/v2/auth/logout`)
    .then((res) => {
      // clear all authentication states AFTER getting logout URL
      TokenStorage.clear();
      State.refreshAuthenticated();
      State.loadProfile();

      const logoutUrl = res?.data?.logoutUrl;
      if (logoutUrl) {
        // Go to Keycloak end-session endpoint
        location.replace(logoutUrl);
      } else {
        // If no IdP logout URL, at least go back to login
        Navigate.toLogin(router, route);
      }
    })
    .catch((err) => {
      console.log(err);
      // Clear tokens even on error
      TokenStorage.clear();
      State.refreshAuthenticated();
      State.loadProfile();
      toast.error('Could not log out');
      // fallback: go to login anyway
      Navigate.toLogin(router, route);
    });
} else {
  // For local/ldap/azuread, clear tokens immediately
  TokenStorage.clear();
  State.refreshAuthenticated();
  State.loadProfile();
  Navigate.toLogin(router, route);
}
</script>
<template>
  <!-- centered both ways, where the sign-in card appears next : the spinner sat on the left
       edge, the inner box being only as wide as the spinner -->
  <div class="d-flex align-items-center justify-content-center py-4 bg-body-tertiary login vh-100">
    <div class="d-flex justify-content-center">
      <div class="spinner-border" role="status">
        <span class="visually-hidden">Logging out...</span>
      </div>
    </div>
  </div>
</template>
<style scoped lang="scss">
[data-bs-theme='light'] {
  .login {
    background-image: var(--af-login-background-light) !important;
    background-size: cover;
  }
}

[data-bs-theme='dark'] {
  .login {
    background-image: var(--af-login-background-dark) !important;
    background-size: cover;
  }
}

[data-bs-theme='color'] {
  .login {
    background-image: var(--af-login-background-color) !important;
    background-size: cover;
  }
}
</style>
