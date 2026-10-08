<script setup>
/******************************************************************/
/*                                                                */
/*  Ace Editor component                                          */
/*                                                                */
/*  @props:                                                       */
/*      modelValue: String                                        */
/*      lang: String                                              */
/*      theme: String                                             */
/*      style: String                                             */
/*                                                                */
/******************************************************************/

import { ref, computed, nextTick } from 'vue';
import { VAceEditor } from 'vue3-ace-editor';
import ace from 'ace-builds';
import 'ace-builds/src-noconflict/mode-yaml'; // Load the language definition file used below
import 'ace-builds/src-noconflict/theme-monokai'; // Load the theme definition file used below
import 'ace-builds/src-noconflict/theme-chrome';
import extSearchboxUrl from 'ace-builds/src-noconflict/ext-searchbox?url';
import workerYamlUrl from 'ace-builds/src-noconflict/worker-yaml?url';

// INIT

ace.config.setModuleUrl('ace/mode/yaml_worker', workerYamlUrl);
ace.config.setModuleUrl('ace/ext/searchbox', extSearchboxUrl);
const emit = defineEmits(['update:modelValue', 'dirty', 'save', 'init']);

// MODEL

const code = ref('');
const keyListener = ref(null);

// PROPS

const props = defineProps({
  modelValue: {
    type: String,
  },
  lang: {
    type: String,
    default: 'yaml',
  },
  theme: {
    type: String,
    default: null,
  },
  style: {
    type: [String, Object],
    default: 'width: 100%;height: 75vh;font-size:1rem',
  },
  // emit update:modelValue on every change (not only on blur) ; only
  // for parents that bind the raw string (see change handler)
  liveSync: {
    type: Boolean,
    default: false,
  },
});

// DATA

const mounted = ref(false);
const systemDark = ref(document.documentElement.getAttribute('data-bs-theme') === 'dark');
const themeObserver = new MutationObserver(() => {
  systemDark.value = document.documentElement.getAttribute('data-bs-theme') === 'dark';
});
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
const effectiveTheme = computed(() => props.theme || (systemDark.value ? 'monokai' : 'chrome'));

// METHODS

const change = (_value) => {
  if (mounted.value) {
    // opt-in : keep the bound model in sync on every edit (not only on
    // blur) so parents can react live — eg detect a reverted change.
    // Only safe when the parent binds the raw string ; a parent that
    // re-serializes the value (eg BsYamlEditor) would reformat mid-typing,
    // so this stays off by default.
    if (props.liveSync) emit('update:modelValue', code.value);
    emit('dirty');
  }
};
const blur = () => {
  emit('update:modelValue', code.value);
};
const save = () => {
  emit('save');
};

watch(
  () => props.modelValue,
  (newVal) => {
    code.value = newVal;
  },
);
// HOOKS

(onMounted(async () => {
  code.value = props.modelValue || '';
  // set mounted at next tick
  await nextTick();
  mounted.value = true;

  keyListener.value = async function (e) {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); // present "Save Page" from getting triggered.
      blur();
      // allow time for the model to update
      await nextTick();
      // emit save event
      save();
    }
  };

  document.addEventListener('keydown', keyListener.value);
}),
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', keyListener.value);
    themeObserver.disconnect();
  }));
</script>
<template>
  <div>
    <v-ace-editor
      @change="change"
      @blur="blur"
      @init="(e) => emit('init', e)"
      v-model:value="code"
      :lang="lang"
      :theme="effectiveTheme"
      :style="style"
      :printMargin="false"
      :options="{ useWorker: true }"
    />
  </div>
</template>
