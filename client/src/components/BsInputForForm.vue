<script setup>
/******************************************************************/
/*                                                                */
/*  AnsibleForms Form Input component                             */
/*                                                                */
/*  This component covers all form input types                    */
/*                                                                */
/******************************************************************/

import { getCurrentInstance, computed } from 'vue';
import HtmlSanitizer from '@/lib/HtmlSanitizer';
import ace from 'ace-builds';
import 'ace-builds/src-noconflict/mode-yaml'; // Load the language definition file used below
import 'ace-builds/src-noconflict/theme-monokai'; // Load the theme definition file used below
import extSearchboxUrl from 'ace-builds/src-noconflict/ext-searchbox?url';

// INIT

ace.config.setModuleUrl('ace/ext/searchbox', extSearchboxUrl);
const emit = defineEmits(['update:modelValue', 'keyup_enter', 'keydown', 'change', 'focus', 'dblclick', 'blur']);
const { uid } = getCurrentInstance();

// MODEL

const model = defineModel();
const sanitizedModel = computed(() => HtmlSanitizer.sanitize(model.value));

// PROPS

defineProps({
  label: { type: String, default: '' },
  icon: { type: String },
  help: { type: String, default: '' },
  description: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  hasError: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  accept: { type: String, default: '' },
  errors: { type: Array, default: () => [] },
  type: { type: String, default: 'text' },
  style: { type: [String, Object], default: '' },
  cssClass: { type: String, default: '' },
  isHorizontal: { type: Boolean, default: false },
  isInline: { type: Boolean, default: false },
  isHtml: { type: Boolean, default: false },
  values: { type: Array, default: () => [] },
  valueKey: { type: String, default: 'value' },
  labelKey: { type: String, default: 'label' },
  rows: { type: Number, default: 3 },
  lang: { type: String, default: 'yaml' },
  theme: { type: String, default: 'monokai' },
  columns: { type: Array, default: () => [] },
  previewColumn: { type: String, default: '' },
  valueColumn: { type: String, default: '' },
  pctColumns: { type: Array, default: () => [] },
  filterColumns: { type: Array, default: () => [] },
  sticky: { type: Boolean, default: false },
  horizontal: { type: Boolean, default: false },
  multiple: { type: Boolean, default: false },
  defaultValue: { type: [String, Array, Object, Number], default: '' },
  isSwitch: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  name: { type: String, default: '' },
  progress: { type: Number, default: undefined },
  dateType: { type: String, default: 'datetime' },
  convertToUtc: { type: Boolean, default: false },
  autofocus: { type: Boolean, default: false },
  containerSize: { type: Object, default: () => ({}) },
});

// METHODS

function change(event) {
  emit('change', event);
}
function keydown(event) {
  emit('keydown', event);
}
function focus(event) {
  emit('focus', event);
  hasFocus.value = true;
}
function keyup_enter(event) {
  emit('keyup_enter', event);
}
function dblclick(event) {
  emit('dblclick', event);
}
function blur(event) {
  emit('blur', event);
  hasFocus.value = false;
}

// DATA

