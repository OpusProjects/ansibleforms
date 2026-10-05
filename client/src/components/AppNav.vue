<script setup>
/******************************************************************/
/*                                                                */
/*  App AnsibleForms Nav component                                */
/*  Contains the top navigation bar                               */
/*                                                                */
/******************************************************************/

import { ref, computed, onMounted } from 'vue';
import { useAppStore } from '@/stores/app';
import { useI18n } from 'vue-i18n';
import Theme from '@/lib/Theme';
import Helpers from '@/lib/Helpers';
import { applyDefaultLanguage } from '@/plugins/i18n';
import { languages } from '@/config/languages';

// INIT
const store = useAppStore();
const { t, locale } = useI18n();

function setLanguage(code) {
  locale.value = code;
  Helpers.setCookie('af_language', code);
}

// ENV-BASED HOME MENU LABEL/ICON
const navHomeLabel = ref('Forms');
const navHomeIcon = ref('home');

import axios from 'axios';

onMounted(async () => {
  try {
    const res = await axios.get('/api/v2/app/config');
    navHomeLabel.value = res.data?.navHomeLabel || navHomeLabel.value;
    navHomeIcon.value = res.data?.navHomeIcon || navHomeIcon.value;
    // Apply server default language if user hasn't chosen one
    if (res.data?.defaultLanguage) {
      applyDefaultLanguage(res.data.defaultLanguage);
    }
    if (res.data?.defaultTheme) {
      Theme.applyServerDefault(res.data.defaultTheme, res.data.defaultThemeColor);
      currentTheme.value = store.theme;
    }
  } catch (e) {
    // fallback to defaults if API fails
    console.error('Failed to fetch app config:', e);
  }
});

// DATA

const showVersion = ref(false);
const showProfile = ref(false);
const currentTheme = ref(Theme.load());
const menuOptions = computed(() => [
  { title: t('nav.jobs'), link: '/jobs', icon: 'history' },
  { title: t('nav.settings'), link: '/admin/settings', icon: 'gear' },
  { title: t('nav.designer'), link: '/designer', icon: 'pen-to-square' },
]);
const helpMenuOptions = computed(() => [
  { title: t('nav.documentation'), href: 'https://ansibleforms.com', icon: 'globe', target: '_blank' },
  { title: t('nav.logs'), link: '/logs', icon: 'file-lines', target: '_self' },
  { title: t('nav.apiDocs'), link: '/api-docs', icon: 'code', target: '_blank' },
]);
const profileMenu = computed(() => [
  { title: t('nav.changePassword'), link: '/change-password', icon: 'key', target: '_self', local_only: true },
  { title: t('nav.logout'), link: '/logout', icon: 'arrow-right-from-bracket', target: '_self' },
]);

// COMPUTED

const menu = computed(() => {
  // Clone menuOptions to avoid mutating the original array
  let m = menuOptions.value.map((item) => ({ ...item }));

  // Add badge to Jobs menu
  const jobsMenu = m.find((item) => item.link === '/jobs');
  if (jobsMenu) {
    jobsMenu.badge = store.approvals;
  }

  // Add home menu item
  m.unshift({
    title: navHomeLabel.value,
    link: '/',
    icon: navHomeIcon.value,
    target: '_self',
  });

  if (!store?.profile?.options?.showSettings) {
    m = m.filter((m) => m.link != '/admin/settings');
  }
  if (!store?.profile?.options?.showDesigner) {
    m = m.filter((m) => m.link != '/designer');
  }
  return m;
});

const helpMenu = computed(() => {
  var m = helpMenuOptions.value;
  if (!store?.profile?.options?.showLogs) {
    m = m.filter((m) => m.link != '/logs');
  }
  return m;
});

// Check if client/server builds match (cache detection)
const buildMismatch = computed(() => {
  const serverSha = store.serverBuild?.gitSha;
  const clientSha = store.clientBuild?.gitSha;
  if (!serverSha || !clientSha || serverSha === 'dev' || clientSha === 'dev') {
    return false; // dev mode, ignore
  }
  return serverSha !== clientSha;
});
</script>

