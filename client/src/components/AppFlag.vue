<script setup>
/******************************************************************/
/*                                                                */
/*  App Flag component                                            */
/*  A small flag for a UI language, drawn as an inline svg :      */
/*  Windows does not render flag emoji, so they cannot be used    */
/*                                                                */
/*  @props:                                                       */
/*      code: String (language code, see config/languages.js)     */
/*                                                                */
/******************************************************************/

defineProps({
  code: {
    type: String,
    required: true,
  },
});

// stripes per language: [direction, colors] - the union jack is drawn separately
const STRIPES = {
  nl: ['h', ['#ae1c28', '#ffffff', '#21468b']],
  de: ['h', ['#000000', '#dd0000', '#ffce00']],
  fr: ['v', ['#002654', '#ffffff', '#ce1126']],
  it: ['v', ['#009246', '#ffffff', '#ce2b37']],
  es: ['h', ['#aa151b', '#f1bf00', '#f1bf00', '#aa151b']], // the middle band is twice as wide
  // the Senyera: nine equal stripes, five yellow and four red, yellow at top and bottom
  ca: ['h', ['#fcdd09', '#da121a', '#fcdd09', '#da121a', '#fcdd09', '#da121a', '#fcdd09', '#da121a', '#fcdd09']],
};
</script>

<template>
  <svg class="af-flag" viewBox="0 0 60 40" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <!-- united kingdom -->
    <g v-if="code === 'en'">
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#ffffff" stroke-width="8" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#c8102e" stroke-width="3" />
      <path d="M30,0 V40 M0,20 H60" stroke="#ffffff" stroke-width="12" />
      <path d="M30,0 V40 M0,20 H60" stroke="#c8102e" stroke-width="7" />
    </g>
    <!-- striped flags -->
    <g v-else-if="STRIPES[code]">
      <template v-for="(color, i) in STRIPES[code][1]" :key="i">
        <rect
          v-if="STRIPES[code][0] === 'h'"
          x="0"
          :y="(40 / STRIPES[code][1].length) * i"
          width="60"
          :height="40 / STRIPES[code][1].length + 0.5"
          :fill="color"
        />
        <rect
          v-else
          :x="(60 / STRIPES[code][1].length) * i"
          y="0"
          :width="60 / STRIPES[code][1].length + 0.5"
          height="40"
          :fill="color"
        />
      </template>
    </g>
    <!-- unknown language: a neutral placeholder -->
    <rect v-else width="60" height="40" fill="#adb5bd" />
  </svg>
</template>

<style scoped>
.af-flag {
  width: 1.35em;
  height: 0.9em;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12);
  vertical-align: -0.1em;
  flex-shrink: 0;
}
</style>
