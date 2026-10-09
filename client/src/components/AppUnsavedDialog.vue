<script setup>
/******************************************************************/
/*                                                                */
/*  The Unsaved changes dialog : asked when a page with unsaved   */
/*  changes is left (useUnsavedGuard). Leave without saving goes  */
/*  on ; Close, the cross, Escape or the backdrop stay.           */
/*                                                                */
/******************************************************************/
import { useI18n } from 'vue-i18n';
import { unsavedPrompt, answerUnsaved } from '@/lib/unsavedPrompt';

const { t } = useI18n();
</script>

<template>
  <BsModal v-if="unsavedPrompt.open" size="md" @close="answerUnsaved(false)">
    <template #title>
      <FaIcon icon="triangle-exclamation" class="me-2 text-warning" />{{ t('settings.common.unsavedTitle') }}
    </template>
    <template #default>
      <p class="mb-0 fs-6">{{ unsavedPrompt.message }}</p>
    </template>
    <template #footer>
      <BsButton icon="right-from-bracket" @click="answerUnsaved(true)">{{
        t('settings.common.unsavedLeave')
      }}</BsButton>
    </template>
  </BsModal>
</template>
