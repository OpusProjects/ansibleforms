<script setup>
import { ref, onMounted } from 'vue';
import { useVuelidate } from '@vuelidate/core';
import { required } from '@vuelidate/validators';
import TokenStorage from '@/lib/TokenStorage'; // work with tokens and local storage
import BaseUrl from '@/lib/BaseUrl';
import State from '@/lib/State'; // work with state
import Navigate from '@/lib/Navigate'; // navigate to routes
import Helpers from '@/lib/Helpers'; // helper functions
import { toast } from 'vue-sonner';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import Theme from '@/lib/Theme';
import { jwtDecode } from 'jwt-decode';
import { useAppStore } from '@/stores/app';

// plugins

const route = useRoute();
const router = useRouter();
// the logo above the form : the custom logo when one is set, as in the header
const store = useAppStore();

// vuelidate
const rules = {
  user: {
    username: {
      required,
    },
    password: {
      required,
    },
  },
};
// data
const user = ref({
  username: '',
  password: '',
});

const currentTheme = ref(Theme.load());
const loading = ref(false);
const azureAdEnabled = ref(false);
const azureGraphUrl = ref('');
const oidcEnabled = ref(false);
const oidcIssuer = ref('');

// validation
const $v = useVuelidate(rules, { user });

// methods
function authAzureAd() {
  localStorage.setItem('authIssuer', 'azuread'); // set cookie to azuread
  window.location.replace(`${BaseUrl}/api/v2/auth/azureadoauth2`); // redirect to azuread
}
function authOidc() {
  localStorage.setItem('authIssuer', 'oidc'); // set cookie to oidc
  window.location.replace(`${BaseUrl}/api/v2/auth/oidc`); // redirect to oidc
}
function getGroupsAndLogin(token, url, type = 'azuread') {
  if (type === 'azuread') {
    // The token in the url is OUR handoff, not an Azure access token (6.3.0) : the server
    // fetches the groups from Microsoft Graph itself at the login step (#548)
    tokenLogin(token, []);
  } else {
    // OIDC branch for now => specify type in the future?
    // decode token with "jwt-decode"
    const payload = jwtDecode(token);

    if (!payload) {
      toast.error('Failed to decode login token');
      return;
    }

    tokenLogin(token, payload.groups || [], 'oidc');
  }
}
async function tokenLogin(token, allGroups, type = 'azuread') {
  // No group filter here : the server applies the provider's group filter to the groups
  // it trusts (the claim in the handoff token), for Entra ID and OIDC alike. Filtering
  // in the browser only ever touched the posted list, which the server ignores whenever
  // the token carries a groups claim.
  const loginProvider = type === 'azuread' ? 'azureadoauth2' : 'oidc';

  try {
    const result = await axios.post(`/api/v2/auth/${loginProvider}/login`, { token: token, groups: allGroups });
    processLogin(result.data);
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err, 'Identity Provider Login failed'));
  }
}
async function getSettings(token) {
  try {
    const result = await axios.get(`/api/v2/auth/settings`);

    azureAdEnabled.value = !!result.data.azureAdEnabled;
    azureGraphUrl.value = result.data.azureGraphUrl;

    oidcEnabled.value = !!result.data.oidcEnabled;
    oidcIssuer.value = result.data.oidcIssuer;

    if (token && azureAdEnabled.value) {
      if (localStorage.getItem('authIssuer') == 'azuread')
        // get cookie and see if we issued azuread
        getGroupsAndLogin(token);
    }
    if (token && oidcEnabled.value) {
      // get cookie ans see if we issued oidc
      if (localStorage.getItem('authIssuer') == 'oidc')
        getGroupsAndLogin(token, `${oidcIssuer.value}/protocol/openid-connect/userinfo`, 'oidc');
    }
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err, 'Failed to get settings'));
  }
}
function processLogin(data) {
  TokenStorage.storeToken(data.token);
  TokenStorage.storeRefreshToken(data.refreshtoken);

  if (!TokenStorage.isAuthenticated()) {
    // console.log("Not authenticated, redirecting to login")
    Navigate.toLogin(router, route);
  } else {
    // console.log("Authenticated")
    Navigate.toOrigin(router, route);
    State.refreshAuthenticated();
    State.loadProfile();
    // the approvals count is loaded by the header (AppNav) as soon as it appears
  }
}
async function login() {
  localStorage.removeItem('authIssuer'); // remove cookie, regular login
  if (!$v.value.user.$invalid) {
    try {
      console.log('Logging in');
      var basicAuth = 'Basic ' + btoa(`${user.value.username}:${user.value.password}`);
      var postconfig = {
        headers: { Authorization: basicAuth },
      };
      const result = await axios.post(`/api/v2/auth/login`, {}, postconfig);
      processLogin(result.data);
    } catch (err) {
      TokenStorage.clear();
      toast.error(Helpers.parseAxiosResponseError(err, 'Login failed'));
    }
  } else {
    toast.error('Form is not valid');
    $v.value.user.$touch();
  }
}
onMounted(() => {
  // TODO => check database before all else

  if (route.query.token) {
    loading.value = true;
    getSettings(route.query.token);
  } else {
    getSettings();
  }
  if (route.query.error) {
    toast.error(route.query.error);
  }
  State.loadVersion();
  State.loadLogo();
});
</script>

