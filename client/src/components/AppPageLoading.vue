<script setup>
/******************************************************************/
/*                                                                */
/*  The loading indicator of a page                               */
/*                                                                */
/*  A spinner and "Loading...", centered in the window's space    */
/*  under the header (not in the page's content, whose height     */
/*  changes as it loads), while a page waits for its data :       */
/*  the forms list, the designer's configuration.                 */
/*                                                                */
/*  It is positioned over the window and takes no clicks, so      */
/*  what is already shown (a menu) stays usable.                  */
/*                                                                */
/******************************************************************/

import { useI18n } from 'vue-i18n';

// INIT

const { t } = useI18n();
</script>
<template>
  <div class="af-page-loading text-body-secondary" role="status" aria-live="polite">
    <FaIcon icon="spinner" spin class="af-page-loading-icon" />
    <span>{{ t('common.loading') }}</span>
  </div>
</template>
<style scoped>
/* the window under the header : its full offset includes the header's bottom border */
.af-page-loading {
  position: fixed;
  top: var(--af-header-offset);
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  pointer-events: none;
}
.af-page-loading-icon {
  font-size: 2rem;
  opacity: 0.5;
}
</style>
