<script setup>
/******************************************************************/
/*                                                                */
/*  One environment variable of a settings page : a field when    */
/*  it can be written, a read-only value saying why when it       */
/*  cannot, and the note when a saved change needs a restart.     */
/*  The state and the Save are useEnvVars.js.                     */
/*                                                                */
/*  @props:                                                       */
/*      e: Object - the variable, as GET /api/v2/config/env       */
/*         returns it                                             */
/*      asSwitch: Boolean - a 0/1 variable as a switch (the       */
/*         enable switch of a feature, as LDAP's)                 */
/*      disabled: Boolean - shown, but not editable now (the      */
/*         feature it belongs to is off)                          */
/*  @model: the edited value                                      */
/*                                                                */
/******************************************************************/

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Helpers from '@/lib/Helpers';
import { languages } from '@/config/languages';
import { envEditable } from '@/composables/useEnvVars';

const props = defineProps({
  e: { type: Object, required: true },
  asSwitch: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});
const model = defineModel({ type: [String, Number], default: '' });

const { t } = useI18n();

const editable = computed(() => envEditable(props.e));

// a switch holds a boolean, the variable 1 or 0
const switchModel = computed({
  get: () => String(model.value) === '1',
  set: (on) => {
    model.value = on ? '1' : '0';
  },
});

// the default language's choices : the languages of the app (config/languages.js) the
// variable allows, with their flags and names
function languageOf(code) {
  return languages.find((l) => l.code === code) || null;
}
function languageChoices(e) {
  const allowed = (envOptions(e) || []).map((o) => o.value);
  return allowed.length ? languages.filter((l) => allowed.includes(l.code)) : languages;
}

// a documented enum ('true, false', '1, 2') becomes a dropdown
// a 0/1 variable reads Yes / No in its dropdown, and still sends 0 or 1
function envOptions(e) {
  const options = Helpers.envAllowedOptions(e?.allowed);
  return (
    options?.map((o) => (o.boolean ? { ...o, label: o.label === 'yes' ? t('common.yes') : t('common.no') } : o)) || null
  );
}

// a path or a command reads in full : its field is wider than the others
const wide = computed(() => /_(PATH|COMMAND)$/.test(props.e.name));

