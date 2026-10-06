<script setup>
import { ref, onMounted } from "vue";
import { useVuelidate } from "@vuelidate/core";
import { required } from "@vuelidate/validators";
import TokenStorage from "@/lib/TokenStorage"; // work with tokens and local storage
import BaseUrl from '@/lib/BaseUrl';
import State from "@/lib/State"; // work with state
import Navigate from "@/lib/Navigate"; // navigate to routes
import Helpers from "@/lib/Helpers"; // helper functions
import { toast } from 'vue-sonner';
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import Theme from "@/lib/Theme";
import { jwtDecode } from "jwt-decode";

// plugins

const route = useRoute();
const router = useRouter();

// vuelidate
const rules = {
   user: {
      username: {
         required
      },
      password: {
         required
      }
   }

}
// data
const user = ref({
   username: "",
   password: ""
});

const currentTheme = ref(Theme.load());
const loading = ref(false);
const azureAdEnabled = ref(false);
const azureGraphUrl = ref("");
const oidcEnabled = ref(false);
const oidcIssuer = ref("");

// validation
const $v = useVuelidate(rules, { user });

// methods
function authAzureAd() {
   localStorage.setItem("authIssuer", "azuread");  // set cookie to azuread
   window.location.replace(`${BaseUrl}/api/v2/auth/azureadoauth2`) // redirect to azuread
}
function authOidc() {
   localStorage.setItem("authIssuer", "oidc");   // set cookie to oidc
   window.location.replace(`${BaseUrl}/api/v2/auth/oidc`) // redirect to oidc
}
function getGroupsAndLogin(token, url, type = 'azuread') {
   if (type === 'azuread') {
      // The token in the url is OUR handoff, not an Azure access token (6.3.0) : the server
      // fetches the groups from Microsoft Graph itself at the login step (#548)
      tokenLogin(token, [])
   }
   else {
    // OIDC branch for now => specify type in the future?
    // decode token with "jwt-decode"
    const payload = jwtDecode(token);

    if (!payload) {
      toast.error("Failed to decode login token");
      return;
    }

    tokenLogin(token, payload.groups || [], 'oidc')
  }
}
async function tokenLogin(token, allGroups, type = 'azuread') {
   // No group filter here : the server applies the provider's group filter to the groups
   // it trusts (the claim in the handoff token), for Entra ID and OIDC alike. Filtering
   // in the browser only ever touched the posted list, which the server ignores whenever
   // the token carries a groups claim.
   const loginProvider = type === 'azuread' ? 'azureadoauth2' : 'oidc'

   try {
      const result = await axios.post(`/api/v2/auth/${loginProvider}/login`, { token: token, groups: allGroups })
      processLogin(result.data)
   } catch(err) {
      toast.error(Helpers.parseAxiosResponseError(err, "Identity Provider Login failed"));
   }
}
async function getSettings(token) {
   try {
      const result = await axios.get(`/api/v2/auth/settings`)
      
      azureAdEnabled.value = !!result.data.azureAdEnabled
      azureGraphUrl.value = result.data.azureGraphUrl

      oidcEnabled.value = !!result.data.oidcEnabled
      oidcIssuer.value = result.data.oidcIssuer

      if (token && azureAdEnabled.value) {
         if (localStorage.getItem("authIssuer") == "azuread") // get cookie and see if we issued azuread
            getGroupsAndLogin(token)
      }
      if (token && oidcEnabled.value) { // get cookie ans see if we issued oidc
         if (localStorage.getItem("authIssuer") == "oidc")
            getGroupsAndLogin(token, `${oidcIssuer.value}/protocol/openid-connect/userinfo`, 'oidc')
      }
   } catch(err) {
      toast.error(Helpers.parseAxiosResponseError(err, "Failed to get settings"))
   }
}
function processLogin(data) {
   TokenStorage.storeToken(data.token)
   TokenStorage.storeRefreshToken(data.refreshtoken)

   if (!TokenStorage.isAuthenticated()) {
      // console.log("Not authenticated, redirecting to login")
      Navigate.toLogin(router,route)
   } else {
      // console.log("Authenticated")
      Navigate.toOrigin(router,route)
      State.refreshAuthenticated()
      State.loadProfile()
      // loadApprovals() // TODO - load approvals
   }
}
async function login() {
   localStorage.removeItem("authIssuer") // remove cookie, regular login
   if (!$v.value.user.$invalid) {
      try {
         console.log("Logging in")
         var basicAuth = 'Basic ' + btoa(`${user.value.username}:${user.value.password}`)
         var postconfig = {
            headers: { 'Authorization': basicAuth }
         }
         const result = await axios.post(`/api/v2/auth/login`, {}, postconfig)
         processLogin(result.data)
      } catch(err) {
         TokenStorage.clear()
         toast.error(Helpers.parseAxiosResponseError(err, "Login failed"))
      }
   } else {
      toast.error("Form is not valid")
      $v.value.user.$touch()
   }
}
onMounted(() => {

   // TODO => check database before all else

   if (route.query.token) {
      loading.value = true
      getSettings(route.query.token)
   } else {
      getSettings()
   }
   if (route.query.error) {
      toast.error(route.query.error)
   }
   State.loadVersion()
});
</script>

<template>

   <div class="d-flex align-items-center py-4 bg-body-tertiary login vh-100">
      <div class="dropdown position-fixed bottom-0 end-0 mb-3 me-3 bd-mode-toggle">
      <BsThemeSwitcher buttonClass="btn-bd-primary py-2" v-model="currentTheme" />
   </div>

   <div class="card form-signin w-100 m-auto">
      <div class="card-body">
         <h5 class="card-title">Please sign in</h5>
         <BsInput v-model="user.username" @keyup_enter="login()" label="Username" placeholder="Username" icon="user"
            :hasError="$v.user.username.$invalid && $v.user.username.$dirty" :errors="$v.user.username.$errors" />
         <BsInput v-model="user.password" @keyup_enter="login()" type="password" label="Password" placeholder="Password" icon="lock"
            :hasError="$v.user.password.$invalid && $v.user.password.$dirty" :errors="$v.user.password.$errors" />
         <button class="btn btn-primary w-100 py-2" @click="login()">Sign in</button>
         <div role="button" class="m-2 azure d-inline-block">
            <FaIcon icon="fac,azure" size="3x" @click="authAzureAd()" v-if="azureAdEnabled" />
         </div>
         <div role="button" class="m-2 openid d-inline-block">
            <FaIcon icon="fac,openid" size="3x" @click="authOidc()" v-if="oidcEnabled" />
         </div>
      </div>
   </div>   
  </div>





</template>


<style scoped>
.form-signin {
   max-width: 500px;
   padding: 1rem;
}

.azure {
   color: #0072c6;
}

.openid {
   color: #d07c1a;
}
[data-bs-theme="light"] {
    .login{
      background-image: var(--af-login-background-light) !important;
      background-size: cover;
    }
  }
  [data-bs-theme="dark"] {
    .login{
      background-image: var(--af-login-background-dark) !important;
      background-size: cover;
    }
  }
  [data-bs-theme="color"] {
    .login{
      background-image: var(--af-login-background-color) !important;
      background-size: cover;
    }
  }  
</style>