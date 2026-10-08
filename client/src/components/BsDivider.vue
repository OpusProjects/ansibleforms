<script setup>
defineProps({
  type: {
    type: String,
    default: 'single',
    validator: (value) => {
      return ['single', 'text', 'icon', 'double', 'dashed', 'fade'].includes(value);
    },
  },
  text: {
    type: String,
    default: '',
  },
  icon: {
    type: String,
    default: '',
  },
  spin: {
    type: Boolean,
    default: false,
  },
});
</script>
<template>
  <!-- text divider -->
  <div class="divider">
    <div v-if="type == 'text'" class="divider-text">
      <span>{{ text }}</span>
    </div>
    <!-- icon divider -->
    <div v-else-if="type == 'icon'" class="divider-icon">
      <FaIcon :icon="icon" :spin="spin" />
    </div>
    <!-- double line -->
    <div v-else-if="type == 'double'" class="divider-double">
      <div class="divider-double"></div>
    </div>
    <!-- dashed divider -->
    <div v-else-if="type == 'dashed'" class="divider-dashed">
      <div class="divider-dashed"></div>
    </div>
    <!-- fade divider -->
    <div v-else-if="type == 'fade'" class="divider-fade">
      <div class="divider-fade"></div>
    </div>
    <!-- single line -->
    <div v-else class="divider-single">
      <div class="divider-single"></div>
    </div>
  </div>
</template>
<style scoped>
.divider {
  margin: 1rem 0;
  position: relative;
}

/* Simple Line with Text */
.divider-text {
  display: flex;
  align-items: center;
  text-align: center;
  color: #6c757d;
}

.divider-text::before,
.divider-text::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--af-gray-muted);
}

.divider-text span {
  padding: 0 1rem;
}

/* Icon Divider */
.divider-icon {
  text-align: center;
  height: 20px;
  position: relative;
}

.divider-icon::before,
.divider-icon::after {
  content: '';
  position: absolute;
  top: 50%;
  width: calc(50% - 30px);
  height: 1px;
  background-color: var(--af-gray-muted);
}

.divider-icon::before {
  left: 0;
}

.divider-icon::after {
  right: 0;
}

/* Double Line */
.divider-double {
  height: 4px;
  border-top: 1px solid var(--af-gray-muted);
  border-bottom: 1px solid var(--af-gray-muted);
}
/* Single Line */
.divider-single {
  border: none;
  height: 1px;
  background-color: var(--af-gray-muted);
}

/* Dashed */
.divider-dashed {
  border: none;
  height: 1px;
  background: repeating-linear-gradient(
    to right,
    var(--af-gray-muted) 0,
    var(--af-gray-muted) 8px,
    transparent 8px,
    transparent 16px
  );
}

/* Fade Divider */
.divider-fade {
  height: 1px;
  background: linear-gradient(to right, transparent, #6c757d, transparent);
}

/* Content Sections */
.content-section {
  padding: 2rem;
  background-color: var(--bs-body-bg);
  margin-bottom: 1rem;
  border-radius: 0.5rem;
}
</style>
