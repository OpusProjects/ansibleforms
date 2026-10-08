<script setup>
/******************************************************************/
/*                                                                */
/*  App Menu Item for categories                                  */
/*                                                                */
/*  @props:                                                       */
/*      currentPath: String                                       */
/*      parent: String                                            */
/*      menu: Object                                              */
/*      forms: Array                                              */
/*      roles: Array                                              */
/*                                                                */
/******************************************************************/

import { ref } from 'vue';
import { useRouter } from 'vue-router';

// INIT

const emit = defineEmits(['click']);
const router = useRouter();

// PROPS

const props = defineProps({
  currentPath: { type: String, default: '' },
  parent: { type: String, default: '' },
  menu: { type: Object },
  forms: { type: Array },
  roles: { type: Array },
});

// COMPUTED

const path = computed(() => {
  return props.parent ? props.parent + '/' + props.menu.name : props.menu.name;
});

const isActive = computed(() => {
  var x = props.currentPath.split('/');
  var y = path.value.split('/');
  for (let i = 0; i < x.length; i++) {
    if (i < y.length) {
      if (x[i] != y[i]) return false;
    } else {
      return true;
    }
  }
  return true;
});

const isHighLighted = computed(() => {
  return props.currentPath == path.value;
});

// METHODS

function goto(path) {
  if (path) {
    router.replace({ path: '/', query: { category: encodeURIComponent(path) } }).catch((_e) => {});
  } else {
    router.replace({ path: '/' }).catch((_e) => {});
  }
}

function filterAllowedForms(category) {
  return filterForms(category);
}

function filterForms(category) {
  if (!category) {
    return props.forms;
  } else {
    return props.forms.filter((item) => {
      if (item.categories != undefined) {
        for (let j = 0; j < item.categories.length; j++) {
          if (inCategory(item.categories[j], category)) return true;
        }
        return false;
      } else {
        return category == 'Default';
      }
    });
  }
}

function inCategory(c, category) {
  var x = category.split('/');
  var y = c.split('/');
  for (let i = 0; i < x.length; i++) {
    if (i < y.length) {
      if (x[i] != y[i]) {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

function countFormsByCategory(category) {
  return filterAllowedForms(category).length;
}

// a category opens to show its sub categories : only the ones with forms are listed, so
// only those count when deciding whether to show the open/close chevron
const hasChildren = computed(() =>
  (props.menu?.items || []).some((item) => countFormsByCategory(path.value + '/' + item.name) > 0),
);

// a click on the selected category, while it is open, folds its sub categories away (it
// stays selected) ; the next click opens them again. Selecting another category resets it.
const folded = ref(false);
const isOpen = computed(() => isActive.value && !folded.value);
function onClick() {
  if (hasChildren.value && isHighLighted.value) {
    folded.value = !folded.value;
    return;
  }
  folded.value = false;
  emit('click', path.value);
}
</script>
<template>
  <li role="button" v-if="countFormsByCategory(path) > 0">
    <!-- <li role="button"> -->
    <div
      class="d-flex justify-content-between align-items-center menu-item p-2 my-1"
      :class="{ active: isHighLighted }"
      @click="onClick()"
    >
      <span class="me-3">
        <span class="me-2">
          <FaIcon :icon="menu.icon" :fixedwidth="true"></FaIcon>
        </span>
        {{ menu.name }}
        <FaIcon v-if="hasChildren" :icon="isOpen ? 'chevron-up' : 'chevron-down'" class="ms-2 af-chevron"></FaIcon
      ></span>
      <span v-if="isHighLighted" class="badge px-3 rounded-pill active">{{ countFormsByCategory(path) }}</span>
      <span v-else class="badge px-3 rounded-pill">{{ countFormsByCategory(path) }}</span>
    </div>
    <Transition name="slidedown">
      <ul
        class="list-unstyled border-start border-1 border-secondary"
        v-if="isOpen && menu && menu.items && menu.items.length > 0"
      >
        <AppMenuItem
          @click="goto(path + '/' + item.name)"
          v-for="item in menu.items"
          :key="path + '/' + item.name"
          :currentPath="currentPath"
          :parent="path"
          :menu="item"
          :forms="forms"
          :roles="roles"
        />
      </ul>
    </Transition>
  </li>
</template>
<style scoped lang="scss">
ul {
  padding-left: 1rem;
  margin-left: 1rem;
  li {
    div.active {
      background-color: var(--af-bg-active) !important;
      color: var(--af-text-active) !important;
    }
  }
}

.af-chevron {
  font-size: 0.7em;
  opacity: 0.6;
}

.badge {
  background-color: var(--af-bg-badge) !important;
  color: var(--af-text-badge) !important;
  &.active {
    background-color: var(--af-text-badge) !important;
    color: var(--af-bg-badge) !important;
  }
}

.slidedown-enter-active,
.slidedown-leave-active {
  transition: max-height 0.5s ease-in-out;
}

.slidedown-enter-to,
.slidedown-leave-from {
  overflow: hidden;
  max-height: 1000px;
}

.slidedown-enter-from,
.slidedown-leave-to {
  overflow: hidden;
  max-height: 0;
}
</style>
