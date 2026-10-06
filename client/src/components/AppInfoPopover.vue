<script setup>
/******************************************************************/
/*                                                                */
/*  App AnsibleForms info popover                                 */
/*  A small info icon that shows a text in a popover : the        */
/*  description of a page, next to its title                      */
/*                                                                */
/*  It opens on a click (or Enter / Space, being a button), not   */
/*  on hover, so it works on a touch screen and with the          */
/*  keyboard ; a second click, a click outside it or Escape       */
/*  closes it. The text is shown as text, never as html.          */
/*                                                                */
/*  @props:                                                       */
/*      text: String - what the popover says                      */
/*      placement: String - where it opens (default right) ; it   */
/*                 moves to another side when there is no room    */
/*                                                                */
/******************************************************************/

import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { Popover } from 'bootstrap';

// PROPS

const props = defineProps({
  text: {
    type: String,
    required: true,
  },
  placement: {
    type: String,
    default: 'right',
  },
});

// INIT
const { t } = useI18n();

// DATA
const button = ref(null);
const open = ref(false);
let popover = null;

// METHODS

/**
 * Closes the popover when the click or the key is not on it or its icon.
 *
 * Args:
 *   event (Event): a click or a key press anywhere on the page.
 */
function onDocument(event) {
  if (!open.value) return;
  if (event.type === 'keydown') {
    if (event.key === 'Escape') {
      popover.hide();
      button.value?.focus();
    }
    return;
  }
  const tip = popover.tip;
  if (button.value?.contains(event.target) || tip?.contains(event.target)) return;
  popover.hide();
}

onMounted(() => {
  // manual : the icon's click toggles it (see the template), so it does not depend on the
  // browser giving a clicked button the focus, which Safari does not
  popover = new Popover(button.value, {
    content: props.text,
    placement: props.placement,
    trigger: 'manual',
    html: false,
    customClass: 'af-info-popover',
    // its top level with the icon, so it opens to the side and downwards instead of
    // centred on the icon, where it reached up over the header ; it still moves to
    // another side when there is no room (a phone)
    popperConfig: (config) => ({ ...config, placement: `${props.placement}-start` }),
  });
  button.value.addEventListener('shown.bs.popover', () => (open.value = true));
  button.value.addEventListener('hidden.bs.popover', () => (open.value = false));
  document.addEventListener('mousedown', onDocument);
  document.addEventListener('keydown', onDocument);
});

// another language, or another page using the same component : the new text
watch(
  () => props.text,
  (text) => popover?.setContent({ '.popover-body': text }),
);

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocument);
  document.removeEventListener('keydown', onDocument);
  popover?.dispose();
});
</script>

<template>
  <button
    ref="button"
    type="button"
    class="btn btn-link af-info-btn"
    :aria-label="t('common.aboutThisPage')"
    :aria-expanded="open"
    @click="popover?.toggle()"
  >
    <span class="af-info-icon"><FaIcon icon="info" /></span>
  </button>
</template>

<style lang="scss">
// the icon : quieter than the title it follows, the accent on hover and while open
.af-info-btn {
  padding: 0 0.25rem;
  font-size: 0.41em;
  line-height: 1;
  vertical-align: 0.55em;
  color: var(--bs-secondary-color);
  text-decoration: none;
  &:hover,
  &[aria-expanded='true'] {
    color: var(--af-primary);
  }
}
// an "i" in a circle drawn here, not Font Awesome's circle-info (solid only in the free set) :
// on a light page an outline, a ring and an "i" in the icon's color, light next to the title ;
// on a dark page a filled circle, which reads better there than a thin ring
.af-info-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25em;
  height: 1.25em;
  border: 0.1em solid currentColor;
  border-radius: 50%;
  svg {
    height: 0.65em;
  }
  [data-bs-theme='dark'] & {
    border-color: transparent;
    background-color: currentColor;
    svg {
      color: var(--bs-body-bg);
    }
  }
}
// the popover : room for a few sentences, at the size of the page's text
.af-info-popover {
  --bs-popover-max-width: 26rem;
  --bs-popover-font-size: 0.9375rem;
  .popover-body {
    line-height: 1.5;
    color: var(--bs-body-color);
  }
}
</style>
