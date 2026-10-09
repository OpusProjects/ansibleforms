<script setup>
/******************************************************************/
/*                                                                */
/*  A panel over the page, as a centred dialog (it was a panel    */
/*  sliding in from the side : the name stays, its users did not  */
/*  have to change). Mounted while hidden, as the panel was, so   */
/*  what it holds keeps its state between two openings.           */
/*                                                                */
/*  @props:                                                       */
/*      title: String                                             */
/*      icon: String                                              */
/*      show: Boolean                                             */
/*      size: String - sm, md, lg (default) or xl                 */
/*      dialogClass: String - a class on the dialog box itself    */
/*         (the root is a fragment : a class on the component     */
/*         would not reach it)                                    */
/*                                                                */
/*  @slots:                                                       */
/*      default: the content                                      */
/*      actions: its buttons, in the footer before Close          */
/*                                                                */
/*  @emit:                                                        */
/*      close: Event                                              */
/*                                                                */
/******************************************************************/

import { getCurrentInstance, computed } from 'vue';
import { useI18n } from 'vue-i18n';

// INIT

const { uid } = getCurrentInstance();
const emit = defineEmits(['close']);
const { t } = useI18n();

// PROPS

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  icon: {
    type: String,
    default: null,
  },
  show: {
    type: Boolean,
    default: false,
  },
  dialogClass: {
    type: String,
    default: '',
  },
  size: {
    type: String,
    default: 'lg',
  },
});

// Bootstrap has no modal-md : the default width is the absence of a class
const sizeClass = computed(() => (props.size && props.size !== 'md' ? `modal-${props.size}` : ''));

// METHODS

function close() {
  emit('close');
}
// a click on the backdrop around the dialog closes it, not one inside it
function backdropClick(e) {
  if (e.target.id == uid) close();
}
</script>

<template>
  <!-- d-block only while shown : its !important would beat v-show, and a hidden dialog would
       still lie over the page, catching its clicks -->
  <div
    v-show="show"
    :id="uid"
    class="modal"
    :class="{ 'd-block': show }"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-labelledby="offcanvasLabel"
    @click="backdropClick"
  >
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable" :class="[sizeClass, dialogClass]">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="offcanvasLabel">
            <span v-if="icon" class="me-2"><FaIcon :icon="icon" /></span>{{ title }}
          </h5>
          <button type="button" class="btn-close" aria-label="Close" @click="close"></button>
        </div>
        <div class="modal-body">
          <slot></slot>
        </div>
        <div class="modal-footer">
          <slot name="actions"></slot>
          <BsButton icon="times" @click="close">{{ t('common.close') }}</BsButton>
        </div>
      </div>
    </div>
  </div>
  <div v-show="show" class="modal-backdrop fade show"></div>
</template>
<style scoped></style>
