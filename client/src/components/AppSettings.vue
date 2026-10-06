<script setup>
/******************************************************************/
/*                                                                */
/*  App AnsibleForms Settings component                           */
/*  Template wrapper for a page section                           */
/*                                                                */
/*  @props:                                                       */
/*      icon: String                                              */
/*      title: String                                             */
/*      description: String - what the page is for, in a popover  */
/*                   behind an info icon after the title          */
/*      crumbs: Array of { title, icon } - a title in steps       */
/*      bare: Boolean - the content without the card around it    */
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
  // a title in steps, each with its own icon (the forms page's sub categories :
  // Expressions › Test1) ; when given, it is shown instead of icon + title
  crumbs: {
    type: Array,
    default: () => [],
  },
  // the content without the card around it, for a page that lays out cards of its own
  bare: {
    type: Boolean,
    default: false,
  },
});
</script>
<template>
  <section class="section w-100" :class="{ 'mt-3': title }">
    <div class="container-fluid">
      <div v-if="title" class="d-flex align-items-center border-bottom mb-3 pb-2">
        <h3 v-if="crumbs.length" :aria-label="title">
          <template v-for="(c, i) in crumbs" :key="i">
            <span v-if="i > 0" class="mx-2 text-body-secondary af-crumb-separator">›</span>
            <span class="me-2"><FaIcon :icon="c.icon" /></span>{{ c.title }}
          </template>
          <AppInfoPopover v-if="description" :text="description" />
        </h3>
        <h3 v-else>
          <span class="me-2">
            <FaIcon :icon="icon" />
          </span>
          {{ title }}
          <AppInfoPopover v-if="description" :text="description" />
        </h3>
        <slot name="feedback"></slot>
        <template v-if="$slots.headerActions">
          <div class="flex-fill"></div>
          <slot name="headerActions"></slot>
        </template>
      </div>
      <slot name="tabs"></slot>
      <div v-if="!bare" class="card" :class="{ 'tab-card-flush-card': $slots.tabs }">
        <div class="card-body">
          <slot></slot>
        </div>
      </div>
      <div v-else class="af-bare-content"><slot></slot></div>
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
/* the page title never wraps (its icon above the word) : the actions next to it give way */
h3 {
  white-space: nowrap;
}
/* the › between the steps of a title is a small glyph at text size : larger, centered on the
   words, and with no line height of its own, so the title is no taller than one without it
   and the divider under it does not move */
.af-crumb-separator {
  font-size: 1.5em;
  line-height: 0;
  vertical-align: -0.05em;
}
/* without the page's card, the content's own cards end the page : leave the same 16px under
   the last one as under the designer's card and the forms tiles */
.af-bare-content {
  padding-bottom: 1rem;
}
.tab-card-flush-card {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
</style>
