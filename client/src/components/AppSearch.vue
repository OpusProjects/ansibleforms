<script setup>
/******************************************************************/
/*                                                                */
/*  App AnsibleForms header search                                */
/*                                                                */
/*  A magnifying glass in the header. A click (or "/" or Ctrl+K)  */
/*  opens a search box over the header ; the forms and pages      */
/*  that match show live under it, like a documentation site's    */
/*  search. The arrow keys move through them, Enter opens one,    */
/*  Escape or a click outside closes the box.                     */
/*                                                                */
/*  The forms come from the same forms list as the Forms page     */
/*  (already filtered on the user's roles), loaded when the box   */
/*  first opens and refreshed on each open after that.            */
/*                                                                */
/******************************************************************/

import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/stores/app';
import Form from '@/lib/Form';
import Search from '@/lib/Search';
import { searchPages } from '@/config/searchPages';

// INIT
const { t } = useI18n();
const router = useRouter();
const store = useAppStore();

// DATA
const open = ref(false);
const query = ref('');
const forms = ref([]);
const active = ref(0);
const root = ref(null);
const input = ref(null);
const list = ref(null);

// COMPUTED

// the index : the forms of the list and the pages the user's options let them open
const entries = computed(() => Search.buildIndex(forms.value, searchPages(t, store.profile?.options)));
const results = computed(() => Search.search(entries.value, query.value));

// a new query starts at the best match
watch(query, () => {
  active.value = 0;
});

// METHODS

/**
 * Loads the forms list in the background ; the search keeps the last one meanwhile.
 *
 * Returns:
 *   Promise<void>: settles once the list is in, or failed to load.
 */
async function loadForms() {
  try {
    const config = await Form.list();
    forms.value = config?.forms || [];
  } catch {
    // not signed in or the server is down : the pages are still searchable
  }
}

/**
 * Opens the search box and puts the cursor in it.
 *
 * Returns:
 *   Promise<void>: settles once the input has the focus.
 */
async function show() {
  if (open.value) return;
  open.value = true;
  loadForms();
  await nextTick();
  input.value?.focus();
  input.value?.select();
}

/**
 * Closes the search box ; the query stays, so reopening shows the same results.
 */
function hide() {
  open.value = false;
}

/**
 * Opens a result and closes the search box.
 *
 * Args:
 *   result (object): the result to open, from Search.search().
 */
function go(result) {
  if (!result) return;
  hide();
  query.value = '';
  router.push(result.to);
}

/**
 * Moves the highlighted result and keeps it in view.
 *
 * Args:
 *   step (number): 1 for the next result, -1 for the previous one.
 */
function move(step) {
  const count = results.value.length;
  if (!count) return;
  active.value = (active.value + step + count) % count;
  nextTick(() => list.value?.querySelector('.af-search-result.active')?.scrollIntoView({ block: 'nearest' }));
}

/**
 * Handles the keys typed in the search box.
 *
 * Args:
 *   event (KeyboardEvent): the key pressed.
 */
function onInputKey(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    move(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    move(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    go(results.value[active.value]);
  } else if (event.key === 'Escape') {
    hide();
  }
}

/**
 * Opens the search on "/" or Ctrl+K (Cmd+K on a Mac), unless the user is typing somewhere.
 *
 * Args:
 *   event (KeyboardEvent): the key pressed anywhere on the page.
 */
function onGlobalKey(event) {
  const target = event.target;
  const typing = target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    show();
  } else if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    show();
  }
}

/**
 * Closes the search box on a click outside it.
 *
 * Args:
 *   event (MouseEvent): the click anywhere on the page.
 */
function onGlobalClick(event) {
  if (open.value && root.value && !root.value.contains(event.target)) hide();
}

onMounted(() => {
  document.addEventListener('keydown', onGlobalKey);
  document.addEventListener('mousedown', onGlobalClick);
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKey);
  document.removeEventListener('mousedown', onGlobalClick);
});
</script>

<template>
  <div ref="root" class="af-search" :class="{ open }">
    <button
      v-if="!open"
      type="button"
      class="btn af-icon-btn"
      :title="t('search.title')"
      :aria-label="t('search.title')"
      @click="show"
    >
      <font-awesome-icon icon="magnifying-glass" />
    </button>

    <template v-else>
      <!-- the box : over the header, the icon on its left and an underline below it -->
      <div class="af-search-box">
        <font-awesome-icon icon="magnifying-glass" class="af-search-icon" />
        <input
          ref="input"
          v-model="query"
          type="search"
          class="af-search-input"
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-controls="af-search-results"
          :aria-expanded="results.length > 0"
          :placeholder="t('search.placeholder')"
          :aria-label="t('search.title')"
          @keydown="onInputKey"
        />
        <button
          type="button"
          class="btn af-icon-btn af-search-close"
          :title="t('search.close')"
          :aria-label="t('search.close')"
          @click="hide"
        >
          <font-awesome-icon icon="xmark" />
        </button>
      </div>

      <!-- the results : the section, the title and the route on the left, the texts that
           matched on the right, every match in bold -->
      <div v-if="query.trim()" id="af-search-results" ref="list" class="af-search-results" role="listbox">
        <div v-if="!results.length" class="af-search-empty">{{ t('search.noResults', { query: query.trim() }) }}</div>
        <a
          v-for="(r, i) in results"
          :key="r.kind + r.path"
          :href="router.resolve(r.to).href"
          class="af-search-result"
          :class="{ active: i === active }"
          role="option"
          :aria-selected="i === active"
          @mouseenter="active = i"
          @click.prevent="go(r)"
        >
          <div class="af-search-main">
            <div class="af-search-section">
              <FaIcon :icon="r.icon" :fixedwidth="true" class="me-1" />
              <template v-for="(p, j) in Search.highlight(r.section || t(`search.kind.${r.kind}`), query)" :key="j">
                <mark v-if="p.match">{{ p.text }}</mark
                ><template v-else>{{ p.text }}</template>
              </template>
            </div>
            <div class="af-search-title">
              <template v-for="(p, j) in Search.highlight(r.title, query)" :key="j">
                <mark v-if="p.match">{{ p.text }}</mark
                ><template v-else>{{ p.text }}</template>
              </template>
            </div>
            <div class="af-search-path">{{ r.path }}</div>
          </div>
          <div v-if="r.snippets.length" class="af-search-snippets">
            <div v-for="(s, k) in r.snippets" :key="k" class="af-search-snippet">
              <template v-for="(p, j) in Search.highlight(s, query)" :key="j">
                <mark v-if="p.match">{{ p.text }}</mark
                ><template v-else>{{ p.text }}</template>
              </template>
            </div>
          </div>
        </a>
      </div>
    </template>
  </div>
