<script setup>
/******************************************/
/*                                        */
/*  Bootstrap modal component             */
/*                                        */
/*  @props:                               */
/*      size: String                      */
/*      dialogClass: String - a class on  */
/*         the dialog box itself          */
/*        'sm' | 'md' | 'lg' | 'xl'        */
/*        'md' is Bootstrap's default      */
/*        width (no modal-* class).        */
/*        Defaults to 'xl', which is what  */
/*        every modal was hard-coded to.   */
/*                                        */
/*  @slots:                               */
/*      title: String                     */
/*      default: String                   */
/*      footer: String                    */
/*                                        */
/*  @emit:                                */
/*      close: Event                      */
/*                                        */
/******************************************/

import { getCurrentInstance, computed } from 'vue';
import { useI18n } from 'vue-i18n';

// INIT

const { t } = useI18n();
const { uid } = getCurrentInstance();
const emit = defineEmits(['close']);
const props = defineProps({
  size: { type: String, default: 'xl' },
  dialogClass: { type: String, default: '' },
});

// Bootstrap has modal-sm/-lg/-xl but no modal-md : the default width is the
// absence of a class, so 'md' must not emit one.
const sizeClass = computed(() => (props.size && props.size !== 'md' ? `modal-${props.size}` : ''));

// METHODS

function backdropClick(e) {
  if (e.target.id == uid) {
    emit('close');
  }
}
</script>

<template>
  <div
    @click="backdropClick"
    :id="uid"
    class="modal fade show d-block"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    data-bs-keyboard="true"
    aria-hidden="true"
    data-bs-backdrop="static"
  >
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable" :class="[sizeClass, dialogClass]">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title"><slot name="title"></slot></h5>
          <button
            type="button"
            class="btn-close"
            data-bs-dismiss="modal"
            aria-label="Close"
            @click="emit('close')"
          ></button>
        </div>
        <div class="modal-body">
          <slot></slot>
        </div>
        <div class="modal-footer">
          <slot name="footer"></slot>
          <BsButton icon="times" @click="emit('close')">{{ t('common.close') }}</BsButton>
        </div>
      </div>
    </div>
  </div>
  <div class="modal-backdrop fade show"></div>
</template>
