<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Input Select Advanced component                     */
/*                                                                */
/*  It allow multicolumn dropdowns with filter, including         */
/*  horizontal and sticky modes.                                  */
/*                                                                */
/*  @props:                                                       */
/*      containerSize: Object                                     */
/*      values: Array                                             */
/*      hasError: Boolean                                         */
/*      multiple: Boolean                                         */
/*      required: Boolean                                         */
/*      isLoading: Boolean                                        */
/*      name: String                                              */
/*      defaultValue: String|Array|Object                         */
/*      placeholder: String                                       */
/*      icon: String                                              */
/*      sizeClass: String                                         */
/*      columns: Array                                            */
/*      previewColumn: String                                     */
/*      valueColumn: String                                       */
/*      pctColumns: Array                                         */
/*      filterColumns: Array                                      */
/*      sticky: Boolean                                           */
/*      horizontal: Boolean                                       */
/*      disabled: Boolean                                         */
/*      isFloating: Boolean                                       */
/*      label: String                                             */
/*      uid: String|Number                                        */
/*                                                                */
/******************************************************************/

import { useTemplateRef, nextTick } from 'vue';

const emit = defineEmits(['update:modelValue']);

const props = defineProps({
  modelValue: { type: [String, Array, Object, Number] },
  containerSize: { type: Object, default: () => ({ x: 0, width: 0 }) },
  values: { type: Array, required: true },
  hasError: { type: Boolean, default: false },
  multiple: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  name: { type: String, required: true },
  defaultValue: { type: [String, Array, Object, Number] },
  placeholder: { type: String },
  icon: { type: String },
  sizeClass: { type: String },
  columns: { type: Array, default: () => {} },
  previewColumn: { type: String },
  valueColumn: { type: String },
  pctColumns: { type: Array, default: () => [] },
  filterColumns: { type: Array, default: () => [] },
  sticky: { type: Boolean, default: false },
  horizontal: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  isFloating: { type: Boolean, default: true },
  label: { type: String, default: '' },
  uid: { type: [String, Number], required: true },
});

const selected = ref(null);
const isActive = ref(false);
const preview = ref('');
const focus = ref('');
const isUp = ref(false);
const isRight = ref(false);
const dropdownMenuWidth = ref('100%');
const inputRef = useTemplateRef('inputRef');
const contentRef = useTemplateRef('contentRef');
const ddRef = useTemplateRef('ddRef');
const dtRef = useTemplateRef('dtRef');

// computed property for safe v-model binding to selected.values
const selectedValues = computed({
  get() {
    return selected.value?.values || [];
  },
  set(newValue) {
    if (!selected.value) {
      selected.value = { values: [], preview: '' };
    }

    // Handle case where newValue is an object with values and preview (from BsInputSelectAdvanced2)
    if (
      typeof newValue === 'object' &&
      Object.prototype.hasOwnProperty.call(newValue, 'values') &&
      Object.prototype.hasOwnProperty.call(newValue, 'preview')
    ) {
      selected.value.values = newValue.values;
      selected.value.preview = newValue.preview;
      preview.value = newValue.preview; // Also update the local preview ref
    } else {
      // Handle case where newValue is just an array
      selected.value.values = newValue || [];
    }
  },
});

// in the case of this advanced select, we don't use the bootstrap dropdown js functions
// instead we use the isActive ref to toggle the dropdown
// but we also need to cover focus, close on esc, close on outside click, etc

// close the dropdown
function close() {
  // when we close the dropdown, we pass the focus back to the inputRef
  isActive.value = false;
  inputRef.value?.focus({ preventScroll: true });
}

// toggle the dropdown
function toggle() {
  if (props.disabled || props.readonly) return;
  isUp.value = false;
  isActive.value = !isActive.value;
  if (isActive.value && !props.isLoading) {
    // here we pass the focus to the contentRef
    nextTick(() => {
      focus.value = 'content';
      //calculate if we need to do a dropup
      var dd = ddRef.value?.getBoundingClientRect();
      var dt = dtRef.value?.getBoundingClientRect();
      if (dt) {
        var wh = window.innerHeight;
        var ww = window.innerWidth;
        // if dropdown is out out of view AND there is space for dropup, do dropup
        isUp.value = dd.bottom > wh && dd.height < dt.top - 100;
        isRight.value = dt.left > ww / 2;
        calcDropdownMenuWidth();
      }
    });
  }
}
function isSelected() {
  close();
}