const hasFocus = ref(false);
</script>
<template>
  <div :class="{ 'mb-3': !isInline, 'd-flex align-items-center': isInline }">
    <!-- WITH ICON -->
    <div v-if="icon && !['select', 'datetime', 'file'].includes(type)">
      <!-- ICON FIELD GROUP -->
      <div class="input-group">
        <!-- ICON -->
        <span class="input-group-text text-gray-500" :class="{ active: hasFocus }" :style="style">
          <FaIcon :fixedwidth="true" :icon="icon" />
        </span>

        <!-- INPUT FIELDS -->
        <BsInputTextAreaRaw
          v-if="type === 'textarea'"
          :rows="rows"
          :readonly="readonly"
          :disabled="disabled"
          :style="style"
          :cssClass="cssClass"
          :id="uid"
          :hasError="hasError"
          :placeholder="placeholder"
          v-model="model"
        />
        <p
          @dblclick="dblclick"
          v-else-if="type == 'expression' && isHtml"
          class="form-control"
          :style="style"
          v-html="sanitizedModel"
          :class="cssClass"
        ></p>
        <p
          @dblclick="dblclick"
          v-else-if="type == 'expression' && !isHtml"
          class="form-control"
          :style="style"
          v-text="model"
          :class="cssClass"
        ></p>
        <BsInputRaw
          v-else
          :readonly="readonly"
          :disabled="disabled"
          :style="style"
          :cssClass="cssClass"
          :uid="uid"
          :type="type"
          @keyup_enter="keyup_enter"
          :hasError="hasError"
          :placeholder="placeholder"
          v-model="model"
          @focus="focus"
          @keydown="keydown"
          @change="change"
          @blur="blur"
        />
      </div>
    </div>

    <!-- WITHOUT ICON -->
    <div v-else>
      <!-- INPUT FIELDS -->
      <BsInputSelectAdvanced
        v-if="type === 'select'"
        :readonly="readonly"
        :disabled="disabled"
        :style="style"
        :cssClass="cssClass"
        :id="uid"
        :hasError="hasError"
        :placeholder="placeholder"
        v-model="model"
        :values="values"
        :defaultValue="defaultValue"
        :multiple="multiple"
        :columns="columns"
        :previewColumn="previewColumn"
        :valueColumn="valueColumn"
        :pctColumns="pctColumns"
        :filterColumns="filterColumns"
        :sticky="sticky"
        :horizontal="horizontal"
        :icon="icon"
        :uid="uid"
        :isLoading="isLoading"
        :name="name"
        :isFloating="false"
        :containerSize="containerSize"
      />
      <BsInputTextAreaRaw
        v-else-if="type === 'textarea'"
        :rows="rows"
        :readonly="readonly"
        :disabled="disabled"
        :style="style"
        :cssClass="cssClass"
        :id="uid"
        :hasError="hasError"
        :placeholder="placeholder"
        v-model="model"
      />
      <BsDateTime
        v-else-if="type === 'datetime'"
        :icon="icon"
        v-model="model"
        :name="name"
        :hasError="hasError"
        :placeholder="placeholder"
        :dateType="dateType"
        :convertToUtc="convertToUtc"
        @change="change"
      />
      <p
        @dblclick="dblclick"
        v-else-if="type == 'expression' && isHtml"
        class="form-control"
        :style="style"
        v-html="sanitizedModel"
        :class="[cssClass, { 'is-invalid': hasError }]"
      ></p>
      <p
        @dblclick="dblclick"
        v-else-if="type == 'expression' && !isHtml"
        class="form-control"
        :style="style"
        v-text="model"
        :class="[cssClass, { 'is-invalid': hasError }]"
      ></p>
      <BsInputCheckboxRaw
        v-else-if="type === 'checkbox'"
        :isSwitch="isSwitch"
        :readonly="readonly"
        :disabled="disabled"
        :style="style"
        :cssClass="cssClass"
        :hasError="hasError"
        :label="label"
        v-model="model"
        @change="change"
      />
      <BsInputRadiobuttonRaw
        v-else-if="type === 'radio'"
        :disabled="disabled"
        :style="style"
        :cssClass="cssClass"
        :hasError="hasError"
        :name="name"
        v-model="model"
        :values="values"
        @change="change"
      />
      <BsInputFileRaw
        v-else-if="type === 'file'"
        :name="name"
        :icon="icon"
        :readonly="readonly"
        :cssClass="cssClass"
        :uid="uid"
        :hasError="hasError"
        :placeholder="placeholder"
        @change="change"
        :progress="progress"
        :accept="accept"
      />
      <BsInputRaw
        v-else
        :readonly="readonly"
        :autofocus="autofocus"
        :disabled="disabled"
        :style="style"
        :cssClass="cssClass"
        :uid="uid"
        :type="type"
        @keyup_enter="keyup_enter"
        :hasError="hasError"
        :placeholder="placeholder"
        v-model="model"
        @focus="focus"
        @keydown="keydown"
        @change="change"
        @blur="blur"
      />
    </div>
    <div v-if="hasError && errors.length > 0" class="invalid-feedback">
      {{ errors[0].$message || errors[0].$params?.description || errors[0] }}
    </div>
    <div class="form-text" v-if="help">
      {{ help }}
    </div>
  </div>
</template>
<style scoped lang="scss">
.invalid-feedback {
  display: block !important;
}
p {
  margin: 0;
  &::after {
    content: '\200B'; // zero-width space
    display: inline-block;
    width: 0;
    height: 1em;
    visibility: hidden;
  }
}
.input-group-text {
  &.active {
    color: var(--bs-body) !important;
  }
}
</style>
