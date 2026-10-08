<script setup>
import { computed } from 'vue';
const model = defineModel();
const props = defineProps({
  placeholder: {
    type: String,
    default: '',
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  style: {
    type: String,
    default: '',
  },
  cssClass: {
    type: String,
    default: '',
  },
  uid: {
    type: String,
    default: '',
  },
  hasError: {
    type: Boolean,
    default: false,
  },
  rows: {
    type: Number,
    default: 3,
  },
});

const classes = computed(() => {
  let classList = ['form-control'];
  if (props.cssClass) {
    classList.push(props.cssClass);
  }
  if (props.hasError) {
    classList.push('is-invalid');
  }
  return classList.join(' ');
});
</script>
<template>
  <textarea
    :readonly="readonly"
    :disabled="disabled"
    :id="uid"
    :style="style"
    :rows="rows"
    :class="classes"
    :placeholder="placeholder"
    v-model="model"
  ></textarea>
</template>
