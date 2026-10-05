<script setup>
/******************************************************************/
/*                                                                */
/*  App AnsibleForms Settings component                           */
/*  Template wrapper for a page section                           */
/*                                                                */
/*  @props:                                                       */
/*      icon: String                                              */
/*      title: String                                             */
/*                                                                */
/*  @slots:                                                       */
/*      default       the card body                               */
/*      tabs          tabs above the card                         */
/*      feedback      status text next to the title               */
/*      footer        free content directly under the card        */
/*      actions       THE action bar, under the card              */
/*      headerActions view controls only, next to the title       */
/*                                                                */
/*  BUTTON PLACEMENT STANDARD                                     */
/*  Every action button belongs in #actions, under the card :     */
/*  Save, Upload, Remove, Test and 'New <x>' alike. Do not put    */
/*  buttons next to the title.                                    */
/*  #headerActions is reserved for controls that decide WHAT the   */
/*  card shows (filters, a line-count select, auto-refresh),      */
/*  which belong above the content they filter rather than after   */
/*  it. It is not a second home for buttons.                      */
/*                                                                */
/******************************************************************/

defineProps({
  icon: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
});
</script>
<template>
  <section class="section w-100" :class="{ 'mt-3': title }">
    <div class="container-fluid">
      <div v-if="title" class="d-flex align-items-center border-bottom mb-3 pb-2">
        <h3>
          <span class="me-2">
            <FaIcon :icon="icon" />
          </span>
          {{ title }}
        </h3>
        <slot name="feedback"></slot>
        <template v-if="$slots.headerActions">
          <div class="flex-fill"></div>
          <slot name="headerActions"></slot>
        </template>
      </div>
      <p v-if="description" class="text-muted settings-description">{{ description }}</p>
      <slot name="tabs"></slot>
      <div class="card" :class="{ 'tab-card-flush-card': $slots.tabs }">
        <div class="card-body">
          <slot></slot>
        </div>
      </div>
      <slot name="footer"></slot>
      <!-- only reserve the footer action bar when there is something in it,
                 otherwise every page without #actions gains dead vertical space -->
      <div v-if="$slots.actions" class="d-flex align-items-center justify-content-end mt-3 mb-3">
        <slot name="actions"></slot>
      </div>
    </div>
  </section>
</template>
<style scoped>
.tab-card-flush-card {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
.settings-description {
  padding-top: 0.5rem;
  margin-bottom: 1.75rem;
}
</style>
