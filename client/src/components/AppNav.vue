<script setup>
/******************************************************************/
/*                                                                */
/*  App AnsibleForms Nav component                                */
/*  Contains the top navigation bar                               */
/*                                                                */
/******************************************************************/

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useAppStore } from '@/stores/app';
import { useI18n } from 'vue-i18n';
import Theme from '@/lib/Theme';
import Helpers from '@/lib/Helpers';
import State from '@/lib/State';
import Profile from '@/lib/Profile';
import { languages, fallbackLanguage } from '@/config/languages';
import { applyDefaultLanguage } from '@/plugins/i18n';

// INIT
const store = useAppStore();
const { t, locale } = useI18n();

function setLanguage(code) {
  locale.value = code;
  Helpers.setCookie('af_language', code);
}

// ENV-BASED HOME MENU LABEL/ICON
const navHomeLabel = ref('Forms');
const navHomeIcon = ref('rectangle-list');

import axios from 'axios';
import Time from '@/lib/Time';

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

// the banner's reload : the new index.html (served no-cache) brings the new bundle
function reloadPage() {
  window.location.reload();
}

// how the signed-in account signs in, shown under its name in the user menu
const loginType = computed(() => Profile.loginType(t, store.profile?.type));
// the person's name when the sign-in brought one (ldap, azure ad, openid connect), else
// the username ; with a name shown, the username goes on the line under it
const displayName = computed(() => store.profile?.displayName || store.profile?.username || '');
const userMeta = computed(() =>
  store.profile?.displayName ? `${store.profile.username} · ${loginType.value.label}` : loginType.value.label,
);

// the approvals bell : the count is loaded when the header appears (also right after a
// login, which used to leave it at 0 until a reload) and refreshed once a minute, so a
// new request shows up while a page stays open
let approvalsTimer = null;
function refreshApprovals() {
  State.refreshApprovals().catch(() => {
    // not logged in (any more) or the server is down : the next page load tells
  });
  // the designer lock on the Designer link, on the same minute (the designer page itself
  // refreshes it every few seconds while it is open)
  State.refreshDesignerLock();
}
onMounted(() => {
  refreshApprovals();
  approvalsTimer = setInterval(refreshApprovals, 60000);
});
onBeforeUnmount(() => clearInterval(approvalsTimer));

// DATA

const showVersion = ref(false);
const currentTheme = ref(Theme.load());
// the profile page can change the theme too: keep the header (logo, switcher) in step
watch(
  () => store.theme,
  (theme) => {
    if (theme) currentTheme.value = theme;
  },
);
const menuOptions = computed(() => [
  { title: t('nav.jobs'), link: '/jobs', icon: 'history' },
  { title: t('nav.settings'), link: '/admin/settings', icon: 'gear' },
  { title: t('nav.designer'), link: '/designer', icon: 'pen-to-square' },
]);
const helpMenuOptions = computed(() => [
  { title: t('nav.documentation'), href: 'https://ansibleforms.com', icon: 'globe', target: '_blank' },
  { title: t('nav.apiDocs'), link: '/api-docs', icon: 'code', target: '_blank' },
]);
const profileMenu = computed(() => [
  { title: t('nav.logout'), link: '/logout', icon: 'arrow-right-from-bracket', target: '_self' },
]);

// COMPUTED

// the designer lock, for the lock on the Designer link : null when nobody holds it
const designerLockIndicator = computed(() => {
  const status = store.designerLock;
  if (!status || status.free || !status.lock) return null;
  if (status.match) {
    return { icon: 'lock', class: 'af-lock-mine', title: t('nav.designerLockedByMe') };
  }
  const who = status.lock.displayName || status.lock.username || '?';
  return { icon: 'lock', class: 'af-lock-other', title: t('nav.designerLockedBy', { user: who }) };
});

const menu = computed(() => {
  // Clone menuOptions to avoid mutating the original array
  let m = menuOptions.value.map((item) => ({ ...item }));

  // (the approvals count is on the bell in the header, not on the Jobs link)

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
  // a lock on the Designer link while someone holds the designer : one color for the user
  // themselves, another for someone else, and who in its tooltip
  const designer = m.find((x) => x.link == '/designer');
  if (designer && designerLockIndicator.value) designer.indicator = designerLockIndicator.value;
  return m;
});

const currentLanguage = computed(() => languages.find((l) => l.code === locale.value) || fallbackLanguage);

