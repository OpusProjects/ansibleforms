<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Nav Menu component                                  */
/*                                                                */
/*  @props:                                                       */
/*      buttonClass: String                                       */
/*      icon: String                                              */
/*      title: String                                             */
/*      showTitle: Boolean                                        */
/*                                                                */
/*  @slots:                                                       */
/*      default: Nav Menu content                                 */
/*                                                                */
/******************************************************************/

import { getCurrentInstance } from 'vue';

// INIT

const { uid } = getCurrentInstance();

// PROPS

defineProps({
  buttonClass: {
    type: String,
    default: 'btn-link nav-link py-2 px-0 px-lg-2',
  },
  icon: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  showTitle: {
    type: Boolean,
    default: false,
  },
});
</script>
<template>
  <button
    class="btn dropdown-toggle d-flex align-items-center"
    type="button"
    :class="buttonClass"
    aria-expanded="false"
    data-bs-toggle="dropdown"
    :aria-label="title"
  >
    <span class="icon me-2"><faIcon :icon="icon" /></span><span v-if="showTitle">{{ title }}</span>
    <span class="d-lg-none ms-2" :id="uid">{{ title }}</span>
  </button>
  <ul class="dropdown-menu dropdown-menu-end" :aria-labelledby="uid">
    <slot></slot>
  </ul>
</template>
<style scoped lang="scss">
.btn {
  color: var(--af-navbar-link-color);
  &:hover {
    color: var(--af-navbar-link-hover-color);
  }
  &.show {
    color: var(--af-navbar-link-active-color);
  }
}
</style>
