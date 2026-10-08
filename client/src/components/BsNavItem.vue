<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Nav Item component                                  */
/*                                                                */
/*  @props:                                                       */
/*      dropdown: Boolean                                         */
/*                                                                */
/*  @slots:                                                       */
/*      default: Nav Item content                                 */
/*                                                                */
/******************************************************************/

defineProps({
  dropdown: {
    type: Boolean,
    default: false,
  },
});
</script>
<template>
  <li class="nav-item" :class="{ dropdown: dropdown }">
    <slot></slot>
  </li>
</template>
