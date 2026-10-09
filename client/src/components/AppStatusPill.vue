<script setup>
/******************************************************************/
/*                                                                */
/*  A job's status as the app's standard pill (styles/tables.scss,*/
/*  .af-pill) : the same colours wherever a job shows its status  */
/*  - the jobs list, a job's page, a form's running job, an AWX   */
/*  workflow. Running blue, success green, failed red, waiting or */
/*  stopped amber, anything else grey ; the label as the jobs'    */
/*  menu says it, else the status itself.                         */
/*                                                                */
/*  @props:                                                       */
/*      status: String - the job's status (AWX's too)             */
/*      label: String - another text than the status's            */
/*      tone: String - a PILL colour instead of the status's (a   */
/*         job's type : grey)                                     */
/*                                                                */
/******************************************************************/
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { PILL } from '@/lib/tableCells';

const props = defineProps({
  status: { type: String, default: '' },
  label: { type: String, default: '' },
  tone: { type: String, default: '' },
});
const { t, te } = useI18n();

// the colour of each status : the app's, and AWX's own words for the same
const STATUS_TONE = {
  running: 'blue',
  pending: 'blue',
  waiting: 'blue',
  success: 'green',
  successful: 'green',
  failed: 'red',
  error: 'red',
  approve: 'amber',
  warning: 'amber',
  aborted: 'amber',
  rejected: 'amber',
  abandoned: 'amber',
  canceled: 'amber',
};
const colour = computed(() => PILL[props.tone || STATUS_TONE[props.status] || 'grey']);
const text = computed(() => {
  if (props.label) return props.label;
  return te(`jobs.menu.${props.status}`) ? t(`jobs.menu.${props.status}`) : props.status;
});
</script>

<template>
  <span class="badge rounded-pill fw-semibold af-pill" :class="colour"
    ><span class="af-pill-label">{{ text }}</span></span
  >
</template>
