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
/*      crumbs: Array of { title, icon, to } - a title in steps,  */
/*              each a link when it has a route (to)              */
/*      bare: Boolean - the content without the card around it    */
/*                                                                */
/*  @slots:                                                       */
/*      default       the card body                               */
/*      tabs          tabs above the card                         */
/*      feedback      status text next to the title               */
/*      footer        free content directly under the card        */
/*      actions       the page's buttons, top right               */
/*      headerActions view controls, next to the title            */
/*                                                                */
/*  BUTTON PLACEMENT STANDARD                                     */
/*  Every action button belongs in #actions : Save, Upload,       */
/*  Remove, Test and 'New <x>' alike. They sit at the top right   */
/*  corner of the page, on the title line, after the controls of  */
/*  #headerActions - those decide WHAT the card shows (search,    */
/*  filters, columns), the buttons act on it.                     */
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
            <!-- a step with a route : a link, in the title's own look -->
            <router-link v-if="c.to" :to="c.to" class="af-crumb-link"
              ><span class="me-2"><FaIcon :icon="c.icon" /></span>{{ c.title }}</router-link
            >
            <template v-else
              ><span class="me-2"><FaIcon :icon="c.icon" /></span>{{ c.title }}</template
            >
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
        <template v-if="$slots.headerActions || $slots.actions">
          <div class="flex-fill"></div>
          <slot name="headerActions"></slot>
          <!-- the page's buttons : top right, after the view controls -->
          <div v-if="$slots.actions" class="d-flex align-items-center flex-shrink-0 af-header-buttons">
            <slot name="actions"></slot>
          </div>
        </template>
      </div>
      <slot name="tabs"></slot>
      <!-- the 16px under the last card (the margin the designer also gives its card) -->
      <div v-if="!bare" class="card af-page-end" :class="{ 'tab-card-flush-card': $slots.tabs }">
        <div class="card-body">
          <slot></slot>
        </div>
      </div>
      <div v-else class="af-bare-content"><slot></slot></div>
      <slot name="footer"></slot>
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
.af-crumb-link,
.af-crumb-link:hover,
.af-crumb-link:focus {
  color: inherit;
  text-decoration: none;
}
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
/* 16px under the card, instead of it touching the bottom of the window */
.af-page-end {
  margin-bottom: 1rem;
}
/* the buttons after the view controls : the same gap as between those ; a button's own
   leading margin (ms-3, from when they sat under the card) is replaced by it */
.af-header-buttons {
  gap: 0.5rem;
}
:slotted(.af-header-buttons) > .btn,
.af-header-buttons > :deep(.btn) {
  margin-left: 0 !important;
}
.af-header-buttons:not(:first-child) {
  margin-left: 0.5rem;
}
.tab-card-flush-card {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
</style>
