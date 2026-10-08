<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Radio Button component                              */
/*                                                                */
/*  @props:                                                       */
/*      label: String                                             */
/*      inline: Boolean                                           */
/*      name: String                                              */
/*      cssClass: String                                          */
/*      hasError: Boolean                                         */
/*      disabled: Boolean                                         */
/*      value: String                                             */
/*                                                                */
/******************************************************************/

import { computed } from 'vue';
import { getCurrentInstance } from 'vue';

// INIT
const { uid } = getCurrentInstance();

// MODEL

const model = defineModel();

// EMITS

const emit = defineEmits(['change']);

// PROPS

const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  inline: {
    type: Boolean,
    default: false,
  },
  name: {
    type: String,
    required: true,
  },
  cssClass: {
    type: String,
    default: '',
  },
  hasError: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  value: {
    type: String,
    required: true,
  },
});

// COMPUTED

const globalClasses = computed(() => {
  let classList = ['form-check'];
  if (props.inline) {
    classList.push('form-check-inline');
  }
  if (props.cssClass) {
    classList.push(props.cssClass);
  }
  return classList.join(' ');
});

const classes = computed(() => {
  let classList = [];
  if (props.hasError) {
    classList.push('is-invalid');
  }
  return classList.join(' ');
});

// METHODS

const handleChange = (event) => {
  emit('change', event);
};
</script>
<template>
  <div :class="globalClasses">
    <input
      class="form-check-input"
      :disabled="disabled"
      :class="classes"
      type="radio"
      :id="uid"
      :name="name"
      :value="value"
      v-model="model"
      @change="handleChange"
    />
    <label class="form-check-label" :for="uid">{{ label }}</label>
  </div>
</template>
<style scoped lang="scss">
.form-check-input {
  &:checked {
    background-color: var(--af-primary);
    border-color: var(--af-primary);
  }
}
</style>