<template>
  <BsModal v-if="showVersion" @close="showVersion = false">
    <template v-slot:title>
      {{ t('version.title') }} <badge class="badge rounded-pill text-bg-info">v{{ store.version }}</badge>
    </template>
    <template v-slot>
      <!-- Cache Mismatch Warning -->
      <div v-if="buildMismatch" class="alert alert-warning d-flex align-items-center" role="alert">
        <font-awesome-icon icon="triangle-exclamation" class="me-2" />
        <div>
          <strong>{{ t('version.cacheMismatchTitle') }}</strong
          ><br />
          <small>{{ t('version.cacheMismatchMsg') }}</small>
        </div>
      </div>

      <div class="mb-3">
        <div class="row g-2">
          <div class="col-md-6">
            <div class="card">
              <div class="card-body">
                <h6 class="card-title">{{ t('version.serverBuild') }}</h6>
                <p class="card-text mb-1">
                  <small class="text-muted">{{ t('version.sha') }}:</small>
                  <code class="ms-1 fs-6 fw-bold">{{ store.serverBuild?.gitSha || 'unknown' }}</code>
                  <span v-if="store.serverBuild?.dirty" class="badge bg-warning ms-2">{{ t('version.dirty') }}</span>
                </p>
                <p class="card-text mb-0" v-if="store.serverBuild?.buildTime">
                  <small class="text-muted">{{ t('version.built') }}:</small>
                  <small class="ms-1">{{ new Date(store.serverBuild.buildTime).toLocaleString() }}</small>
                </p>
              </div>
            </div>
          </div>
          <div class="col-md-6">
            <div class="card">
              <div class="card-body">
                <h6 class="card-title">{{ t('version.clientBuild') }}</h6>
                <p class="card-text mb-1">
                  <small class="text-muted">{{ t('version.sha') }}:</small>
                  <code class="ms-1 fs-6 fw-bold">{{ store.clientBuild?.gitSha || 'unknown' }}</code>
                  <span v-if="store.clientBuild?.dirty" class="badge bg-warning ms-2">{{ t('version.dirty') }}</span>
                </p>
                <p class="card-text mb-0" v-if="store.clientBuild?.buildTime">
                  <small class="text-muted">{{ t('version.built') }}:</small>
                  <small class="ms-1">{{ new Date(store.clientBuild.buildTime).toLocaleString() }}</small>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p class="mt-3 fs-6 user-select-none">
        {{ t('version.license') }}<br />
        <br />
        {{ t('version.warranty') }}<br />

        <br />{{ t('version.findLicense') }}
        <a target="_blank" href="http://www.gnu.org/licenses/">http://www.gnu.org/licenses/</a><br />
      </p>
    </template>
  </BsModal>
  <BsModal v-if="showProfile" @close="showProfile = false">
    <template v-slot:title>
      {{ t('nav.aboutMe') }}
    </template>

    <div class="row gy-2 m-2">
      <div class="col m-2 bg-info-subtle">
        <div class="p-2">
          <strong>{{ t('nav.username') }} : </strong>{{ store?.profile?.username }}
        </div>
      </div>
      <div class="col m-2 bg-info-subtle">
        <div class="p-2">
          <strong>{{ t('nav.type') }} : </strong>{{ store?.profile?.type }}
        </div>
      </div>
    </div>
    <div class="row gy-2 m-2">
      <div class="col m-2 bg-success-subtle">
        <div class="p-2">
          <strong>{{ t('nav.groups') }} : </strong>
          <ul class="list-unstyled">
            <li v-for="g in store?.profile?.groups || []" :key="g"><font-awesome-icon icon="check" /> {{ g }}</li>
          </ul>
        </div>
      </div>
      <div class="col m-2 bg-warning-subtle">
        <div class="p-2">
          <strong>{{ t('nav.roles') }} : </strong>
          <ul class="list-unstyled">
            <li v-for="r in store?.profile?.roles || []" :key="r"><font-awesome-icon icon="check" /> {{ r }}</li>
          </ul>
          <strong>{{ t('nav.options') }} : </strong>
          <ul class="list-unstyled">
            <li v-for="r in Object.keys(store?.profile?.options || [])" :key="r">
              <font-awesome-icon icon="check" /> {{ r }} : {{ store?.profile?.options[r] }}
            </li>
          </ul>
        </div>
      </div>
    </div>
  </BsModal>
  <BsNavBar :currentTheme="currentTheme">
    <ul class="navbar-nav ms-auto mb-2 mb-md-0">
      <BsNavLink v-for="m in menu" :key="m.link" :link="m" />
      <!-- help menu -->
      <BsNavDivider />
      <BsNavItem :dropdown="true">
        <BsNavMenu icon="circle-question" title="Help">
          <li v-for="m in helpMenu" :key="m.title">
            <a
              v-if="m.href"
              type="button"
              class="dropdown-item d-flex align-items-center"
              :href="m.href"
              :target="m.target"
            >
              <span class="icon"><font-awesome-icon :icon="m.icon" /></span>
              <span class="ms-2">{{ m.title }}</span>
            </a>
            <router-link v-else class="dropdown-item d-flex align-items-center" :to="m.link" :target="m.target">
              <span class="icon"><font-awesome-icon :icon="m.icon" /></span>
              <span class="ms-2">{{ m.title }}</span>
            </router-link>
          </li>
          <hr />
          <li>
            <button type="button" class="dropdown-item d-flex align-items-center" @click="showVersion = true">
              <span class="icon"><font-awesome-icon icon="code-branch" /></span>
              <span class="ms-2">{{ t('nav.about') }} v{{ store.version }}</span>
            </button>
          </li>
        </BsNavMenu>
      </BsNavItem>

      <!-- user profile -->
      <BsNavDivider />
      <BsNavItem :dropdown="true">
        <BsNavMenu icon="user" :title="store.profile?.username || ''" :showTitle="true">
          <li v-for="m in profileMenu" :key="m.link">
            <template v-if="(store.profile?.type == 'local' && m.local_only) || !m.local_only">
              <a v-if="m.href" type="button" class="dropdown-item d-flex align-items-center" :href="m.href">
                <span class="icon"><font-awesome-icon :icon="m.icon" /></span>
                <span class="ms-2">{{ m.title }}</span>
              </a>
              <router-link v-else class="dropdown-item d-flex align-items-center" :to="m.link" :target="m.target">
                <span class="icon"><font-awesome-icon :icon="m.icon" /></span>
                <span class="ms-2">{{ m.title }}</span>
              </router-link>
            </template>
          </li>
          <hr />
          <li>
            <button type="button" class="dropdown-item d-flex align-items-center" @click="showProfile = true">
              <span class="icon"><font-awesome-icon icon="address-card" /></span>
              <span class="ms-2">{{ t('nav.aboutMe') }}</span>
            </button>
          </li>
        </BsNavMenu>
      </BsNavItem>

      <!-- language switcher -->
      <BsNavDivider />
      <BsNavItem :dropdown="true">
        <BsNavMenu icon="globe" :title="languages.find((l) => l.code === locale)?.flag || '🌐'">
          <li v-for="lang in languages" :key="lang.code">
            <button
              type="button"
              class="dropdown-item d-flex align-items-center"
              :class="{ active: locale === lang.code }"
              @click="setLanguage(lang.code)"
            >
              <span class="me-2">{{ lang.flag }}</span>
              <span>{{ lang.label }}</span>
            </button>
          </li>
        </BsNavMenu>
      </BsNavItem>

      <!-- theme switcher -->
      <BsNavDivider />
      <BsNavItem :dropdown="true">
        <BsThemeSwitcher v-model="currentTheme" />
      </BsNavItem>
    </ul>
  </BsNavBar>
</template>

<style scoped lang="scss"></style>
