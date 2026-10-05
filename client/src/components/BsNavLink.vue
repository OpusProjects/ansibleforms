<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Nav Link component                                  */
/*                                                                */
/*  @props:                                                       */
/*      link: Object                                              */
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
      <font-awesome-icon :icon="link.icon" /> {{ link.title }}
      <span v-if="link.badge && link.badge > 0" class="badge rounded-pill bg-danger ms-2 align-middle">{{
        link.badge
      }}</span>
    </router-link>
  </li>
</template>
<style scoped lang="scss"></style>
