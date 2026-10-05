<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Table select component                              */
/*  It's used in the BsInputSelectAdvanced2 component             */
/*  To create a left-right selector                               */
/*  This component creates a table with selectable rows           */
/*                                                                */
/*  @props:                                                       */
/*      values: Array                                             */
/*      modelValue: Object                                        */
/*      required: Boolean                                         */
/*      status: String                                            */
/*      sizeClass: String                                         */
/*      columns: Array                                            */
/*      previewColumn: String                                     */
/*      valueColumn: String                                       */
/*      filterColumns: Array                                      */
/*      focus: String                                             */
/*                                                                */
/*  @emit:                                                        */
/*      update:modelValue                                         */
/*      reset                                                     */
/*      focusset                                                   */
/*                                                                */
/******************************************************************/

import { useTemplateRef, computed } from 'vue';
import Helpers from '@/lib/Helpers';

// INIT

const emit = defineEmits(['update:modelValue', 'reset', 'focusset']);
const queryfilterRef = useTemplateRef('queryfilterRef');

// DATA

const selected = ref({});
const labels = ref([]);
const valueLabel = ref('');
const previewLabel = ref('');
const preview = ref('');
const queryfilter = ref('');

// PROPS

const props = defineProps({
  values: {
    type: Array,
    required: true,
  },
  modelValue: {
    type: [Object, Array, String],
    default: () => {},
  },
  required: { type: Boolean },
  status: { type: String },
  sizeClass: { type: String },
  columns: { type: Array, default: () => [] },
  previewColumn: { type: String },
  valueColumn: { type: String },
  filterColumns: { type: Array, default: () => [] },
  focus: { type: String },
});

// COMPUTED

const selectedItems = computed(() => {
  return props.values.filter((v, i) => selected.value[i]);
});

const filtered = computed(() => {
  var cols = [];
  // if filtercolumns, use them
  if (props.filterColumns.length > 0) {
    cols = props.filterColumns;
  } else {
    // if not, take the previewLabel
    if (previewLabel.value) {
      cols.push(previewLabel.value);
    }
  }
  return props.values.reduce(function (filtered, item, i) {
    var found = false;
    if (queryfilter.value) {
      // if the item exists
      if (item) {
        // console.log(item);
        // go over all filterColumns
        if (cols.length > 0) {
          for (const col of cols) {
            // if the column is present

            if (item[col]) {
              // check if the value contains our filter
              found ||= item[col].toString().toLowerCase().includes(queryfilter.value.toLowerCase());
            } else {
              // no item, always pass
              found = true;
            }
          }
        } else {
          // normal array
          found = item.toString().toLowerCase().includes(queryfilter.value.toLowerCase());
        }
      }
    } else {
      found = true;
    }
    if (found) {
      filtered.push({ index: i, value: item });
    }
    return filtered;
  }, []);
});

// WATCHERS

watch(
  () => props.values,
  (_val) => {
    queryfilter.value = '';
    selected.value = {};
    getLabels();
    emit('reset');
    recalc();
  },
  { deep: true },
);
watch(
  () => props.focus,
  (val) => {
    if (val == 'content') {
      nextTick(() => {
        queryfilterRef.value.focus({ preventScroll: true });
        emit('focusset');
      });
    }
  },
);

// METHODS

function highlightFilter(v, label = undefined) {
  var s = (v ?? '') + '';
  var cols = [];
  if (props.filterColumns.length > 0) {
    cols = props.filterColumns;
  } else {
    if (previewLabel.value) {
      cols.push(previewLabel.value);
    }
  }
  if (label && !cols.includes(label)) {
    return Helpers.htmlEncode(s);
  }
  var index;
  var search = queryfilter.value;
  var l = search.length;
  var p1, p2, p3;
  if (s && queryfilter.value) {
    index = s.toLowerCase().indexOf(search.toLowerCase());
    if (index >= 0) {
      p1 = s.slice(0, index);
      p2 = s.slice(index, index + l);
      p3 = s.slice(index + l);
      return `${Helpers.htmlEncode(p1)}<span class='fw-bold'>${Helpers.htmlEncode(p2)}</span>${Helpers.htmlEncode(p3)}`;
    } else {
      return Helpers.htmlEncode(s);
    }
  } else {
    // htmlEncode(s), not the raw v. This branch is taken whenever the search box is
    // EMPTY - i.e. the moment the dropdown opens - and its result goes to v-html, so an
    // option value coming from a datasource/query row (a CMDB description, a hostname)
    // executed in the browser of every user who opened the form. Every sibling branch
    // above already encodes; this one was the hole. `s` is just String(v).
    return Helpers.htmlEncode(s);
  }
}

function select(i) {
  selected.value[i] = !selected.value[i];
  recalc();
}
function recalc() {
  var l = selectedItems.value.length;
  var first = selectedItems.value.slice(0, 3);
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
  emit('update:modelValue', { values: selectedItems.value, preview: preview.value });
}

function reset() {
  for (let i = 0; i < filtered.value.length; i++) {
    selected.value[filtered.value[i].index] = false;
  }
}
function getLabels() {
  var previewLabels = [];
  var valueLabels = [];
  preview.value = '';
  previewLabel.value = '';
  valueLabel.value = '';
  if (props.values.length > 0) {
    // `props.values[0] &&` : typeof null is "object", so a null first entry fell into
    // the else and Object.keys(null) threw - the exception escaped the values watcher
    // and the select rendered with no labels and no rows at all. A null entry is a real
    // possibility (`values: [~, a, b]` in the form yaml, or a jq/expression result with
    // a null), which is why the rest of this file guards every other access.
    if (!props.values[0] || typeof props.values[0] !== 'object') {
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
  }
}

// HOOKS

onMounted(() => {
  reset();
  getLabels();
});
</script>
<template>
  <div class="mt-2">
    <div class="pb-2">
      <div class="input-group">
        <span class="input-group-text text-gray-500">
          <FaIcon icon="search" />
        </span>
        <input
          class="form-control"
          tabindex="0"
          ref="queryfilterRef"
          type="text"
          placeholder=""
          v-model="queryfilter"
        />
      </div>
    </div>
    <p v-if="values.length == 0" class="pl-3">No data</p>
    <p v-if="values.length > 0 && filtered.length == 0" class="ps-3">Filter returns no results</p>
    <div class="table-container">
      <table class="table table-hover border mb-0">
        <thead v-if="labels.length > 1">
          <tr :class="sizeClass">
            <th :key="l" v-for="l in labels">{{ l }}</th>
          </tr>
        </thead>
        <thead v-if="labels.length == 1">
          <tr :class="sizeClass">
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          <tr
            :class="{
              'table-primary': selected[v.index],
              sizeClass: sizeClass,
            }"
            :key="v.index"
            v-for="v in filtered"
            @click="select(v.index)"
          >
            <td v-for="l in labels" v-html="highlightFilter(v.value[l], l)" :key="l"></td>
            <td v-if="labels.length == 0" v-html="highlightFilter(v.value)"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
<style scoped>
.table td,
.table th {
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
table tbody {
  display: block;
  max-height: 300px;
  overflow-y: scroll;
}
table thead,
table tbody tr {
  display: table;
  width: calc(100% - 17px);
  table-layout: fixed;
}
table tbody tr {
  display: table;
  width: 100% !important;
  table-layout: fixed;
  cursor: pointer;
}
table thead th.is-first,
table tbody td.is-first {
  width: 4em !important;
  max-width: 4em !important;
}
</style>
