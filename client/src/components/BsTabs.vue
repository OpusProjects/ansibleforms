<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Tabs container.                                     */
/*                                                                */
/*  Manages a list of <BsTab> children via provide/inject and     */
/*  renders a nav-tabs header + stacked tab panes (panes are      */
/*  rendered by the child <BsTab> components themselves, this     */
/*  component only draws the header).                             */
/*                                                                */
/*  The header is hidden automatically when only a single tab     */
/*  is registered, so callers can use <BsTabs> unconditionally.   */
/*                                                                */
/*  @props:                                                       */
/*      modelValue: String - id of the active tab (v-model)       */
/*      pills: Boolean - use nav-pills instead of nav-tabs        */
/*      fill: Boolean - use nav-fill (equal-width tabs)           */
/*                                                                */
/*  @emits:                                                       */
/*      update:modelValue                                         */
/*                                                                */
/*  @slots:                                                       */
/*      default: <BsTab> children                                 */
/*                                                                */
/******************************************************************/

import { ref, computed, provide, reactive, watch } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  // Visual style for the nav header. Defaults to Bootstrap's nav-underline
  // which works nicely as a drilldown breadcrumb.
  variant: {
    type: String,
    default: 'tabs',
    validator: (v) => ['tabs', 'pills'].includes(v),
  },
  fill: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue']);

// Ordered list of registered tabs. Entries are reactive wrappers so title
// updates in children propagate to the header.
const tabs = reactive([]);

// Active tab id (internal), synced with v-model.
const activeId = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => {
    if (v && v !== activeId.value) activeId.value = v;
  },
);
watch(activeId, (v) => {
  if (v !== props.modelValue) emit('update:modelValue', v);
});

function register(tab) {
  tabs.push(tab);
  // If nothing is active yet, activate the first tab.
  if (!activeId.value) activeId.value = tab.id;
}

function unregister(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  tabs.splice(idx, 1);
  // If the closed tab was active, fall back to the previous one (or the
  // new first one if we just removed the head).
  if (activeId.value === id) {
    const fallback = tabs[idx - 1] || tabs[idx] || tabs[0];
    activeId.value = fallback ? fallback.id : '';
  }
}

function isActive(id) {
  return activeId.value === id;
}

function activate(id) {
  activeId.value = id;
}

// Injected API consumed by <BsTab> children.
provide('bsTabs', {
  register,
  unregister,
  isActive,
  activate,
});

const navClass = computed(() => {
  const base = `nav nav-${props.variant}`;
  return props.fill ? `${base} nav-fill` : base;
});

const showHeader = computed(() => tabs.length > 1);

function onTabClick(tab, ev) {
  ev?.preventDefault();
  if (tab.disabled) return;
  activate(tab.id);
}
</script>

<template>
  <!-- Header (only shown when more than one tab is present) -->
  <ul v-if="showHeader" :class="navClass">
    <li v-for="tab in tabs" :key="tab.id" class="nav-item">
      <a
        href="#"
        class="nav-link"
        :class="{ active: tab.id === activeId, disabled: tab.disabled }"
        @click="onTabClick(tab, $event)"
        >{{ tab.title }}</a
      >
    </li>
  </ul>

  <!-- Panes: rendered by <BsTab> children -->
  <div class="tab-content">
    <slot></slot>
  </div>
</template>
