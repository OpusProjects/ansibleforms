<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap YAML Editor Component                               */
/*                                                                */
/*  A specialized editor for YAML content with:                   */
/*  - AceEditor integration for editing                           */
/*  - Syntax-highlighted readonly display                         */
/*  - Load from file (.yml/.yaml)                                 */
/*  - Download as .yml                                            */
/*                                                                */
/******************************************************************/

import 'ace-builds';
import 'ace-builds/src-noconflict/mode-yaml';
import YAML from 'yaml';
import Helpers from '@/lib/Helpers';
import { toast } from 'vue-sonner';

const model = defineModel();
const emit = defineEmits(['update:modelValue', 'blur']);

const props = defineProps({
  hasError: { type: Boolean, default: false },
  icon: { type: String, default: '' },
  readonly: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  showLoadButton: { type: Boolean, default: false },
  showDownloadButton: { type: Boolean, default: false },
  name: { type: String, default: 'yaml-field' },
  errors: { type: Array, default: () => [] },
  help: { type: String, default: '' },
});

const fileInputRef = ref(null);

// Convert object to YAML string for editing/display
const yamlString = computed({
  get: () => {
    if (typeof model.value === 'string') return model.value;
    if (model.value === undefined || model.value === null) return '';
    return YAML.stringify(model.value);
  },
  set: (value) => {
    try {
      const parsed = YAML.parse(value);
      model.value = parsed;
    } catch (e) {
      // Keep as string if invalid (validation will catch it)
      model.value = value;
    }
  },
});

// Trigger file input click
function triggerFileInput() {
  fileInputRef.value?.click();
}

// Handle file load
async function handleFileLoad(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  // Check file extension
  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) {
    toast.error('Please select a .yml or .yaml file');
    return;
  }

  try {
    const text = await file.text();
    const parsed = YAML.parse(text);
    model.value = parsed;
    toast.success(`Loaded ${file.name}`);
    emit('update:modelValue', parsed);
  } catch (e) {
    toast.error(`Failed to parse ${file.name}: ${e.message}`);
  }

  // Reset input so same file can be loaded again
  event.target.value = '';
}

// Handle download
function handleDownload() {
  try {
    const cleanValue = Helpers.stripInternalFields(model.value);
    const yamlContent = YAML.stringify(cleanValue);
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${props.name || 'download'}.yml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('YAML file downloaded');
  } catch (e) {
    toast.error(`Failed to download: ${e.message}`);
  }
}
</script>

<template>
  <div class="yaml-editor-wrapper">
    <!-- Action buttons -->
    <div v-if="showLoadButton || showDownloadButton" class="mb-2 d-flex gap-2">
      <BsButton
        v-if="showLoadButton"
        cssClass="btn-sm"
        icon="file-import"
        @click="triggerFileInput"
        :disabled="disabled || readonly"
      >
        Load YAML
      </BsButton>

      <BsButton
        v-if="showDownloadButton"
        cssClass="btn-sm"
        icon="download"
        @click="handleDownload"
        :disabled="disabled || !model"
      >
        Download
      </BsButton>

      <!-- Hidden file input -->
      <input
        v-if="showLoadButton"
        ref="fileInputRef"
        type="file"
        accept=".yml,.yaml"
        @change="handleFileLoad"
        style="display: none"
      />
    </div>

    <!-- Readonly display with syntax highlighting -->
    <div v-if="readonly" class="card p-3 yaml-readonly">
      <pre v-highlightjs><code language="yaml" style="border:none;padding:0">{{ yamlString }}</code></pre>
    </div>

    <!-- Editable mode -->
    <div v-else :class="{ 'is-invalid': hasError }">
      <div v-if="icon" class="input-group" :class="{ 'is-invalid': hasError }">
        <span class="input-group-text">
          <FaIcon :icon="icon" />
        </span>
        <div class="ace-editor-wrapper" :class="{ 'is-invalid': hasError }">
          <AceEditor
            v-model="yamlString"
            lang="yaml"
            :readonly="disabled"
            :style="{ width: '100%', height: '250px', fontSize: '1rem' }"
            @blur="emit('blur')"
          />
        </div>
      </div>
      <div v-else class="ace-editor-wrapper" :class="{ 'is-invalid': hasError }">
        <AceEditor
          v-model="yamlString"
          lang="yaml"
          :readonly="disabled"
          :style="{ width: '100%', height: '250px', fontSize: '1rem' }"
          @blur="emit('blur')"
        />
      </div>
    </div>

    <!-- Error messages -->
    <div v-if="errors.length > 0" class="invalid-feedback d-block">
      <div v-for="(error, index) in errors" :key="index">
        {{ error.$params?.description || error.$message || error }}
      </div>
    </div>

    <!-- Help text -->
    <small v-if="help" class="form-text text-muted">{{ help }}</small>
  </div>
</template>

<style scoped lang="scss">
.yaml-editor-wrapper {
  .yaml-readonly pre {
    margin: 0;
    background: transparent;
  }

  .ace-editor-wrapper.is-invalid {
    border: 1px solid #dc3545;
    border-radius: 0.25rem;
  }

  .input-group .ace-editor-wrapper.is-invalid {
    border: none;
    border-radius: 0;
  }

  .input-group.is-invalid {
    border: 1px solid #dc3545;
    border-radius: 0.25rem;
  }
}
</style>
