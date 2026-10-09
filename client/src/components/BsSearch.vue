<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Search component                                    */
/*  A search box : a magnifying glass, the input, and an X that   */
/*  clears it once something is typed. The placeholder hides as   */
/*  soon as the box is focused.                                   */
/*                                                                */
/*  @model: String - the search text                              */
/*                                                                */
/*  @props:                                                       */
/*      placeholder: String                                       */
/*                                                                */
/******************************************************************/

import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

// MODEL & PROPS

const search = defineModel({ type: String, default: '' });

defineProps({
  placeholder: { type: String, default: '' },
  // the icon in the grey box at the left : a magnifier, or a filter for a regex
  icon: { type: String, default: 'search' },
});

// INIT

const { t } = useI18n();
const input = ref(null);

// METHODS

// empty the box and keep the cursor in it, to type the next search right away
function clear() {
  search.value = '';
  input.value?.focus();
}
</script>

<template>
  <div class="input-group af-search">
    <span class="input-group-text">
      <FaIcon :icon="icon" />
    </span>
    <input
      ref="input"
      v-model="search"
      type="text"
      class="form-control"
      :class="{ 'border-end-0': search }"
      :placeholder="placeholder"
      @keydown.esc="clear"
    />
    <button
      v-if="search"
      type="button"
      class="btn af-search-clear"
      :title="t('common.clear')"
      :aria-label="t('common.clear')"
      @click="clear"
    >
      <FaIcon icon="xmark" />
    </button>
  </div>
</template>

<style scoped>
/* the magnifying glass in the normal text color (the muted grey is all but invisible) */
.input-group-text {
  color: var(--bs-body-color);
}
/* the placeholder only says what to type : it goes as soon as the box is focused (the
   themes set the placeholder color with !important, see bootstrap-override.scss) */
.form-control:focus::placeholder {
  color: transparent !important;
}
/* the X sits inside the box, on its right edge, with the input's border around it */
.af-search-clear {
  border: var(--bs-border-width) solid var(--bs-border-color);
  border-left: 0;
  background-color: var(--bs-body-bg);
  color: var(--bs-secondary-color);
  padding: 0 0.75rem;
}
.af-search-clear:hover {
  color: var(--bs-body-color);
}
/* while the input is focused, its focus outline continues around the X */
.form-control:focus + .af-search-clear {
  border-color: var(--bs-focus-ring-color, #86b7fe);
}
</style>
