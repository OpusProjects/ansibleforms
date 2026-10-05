<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap OffCanvas component                                 */
/*                                                                */
/*  @props:                                                       */
/*      title: String                                             */
/*      icon: String                                              */
/*      show: Boolean                                             */
/*                                                                */
/*  @slots:                                                       */
/*      default: OffCanvas content                                */
/*      actions: OffCanvas actions                                */
/*                                                                */
/*  @emit:                                                        */
/*      close: Event                                              */
/*                                                                */
/******************************************************************/

import { getCurrentInstance } from 'vue';

// INIT

const { uid } = getCurrentInstance();
const emit = defineEmits(['close']);

// PROPS

defineProps({
  title: {
    type: String,
    required: true,
  },
  icon: {
    type: String,
    default: null,
  },
  show: {
    type: Boolean,
    default: false,
  },
});

// METHODS

function close() {
  emit('close');
}
function backdropClick(_e) {
  close();
}
</script>

<template>
  <div
    :id="uid"
    class="offcanvas offcanvas-start d-block"
    :class="{ show: show }"
    tabindex="-1"
    data-bs-keyboard="true"
    aria-hidden="true"
    aria-labelledby="offcanvasLabel"
  >
    <div class="offcanvas-header">
      <h5 class="offcanvas-title" id="offcanvasLabel">
        <span v-if="icon" class="me-3"><FaIcon :icon="icon" /></span>{{ title }}
      </h5>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close" @click="close"></button>
    </div>
    <div class="offcanvas-body h-100">
      <slot></slot>
      <slot name="actions"></slot>
      <div style="height: 200px"></div>
    </div>
  </div>
  <div @click="backdropClick" class="offcanvas-backdrop fade show" v-if="show"></div>
</template>
<style scoped></style>
