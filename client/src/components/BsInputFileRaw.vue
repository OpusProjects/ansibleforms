<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Input File component                                */
/*                                                                */
/*  @props:                                                       */
/*      placeholder: String                                       */
/*      icon: String                                              */
/*      name: String                                              */
/*      readonly: Boolean                                         */
/*      uid: String                                               */
/*      hasError: Boolean                                         */
/*      accept: String                                            */
/*      progress: Number                                          */
/*                                                                */
/*  @emit:                                                        */
/*      change: Event                                              */
/*                                                                */
/******************************************************************/

import { computed } from 'vue';

// INIT

const emit = defineEmits(['change']);

// PROPS

const props = defineProps({
  placeholder: {
    type: String,
    default: '',
  },
  icon: {
    type: String,
    default: '',
  },
  name: {
    type: String,
    required: true,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  uid: {
    type: [String, Number],
    default: '',
  },
  hasError: {
    type: Boolean,
    default: false,
  },
  accept: {
    type: String,
    default: '',
  },
  progress: {
    type: Number,
    default: undefined,
  },
  // read below to build the class list, and it was never declared - so it was always
  // undefined and the class silently never applied. BsInputRaw had exactly this bug
  // and was fixed; this sibling was missed, as was its caller (BsInputForForm did not
  // pass it either, unlike BsInput which passes it to every other raw input).
  cssClass: {
    type: String,
    default: '',
  },
});

// METHODS

function change(event) {
  emit('change', event);
}

// COMPUTED

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
  <div class="input-group">
    <span class="input-group-text text-gray-500" v-if="icon != ''">
      <FaIcon :fixedwidth="true" :icon="icon" />
    </span>
    <input
      :readonly="readonly"
      :accept="accept"
      :name="name"
      :class="classes"
      :id="uid"
      type="file"
      :placeholder="placeholder"
      @change="change"
    />
    <label class="input-group-text" v-if="progress != undefined">{{ progress }}%</label>
  </div>
</template>
<style scoped>
.is-tiny {
  height: 2px;
}
</style>
