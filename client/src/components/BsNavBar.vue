<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Navbar component                                    */
/*                                                                */
/*  @props:                                                       */
/*      currentTheme: String                                      */
/*                                                                */
/*  @slots:                                                       */
/*      start: primary navigation, placed next to the logo        */
/*      default: Navbar content, aligned to the right             */
/*                                                                */
/******************************************************************/

import { useAppStore } from '@/stores/app';

defineProps({
  currentTheme: {
    type: String,
    required: true,
  },
});

// a custom logo (uploaded in the admin panel) replaces the default themed logo
const store = useAppStore();
</script>

<template>
  <nav class="navbar navbar-expand-md af-header">
    <div class="container-fluid af-header-inner">
      <router-link class="navbar-brand af-brand" to="/">
        <img class="logo my-auto" v-if="store.customLogo" :src="store.customLogo" />
        <img class="logo my-auto" v-else-if="currentTheme === 'dark'" :src="'img/logo_dark.svg'" />
        <img class="logo my-auto" v-else-if="currentTheme === 'light'" :src="'img/logo_light.svg'" />
        <img class="logo my-auto" v-else :src="'img/logo_color.svg'" />
      </router-link>
      <button
        class="navbar-toggler af-toggler"
        type="button"
        data-bs-toggle="collapse"
        data-bs-target="#navbarCollapse"
        aria-controls="navbarCollapse"
        aria-expanded="false"
        aria-label="Toggle navigation"
      >
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="navbarCollapse">
        <slot name="start"></slot>
        <slot></slot>
      </div>
    </div>
  </nav>
</template>
<style scoped lang="scss">
// ===============================================================
// Header bar
// ===============================================================

// one fixed height, so the active-link underline sits exactly on the bottom edge
.af-header {
  min-height: var(--af-header-height);
  padding: 0;
  border-bottom: 1px solid var(--af-header-border);
  box-shadow: var(--af-header-shadow);
  position: sticky;
  top: 0;
  z-index: 1030;
}
.af-header-inner {
  position: relative; // anchor for the centered primary links (AppNav)
  min-height: var(--af-header-height);
  padding-left: 1.25rem;
  padding-right: 1.25rem;
  // more room at both ends on wider screens, so the logo and the user menu do not hug the edges
  @media (min-width: 768px) {
    padding-left: 2.5rem;
    padding-right: 2.5rem;
  }
}

// the logo, separated from the primary navigation by a hairline
.af-brand {
  display: flex;
  align-items: center;
  margin-right: 0;
  padding: 0 1.25rem 0 0;
  @media (min-width: 768px) {
    border-right: 1px solid var(--af-header-border);
    height: 34px;
    margin-right: 1rem;
  }
  // the links are centered from here on, so the logo no longer needs a separator
  @media (min-width: 1200px) {
    border-right: 0;
  }
}
.logo {
  max-width: 200px;
  max-height: 33px;
}
/* an svg without width/height attributes has no size of its own - only the ratio of its
   viewBox - so with just max-width/max-height it collapsed to 0 wide and the logo vanished.
   A height gives it one and the width follows from the ratio. Raster images carry their
   own size and keep the rule above, so a small png is not scaled up. */
.logo[src^='data:image/svg+xml'] {
  height: 33px;
  width: auto;
}

.af-toggler {
  border: 0;
  padding: 0.25rem 0.5rem;
  &:focus {
    box-shadow: none;
  }
}
</style>
