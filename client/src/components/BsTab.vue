<script setup>
/******************************************************************/
/*                                                                */
/*  A single tab pane inside <BsTabs>. Registers itself with the  */
/*  parent on mount, unregisters on unmount. The slot content     */
/*  is always rendered (v-show) so per-tab state is preserved     */
/*  across tab switches.                                          */
/*                                                                */
/*  @props:                                                       */
/*      id: String - unique tab id (required)                     */
/*      title: String - label shown in the nav                    */
/*      icon: String - optional FA icon name                      */
/*      closable: Boolean - show an × button in the tab header    */
/*      disabled: Boolean - prevent activation                    */
/*                                                                */
/*  @emits:                                                       */
/*      close - fired when the × is clicked                       */
/*                                                                */
/*  @slots:                                                       */
/*      default: pane contents                                    */
/*                                                                */
/******************************************************************/

import { inject, onBeforeUnmount, reactive, watch, computed } from 'vue';

const props = defineProps({
  id: { type: String, required: true },
  title: { type: String, default: '' },
  icon: { type: String, default: '' },
  closable: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['close']);

const api = inject('bsTabs', null);
if (!api) {
  console.error('<BsTab> must be used inside <BsTabs>');
}

// Reactive descriptor the parent reads to render the header. We mutate its
// fields so changes in props are reflected live in the nav.
const descriptor = reactive({
  id: props.id,
  title: props.title,
  icon: props.icon,
  closable: props.closable,
  disabled: props.disabled,
  onClose: () => emit('close'),
});

watch(
  () => props.title,
  (v) => {
    descriptor.title = v;
  },
);
watch(
  () => props.icon,
  (v) => {
    descriptor.icon = v;
  },
);
watch(
  () => props.closable,
  (v) => {
    descriptor.closable = v;
  },
);
watch(
  () => props.disabled,
  (v) => {
    descriptor.disabled = v;
  },
);

api?.register(descriptor);

onBeforeUnmount(() => {
  api?.unregister(props.id);
});

const active = computed(() => !!api?.isActive(props.id));
</script>

<template>
  <div class="tab-pane" :class="{ 'active show': active }" v-show="active" role="tabpanel">
    <slot></slot>
  </div>
</template>
