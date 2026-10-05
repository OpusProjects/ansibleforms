<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Input Select Component base on left-right selection */
/*                                                                */
/*  It allows selecting items visually left to right              */
/*  It is based on the BsInputSelectAdvancedTable2 component      */
/*  It can be used standalone or as dropdown in advanced select   */
/*                                                                */
/*  @props:                                                       */
/*      values: Array                                             */
/*      hasError: Boolean                                         */
/*      required: Boolean                                         */
/*      name: String                                              */
/*      defaultValue: String                                      */
/*      columns: Array                                            */
/*      previewColumn: String                                     */
/*      valueColumn: String                                       */
/*      filterColumns: Array                                      */
/*      disabled: Boolean                                         */
/*                                                                */
/******************************************************************/

import Helpers from '@/lib/Helpers';
import _ from 'lodash';

// INIT

const emit = defineEmits(['update:modelValue']);

// PROPS

const props = defineProps({
  modelValue: { type: [String, Array, Object, Number] },
  values: { type: Array, required: true, default: () => [] },
  hasError: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
  name: { type: String, required: true },
  defaultValue: { type: [String, Array, Object, Number] },
  columns: { type: Array, default: () => {} },
  previewColumn: { type: String, default: '' },
  valueColumn: { type: String },
  filterColumns: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
});

// DATA

const selectedToMoveRight = ref({});
const selectedToMoveLeft = ref({});
const selected = ref([]);
const labels = ref([]);
const valueLabel = ref('');
const previewLabel = ref('');
const isLoaded = ref(false);
const preview = ref('');

// WATCHERS

watch(
  () => props.values,
  (_val) => {
    recalc();
  },
  { deep: true },
);

watch(
  () => selected.value,
  (_val) => {
    emitUpdate();
  },
  { deep: true },
);

// sync modelValue with selected array
// sync modelValue with selected array (extract values if object, prevent loops)
watch(
  () => props.modelValue,
  (newValue) => {
    let targetArray = [];
    if (Array.isArray(newValue)) {
      targetArray = newValue;
    } else if (newValue && typeof newValue === 'object' && Array.isArray(newValue.values)) {
      targetArray = newValue.values;
    }

    // Only update if the arrays are actually different
    if (JSON.stringify(selected.value) !== JSON.stringify(targetArray)) {
      selected.value = targetArray;
    }
  },
);

// COMPUTED

const valuesNotSelected = computed(() => {
  return Helpers.diff(props.values, selected.value);
});

// METHODS

function moveRight() {
  selected.value = [].concat(selected.value, selectedToMoveRight.value.values);
}

function moveLeft() {
  selected.value = selected.value.filter((item) => !selectedToMoveLeft.value.values.includes(item));
}

function moveAllRight() {
  selected.value = [].concat(props.values);
}

function moveAllLeft() {
  selected.value = [];
}

function emitUpdate() {
  var l = selected.value.length;
  var first = selected.value.slice(0, 3);
  if (l > 0) {
    if (l > 3) {
      preview.value =
        first
          .map((i) => {
            return i ? (i[previewLabel.value] ?? i) : 'undefined';
          })
          .join(', ') +
        ', ... (' +
        l +
        ' items selected)';
    } else {
      preview.value = first
        .map((i) => {
          return i ? (i[previewLabel.value] ?? i) : 'undefined';
        })
        .join(', ');
    }
  } else {
    preview.value = '';
  }
  isLoaded.value = true;

  if (selected.value.length == 0) {
    emit('update:modelValue', { values: undefined, preview: '' });
  } else {
    emit('update:modelValue', { values: selected.value, preview: preview.value });
  }
}

