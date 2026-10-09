<script setup>
/********************************************************/
/*                                                      */
/*  Bootstrap Form Input Component                      */
/*  Handles all input types                             */
/*                                                      */
/*  Types:                                              */
/*    - text                                            */
/*    - password                                        */
/*    - email                                           */
/*    - number                                          */
/*    - checkbox                                        */
/*    - select                                          */
/*    - select_advanced                                 */
/*    - textarea                                        */
/*    - editor                                          */
/*    - sshPrivateKeyArt                                */
/*    - sshPublicKey                                    */
/*                                                      */
/********************************************************/

import { getCurrentInstance } from 'vue';
import ace from 'ace-builds';
import 'ace-builds/src-noconflict/mode-yaml'; // Load the language definition file used below
import 'ace-builds/src-noconflict/theme-monokai';
import 'ace-builds/src-noconflict/theme-chrome';
import extSearchboxUrl from 'ace-builds/src-noconflict/ext-searchbox?url';

// MODEL

const model = defineModel();

// INIT

ace.config.setModuleUrl('ace/ext/searchbox', extSearchboxUrl);
const emit = defineEmits(['update:modelValue', 'dirty', 'keyup_enter', 'save', 'init']);
const { uid } = getCurrentInstance();

// PROPS

defineProps({
  icon: { type: String }, // Icon name
  label: { type: String, default: '' }, // Label text
  help: { type: String, default: '' }, // Help text
  description: { type: String, default: '' }, // Description text
  placeholder: { type: String, default: '' }, // Placeholder text
  hasError: { type: Boolean, default: false }, // Error flag
  required: { type: Boolean, default: false }, // Required flag
  readonly: { type: Boolean, default: false }, // Readonly flag
  disabled: { type: Boolean, default: false }, // Disabled flag
  errors: { type: Array, default: () => [] }, // Error messages
  type: { type: String, default: 'text' }, // Input type
  style: { type: [String, Object], default: '' }, // Style
  isFloating: { type: Boolean, default: true }, // Floating flag, for floating labels
  cssClass: { type: String, default: '' }, // CSS class
  isHorizontal: { type: Boolean, default: false }, // label and input in the same row
  isInline: { type: Boolean, default: false }, // Field is inline with other fields
  isSwitch: { type: Boolean, default: true }, // checkbox: render as a switch
  values: { type: Array, default: () => [] }, // values for select and select_advanced
  valueKey: { type: String, default: 'value' }, // Value key for select
  labelKey: { type: String, default: 'label' }, // Label key for select
  rows: { type: Number, default: 3 }, // Rows for textarea
  lang: { type: String, default: 'yaml' }, // Language for editor
  theme: { type: String, default: null }, // Theme for editor (null = auto-detect light/dark)
  liveSync: { type: Boolean, default: false }, // editor: emit model on every change (raw-string parents only)
  columns: { type: Array, default: () => [] }, // Columns for select_advanced
  previewColumn: { type: String, default: '' }, // Preview column for select_advanced
  valueColumn: { type: String, default: '' }, // Value column for select_advanced
  pctColumns: { type: Array, default: () => [] }, // Percentage columns for select_advanced
  filterColumns: { type: Array, default: () => [] }, // Filter columns for select_advanced
  sticky: { type: Boolean, default: false }, // Sticky flag for select_advanced
  horizontal: { type: Boolean, default: false }, // Horizontal flag for select_advanced
  multiple: { type: Boolean, default: false }, // Multiple flag for select_advanced
  defaultValue: { type: String, default: '' }, // Default value for select_advanced
  isLoading: { type: Boolean, default: false }, // Loading flag for select_advanced
  name: { type: String, default: '' }, // field name
});
</script>
<template>
  <template v-if="isFloating && type != 'checkbox' && type != 'select_advanced'">
    <div :class="{ 'mb-3': !isInline, 'd-flex align-items-center': isInline }">
      <div v-if="icon" class="input-group">
        <span class="input-group-text" :style="style">
          <FaIcon :fixedwidth="true" :icon="icon" />
        </span>
        <div class="form-floating">
          <BsInputSelectRaw
            v-if="type === 'select'"
            :readonly="readonly"
            :valueKey="valueKey"
            :labelKey="labelKey"
            :disabled="disabled"
            :style="style"
            :cssClass="cssClass"
            :id="uid"
            :hasError="hasError"
            :placeholder="placeholder"
            v-model="model"
            :values="values"
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
          <BsInputRaw
            v-else
            :readonly="readonly"
            :disabled="disabled"
            :style="style"
            :cssClass="cssClass"
            :id="uid"
            :type="type"
            @keyup_enter="emit('keyup_enter')"
            :hasError="hasError"
            :placeholder="placeholder"
            v-model="model"
          />
          <label :for="uid">{{ label }}<span v-if="required" class="text-danger ms-1">*</span></label>
        </div>
      </div>
      <div v-else class="form-floating">
        <BsInputSelectRaw
          v-if="type === 'select'"
          :readonly="readonly"
          :valueKey="valueKey"
          :labelKey="labelKey"
          :disabled="disabled"
          :style="style"
          :cssClass="cssClass"
          :id="uid"
          :hasError="hasError"
          :placeholder="placeholder"
          v-model="model"
          :values="values"
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
        <BsInputRaw
          v-else
          :readonly="readonly"
          :disabled="disabled"
          :style="style"
          :cssClass="cssClass"
          :id="uid"
          :type="type"
          @keyup_enter="emit('keyup_enter')"
          :hasError="hasError"
          :placeholder="placeholder"
          v-model="model"
        />
        <label :for="uid">{{ label }}<span v-if="required" class="text-danger ms-1">*</span></label>
      </div>
      <div v-if="hasError && errors.length > 0" class="invalid-feedback">
        {{ errors[0].$message || errors[0] }}
      </div>
      <div class="form-text" v-if="help">
        {{ help }}
      </div>
    </div>
  </template>
  <template v-else-if="isFloating && type == 'select_advanced' && !sticky">
    <div :class="{ 'mb-3': !isInline, 'd-flex align-items-center': isInline }">
      <BsInputSelectAdvanced
        :name="name"
        v-model="model"
        :values="values"
        :columns="columns"
        :previewColumn="previewColumn"
        :required="required"
        :defaultValue="defaultValue"
        :multiple="multiple"
        :valueColumn="valueColumn"
        :pctColumns="pctColumns"
        :filterColumns="filterColumns"
        :sticky="sticky"
        :horizontal="horizontal"
        :icon="icon"
        :uid="uid"
        :label="label"
        :hasError="hasError"
        :isFloating="isFloating"
        :isLoading="isLoading"
      />
      <div v-if="hasError && errors.length > 0" class="invalid-feedback">
        {{ errors[0].$message || errors[0] }}
      </div>
      <div class="form-text" v-if="help">
        {{ help }}
      </div>
    </div>
  </template>
  <template v-else-if="isHorizontal">
    <div class="row" :class="{ 'mb-3': !isInline, 'd-flex align-items-center': isInline }">
      <label
        :for="uid"
        class="form-label fw-bold col-form-label col-sm-2"
        :class="{ 'af-label-tall': ['editor', 'textarea'].includes(type) }"
        >{{ type != 'checkbox' ? label : ''
        }}<span v-if="required && type != 'checkbox'" class="text-danger ms-1">*</span></label
      >
      <!-- a checkbox/switch has no input-group, so it must not take the icon
           branch: it would fall through to BsInputRaw and render as a text box -->
      <div v-if="icon && type != 'select_advanced' && type != 'checkbox'" class="col-sm-10">
        <div class="input-group">
          <span class="input-group-text text-gray-500" :style="style">
            <FaIcon :fixedwidth="true" :icon="icon" />
          </span>
          <BsInputSelectRaw
            v-if="type === 'select'"
            :readonly="readonly"
            :valueKey="valueKey"
            :labelKey="labelKey"
            :disabled="disabled"
            :style="style"
            :cssClass="cssClass"
            :id="uid"
            :hasError="hasError"
            :placeholder="placeholder"
            v-model="model"
            :values="values"
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
          <BsInputRaw
            v-else
            :readonly="readonly"
            :disabled="disabled"
            :style="style"
            :cssClass="cssClass"
            :uid="uid"
            :type="type"
            @keyup_enter="emit('keyup_enter')"
            :hasError="hasError"
            :placeholder="placeholder"
            v-model="model"
          />
          <div v-if="hasError && errors.length > 0" class="invalid-feedback">
            {{ errors[0].$message || errors[0] }}
          </div>
        </div>
        <div class="form-text" v-if="help">
          {{ help }}
        </div>
      </div>
      <div
        v-else-if="type == 'select_advanced'"
        class="col-sm-10"
        :class="{ 'mb-3': !isInline, 'd-flex align-items-center': isInline }"
      >
        <label
          :for="uid"
          class="form-label fw-bold col-form-label col-sm-2"
          :class="{ 'af-label-tall': ['editor', 'textarea'].includes(type) }"
          >{{ label }}<span v-if="required && type != 'checkbox'" class="text-danger ms-1">*</span></label
        >
        <BsInputSelectAdvanced
          :name="name"
          v-model="model"
          :values="values"
          :columns="columns"
          :previewColumn="previewColumn"
          :required="required"
          :defaultValue="defaultValue"
          :multiple="multiple"
          :valueColumn="valueColumn"
          :pctColumns="pctColumns"
          :filterColumns="filterColumns"
          :sticky="sticky"
          :horizontal="horizontal"
          :icon="icon"
          :uid="uid"
          :label="label"
          :hasError="hasError"
          :isFloating="isFloating"
          :isLoading="isLoading"
        />
        <div v-if="hasError && errors.length > 0" class="invalid-feedback">
          {{ errors[0].$message || errors[0] }}
        </div>
        <div class="form-text" v-if="help">
          {{ help }}
        </div>
      </div>
      <div v-else class="col-sm-10">
        <BsInputSelectRaw
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
        <AceEditor
          v-else-if="type === 'editor'"
          v-model="model"
          :lang="lang"
          :theme="theme"
          :liveSync="liveSync"
          @save="emit('save')"
          @init="(e) => emit('init', e)"
          :style="style"
          :printMargin="true"
          @dirty="emit('dirty')"
        />
        <BsInputCheckboxRaw
          v-else-if="type === 'checkbox'"
          :readonly="readonly"
          :disabled="disabled"
          :style="style"
          :cssClass="cssClass"
          :uid="uid"
          :isSwitch="isSwitch"
          :hasError="hasError"
          :label="label"
          v-model="model"
        />
        <BsInputRaw
          v-else
          :readonly="readonly"
          :disabled="disabled"
          :style="style"
          :cssClass="cssClass"
          :uid="uid"
          :type="type"
          @keyup_enter="emit('keyup_enter')"
          :hasError="hasError"
          :placeholder="placeholder"
          v-model="model"
        />
        <div v-if="hasError && errors.length > 0" class="invalid-feedback">
          {{ errors[0].$message || errors[0] }}
        </div>
        <div class="form-text" v-if="help">
          {{ help }}
        </div>
      </div>
    </div>
  </template>
  <template v-else>
    <div :class="{ 'mb-3': !isInline, 'd-flex align-items-center': isInline }">
      <label :for="uid" class="form-label fw-bold"
        >{{ type != 'checkbox' ? label : ''
        }}<span v-if="required && type != 'checkbox'" class="text-danger ms-1">*</span></label
      >
      <p v-if="description" v-html="description"></p>
      <!-- see the horizontal branch: a checkbox/switch has no input-group -->
      <div v-if="icon && type !== 'select_advanced' && type !== 'checkbox'">
        <div class="input-group">
          <span class="input-group-text text-gray-500" :style="style">
            <FaIcon :fixedwidth="true" :icon="icon" />
          </span>
          <BsInputSelectRaw
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
          <BsInputRaw
            v-else
            :readonly="readonly"
            :disabled="disabled"
            :style="style"
            :cssClass="cssClass"
            :id="uid"
            :type="type"
            @keyup_enter="emit('keyup_enter')"
            :hasError="hasError"
            :placeholder="placeholder"
            v-model="model"
          />
        </div>
      </div>
      <div v-else>
        <BsInputSelectRaw
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
        />
        <BsInputSelectAdvanced
          v-else-if="type === 'select_advanced'"
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
          :label="label"
          :isLoading="isLoading"
          :name="name"
          :isFloating="isFloating"
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
        <AceEditor
          v-else-if="type === 'editor'"
          v-model="model"
          :lang="lang"
          :theme="theme"
          :liveSync="liveSync"
          :style="style"
          :printMargin="false"
          @save="emit('save')"
          @init="(e) => emit('init', e)"
          @dirty="emit('dirty')"
        />
        <BsSshKey
          v-else-if="['sshPrivateKeyArt', 'sshPublicKey'].includes(type)"
          v-model="model"
          :type="type"
          :icon="icon"
          :required="required"
        />
        <!-- BsInputCheckboxRaw declares `uid`, not `id`: passing `id` left it
             empty, so the rendered <label for=""> matched no input and clicking
             the label did nothing -->
        <BsInputCheckboxRaw
          v-else-if="type === 'checkbox'"
          :readonly="readonly"
          :disabled="disabled"
          :style="style"
          :cssClass="cssClass"
          :uid="uid"
          :isSwitch="isSwitch"
          :hasError="hasError"
          :label="label"
          v-model="model"
        />
        <BsInputRaw
          v-else
          :readonly="readonly"
          :disabled="disabled"
          :style="style"
          :cssClass="cssClass"
          :id="uid"
          :type="type"
          @keyup_enter="emit('keyup_enter')"
          :hasError="hasError"
          :placeholder="placeholder"
          v-model="model"
        />
      </div>
      <div v-if="hasError && errors.length > 0" class="invalid-feedback">
        {{ errors[0].$message || errors[0] }}
      </div>
      <div class="form-text" v-if="help">
        {{ help }}
      </div>
    </div>
  </template>
</template>
<style scoped lang="scss">
.form-floating:focus-within {
  z-index: 2;
}
.invalid-feedback {
  display: block !important;
}
/* beside a tall box (an editor, a textarea) the label starts level with its first line : the
   top padding that centres it on a one line input would put it below */
.af-label-tall {
  padding-top: 0.2rem;
}
</style>