</template>

<style lang="scss">
// ===============================================================
// Header search (not scoped, like the rest of the header styles)
// ===============================================================

// while the box is open it covers the middle of the header : hide the links it would cut
// in half rather than show a part of one
.af-header:has(.af-search.open) .af-nav-primary {
  visibility: hidden;
}

.af-header .af-search {
  position: relative;
  display: flex;
  align-items: center;
  height: 42px;

  // the open box covers the header to its left, up to the width of the results
  .af-search-box {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    z-index: 1050;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: min(28rem, calc(100vw - 2rem));
    height: 42px;
    padding: 0 0.25rem 0 0.6rem;
    background-color: var(--af-bg-navbar);
    border-bottom: 2px solid var(--af-navbar-indicator);
  }
  .af-search-icon {
    font-size: 1.15rem;
    color: var(--af-navbar-indicator);
  }
  .af-search-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: 0;
    font-size: 1.05rem;
    color: var(--af-navbar-link-hover-color);
    background: transparent;
    &::placeholder {
      color: var(--af-navbar-link-color);
      opacity: 0.7;
    }
    // the browser's own clear button : the close button is beside it already
    &::-webkit-search-cancel-button {
      display: none;
    }
  }
  // the close button : a header icon button, a little smaller inside the box
  .af-search-close {
    min-width: 34px;
    height: 34px;
    svg {
      font-size: 1.1rem;
    }
  }

  // the results, under the box, as wide as it
  .af-search-results {
    position: absolute;
    right: 0;
    top: calc(50% + 21px + 0.5rem);
    z-index: 1050;
    width: min(28rem, calc(100vw - 2rem));
    max-height: min(70vh, 36rem);
    overflow-y: auto;
    padding: 0.35rem;
    font-size: 0.875rem;
    background-color: var(--bs-body-bg);
    border: 1px solid var(--af-header-border);
    border-radius: 10px;
    box-shadow:
      0 10px 30px rgba(15, 23, 42, 0.12),
      0 2px 6px rgba(15, 23, 42, 0.06);
  }
  .af-search-empty {
    padding: 0.75rem;
    color: var(--bs-secondary-color);
  }

  // a result : two columns, a hairline between them, as a documentation site shows them
  .af-search-result {
    display: flex;
    gap: 1rem;
    padding: 0.6rem 0.7rem;
    border-radius: 6px;
    color: var(--bs-body-color);
    text-decoration: none;
    & + .af-search-result {
      margin-top: 0.15rem;
    }
    &.active {
      background-color: var(--bs-tertiary-bg);
    }
    mark {
      padding: 0;
      font-weight: 700;
      color: inherit;
      background: transparent;
    }
  }
  .af-search-main {
    flex: 0 0 45%;
    min-width: 0;
  }
  .af-search-section {
    font-size: 0.8rem;
    color: var(--af-primary);
    opacity: 0.75;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .af-search-title {
    font-size: 1rem;
    font-weight: 500;
    color: var(--af-primary);
    overflow-wrap: anywhere;
  }
  .af-search-path {
    font-size: 0.75rem;
    color: var(--bs-secondary-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .af-search-snippets {
    flex: 1;
    min-width: 0;
    padding-left: 1rem;
    border-left: 1px solid var(--af-header-border);
  }
  .af-search-snippet + .af-search-snippet {
    margin-top: 0.3rem;
  }

  // collapsed (mobile) header : the box and the results take the screen's width, one column
  @media (max-width: 767.98px) {
    .af-search-box,
    .af-search-results {
      position: fixed;
      left: 1rem;
      right: 1rem;
      width: auto;
    }
    .af-search-box {
      top: 0.75rem;
      transform: none;
    }
    .af-search-results {
      top: calc(0.75rem + 42px + 0.5rem);
    }
    .af-search-result {
      flex-direction: column;
      gap: 0.3rem;
    }
    .af-search-snippets {
      padding-left: 0;
      border-left: 0;
    }
  }
}
</style>
