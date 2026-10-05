<script setup>
/*****************************************************/
/*                                                   */
/*  Bootstrap Checkbox Component                     */
/*                                                   */
/*  @props:                                          */
/*      label: String - Label of the checkbox        */
/*      inline: Boolean - Inline checkbox            */
/*      isSwitch: Boolean - Switch checkbox            */
/*      cssClass: String - Custom css class          */
/*      uid: String - Unique id                      */
/*      hasError: Boolean - Has error                */
/*      disabled: Boolean - Disabled checkbox        */
/*      readonly: Boolean - Readonly checkbox        */
/*                                                   */
/*****************************************************/

import { computed } from 'vue';

const emit = defineEmits(['change']);

// MODEL

const model = defineModel();

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
  isSwitch: {
    type: Boolean,
    default: true,
  },
  cssClass: {
    type: String,
    default: '',
  },
  uid: {
    type: [String, Number],
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
  readonly: {
    type: Boolean,
    default: false,
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
  if (props.isSwitch) {
    classList.push('form-switch');
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
const change = () => {
  emit('change', model.value);
};
</script>
<template>
  <div :class="globalClasses">
    <input
      class="form-check-input"
      :disabled="disabled || readonly"
      :class="classes"
      type="checkbox"
      @change="change"
      :id="uid"
      v-model="model"
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
