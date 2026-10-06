<script setup>
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { Toaster } from 'vue-sonner';

import TokenStorage from '@/lib/TokenStorage';
import Navigate from '@/lib/Navigate';
import { useAppStore } from '@/stores/app';
import State from '@/lib/State';
import { isNewerBuild, clientSha } from '@/lib/Version';
import Theme from '@/lib/Theme';

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const isLoaded = ref(false);
const initComplete = ref(false);
// const theme = useTheme();

// every response names the server's build (X-App-Build) : a newer one than this tab's means the
// tab was opened before an upgrade, and the banner under the header offers a reload (issue #660)
function checkBuild(response) {
  const serverSha = response?.headers?.['x-app-build'];
  if (isNewerBuild(serverSha, clientSha())) appStore.newVersionAvailable = true;
}

function registerAxiosInterceptor() {
  // this is the token refresh control
  // if we get a 401 error, we should try to refresh the tokens first and and have second attempt
  axios.interceptors.response.use(
    (response) => {
      checkBuild(response);
      // Return a successful response back to the calling service
      return response;
    },
    async (error) => {
      checkBuild(error.response);
      // Return any error which is not due to authentication back to the calling service
      if (error.response?.status !== 401) {
        throw error;
      } else {
        // Don't handle auth errors until init completes (database check done)
        if (!initComplete.value) {
          throw error;
        }
        // Logout user if token refresh didn't work or user is disabled
        console.log('Axios 401 error occurred, we are not authorized');

        // Don't intercept login endpoints - let them handle their own errors
        const url = error?.config?.url || '';
        if (
          url.includes('/api/v2/auth/login') ||
          url.includes('/auth/azureadoauth2/login') ||
          url.includes('/auth/oidc/login')
        ) {
          throw error;
        }

        // A permission failure is NOT an authentication failure : the server answers
        // 403 for those (see server/src/lib/middleware.js) and it never reaches here,
        // so a page may probe an endpoint it might not have and simply catch the
        // error. This used to test the error message for 'No access', which only
        // ever matched in english - in any other locale it fell through to the
        // refresh below, refreshed fine (the token was valid all along), retried,
        // and 401'd again forever.
        if (error?.config?.url == `/api/v2/token` || error?.response?.data?.error == 'Account is disabled.') {
          console.log('The error is from token refresh or account is disabled, no refresh possible');
          var message = 'Unauthorized.  Access denied.';
          if (error?.response?.data?.error) {
            message += '\r\n' + error.response.data.error;
          }
          if (error?.response?.data?.details) {
            message += '\r\n' + error.response.data.details;
          }
          // clear token storage and redirect to login
          TokenStorage.clear();
          Navigate.toLogin(router, route);
          // throw new error back to axios, stop processing
          throw new Error(message);
        }

        // The retry below re-enters this interceptor. If the fresh token is STILL
        // refused, refreshing a second time cannot help - without this guard the
        // pair would keep refreshing and retrying indefinitely.
        if (error?.config?.__isRetry) {
          console.log('Already retried once with a fresh token, giving up');
          TokenStorage.clear();
          Navigate.toLogin(router, route);
          return Promise.reject({ __silent__: true });
        }

        // Try request again with new token.  Anything thrown from here on is left
        // to propagate : it will likely be a new 401 error, not authorized to
        // refresh, and it will be caught by this interceptor in a second run.
        // In all other cases, something was wrong with the token refresh.
        const token = await TokenStorage.getNewToken();
        if (!token) {
          // No token was returned, this means the user is not authenticated
          // Silently redirect to login without spamming errors
          TokenStorage.clear();
          Navigate.toLogin(router, route);
          // Return a rejected promise to stop axios processing, but suppress the error message
          return Promise.reject({ __silent__: true });
        }
        console.log('Refresh done');
        console.log('Retrying previous call with new tokens');
        // New request with new token
        const config = error.config;
        config.headers['Authorization'] = `Bearer ${token}`;
        config.__isRetry = true;

        const retryResponse = await axios.request(config);
        if (retryResponse.error) {
          // The response itself contains an error, throw it
          throw retryResponse.error;
        } else {
          // finally, the refresh worked and the response retried was successful
          return retryResponse;
        }
      }
    },
  );
}

async function checkDatabase() {
  console.log('Checking database');
  var result;
  try {
    result = await State.checkDatabase();
  } catch (err) {
    console.log(err);
    Navigate.toError(router);
    initComplete.value = true;
    // Don't set isLoaded - error page should show without it
    return;
  }
  if (result) {
    initComplete.value = true;
    isLoaded.value = true;
    await login();
  } else {
    Navigate.toSchema(router);
    initComplete.value = true;
    // Don't set isLoaded - schema page should show without it
  }
}

async function login() {
  console.log('login from app');
  await State.init(router, route);
}

onMounted(async () => {
  console.log('App is mounted');
  Theme.load();
  console.log('Theme is loaded');
  await router.isReady();
  registerAxiosInterceptor(); // setup token refresh, an axios interceptor
  console.log('Router is ready');
  await checkDatabase();
  console.log('Database check complete');
});
</script>

<template>
  <!-- lifted above the chat button, which shares the bottom-right corner -->
  <Toaster
    position="bottom-right"
    :duration="5000"
    :close-button="true"
    :theme="appStore.theme"
    :expand="true"
    :offset="{ bottom: '6rem', right: '1.25rem' }"
  />
  <AppChat />
  <router-view v-if="isLoaded || route.name === '/schema' || route.name === '/login' || route.name === '/error'" />
  <div v-else class="d-flex justify-content-center align-items-center vh-100">
    <div class="text-center">
      <div class="spinner-border text-primary mb-3" role="status" style="width: 3rem; height: 3rem">
        <span class="visually-hidden">Loading...</span>
      </div>
      <p>Loading...</p>
    </div>
  </div>
</template>
<style>
@import 'roboto-fontface/css/roboto/roboto-fontface.css';
</style>
