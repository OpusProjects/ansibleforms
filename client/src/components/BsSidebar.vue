<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Sidebar component                                   */
/*                                                                */
/*  @props:                                                       */
/*      sections: Array of { title, items[] } ; a section with    */
/*        no title has no collapsible header. An item links to    */
/*        a route ({ link }) or runs a click ({ action, active,   */
/*        disabled }) ; a disabled entry is greyed out. Either    */
/*        kind can show a count ({ badge, badgeAlert })           */
/*      storageKey: String - localStorage key for collapse state  */
/*      title: String - optional heading above the sections       */
/*      icon: String - icon shown next to the heading             */
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
  // a heading above the sections, styled like the forms page's "Categories" heading
  title: { type: String, default: '' },
  icon: { type: String, default: '' },
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

// each section opens and closes on its own, several can be open at once : the menu scrolls
// by itself (it is one screen high), so a long open list no longer pushes the page down
function toggle(idx) {
  collapsed.value[idx] = !collapsed.value[idx];
  save();
}

const isActive = (link) => {
  return !!link && route.path.includes(link);
};

// the section of the current page is open on arrival : on a first visit (no saved state)
// only that one, and when a link in a closed section is followed, that section opens too
// (the others stay as the user left them). An in-page entry marked active counts as the
// current page too (the jobs list's status filters).
function openActiveSection() {
  const idx = (props.sections || []).findIndex((s) => (s.items || []).some((i) => i.active || isActive(i.link)));
  if (idx < 0) return;
  const firstVisit = Object.keys(collapsed.value).length === 0;
  if (firstVisit) {
    props.sections.forEach((_, j) => {
      collapsed.value[j] = j !== idx;
    });
    save();
  } else if (collapsed.value[idx]) {
    collapsed.value[idx] = false;
    save();
  }
}
onMounted(openActiveSection);
watch(() => route.path, openActiveSection);
</script>
<template>
  <div class="af-sidebar d-flex flex-column p-3 bg-body-tertiary">
    <!-- 16px under the divider before a section title ; an untitled list sets its own
         space instead (see the list below) -->
    <div
      v-if="title"
      class="d-flex align-items-center px-2 pb-3 border-bottom link-body-emphasis"
      :class="sections?.[0] && !sections[0].title ? 'mb-0' : 'mb-3'"
    >
      <FaIcon v-if="icon" :icon="icon" />
      <span class="ms-2 fs-5 fw-bold">{{ title }}</span>
    </div>
    <div class="mb-auto">
      <div v-for="(section, idx) in sections" :key="idx" :class="{ 'mt-2': idx > 0 }">
        <div
          v-if="section.title"
          class="sidebar-section-header d-flex align-items-center justify-content-between px-2 py-1"
          role="button"
          @click="toggle(idx)"
        >
          <small class="text-uppercase fw-semibold text-body-secondary letter-spacing">{{ section.title }}</small>
          <FaIcon :icon="collapsed[idx] ? 'chevron-down' : 'chevron-up'" class="text-body-secondary" size="xs" />
        </div>
        <!-- under a section title a small gap ; an untitled list follows the selection, like the
             forms page's category list : a highlighted first entry's bar starts 20px from the
             panel's top, an unhighlighted entry 12px (the eye then measures to its text) -->
        <ul
          v-show="!section.title || !collapsed[idx]"
          class="nav nav-pills flex-column"
          :class="section.title ? 'mt-1' : section.items?.[0]?.active ? 'af-list-first-active' : 'af-list-first'"
        >
          <li v-for="item in section.items" :key="item.link || item.title" class="nav-item">
            <!-- a view inside the current page (the designer's editors) rather than a route -->
            <a
              v-if="item.action"
              role="button"
              class="nav-link"
              :class="{
                active: item.active,
                disabled: item.disabled,
                'link-body-emphasis': !item.active && !item.disabled,
              }"
              :aria-current="item.active ? 'page' : null"
              :aria-disabled="item.disabled ? 'true' : null"
              @click="!item.disabled && item.action()"
            >
              <!-- a row : the label takes the room and is cut off with an ellipsis rather than
                   wrapping, the count keeps its place on the right, so every row is as high -->
              <span class="d-flex align-items-center">
                <span class="flex-grow-1 text-truncate">
                  <FaIcon :icon="item.icon" :fixedwidth="true" />
                  {{ item.title }}
                </span>
                <span
                  v-if="item.badge != null"
                  class="badge rounded-pill flex-shrink-0 ms-2 af-sidebar-badge"
                  :class="{ 'is-alert': item.badgeAlert, active: item.active }"
                  >{{ item.badge }}</span
                >
              </span>
            </a>
            <router-link
              v-else
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
/* the menu scrolls on its own, independent of the page : it sticks to the top of the
   scrolling area (#app, which starts below the header) and is exactly one screen high
   minus the header, so a long page never drags the menu along */
.af-sidebar {
  width: 300px; /* the same width as the forms page category list (.af-forms-sidebar) */
  flex-shrink: 0;
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: calc(100vh - var(--af-header-offset));
  overflow-y: auto;
}
.af-list-first {
  margin-top: -4px; /* 16px panel padding - 4px = 12px */
}
.af-list-first-active {
  margin-top: 4px; /* 16px panel padding + 4px = 20px */
}
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
/* a count next to an entry, styled like the forms page's category counts */
.af-sidebar-badge {
  padding: 0.35em 0.75em;
  background-color: var(--af-bg-badge);
  color: var(--af-text-badge);
}
.af-sidebar-badge.active {
  background-color: var(--af-text-badge);
  color: var(--af-bg-badge);
}
.af-sidebar-badge.is-alert:not(.active) {
  background-color: var(--bs-danger);
  color: #fff;
}
/* a disabled entry (the designer before it is started) : a light grey, clearly not clickable */
.nav-link.disabled {
  color: var(--bs-secondary-color) !important;
  opacity: 0.55;
  cursor: default;
}
/* on the dark background the faded grey is harder to make out, so it is a little lighter */
[data-bs-theme='dark'] .nav-link.disabled {
  opacity: 0.68;
}
.nav-link:not(.active):not(.disabled):hover {
  background-color: var(--bs-secondary-bg);
}
</style>
