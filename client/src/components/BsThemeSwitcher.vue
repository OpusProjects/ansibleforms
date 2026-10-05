<script setup>
/******************************************************************/
/*                                                                */
/*  Bootstrap Theme Switcher component                            */
/*                                                                */
/*  @props:                                                       */
/*      buttonClass: String                                       */
/*                                                                */
/*  @emit:                                                        */
/*      themeChanged: Event                                       */
/*                                                                */
/******************************************************************/

import Theme from '@/lib/Theme';
import { useAppStore } from '@/stores/app';

// MODEL

const currentTheme = defineModel();

// INIT

const themes = Theme.themes();
defineEmits(['themeChanged']);
const store = useAppStore();
const wrapperRef = ref(null);

// PROPS

defineProps({
  buttonClass: {
    type: String,
  },
});

// DATA

const showPalette = ref(false);
const selectedColor = ref(currentTheme.value === 'color' ? Theme.getColor() : null);

const palette = [
  { label: 'Blue', hex: '#008cba' },
  { label: 'Indigo', hex: '#6610f2' },
  { label: 'Purple', hex: '#744fc6' },
  { label: 'Pink', hex: '#d63384' },
  { label: 'Red', hex: '#dc3545' },
  { label: 'Orange', hex: '#ff8800' },
  { label: 'Green', hex: '#198754' },
  { label: 'Teal', hex: '#20c997' },
  { label: 'Cyan', hex: '#0190ce' },
  { label: 'Navy', hex: '#1b2a4a' },
  { label: 'Slate', hex: '#475569' },
  { label: 'Brown', hex: '#795548' },
];

// METHODS

function setTheme(theme) {
  if (theme === 'color') {
    showPalette.value = true;
    currentTheme.value = 'color';
    return;
  }
  showPalette.value = false;
  selectedColor.value = null;
  Theme.clearColor();
  // this switcher is the only explicit user choice, so record it here to
  // stop the server default theme from overriding it on the next load
  Theme.choose(theme);
  currentTheme.value = theme;
}

function pickColor(hex) {
  selectedColor.value = hex;
  Theme.choose('color');
  Theme.applyColor(hex);
}

function onDropdownHidden() {
  if (showPalette.value && store.theme !== 'color') {
    currentTheme.value = store.theme;
  }
  showPalette.value = false;
}

let dropdownEl = null;

onMounted(() => {
  dropdownEl = wrapperRef.value?.closest('.dropdown');
  if (dropdownEl) {
    dropdownEl.addEventListener('hidden.bs.dropdown', onDropdownHidden);
  }
});

onBeforeUnmount(() => {
  if (dropdownEl) {
    dropdownEl.removeEventListener('hidden.bs.dropdown', onDropdownHidden);
  }
});

// COMPUTED

const themeIcon = computed(() => {
  return themes.find((t) => t.value == currentTheme.value).icon;
});
</script>
<template>
  <span ref="wrapperRef" style="display: contents">
    <BsNavMenu :icon="themeIcon" title="Toggle switcher" :buttonClass="buttonClass">
      <li v-for="t in themes" :key="t.value">
        <button
          v-if="t.value === 'color'"
          type="button"
          class="dropdown-item d-flex align-items-center"
          @click.stop="setTheme('color')"
          :class="{ active: currentTheme === 'color' }"
        >
          <span><FaIcon :icon="t.icon" :fixedwidth="true" /></span>
          <span class="ms-2">{{ t.title }}</span>
          <span v-if="currentTheme === 'color'" class="ms-auto"><font-awesome-icon icon="check" /></span>
        </button>
        <button
          v-else
          type="button"
          class="dropdown-item d-flex align-items-center"
          @click="setTheme(t.value)"
          :class="{ active: currentTheme == t.value }"
        >
          <span><FaIcon :icon="t.icon" :fixedwidth="true" /></span>
          <span class="ms-2">{{ t.title }}</span>
          <span v-if="currentTheme == t.value" class="ms-auto"><font-awesome-icon icon="check" /></span>
        </button>
      </li>
      <template v-if="showPalette">
        <li><hr class="dropdown-divider" /></li>
        <li class="px-3 py-2" @click.stop>
          <div class="color-palette">
            <button
              v-for="c in palette"
              :key="c.hex"
              type="button"
              class="color-swatch"
              :style="{ backgroundColor: c.hex }"
              :class="{ 'color-swatch-active': selectedColor === c.hex }"
              :title="c.label"
              @click="pickColor(c.hex)"
            >
              <FaIcon v-if="selectedColor === c.hex" icon="check" class="swatch-check" />
            </button>
          </div>
        </li>
      </template>
    </BsNavMenu>
  </span>
</template>
<style scoped lang="scss">
.color-palette {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
  min-width: 180px;
}
.color-swatch {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition:
    transform 0.15s,
    border-color 0.15s;
  &:hover {
    transform: scale(1.2);
    border-color: rgba(255, 255, 255, 0.5);
  }
}
.color-swatch-active {
  border-color: var(--bs-body-color);
  box-shadow: 0 0 0 2px var(--bs-body-bg);
}
.swatch-check {
  color: #fff;
  font-size: 0.65rem;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.5));
}
</style>
