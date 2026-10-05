<script setup>
/******************************************************/
/*                                                    */
/*  Bootstrap Dropdown Split Button Component         */
/*                                                    */
/*  @props:                                           */
/*      colorClass: String - Color class              */
/*      icon: String - Main button icon               */
/*      label: String - Main button label             */
/*      actions: Array - Dropdown actions             */
/*          [{                                        */
/*            key: String - Unique key                */
/*            label: String - Action label            */
/*            icon: String - Action icon              */
/*            roleOption: String - Required role opt  */
/*            divider: Boolean - Show divider after   */
/*          }]                                        */
/*                                                    */
/*  @emit:                                            */
/*      click: Event - Main button click              */
/*      action: String - Action key clicked           */
/*                                                    */
/******************************************************/

import { computed } from 'vue';
import { useAppStore } from '@/stores/app';

// INIT

const emit = defineEmits(['click', 'action']);
const store = useAppStore();

// PROPS

const props = defineProps({
  colorClass: {
    type: String,
    default: 'primary',
  },
  icon: {
    type: String,
    default: '',
  },
  label: {
    type: String,
    default: 'Submit',
  },
  actions: {
    type: Array,
    default: () => [],
  },
  cssClass: {
    type: String,
    default: '',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  menuEnd: {
    type: Boolean,
    default: false,
  },
  fullWidth: {
    type: Boolean,
    default: true,
  },
});

// COMPUTED

const classes = computed(() => {
  return `btn-${props.colorClass} ${props.cssClass}`;
});

// Filter actions based on role options
const visibleActions = computed(() => {
  return props.actions.filter((action) => {
    // If no roleOption specified, always show
    if (!action.roleOption) return true;
    // Check if user has the required role option
    return store.profile.options?.[action.roleOption] || false;
  });
});

const hasVisibleActions = computed(() => visibleActions.value.length > 0);

// METHODS

function handleMainClick(event) {
  emit('click', event);
}

function handleActionClick(actionKey) {
  emit('action', actionKey);
}
</script>
<template>
  <div class="btn-group" :class="{ 'w-100': fullWidth }" role="group">
    <!-- Main button -->
    <button type="button" class="btn flex-grow-1" :class="classes" :disabled="disabled" @click="handleMainClick">
      <span v-if="icon" class="me-1"><FaIcon :icon="icon" /></span>
      <span>{{ label }}</span>
    </button>

    <!-- Dropdown toggle (only show if there are visible actions) -->
    <button
      v-if="hasVisibleActions"
      type="button"
      class="btn dropdown-toggle dropdown-toggle-split"
      :class="classes"
      :disabled="disabled"
      data-bs-toggle="dropdown"
      aria-expanded="false"
      style="flex: 0 0 auto"
    >
      <span class="visually-hidden">Toggle Dropdown</span>
    </button>

    <!-- Dropdown menu -->
    <ul v-if="hasVisibleActions" class="dropdown-menu" :class="{ 'dropdown-menu-end': menuEnd }">
      <template v-for="(action, index) in visibleActions" :key="action.key">
        <li>
          <a class="dropdown-item" href="#" @click.prevent="handleActionClick(action.key)">
            <FaIcon v-if="action.icon" :icon="action.icon" class="me-2" />
            {{ action.label }}
          </a>
        </li>
        <li v-if="action.divider && index < visibleActions.length - 1">
          <hr class="dropdown-divider" />
        </li>
      </template>
    </ul>
  </div>
</template>
