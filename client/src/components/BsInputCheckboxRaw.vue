<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Input Checkbox component                            */
/*                                                                */
/*  @props:                                                       */
/*      label: String                                             */
/*      readonly: Boolean                                         */
/*      style: String                                             */
/*      cssClass: String                                          */
/*      isSwitch: Boolean                                           */
/*      uid: String                                               */
/*      hasError: Boolean                                         */
/*                                                                */
/******************************************************************/

const emit = defineEmits(['change']);

// MODEL

const model = defineModel();

// PROPS

defineProps({
  label: {
    type: String,
    required: true,
  },
  readonly: {
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
  isSwitch: {
    type: Boolean,
    default: true,
  },
  uid: {
    type: [String, Number],
    default: '',
  },
  hasError: {
    type: Boolean,
    default: false,
  },
});

const change = () => {
  emit('change', model.value);
};
</script>
<template>
  <BsCheckbox
    v-model="model"
    :isSwitch="isSwitch"
    :label="label"
    :readonly="readonly"
    @change="change"
    :uid="uid"
    :style="style"
    :cssClass="cssClass"
    :hasError="hasError"
  />
</template>