// One line of help under each variable. help.yaml holds a multi-paragraph description; take
// its first sentence. The split requires a capital after the period, so 'e.g. `https://...`'
// and 'i.e. /dev/log' are not cut in half.
function envHelp(e) {
  // a hand-written hint wins : several variables share one boilerplate description
  if (e.hint) return String(e.hint).trim();
  const d = String(e.description || '')
    .replace(/\s+/g, ' ')
    .replace(/\*\*(.+?)\*\*/g, '$1') // '**DEPRECATED:**' rendered its asterisks
    .replace(/`([^`]+)`/g, '$1')
    .trim();
  if (!d) return '';
  return d.split(/(?<=\.)\s+(?=[A-Z])/)[0];
}
</script>
<template>
  <!-- The same rhythm as the Settings tab - label, value, help text below -
     but deliberately NOT BsInput. These are read-only: they come from the
     process environment and there is no endpoint that writes them, so an
     input (even disabled) would promise an edit that cannot happen. The
     value sits in a plain bordered block instead. -->
  <div class="mb-3" :class="{ 'af-field-wide': wide }">
    <!-- an editable variable gets a real BsInput, so it is identical to the
       Settings tab. One that cannot be written keeps the read-only box and
       says why, rather than offering an edit that would not take. -->
    <!-- the default language : a flag and its full name, as on the profile page -->
    <template v-if="editable && e.name === 'DEFAULT_LANGUAGE'">
      <label class="form-label fw-bold">{{ e.short || e.name }}</label>
      <div class="input-group">
        <span class="input-group-text text-gray-500"><FaIcon :fixedwidth="true" icon="language" /></span>
        <button
          class="form-select d-flex align-items-center gap-2 text-start"
          type="button"
          data-bs-toggle="dropdown"
          aria-expanded="false"
          :aria-label="e.short || e.name"
        >
          <template v-if="languageOf(model)">
            <AppFlag :code="languageOf(model).code" />{{ languageOf(model).label }}
          </template>
          <span v-else class="text-body-secondary">{{ model || '-' }}</span>
        </button>
        <ul class="dropdown-menu w-100">
          <li v-for="lang in languageChoices(e)" :key="lang.code">
            <button
              type="button"
              class="dropdown-item d-flex align-items-center gap-2"
              :class="{ active: model === lang.code }"
              @click="model = lang.code"
            >
              <AppFlag :code="lang.code" />{{ lang.label }}
            </button>
          </li>
        </ul>
      </div>
      <div v-if="envHelp(e)" class="form-text">{{ envHelp(e) }}</div>
    </template>
    <!-- a switch : the bold title of every field above it, the switch, then the help -->
    <template v-else-if="editable && asSwitch">
      <label class="form-label fw-bold af-switch-title" :for="'sw-' + e.name">{{ e.short || e.name }}</label>
      <div class="form-check form-switch mb-0">
        <input
          :id="'sw-' + e.name"
          v-model="switchModel"
          class="form-check-input"
          type="checkbox"
          role="switch"
          :disabled="disabled"
        />
      </div>
      <div v-if="envHelp(e)" class="form-text">{{ envHelp(e) }}</div>
    </template>
    <BsInput
      v-else-if="editable"
      :disabled="disabled"
      :isFloating="false"
      :icon="e.type === 'number' ? 'hashtag' : 'font'"
      :type="envOptions(e) ? 'select' : e.secret ? 'password' : e.type === 'number' ? 'number' : 'text'"
      :values="envOptions(e) || []"
      valueKey="value"
      labelKey="label"
      :placeholder="e.secret && e.set ? t('settings.settingsPage.envSecretUnchanged') : ''"
      :label="e.short || e.name"
      :help="envHelp(e)"
      v-model="model"
    />
    <template v-else>
      <label class="form-label fw-bold">{{ e.short || e.name }}</label>
      <div>
        <div class="input-group">
          <span class="input-group-text text-gray-500">
            <FaIcon :fixedwidth="true" :icon="e.editable === 'refused' ? 'lock' : 'shield-halved'" />
          </span>
          <div class="form-control env-value" :title="e.value ? e.value : e.name">
            {{ e.value === null || e.value === '' ? '—' : e.value }}
          </div>
        </div>
      </div>
      <div v-if="envHelp(e)" class="form-text">{{ envHelp(e) }}</div>
      <div class="form-text env-locked">
        {{ e.overridden ? t('settings.settingsPage.envOverridden') : e.refusedReason || '' }}
      </div>
    </template>
    <div v-if="editable && e.editable === 'restart'" class="form-text env-restart">
      {{ t('settings.settingsPage.envRestartRequired') }}
      <!-- for a path, 'takes effect after a restart' is true but misses the
         part that matters: whatever is already on disk does not move -->
      <template v-if="e.relocates"> {{ t('settings.settingsPage.envRelocates') }}</template>
    </div>
  </div>
</template>
<style scoped>
/* Every field one width, the same on every settings page - dropdowns, text fields and the
   read-only values alike : stretched across the card, a Yes / No put its value far from its
   arrow and a short value looked lost. A longer value scrolls in its field. The language
   dropdown is a button styled as a select : it matches. */
:deep(.input-group) {
  max-width: 20rem;
}
/* a path or a command (wide) : wide enough to read it in full */
.af-field-wide :deep(.input-group) {
  max-width: 40rem;
}
/* the title above a switch stays : the settings forms (AppAdminSingle) hide the empty label
   their own switches leave above them, and this one is not empty */
.af-switch-title {
  display: inline-block !important;
}
.env-locked {
  color: var(--bs-secondary-color);
  font-style: italic;
}
.env-restart {
  color: var(--af-warning-text, var(--bs-warning-text-emphasis));
}
/* The value is a div, not an input : .form-control gives it the same box as the fields,
   and the tertiary background is what says 'read only'. */
.env-value {
  background-color: var(--bs-tertiary-bg);
  /* one line, as wide as the fields : a long value (a path) ends in an ellipsis, all of it
     in the tooltip */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--bs-font-monospace);
}
</style>
