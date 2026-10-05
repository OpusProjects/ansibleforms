<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Sidebar component                                   */
/*                                                                */
/*  @props:                                                       */
/*      sections: Array of { title, items[] }                     */
/*      storageKey: String - localStorage key for collapse state  */
/*                                                                */
/******************************************************************/

import { ref, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

const props = defineProps({
  sections: Array,
  // Every page mounts its own sidebar, so the collapse state has to be
  // persisted (same as the theme in Theme.js) or following any link remounts
  // with an empty state and re-expands every section.
  storageKey: { type: String, default: 'af_sidebar_collapsed' },
});

// keyed by section index: stable across pages, and unlike the section title it
// does not change when the user switches language
function loadCollapsed() {
  try {
    const saved = JSON.parse(localStorage.getItem(props.storageKey) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch (e) {
    return {};
  }
}

const collapsed = ref(loadCollapsed());

function save() {
  try {
    localStorage.setItem(props.storageKey, JSON.stringify(collapsed.value));
  } catch (e) {
    // storage full or disabled: keep the in-memory state
  }
}

// an accordion : opening a section closes the others, so the list never shows more
// than one section's entries ; closing one leaves the rest as it is
function toggle(idx) {
  const open = !!collapsed.value[idx];
  if (open)
    props.sections.forEach((_, j) => {
      if (j !== idx) collapsed.value[j] = true;
    });
  collapsed.value[idx] = !open;
  save();
}

const isActive = (link) => {
  return route.path.includes(link);
};

// the section of the current page is open on arrival - and only that one on a first
// visit (no saved state), or when a link in a closed section is followed
function openActiveSection() {
  const idx = (props.sections || []).findIndex((s) => (s.items || []).some((i) => isActive(i.link)));
  if (idx < 0) return;
  const firstVisit = Object.keys(collapsed.value).length === 0;
  if (firstVisit || collapsed.value[idx]) {
    props.sections.forEach((_, j) => {
      collapsed.value[j] = j !== idx;
    });
    save();
  }
}
onMounted(openActiveSection);
watch(() => route.path, openActiveSection);
</script>
<template>
  <div class="d-flex flex-column p-3 bg-body-tertiary" style="width: 280px">
    <div class="mb-auto">
      <div v-for="(section, idx) in sections" :key="idx" :class="{ 'mt-2': idx > 0 }">
        <div
          class="sidebar-section-header d-flex align-items-center justify-content-between px-2 py-1"
          role="button"
          @click="toggle(idx)"
        >
          <small class="text-uppercase fw-semibold text-body-secondary letter-spacing">{{ section.title }}</small>
          <FaIcon :icon="collapsed[idx] ? 'chevron-down' : 'chevron-up'" class="text-body-secondary" size="xs" />
        </div>
        <ul v-show="!collapsed[idx]" class="nav nav-pills flex-column mt-1">
          <li v-for="item in section.items" :key="item.link" class="nav-item">
            <router-link
              :to="item.link"
              class="nav-link"
              :class="{ active: isActive(item.link), 'link-body-emphasis': !isActive(item.link) }"
              :aria-current="isActive(item.link) ? 'page' : null"
            >
              <FaIcon :icon="item.icon" :fixedwidth="true" />
              {{ item.title }}
            </router-link>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
<style scoped>
.sidebar-section-header {
  cursor: pointer;
  border-radius: 0.25rem;
}
.sidebar-section-header:hover {
  background-color: var(--bs-tertiary-bg);
}
.letter-spacing {
  letter-spacing: 0.05em;
  font-size: 0.9rem;
}
.nav-link:not(.active):hover {
  background-color: var(--bs-secondary-bg);
}
</style>