const helpMenu = computed(() => helpMenuOptions.value);

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
                  <small class="ms-1">{{ Time.format(store.serverBuild.buildTime) }}</small>
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
                  <small class="ms-1">{{ Time.format(store.clientBuild.buildTime) }}</small>
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
  <BsNavBar :currentTheme="currentTheme">
    <!-- primary navigation, next to the logo -->
    <template #start>
      <ul class="navbar-nav af-nav-primary me-auto">
        <BsNavLink v-for="m in menu" :key="m.link" :link="m" />
      </ul>
    </template>

    <ul class="navbar-nav af-nav-utility ms-auto">
      <!-- search : forms and pages, live as you type (also on "/" and Ctrl+K) -->
      <BsNavItem>
        <AppSearch />
      </BsNavItem>

      <!-- approvals bell : a red count when jobs wait for an approval, opens them on the jobs page -->
      <BsNavItem>
        <router-link
          class="btn af-icon-btn af-bell"
          :to="{ path: '/jobs', query: { status: 'approve' } }"
          :title="t('jobs.menu.approve')"
          :aria-label="t('jobs.menu.approve')"
        >
          <font-awesome-icon icon="bell" />
          <span v-if="store.approvals > 0" class="af-bell-count">{{
            store.approvals > 99 ? '99+' : store.approvals
          }}</span>
        </router-link>
      </BsNavItem>

      <!-- help menu -->
      <BsNavItem :dropdown="true">
        <BsNavMenu icon="circle-question" title="Help" buttonClass="af-icon-btn">
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
          <li><hr class="dropdown-divider" /></li>
          <li>
            <button type="button" class="dropdown-item d-flex align-items-center" @click="showVersion = true">
              <span class="icon"><font-awesome-icon icon="code-branch" /></span>
              <span class="ms-2">{{ t('nav.about') }}</span>
              <span class="ms-auto ps-3 af-menu-meta">v{{ store.version }}</span>
            </button>
          </li>
        </BsNavMenu>
      </BsNavItem>

      <!-- theme switcher -->
      <BsNavItem :dropdown="true">
        <BsThemeSwitcher v-model="currentTheme" buttonClass="af-icon-btn" />
      </BsNavItem>

      <!-- language switcher: shows the current language's flag -->
      <BsNavItem :dropdown="true">
        <button
          class="btn af-icon-btn"
          type="button"
          data-bs-toggle="dropdown"
          aria-expanded="false"
          :aria-label="t('nav.language')"
          :title="currentLanguage.label"
        >
          <AppFlag :code="currentLanguage.code" class="af-nav-flag" />
          <span class="d-md-none ms-2">{{ currentLanguage.label }}</span>
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li v-for="lang in languages" :key="lang.code">
            <button
              type="button"
              class="dropdown-item d-flex align-items-center gap-2"
              :class="{ active: locale === lang.code }"
              @click="setLanguage(lang.code)"
            >
              <AppFlag :code="lang.code" />
              <span>{{ lang.label }}</span>
              <span v-if="locale === lang.code" class="ms-auto ps-3"><font-awesome-icon icon="check" /></span>
            </button>
          </li>
        </ul>
      </BsNavItem>

      <!-- user menu: profile and sign out -->
      <BsNavItem :dropdown="true" class="af-user-item">
        <!-- only the avatar, like the icon buttons beside it : the name and the login type are in
             the menu it opens, and in its tooltip -->
        <button
          class="btn af-user-btn"
          type="button"
          data-bs-toggle="dropdown"
          aria-expanded="false"
          :title="displayName"
          :aria-label="displayName"
        >
          <span class="af-avatar"><font-awesome-icon icon="user" /></span>
        </button>
        <ul class="dropdown-menu dropdown-menu-end af-user-menu">
          <li class="af-user-card">
            <span class="af-avatar af-avatar-lg"><font-awesome-icon icon="user" /></span>
            <span class="d-flex flex-column lh-sm">
              <strong>{{ displayName }}</strong>
              <small class="af-menu-meta">{{ userMeta }}</small>
            </span>
          </li>
          <li><hr class="dropdown-divider" /></li>
          <li>
            <router-link class="dropdown-item d-flex align-items-center" to="/profile">
              <span class="icon"><font-awesome-icon icon="user-gear" /></span>
              <span class="ms-2">{{ t('nav.profile') }}</span>
            </router-link>
          </li>
          <li><hr class="dropdown-divider" /></li>
          <template v-for="m in profileMenu" :key="m.link">
            <li>
              <router-link class="dropdown-item d-flex align-items-center" :to="m.link" :target="m.target">
                <span class="icon"><font-awesome-icon :icon="m.icon" /></span>
                <span class="ms-2">{{ m.title }}</span>
              </router-link>
            </li>
          </template>
        </ul>
      </BsNavItem>
    </ul>
  </BsNavBar>
  <!-- the server runs a newer build than this tab (a tab opened before an upgrade, issue #660) :
       offer a reload, never reload by itself, so nothing typed in a form is lost -->
  <div v-if="store.newVersionAvailable && !store.newVersionDismissed" class="af-new-version" role="status">
    <FaIcon icon="circle-arrow-up" class="me-2" />
    <span>{{ t('version.newVersionAvailable') }}</span>
    <button type="button" class="btn btn-sm btn-primary ms-3" @click="reloadPage">
      <FaIcon icon="rotate-right" class="me-1" />{{ t('version.newVersionReload') }}
    </button>
    <button
      type="button"
      class="btn-close ms-auto"
      :aria-label="t('version.newVersionDismiss')"
      :title="t('version.newVersionDismiss')"
      @click="store.newVersionDismissed = true"
    ></button>
  </div>
</template>

<style lang="scss">
// ===============================================================
// Header navigation (not scoped: it styles the links and menus that
// BsNavLink, BsNavMenu and BsThemeSwitcher render inside the header)
// ===============================================================

.af-header {
  font-size: 0.875rem;

  // primary links: full header height, so the active underline sits on the bottom edge
  .af-nav-primary .nav-link {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 1.0625rem;
    font-weight: 500;
    padding: 0.45rem 0.85rem !important;
    margin: 0 0.9rem;
    border-radius: 6px;
    color: var(--af-navbar-link-color) !important;
    transition:
      background-color 0.15s,
      color 0.15s;
    svg {
      font-size: 1.3em; // about 22px next to the 17px text
      opacity: 0.75;
    }
    &:hover {
      color: var(--af-navbar-link-hover-color) !important;
      background-color: var(--af-navbar-hover-bg);
    }
    &.active {
      color: var(--af-navbar-link-active-color) !important;
      font-weight: 600;
      svg {
        opacity: 1;
      }
    }
    @media (min-width: 768px) {
      &.active::after {
        content: '';
        position: absolute;
        left: 0.85rem;
        right: 0.85rem;
        bottom: calc((var(--af-header-height) - 100%) / -2);
        height: 3px;
        border-radius: 3px 3px 0 0;
        background-color: var(--af-navbar-indicator);
      }
    }
    .badge {
      font-size: 0.68rem;
      padding: 0.2em 0.5em;
      margin-left: 0.1rem !important;
    }
  }

  // on wide screens the primary links sit in the middle of the bar, independent of how
  // wide the logo and the user menu are ; narrower screens keep them next to the logo
  @media (min-width: 1200px) {
    .af-nav-primary {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
    }
  }

  // utility buttons on the right: icon only, square, subtle hover
  .af-nav-utility {
    align-items: center;
    gap: 0.25rem;
  }
  .af-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 42px;
    height: 42px;
    font-size: 1.25rem;
    padding: 0 0.5rem;
    border-radius: 6px;
    border: 0;
    color: var(--af-navbar-link-color) !important;
    .icon {
      margin-right: 0 !important;
    }
    svg {
      font-size: 1.45rem;
    }
    &::after {
      display: none; // no caret on icon buttons
    }
    // BsNavMenu repeats the title for the collapsed menu (below lg); the header expands at md,
    // so hide it there to keep the button icon-only
    @media (min-width: 768px) {
      .d-lg-none {
        display: none !important;
      }
    }
    &:hover,
    &.show {
      color: var(--af-navbar-link-hover-color) !important;
      background-color: var(--af-navbar-hover-bg);
    }
  }

  // the count on the approvals bell : a red circle on the bell's top right corner
  .af-bell {
    position: relative;
  }
  .af-bell-count {
    position: absolute;
    top: 1px;
    right: 0;
    min-width: 1.15rem;
    height: 1.15rem;
    padding: 0 0.3rem;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 700;
    line-height: 1.15rem;
    text-align: center;
    color: #ffffff;
    background-color: var(--bs-danger);
    box-shadow: 0 0 0 2px var(--af-bg-navbar);
  }

  // light theme : its hover color is darker than the icons, so the buttons on the right
  // use a lighter grey instead, as the other themes lighten them ; the hover background
  // stays (the flag and the avatar lighten through their brightness filter below)
  [data-bs-theme='light'] & {
    // the bell, help and theme icons and the user name turn black
    .af-icon-btn,
    .af-user-btn {
      &:hover,
      &.show {
        color: #000000 !important;
      }
    }
  }

  // the flag in the language button, a little larger than the menu flags
  .af-nav-flag {
    width: 1.75rem;
    height: 1.2rem;
    transition: filter 0.15s;
  }
  // on hover the flag lightens, like the other header icons change color ; brightness and
  // not opacity, so it lightens on a dark header as well instead of fading into it
  .af-icon-btn:hover .af-nav-flag,
  .af-icon-btn.show .af-nav-flag,
  .af-user-btn:hover .af-avatar,
  .af-user-btn.show .af-avatar {
    filter: brightness(1.25);
  }

  // user button: avatar with the name next to it
  // the avatar sits in the row of icon buttons, with no separator before it
  .af-user-item {
    margin-left: 0.25rem;
  }
  .af-user-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    // a round hover area around the avatar, a little larger than it
    width: 42px;
    height: 42px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    color: var(--af-navbar-link-color) !important;
    &:hover,
    &.show {
      color: var(--af-navbar-link-hover-color) !important;
      // the circle around the avatar : the theme sets it apart so the avatar's ring (the
      // header's color, the box-shadow below) shows against it in every theme
      background-color: var(--af-avatar-hover-bg, var(--af-navbar-hover-bg));
    }
  }
  .af-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    font-size: 0.9rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #ffffff;
    background-color: var(--af-avatar-bg);
    box-shadow: 0 0 0 2px var(--af-bg-navbar);
    transition: filter 0.15s;
  }
  .af-avatar-lg {
    width: 40px;
    height: 40px;
    font-size: 1.1rem;
  }

  // dropdown menus: rounded, hairline border, soft shadow
  .dropdown-menu {
    min-width: 15rem;
    padding: 0.35rem;
    margin-top: 0.5rem !important;
    font-size: 0.9375rem; // 15px
    border: 1px solid var(--af-header-border);
    border-radius: 10px;
    box-shadow:
      0 10px 30px rgba(15, 23, 42, 0.12),
      0 2px 6px rgba(15, 23, 42, 0.06);
  }
  .dropdown-item {
    border-radius: 6px;
    padding: 0.5rem 0.7rem;
    .icon {
      width: 1.1rem;
      text-align: center;
      opacity: 0.75;
    }
  }
  .dropdown-header {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.4rem 0.6rem 0.25rem;
  }
  .dropdown-divider {
    margin: 0.35rem 0;
  }
}

