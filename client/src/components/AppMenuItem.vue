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
</script>
<template>
  <li role="button" v-if="countFormsByCategory(path) > 0">
    <!-- <li role="button"> -->
    <div
      class="d-flex justify-content-between menu-item p-2 my-1"
      :class="{ active: isHighLighted }"
      @click="emit('click', path)"
    >
      <span class="me-3">
        <span class="me-2">
          <FaIcon :icon="menu.icon" :fixedwidth="true"></FaIcon>
        </span>
        {{ menu.name }}</span
      >
      <span v-if="isHighLighted" class="badge px-3 rounded-pill active">{{ countFormsByCategory(path) }}</span>
      <span v-else class="badge px-3 rounded-pill">{{ countFormsByCategory(path) }}</span>
    </div>
    <Transition name="slidedown">
      <ul
        class="list-unstyled border-start border-1 border-secondary"
        v-if="isActive && menu && menu.items && menu.items.length > 0"
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
