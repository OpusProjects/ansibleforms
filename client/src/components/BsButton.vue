<script setup>
/******************************************************/
/*                                                    */
/*  Bootstrap Button Component                        */
/*                                                    */
/*  @props:                                           */
/*      colorClass: String - Color class              */
/*      isIconButton: Boolean - Is icon button        */
/*      icon: String - Icon name                      */
/*      cssClass: String - Custom css class           */
/*      spin: Boolean - Spin icon                     */
/*      iconToggle: String - Icon name for toggle     */
/*      toggle: Boolean - Toggle button               */
/*      cssClassToggle: String - Custom css class     */
/*                                                    */
/*  @emit:                                            */
/*      click: Event - Click event                    */
/*                                                    */
/******************************************************/

import { computed } from 'vue';

// INIT

const emit = defineEmits(['click']);

// PROPS

const props = defineProps({
  colorClass: {
    type: String,
    default: 'primary',
  },
  isIconButton: {
    type: Boolean,
    default: false,
  },
  icon: {
    type: String,
    default: '',
  },
  cssClass: {
    type: String,
    default: '',
  },
  spin: {
    type: Boolean,
    default: false,
  },
  iconToggle: {
    type: String,
    default: '',
  },
  toggle: {
    type: Boolean,
    default: false,
  },
  cssClassToggle: {
    type: String,
    default: '',
  },
});

// COMPUTED

const classes = computed(() => {
  if (props.cssClass && !props.toggle) {
    return `btn-outline-${props.colorClass} ${props.cssClass}`;
  } else if (props.cssClassToggle && props.toggle) {
    return `btn-outline-${props.colorClass} ${props.cssClassToggle}`;
  } else {
    return `btn-outline-${props.colorClass}`;
  }
});
</script>
<template>
  <button type="button" class="btn" :class="classes" @click="emit('click', $event)">
    <span v-if="icon && !toggle" :class="{ 'me-1': !isIconButton }"><FaIcon :icon="icon" :spin="spin" /></span>
    <span v-if="iconToggle && toggle" :class="{ 'me-1': !isIconButton }"
      ><FaIcon :icon="iconToggle" :spin="spin"
    /></span>
    <span>
      <slot v-if="!toggle"></slot>
      <slot name="toggle" v-if="toggle"></slot>
    </span>
  </button>
</template>