// the "newer version" banner under the header : the accent's light tint, one line
.af-new-version {
  display: flex;
  align-items: center;
  padding: 0.5rem 2.5rem;
  font-size: 0.9375rem;
  color: var(--bs-primary-text-emphasis);
  background-color: var(--bs-primary-bg-subtle);
  border-bottom: 1px solid var(--bs-primary-border-subtle);
}

.af-header {
  // the user menu grows with the name : a long one (an Azure AD e-mail address) stays on one
  // line and widens the menu, up to the screen width, where it is cut off with an ellipsis
  .af-user-menu {
    width: max-content;
    max-width: calc(100vw - 2rem);
  }
  .af-user-card {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.5rem 0.6rem 0.4rem;
    > span:last-child {
      min-width: 0;
    }
    strong,
    small {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .af-avatar {
      box-shadow: none;
      background-color: var(--af-primary);
    }
  }
  .af-menu-meta {
    color: var(--bs-secondary-color);
    font-size: 0.85rem;
  }

  // collapsed (mobile) menu: plain stacked list
  @media (max-width: 767.98px) {
    .navbar-collapse {
      padding: 0.5rem 0 0.75rem;
    }
    .af-nav-utility {
      flex-direction: row;
      justify-content: flex-start;
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--af-header-border);
    }
    .af-user-item {
      margin-left: auto;
    }
  }
}
</style>