<template>
  <div class="d-flex align-items-center py-4 bg-body-tertiary login vh-100">
    <div class="dropdown position-fixed top-0 end-0 mt-3 me-3 bd-mode-toggle">
      <BsThemeSwitcher buttonClass="btn-bd-primary py-2" v-model="currentTheme" />
    </div>

    <div class="card form-signin w-100 m-auto">
      <div class="card-body">
        <div class="login-logo">
          <!-- an uploaded logo ; not the server's built-in default, which is the light logo and
               would replace the dark theme's own -->
          <img v-if="store.customLogo && !store.logoIsDefault" :src="store.customLogo" alt="AnsibleForms" />
          <img v-else-if="currentTheme === 'dark'" :src="'img/logo_dark.svg'" alt="AnsibleForms" />
          <!-- the color theme's white logo is made for its colored header : the card is white -->
          <img v-else :src="'img/logo_light.svg'" alt="AnsibleForms" />
        </div>
        <h5 class="card-title login-title">Please sign in</h5>
        <BsInput
          v-model="user.username"
          @keyup_enter="login()"
          label="Username"
          placeholder="Username"
          icon="user"
          :hasError="$v.user.username.$invalid && $v.user.username.$dirty"
          :errors="$v.user.username.$errors"
        />
        <BsInput
          v-model="user.password"
          @keyup_enter="login()"
          type="password"
          label="Password"
          placeholder="Password"
          icon="lock"
          :hasError="$v.user.password.$invalid && $v.user.password.$dirty"
          :errors="$v.user.password.$errors"
        />
        <button class="btn btn-primary w-100 py-2 login-submit" @click="login()">Sign in</button>
        <!-- single sign-on : under a divider, its providers in a centred row of equal buttons -->
        <template v-if="azureAdEnabled || oidcEnabled">
          <div class="login-divider"><span>or</span></div>
          <div class="login-sso">
            <button
              v-if="azureAdEnabled"
              type="button"
              class="login-sso-btn"
              title="Sign in with Microsoft"
              aria-label="Sign in with Microsoft"
              @click="authAzureAd()"
            >
              <!-- the Microsoft logo, as Microsoft's sign-in buttons carry it (its branding
                   guidelines) : four squares, its four colours -->
              <svg class="login-ms-logo" viewBox="0 0 21 21" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
            </button>
            <button
              v-if="oidcEnabled"
              type="button"
              class="login-sso-btn"
              title="Sign in with OpenID Connect"
              aria-label="Sign in with OpenID Connect"
              @click="authOidc()"
            >
              <!-- the OpenID mark in its colours : the orange I, the grey swoosh and arrow -->
              <svg class="login-oidc-logo" viewBox="0 0 512 512" aria-hidden="true">
                <path fill="#f7931e" d="M310.2 18.9L232.7 56.7V493l77.4-36.5z" />
                <path
                  fill="#9a9a9a"
                  d="M232.7 444.4C144.2 433.3 77.7 385.1 77.7 327c0-55 59.7-101.3 141.4-115.4V162.3C94.3 177.5 0 245.3 0 327c0 84.5 101.1 154.5 232.7 166z"
                />
                <path
                  fill="#9a9a9a"
                  d="M323.8 162.3v49.3c30.5 5.3 57.8 14.9 80.2 27.9l-42 23.7 150 32.6L501.3 184.7l-39.9 22.6c-37.1-22.6-84.5-38.6-137.6-45z"
                />
              </svg>
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-signin {
  /* the width of a usual login card : wider stretches the fields */
  max-width: 450px;
  padding: 1rem;
  /* a soft shadow all around, lifting the card off the background */
  box-shadow: 0 0 1.5rem rgba(0, 0, 0, 0.18);
}

/* the logo heads the card, larger than in the header (33px) : the card is 500px wide.
   An svg without width/height has no size of its own, so it gets a height, and the width
   follows from its ratio ; raster images keep their own size, never scaled up. */
.login-logo {
  display: flex;
  justify-content: center;
  margin-bottom: 1.625rem;
  img {
    max-width: 100%;
    max-height: 56px;
  }
  img[src$='.svg'],
  img[src^='data:image/svg+xml'] {
    height: 56px;
    width: auto;
  }
}

/* centered under the logo, with more room above it (the logo's margin) than below it */
.login-title {
  text-align: center;
  margin-bottom: 1rem;
}

/* the one action on the page, so a solid button : the theme tints every btn-primary down to
   a pale fill (styles/textColors.scss, with !important), which made Sign in the faintest
   thing on the card. This selector is more specific, so it wins in every theme. */
.btn.login-submit {
  color: #fff !important;
  background-color: var(--bs-primary) !important;
  border-color: var(--bs-primary) !important;
  &:hover,
  &:focus-visible {
    background-color: color-mix(in srgb, var(--bs-primary) 85%, #000) !important;
    border-color: color-mix(in srgb, var(--bs-primary) 85%, #000) !important;
  }
}

/* or : a line each side of the word, between the sign in and the single sign-on */
.login-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1.25rem 0 1rem;
  color: var(--bs-secondary-color);
  font-size: 0.875rem;
  &::before,
  &::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--af-field-border);
  }
}

/* the providers : a centred row of equal buttons, framed as the fields, their own colours */
.login-sso {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
}
.login-sso-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 4.5rem;
  height: 3rem;
  border: 1px solid var(--af-field-border);
  border-radius: 0.375rem;
  background: var(--bs-body-bg);
  font-size: 1.75rem;
  &:hover {
    background: var(--bs-tertiary-bg);
  }
  &:focus-visible {
    outline: 0;
    box-shadow: 0 0 0 0.25rem var(--bs-focus-ring-color);
  }
}

/* the providers' logos : the same visual weight - the OpenID mark, narrower than the
   Microsoft squares, a little larger */
.login-ms-logo {
  width: 1.5rem;
  height: 1.5rem;
}
.login-oidc-logo {
  width: 1.75rem;
  height: 1.75rem;
}

/* the menu's text label is meant for the collapsed header : the login page has none, so
   small screens keep the icon alone, as large ones do */
.bd-mode-toggle :deep(.d-lg-none) {
  display: none !important;
}
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
