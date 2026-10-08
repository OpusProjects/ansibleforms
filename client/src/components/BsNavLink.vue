<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Nav Link component                                  */
/*                                                                */
/*  @props:                                                       */
/*      link: Object - { link, title, icon, badge, indicator }    */
/*            indicator : { icon, class, title } - a small icon   */
/*            on the link's icon, with its tooltip                */
/*                                                                */
/******************************************************************/

import { useRoute } from 'vue-router';

// INIT

const route = useRoute();

// PROPS

defineProps({
  link: {
    type: Object,
    required: true,
  },
});
</script>
<template>
  <li class="nav-item">
    <router-link
      :to="link.link"
      class="nav-link icon-link"
      :class="{
        active: route.path == link.link || (route.path.includes(link.link) && link.link !== '/'),
        'link-body-emphasis': route.path !== link.link,
      }"
    >
      <span class="af-nav-link-icon" :class="{ 'af-has-indicator': link.indicator }">
        <font-awesome-icon :icon="link.icon" />
        <!-- a small state icon on the link's icon (the designer lock), explained by its tooltip -->
        <span
          v-if="link.indicator"
          class="af-nav-indicator"
          :class="link.indicator.class"
          :title="link.indicator.title"
          role="img"
          :aria-label="link.indicator.title"
          ><font-awesome-icon :icon="link.indicator.icon"
        /></span>
      </span>
      {{ link.title }}
      <span v-if="link.badge && link.badge > 0" class="badge rounded-pill bg-danger ms-2 align-middle">{{
        link.badge
      }}</span>
    </router-link>
  </li>
</template>
<style scoped lang="scss">
// the link's icon carries the indicator on its top right corner, like the bell its count
.af-nav-link-icon {
  position: relative;
  display: inline-flex;
  // the indicator sticks out on the right : room for it before the link's title
  &.af-has-indicator {
    margin-right: 0.5em;
  }
}
.af-nav-indicator {
  position: absolute;
  top: -0.55em;
  right: -0.75em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.3em;
  height: 1.3em;
  border-radius: 50%;
  font-size: 0.8em;
  color: #ffffff;
  // a ring in the header's color, so it stands out from the icon under it
  box-shadow: 0 0 0 2px var(--af-bg-navbar);
  svg {
    font-size: 0.85em !important;
    opacity: 1 !important;
  }
  // the user holds the lock themselves : green
  &.af-lock-mine {
    background-color: var(--bs-success);
  }
  // someone else holds it : red, the designer is not available
  &.af-lock-other {
    background-color: var(--bs-danger);
  }
}
</style>
