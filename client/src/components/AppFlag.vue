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
  pl: ['h', ['#ffffff', '#dc143c']], // two equal stripes, white over red
  es: ['h', ['#aa151b', '#f1bf00', '#f1bf00', '#aa151b']], // the middle band is twice as wide
  // the Senyera: nine equal stripes, five yellow and four red, yellow at top and bottom
  ca: ['h', ['#fcdd09', '#da121a', '#fcdd09', '#da121a', '#fcdd09', '#da121a', '#fcdd09', '#da121a', '#fcdd09']],
};

// the points of a five-pointed star centred on (cx, cy), with outer radius r, its first point
// at `angle` radians (screen coordinates: -PI/2 points straight up)
function starPoints(cx, cy, r, angle = -Math.PI / 2) {
  const inner = r * 0.382; // the inner radius of a regular five-pointed star
  const points = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : inner;
    const a = angle + (i * Math.PI) / 5;
    points.push(`${(cx + radius * Math.cos(a)).toFixed(2)},${(cy + radius * Math.sin(a)).toFixed(2)}`);
  }
  return points.join(' ');
}

// china: one large star in the upper hoist, four small ones in an arc, each pointing at its centre
const CHINA_BIG_STAR = starPoints(10, 10, 6);
const CHINA_SMALL_STARS = [
  [20, 4],
  [24, 8],
  [24, 14],
  [20, 18],
].map(([x, y]) => starPoints(x, y, 2, Math.atan2(10 - y, 10 - x)));
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
    <!-- portugal: green and red split at 2/5, with a simplified sphere and shield on the boundary -->
    <g v-else-if="code === 'pt'">
      <rect width="60" height="40" fill="#ff0000" />
      <rect width="24" height="40" fill="#006600" />
      <circle cx="24" cy="20" r="8" fill="none" stroke="#ffcc00" stroke-width="2.5" />
      <rect x="21" y="16.5" width="6" height="7" rx="1" fill="#ffffff" stroke="#ff0000" stroke-width="1.2" />
    </g>
    <!-- japan: a red disc, 3/5 of the height across, centred on a white field -->
    <g v-else-if="code === 'ja'">
      <rect width="60" height="40" fill="#ffffff" />
      <circle cx="30" cy="20" r="12" fill="#bc002d" />
    </g>
    <!-- china: red field, a large yellow star and four small ones in the upper hoist -->
    <g v-else-if="code === 'zh'">
      <rect width="60" height="40" fill="#ee1c25" />
      <polygon :points="CHINA_BIG_STAR" fill="#ffff00" />
      <polygon v-for="(points, i) in CHINA_SMALL_STARS" :key="i" :points="points" fill="#ffff00" />
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