function recalc() {
  var previewLabels = [];
  var valueLabels = [];
  previewLabel.value = '';
  valueLabel.value = '';
  if (props.values.length > 0) {
    if (typeof props.values[0] !== 'object') {
      labels.value = [];
    } else {
      // get all labels
      labels.value = Object.keys(props.values[0]);

      // filter preview label
      previewLabels = labels.value.filter((item) => item == props.previewColumn);
      valueLabels = labels.value.filter((item) => item == props.valueColumn);
    }
    // reduct labels to the ones we want to show
    if (props.columns.length > 0) {
      // limit labels to provided columnslist
      labels.value = props.columns.filter((item) => labels.value.includes(item));
    }
    // if we found a preview label, use it
    if (previewLabels.length > 0) {
      // if we have a specific value column
      previewLabel.value = previewLabels[0]; // set it
    } else if (labels.value.length > 0) {
      // if we didn't find a preview label, use the first visible label
      previewLabel.value = labels.value[0];
    }
    // if we found a value label, use it
    if (valueLabels.length > 0) {
      // if we have a specific value column
      valueLabel.value = valueLabels[0]; // set it
    } else {
      if (labels.value.length > 0) valueLabel.value = labels.value[0];
    }

    if (props.defaultValue == '__auto__') {
      selected.value.push(props.values[0]);
    } else if (props.defaultValue == '__all__') {
      // if all is set, we select all
      moveAllRight();
    } else if (props.defaultValue != '__none__' && props.defaultValue != undefined) {
      // if a regular default is set, we select it
      var obj;
      var defaulttype;
      try {
        obj = JSON.parse(props.defaultValue);
        if (typeof obj == 'object') {
          defaulttype = 'object';
        }
      } catch (err) {
        obj = undefined;
      }
      if (typeof props.defaultValue == 'object') {
        obj = props.defaultValue;
        defaulttype = 'object';
      }
      if (defaulttype == 'object') {
        obj = _.concat(obj, []);
        selected.value = _.intersectionWith(props.values, obj, _.isEqual);
      } else {
        // we search for the value by string
        props.values.forEach((item) => {
          if (item && props.defaultValue == (item[valueLabel.value] || item)) {
            selected.value.push(item);
          } else if (Array.isArray(props.defaultValue) && props.defaultValue.length > 0) {
            if (item && props.defaultValue.includes(item[valueLabel.value] || item || false)) {
              selected.value.push(item);
            }
          }
        });
      }
    }
  }
}

// on mounted we blur the input and the content, no focus !
onMounted(() => {
  recalc();
  emitUpdate();
});
</script>
<template>
  <div class="row g-0" v-if="isLoaded">
    <div class="col">
      <div class="p-2 border-right h-100">
        <BsInputSelectAdvancedTable2
          :required="required || false"
          :values="valuesNotSelected || []"
          v-model="selectedToMoveRight"
          :columns="columns || []"
          :filterColumns="filterColumns || []"
          :previewColumn="previewColumn || ''"
          :valueColumn="valueColumn || ''"
          @reset="preview = ''"
        />
      </div>
    </div>
    <div class="picker-divider col text-center col-2 align-content-center">
      <div class="m-3">
        <button class="btn btn-arrow btn-outline-success" :disabled="disabled" @click="moveAllRight">
          <font-awesome-icon icon="angles-right" /></button
        ><br />
        <button class="btn btn-arrow btn-outline-success" :disabled="disabled" @click="moveRight">
          <font-awesome-icon icon="angle-right" /></button
        ><br />
        <button class="btn btn-arrow btn-outline-danger" :disabled="disabled" @click="moveLeft">
          <font-awesome-icon icon="angle-left" /></button
        ><br />
        <button class="btn btn-arrow btn-outline-danger" :disabled="disabled" @click="moveAllLeft">
          <font-awesome-icon icon="angles-left" />
        </button>
      </div>
    </div>
    <div class="col">
      <div class="p-2 border-left h-100">
        <BsInputSelectAdvancedTable2
          :required="required || false"
          :values="selected || []"
          v-model="selectedToMoveLeft"
          :columns="columns || []"
          :filterColumns="filterColumns || []"
          :previewColumn="previewColumn || ''"
          :valueColumn="valueColumn || ''"
          @reset="preview = ''"
        />
      </div>
    </div>
  </div>
</template>
<style scoped>
.btn-arrow {
  width: 4rem;
  margin-bottom: 0.3rem;
}
.border-right {
  border-right: 1px solid #aaa;
}
.border-left {
  border-left: 1px solid #aaa;
}
.is-fullwidth {
  width: 100%;
}
.picker-divider {
  background-color: var(--bs-tertiary-bg);
}
</style>
