<script setup>
/******************************************************************/
/*                                                                */
/*  Font Awesome Icon component                                   */
/*                                                                */
/*  @props:                                                       */
/*      icon: String                                              */
/*      size: String                                              */
/*      fixedwidth: Boolean                                       */
/*      role: String                                              */
/*      color: String                                             */
/*      overlayIcon: String (optional)                            */
/*      overlayIconTransform: String (optional)                   */
/*      overlayIconColor: String (optional)                       */
/*      overlayIconText: String (optional)                        */
/*      overlayIconTextPosition: String (optional)                */
/*      overlayIconTextColor: String (optional)                   */
/*                                                                */
/******************************************************************/

import { computed } from 'vue';

// PROPS

const props = defineProps({
  icon: {
    type: String,
    required: true,
  },
  size: {
    type: String,
    default: null,
  },
  fixedwidth: {
    type: Boolean,
    default: false,
  },
  role: {
    type: String,
    default: null,
  },
  color: {
    type: String,
    default: null,
  },
  overlayIcon: {
    type: String,
    default: null,
  },
  overlayIconTransform: {
    type: String,
    default: 'shrink-6 up-7 right-7',
  },
  overlayIconColor: {
    type: String,
    default: 'success',
  },
  overlayIconCircle: {
    type: Boolean,
    default: true,
  },
  overlayIconText: {
    type: String,
    default: null,
  },
  overlayIconTextPosition: {
    type: String,
    default: 'bottom-left',
  },
  overlayIconTextColor: {
    type: String,
    default: 'success',
  },
});

// COMPUTED

const i = computed(() => {
  if (props.icon?.includes(',')) {
    return props.icon.split(',');
  } else {
    return props.icon;
  }
});

const overlayI = computed(() => {
  if (props.overlayIcon?.includes(',')) {
    return props.overlayIcon.split(',');
  } else {
    return props.overlayIcon;
  }
});

const circleColor = computed(() => {
  // Use theme-aware CSS variable for circle color
  return `overlay-circle-${props.overlayIconColor}`;
});

const iconOverlayColor = computed(() => {
  // Use CSS variable when circle is present, otherwise use the prop color
  return props.overlayIconCircle ? 'overlay-icon' : props.overlayIconColor;
});

const adjustTransform = (transform) => {
  // Parse and adjust transform string
  // shrink-X becomes shrink-(X+3)
  // Other transforms remain unchanged
  return transform.replace(/shrink-(\d+)/g, (match, value) => {
    const num = parseInt(value);
    return `shrink-${num + 4}`;
  });
};

const circleTransform = computed(() => {
  return props.overlayIconCircle ? props.overlayIconTransform : null;
});

const iconTransform = computed(() => {
  if (props.overlayIconCircle) {
    return adjustTransform(props.overlayIconTransform);
  } else {
    return props.overlayIconTransform;
  }
});
</script>
<template>
  <!-- Layered icons when overlayIcon or overlayIconText is provided -->
  <font-awesome-layers v-if="overlayIcon || overlayIconText" :class="[size ? `fa-${size}` : '']">
    <font-awesome-icon
      :class="`text-${color}`"
      :role="role"
      :icon="i"
      :fixed-width="fixedwidth"
      :spin="icon == 'spinner'"
    />
    <font-awesome-icon
      v-if="overlayIconCircle"
      icon="circle"
      inverse
      :transform="circleTransform"
      :class="`text-${circleColor} overlay-circle-border`"
    />
    <font-awesome-icon
      v-if="overlayIcon"
      :icon="overlayI"
      :inverse="overlayIconCircle"
      :transform="iconTransform"
      :class="`text-${iconOverlayColor}`"
    />
    <font-awesome-layers-text
      v-if="overlayIconText"
      counter
      :position="overlayIconTextPosition"
      :class="`bg-${overlayIconTextColor}`"
      :value="overlayIconText"
    />
  </font-awesome-layers>

  <!-- Single icon when no overlay -->
  <font-awesome-icon
    v-else
    :class="`text-${color}`"
    :role="role"
    :icon="i"
    :size="size"
    :fixed-width="fixedwidth"
    :spin="icon == 'spinner'"
  />
</template>