function calcDropdownMenuWidth() {
  var valueLength = 0;

  try {
    if (typeof props.values[0] == 'object') valueLength = Object.keys(props.values[0]).length;
  } catch (err) {
    //
  }
  var columnsCount = props.columns?.length || valueLength;
  if (props.horizontal || columnsCount > 1) {
    var dt = dtRef.value?.getBoundingClientRect();
    var dtleft = dt?.left || 0;
    var dtright = dt?.right || 0;
    var ww = props.containerSize.width;
    var wx = props.containerSize.x;
    var widthIfLeft = ww + wx - dtleft - 25;
    var widthIfRight = dtright - wx - 25;
    var width = isRight.value ? widthIfRight : widthIfLeft;
    dropdownMenuWidth.value = width + 'px';
  }
}

function dropfocus(_event) {
  if (isActive.value) {
    close();
  }
}

// we watch the selected value and emit the model value
watch(
  () => selected.value,
  (val) => {
    if (val) {
      preview.value = val.preview;
      emit('update:modelValue', val.values);
    }
  },
  { deep: true },
);

// we watch the container size and recalculate the dropdown menu width
// deep: AppForm creates containerSize as ref({x,width}) and its resize listener
// mutates .x/.width IN PLACE, so the getter returns the same object every time and a
// shallow watcher could never fire - the width computed when the dropdown opened
// stayed stale until it was closed and reopened.
watch(
  () => props.containerSize,
  (_val) => {
    calcDropdownMenuWidth();
  },
  { deep: true },
);

// sync modelValue with selected.values
watch(
  () => props.modelValue,
  (newValue) => {
    if (selected.value && JSON.stringify(selected.value.values) !== JSON.stringify(newValue)) {
      selected.value.values = newValue;
      // Also reset preview when modelValue is reset
      if (!newValue || (Array.isArray(newValue) && newValue.length === 0)) {
        selected.value.preview = '';
        preview.value = '';
      }
    }
  },
);

