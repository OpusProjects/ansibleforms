<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Input Radiobutton component                          */
/*                                                                */
/*  @props:                                                       */
/*      name: String                                              */
/*      disabled: Boolean                                         */
/*      style: String                                             */
/*      cssClass: String                                          */
/*      uid: String                                               */
/*      hasError: Boolean                                         */
/*      values: Array                                             */
/*                                                                */
/******************************************************************/

// MODEL

const model = defineModel();

// EMITS

const emit = defineEmits(['change']);

// PROPS

defineProps({
  name: {
    type: String,
    required: true,
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
  values: {
    type: Array,
    required: true,
  },
});

// METHODS

const handleChange = (event) => {
  emit('change', event);
};
</script>
<template>
  <BsRadiobutton
    :name="name"
    v-model="model"
    v-for="radiovalue in values"
    :inline="true"
    :value="typeof radiovalue == 'string' ? radiovalue : radiovalue.value"
    :key="typeof radiovalue == 'string' ? radiovalue : radiovalue.value"
    :label="typeof radiovalue == 'string' ? radiovalue : radiovalue.label"
    :disabled="disabled"
    :style="style"
    :cssClass="cssClass"
    :hasError="hasError"
    @change="handleChange"
  />
</template>
