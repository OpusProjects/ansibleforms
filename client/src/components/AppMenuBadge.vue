<script setup>
/******************************************************************/
/*                                                                */
/*  App AnsibleForms menu badge                                   */
/*  The count beside an entry of a left menu : the forms of a     */
/*  category (Forms), the jobs of a filter (Jobs), the hosts of   */
/*  an inventory (Inventories). One look in every menu.           */
/*                                                                */
/*  @props:                                                       */
/*      count: Number|String - what it shows                      */
/*      active: Boolean - its entry is the one selected : the     */
/*              colors swapped, on the entry's highlight          */
/*      alert: Boolean - something to look at (jobs waiting for  */
/*             approval) : red, unless its entry is selected      */
/*                                                                */
/******************************************************************/
defineProps({
  count: {
    type: [Number, String],
    default: 0,
  },
  active: {
    type: Boolean,
    default: false,
  },
  alert: {
    type: Boolean,
    default: false,
  },
});
</script>

<template>
  <span class="badge rounded-pill flex-shrink-0 af-menu-badge" :class="{ active, 'is-alert': alert }">{{ count }}</span>
</template>

<style scoped>
/* the menus' blue pill, its number white ; on the selected entry the colors swapped */
.af-menu-badge {
  padding: 0.35em 0.75rem;
  background-color: var(--af-bg-badge);
  color: var(--af-text-badge);
}
.af-menu-badge.active {
  background-color: var(--af-text-badge);
  color: var(--af-bg-badge);
}
.af-menu-badge.is-alert:not(.active) {
  background-color: var(--bs-danger);
  color: #fff;
}
</style>