// on mounted we blur the input and the content, no focus !
onMounted(() => {
  inputRef.value?.blur();
  contentRef.value?.blur();
});
</script>
<template>
  <div>
    <div v-if="!sticky && !horizontal" class="dropdown" v-click-outside="dropfocus" :class="{ dropup: isUp }">
      <template v-if="isFloating">
        <div class="input-group" :class="{ active: isActive }" ref="dtRef">
          <span class="input-group-text text-gray-500" :class="{ active: isActive }" v-if="icon" @mouseup="toggle()">
            <FaIcon :fixedwidth="true" :icon="icon" />
          </span>
          <div class="form-floating">
            <input
              class="form-control"
              ref="inputRef"
              :class="{ 'is-invalid': hasError }"
              :readonly="!disabled"
              type="text"
              :id="uid"
              :placeholder="isLoading ? 'Loading...' : placeholder || 'Select...'"
              :value="isLoading ? '' : preview"
              @keydown.esc="close()"
              @keydown.tab="close()"
              @keydown.space.prevent="toggle()"
              @mouseup="toggle()"
              :disabled="disabled"
              :tabindex="null"
            />
            <label :for="uid">{{ label }}<span v-if="required" class="text-danger ms-1">*</span></label>
          </div>
          <span class="input-group-text" @mouseup="toggle()">
            <font-awesome-icon v-if="isLoading" icon="spinner" spin />
            <font-awesome-icon v-else-if="!isActive" icon="angle-down" />
            <font-awesome-icon v-else icon="angle-right" />
          </span>
        </div>
      </template>
      <div v-else class="input-group" :class="{ active: isActive }" ref="dtRef">
        <span class="input-group-text text-gray-500" :class="{ active: isActive }" v-if="icon" @mouseup="toggle()">
          <FaIcon :fixedwidth="true" :icon="icon" />
        </span>
        <input
          class="form-control"
          ref="inputRef"
          :class="{ 'is-invalid': hasError }"
          :readonly="!disabled"
          type="text"
          :value="isLoading ? '' : preview"
          :placeholder="isLoading ? 'Loading...' : placeholder"
          @keydown.esc="close()"
          @keydown.tab="close()"
          @keydown.space.prevent="toggle()"
          @mouseup="toggle()"
          :disabled="disabled"
          :tabindex="null"
        />
        <span class="input-group-text" @mouseup="toggle()">
          <font-awesome-icon v-if="isLoading" icon="spinner" spin />
          <font-awesome-icon v-else-if="!isActive" icon="angle-down" />
          <font-awesome-icon v-else icon="angle-right" />
        </span>
      </div>

      <div
        ref="ddRef"
        class="dropdown-menu border border-body af-shadow py-0 mt-2 af-dd-advanced"
        :class="{ 'dropdown-menu-end': isRight, show: isActive && !isLoading }"
        :style="'width:' + dropdownMenuWidth"
        role="menu"
      >
        <div ref="contentRef" @keydown.esc="close()" @keydown.tab="close()">
          <BsInputSelectAdvancedTable
            :defaultValue="defaultValue"
            :initialValue="modelValue"
            :required="required || false"
            :multiple="multiple || false"
            :name="name"
            :placeholder="placeholder || 'Select...'"
            :values="values || []"
            v-model="selected"
            :columns="columns || []"
            :pctColumns="pctColumns || []"
            :filterColumns="filterColumns || []"
            :previewColumn="previewColumn || ''"
            :valueColumn="valueColumn || ''"
            :disabled="readonly || disabled"
            @isSelected="isSelected"
            @reset="preview = ''"
            @update:preview="preview = $event"
            :focus="focus"
            @focusset="focus = ''"
          />
        </div>
      </div>
    </div>

    <div v-if="!horizontal && sticky" tabindex="0" class="border mb-2" :class="{ 'border-danger': hasError }">
      <p class="m-3 text-body-secondary">{{ preview || 'Nothing selected' }}</p>
      <BsInputSelectAdvancedTable
        :defaultValue="defaultValue"
        :initialValue="modelValue"
        :required="required || false"
        :multiple="multiple || false"
        :name="name"
        :values="values || []"
        v-model="selected"
        :columns="columns || []"
        :pctColumns="pctColumns || []"
        :filterColumns="filterColumns || []"
        :previewColumn="previewColumn || ''"
        :valueColumn="valueColumn || ''"
        :disabled="readonly || disabled"
        @reset="preview = ''"
        @update:preview="preview = $event"
      />
    </div>

    <div v-if="!sticky && horizontal" v-click-outside="dropfocus" class="dropdown" :class="{ dropup: isUp }">
      <template v-if="isFloating">
        <div class="input-group" :class="{ active: isActive }" ref="dtRef">
          <span class="input-group-text text-gray-500" :class="{ active: isActive }" v-if="icon" @mouseup="toggle()">
            <FaIcon :fixedwidth="true" :icon="icon" />
          </span>
          <div class="form-floating">
            <input
              class="form-control"
              ref="inputRef"
              :class="{ 'is-invalid': hasError }"
              :readonly="!disabled"
              type="text"
              :id="uid"
              :value="isLoading ? '' : preview"
              :placeholder="isLoading ? 'Loading...' : placeholder || 'Select...'"
              @keydown.esc="close()"
              @keydown.tab="close()"
              @keydown.space.prevent="toggle()"
              @mouseup="toggle()"
              :disabled="disabled"
              :tabindex="null"
            />
            <label :for="uid">{{ label }}<span v-if="required" class="text-danger ms-1">*</span></label>
          </div>
          <span class="input-group-text" @mouseup="toggle()">
            <font-awesome-icon v-if="isLoading" icon="spinner" spin />
            <font-awesome-icon v-else-if="!isActive" icon="angle-down" />
            <font-awesome-icon v-else icon="angle-right" />
          </span>
        </div>
      </template>
      <!-- ref="dtRef" like the three sibling branches. Without it toggle()'s
             `if (dt)` never ran, so isUp/isRight stayed false and calcDropdownMenuWidth()
             was never called - and BsInputForForm always passes :isFloating="false", so
             THIS is the branch every form field actually renders. The panel therefore
             always dropped downward (clipped off-screen near the bottom of the viewport)
             and kept width:100% instead of the computed multi-column width. -->
      <div v-else class="input-group" :class="{ active: isActive }" ref="dtRef">
        <span class="input-group-text text-gray-500" :class="{ active: isActive }" v-if="icon" @mouseup="toggle()">
          <FaIcon :fixedwidth="true" :icon="icon" />
        </span>
        <input
          class="form-control"
          ref="inputRef"
          :class="{ 'is-invalid': hasError }"
          :readonly="!disabled"
          type="text"
          :value="isLoading ? '' : preview"
          :placeholder="isLoading ? 'Loading...' : placeholder"
          @keydown.esc="close()"
          @keydown.tab="close()"
          @keydown.space.prevent="toggle()"
          @mouseup="toggle()"
          :disabled="disabled"
          :tabindex="null"
        />
        <span class="input-group-text" @mouseup="toggle()">
          <font-awesome-icon v-if="isLoading" icon="spinner" spin />
          <font-awesome-icon v-else-if="!isActive" icon="angle-down" />
          <font-awesome-icon v-else icon="angle-right" />
        </span>
      </div>

      <div
        ref="ddRef"
        class="dropdown-menu border af-shadow py-0 mt-2 af-dd-advanced"
        :class="{
          'border-danger': hasError,
          'border-body': !hasError,
          'dropdown-menu-end': isRight,
          show: isActive && !isLoading,
        }"
        :style="'width:' + dropdownMenuWidth"
        role="menu"
      >
        <div ref="contentRef" @keydown.esc="close()" @keydown.tab="close()">
          <BsInputSelectAdvanced2
            :defaultValue="defaultValue"
            :required="required || false"
            :name="name"
            :values="values || []"
            v-model="selectedValues"
            :columns="columns || []"
            :filterColumns="filterColumns || []"
            :previewColumn="previewColumn || ''"
            :valueColumn="valueColumn || ''"
            @reset="preview = ''"
            :focus="focus"
            @focusset="focus = ''"
          />
        </div>
      </div>
    </div>
    <div class="border mb-2" :class="{ 'border-danger': hasError }" v-if="horizontal && sticky" tabindex="0">
      <BsInputSelectAdvanced2
        :required="required || false"
        :name="name"
        :defaultValue="defaultValue"
        :values="values || []"
        v-model="selectedValues"
        :columns="columns || []"
        :filterColumns="filterColumns || []"
        :previewColumn="previewColumn || ''"
        :valueColumn="valueColumn || ''"
        :disabled="readonly || disabled"
        @reset="preview = ''"
      />
    </div>
  </div>
</template>
<style scoped>
.dropdown.dropup .dropdown-menu {
  bottom: 100% !important;
  margin-bottom: 0.5rem !important;
  padding-top: initial;
  top: auto;
}
.input-group-text.active {
  color: var(--bs-body) !important;
}
.input-group.active {
  color: #212529;
  background-color: #fff;
  border-color: #86b7fe;
  outline: 0;
  box-shadow: 0 0 0 0.25rem rgb(13 110 253 / 25%);
  z-index: 3;
  border-radius: 0.25rem;
}

/* Ensure Bootstrap end-aligned dropdown actually snaps to the right edge even with custom widths */
:deep(.dropdown-menu-end) {
  left: auto !important;
  right: 0 !important;
  transform-origin: top right;
}

/* When in dropup mode and end-aligned, keep bottom positioning consistent */
.dropdown.dropup :deep(.dropdown-menu-end) {
  left: auto !important;
  right: 0 !important;
}

/* Prevent unintended horizontal scroll due to large dynamic width */
.af-dd-advanced.dropdown-menu {
  max-width: 100vw;
  box-sizing: border-box;
}
</style>
