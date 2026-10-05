<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Navbar component                                    */
/*                                                                */
/*  @props:                                                       */
/*      currentTheme: String                                      */
/*                                                                */
/*  @slots:                                                       */
/*      default: Navbar content                                   */
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
  <nav
    class="navbar navbar-expand-md border border-secondary-subtle border-top-0 border-start-0 border-end-0 border-bottom-1 py-3"
  >
    <div class="container-xxl">
      <router-link class="navbar-brand ms-3" to="/">
        <img class="logo my-auto" v-if="store.customLogo" :src="store.customLogo" />
        <img class="logo my-auto" v-else-if="currentTheme === 'dark'" :src="'img/logo_dark.svg'" />
        <img class="logo my-auto" v-else-if="currentTheme === 'light'" :src="'img/logo_light.svg'" />
        <img class="logo my-auto" v-else :src="'img/logo_color.svg'" />
      </router-link>
      <button
        class="navbar-toggler"
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
        <slot></slot>
      </div>
    </div>
  </nav>
</template>
<style scoped lang="scss">
.logo {
  max-width: 200px;
  max-height: 30px;
}
/* an svg without width/height attributes has no size of its own - only the ratio of its
   viewBox - so with just max-width/max-height it collapsed to 0 wide and the logo vanished.
   A height gives it one and the width follows from the ratio. Raster images carry their
   own size and keep the rule above, so a small png is not scaled up. */
.logo[src^='data:image/svg+xml'] {
  height: 30px;
  width: auto;
}
</style>
