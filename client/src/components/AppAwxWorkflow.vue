<script setup>
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';

/******************************************************************/
/*                                                                */
/*  Awx Workflow component                                        */
/*  Visualize an awx workflow job as a graph, similar to the      */
/*  awx workflow output view.  Nodes are painted by status        */
/*  (green=successful, red=failed, ...) and the links are         */
/*  painted by relation (success, failure, always)                */
/*                                                                */
/*  @props:                                                       */
/*      workflow: Object                                          */
/*        { id, name, status, nodes: [                            */
/*            { id, name, type, status, elapsed,                  */
/*              success_nodes, failure_nodes, always_nodes } ] }  */
/*                                                                */
/******************************************************************/

const props = defineProps({
  workflow: {
    type: Object,
    required: true,
  },
});

const { t } = useI18n();

// the graph at its size (scrolled sideways when wider than the panel), or shrunk to its width
const fit = ref(false);

// ─── full screen : zoom and pan ───────────────────────────────────────────────
// the graph's place and zoom in the window : moved by x, y and scaled by k
const stage = ref(null);
const view = ref({ x: 0, y: 0, k: 1 });
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const clampZoom = (k) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/**
 * Zooms around a point of the window, which stays where it is (the pointer, or the middle).
 *
 * Args:
 *   k (number): the new zoom.
 *   px (number): the point's x in the svg, by default its middle.
 *   py (number): the point's y in the svg, by default its middle.
 */
function zoomTo(k, px, py) {
  const r = stage.value?.getBoundingClientRect();
  if (!r) return;
  const x0 = px ?? r.width / 2;
  const y0 = py ?? r.height / 2;
  const { x, y, k: k0 } = view.value;
  const k1 = clampZoom(k);
  view.value = { k: k1, x: x0 - ((x0 - x) * k1) / k0, y: y0 - ((y0 - y) * k1) / k0 };
}

/**
 * Zooms in or out by a factor, around the middle.
 *
 * Args:
 *   factor (number): more than 1 zooms in.
 */
function zoomBy(factor) {
  zoomTo(view.value.k * factor);
}

/**
 * The whole graph in the window, in its middle : at actual size, or smaller when it is larger.
 */
function fitView() {
  const r = stage.value?.getBoundingClientRect();
  if (!r) return;
  const k = clampZoom(Math.min(1, (r.width - 48) / graph.value.width, (r.height - 48) / graph.value.height));
  view.value = { k, x: (r.width - graph.value.width * k) / 2, y: (r.height - graph.value.height * k) / 2 };
}

/**
 * The wheel zooms, around the pointer (full screen only : the page scrolls otherwise).
 *
 * Args:
 *   e (WheelEvent): the wheel turned.
 */
function onWheel(e) {
  if (!fullscreen.value) return;
  e.preventDefault();
  const r = stage.value.getBoundingClientRect();
  zoomTo(view.value.k * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}

// a drag moves the graph : where it started, and where the graph was then
const dragging = ref(false);
let dragStart = null;

/**
 * Starts a drag (full screen only).
 *
 * Args:
 *   e (PointerEvent): the button pressed.
 */
function onPointerDown(e) {
  if (!fullscreen.value || e.button !== 0) return;
  dragStart = { px: e.clientX, py: e.clientY, x: view.value.x, y: view.value.y };
}

/**
 * Moves the graph with the pointer : a drag once it went a few pixels (less is a click, on a
 * node it opens the node's output).
 *
 * Args:
 *   e (PointerEvent): the pointer moved.
 */
function onPointerMove(e) {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.px;
  const dy = e.clientY - dragStart.py;
  if (!dragging.value) {
    if (Math.hypot(dx, dy) < 4) return;
    dragging.value = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  view.value = { ...view.value, x: dragStart.x + dx, y: dragStart.y + dy };
}

// the click a drag ends with : not a click on a node
let justDragged = false;

/**
 * Ends a drag.
 */
function onPointerUp() {
  justDragged = dragging.value;
  setTimeout(() => (justDragged = false));
  dragging.value = false;
  dragStart = null;
}

// ─── a node's output ──────────────────────────────────────────────────────────
const emit = defineEmits(['node']);

/**
 * Whether a node has output to show : it ran (an AWX job of its own).
 *
 * Args:
 *   n (object): the node.
 *
 * Returns:
 *   boolean: true when it ran.
 */
function hasOutput(n) {
  return !!n.job && n.status !== 'skipped' && !n.do_not_run;
}

/**
 * A click on a node that ran : the page opens its output (not the click a drag ends with).
 *
 * Args:
 *   n (object): the node clicked.
 */
function openNode(n) {
  if (justDragged || !hasOutput(n)) return;
  emit('node', n);
}

// the panel over the whole window (its toolbar, the graph at full size), and back : Esc, the
// button or a click beside it closes it ; the page under it does not scroll meanwhile
const fullscreen = ref(false);
/**
 * Closes the full screen on Esc.
 *
 * Args:
 *   e (KeyboardEvent): the key pressed.
 */
function onKey(e) {
  // a dialog over the full screen (a node's output) closes first
  if (e.key === 'Escape' && !e.defaultPrevented) fullscreen.value = false;
}
watch(fullscreen, (on) => {
  // opened : the whole graph in the middle of the window
  if (on) nextTick(fitView);
  document.body.style.overflow = on ? 'hidden' : '';
  if (on) document.addEventListener('keydown', onKey);
  else document.removeEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
});

// layout constants
const NODE_W = 170;
const NODE_H = 52;
const GAP_X = 60;
const GAP_Y = 24;
const MARGIN = 15;
const START_W = 70;
const START_H = 32;

// node colors by awx job status
const statusColors = {
  successful: 'var(--bs-success)',
  failed: 'var(--bs-danger)',
  error: 'var(--bs-danger)',
  unreachable: 'var(--bs-danger)',
  running: 'var(--bs-primary)',
  canceled: 'var(--bs-warning)',
};
// link colors by relation type
const edgeColors = {
  success: 'var(--bs-success)',
  failure: 'var(--bs-danger)',
  always: 'var(--bs-info)',
  start: 'var(--bs-secondary)',
};

function statusColor(status) {
  return statusColors[status] || 'var(--bs-secondary)';
}

// a smooth bezier link between 2 points
function linkPath(x1, y1, x2, y2) {
  const dx = Math.max(30, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function truncate(s, len = 20) {
  return s && s.length > len ? s.slice(0, len - 1) + '…' : s;
}

// compute the graph layout (layered DAG, like the awx workflow visualizer)
const graph = computed(() => {
  const nodes = props.workflow?.nodes || [];
  const byId = {};
  nodes.forEach((n) => {
    byId[n.id] = n;
  });
  // collect the links
  const edges = [];
  nodes.forEach((n) => {
    (n.success_nodes || []).forEach((c) => byId[c] && edges.push({ from: n.id, to: c, type: 'success' }));
    (n.failure_nodes || []).forEach((c) => byId[c] && edges.push({ from: n.id, to: c, type: 'failure' }));
    (n.always_nodes || []).forEach((c) => byId[c] && edges.push({ from: n.id, to: c, type: 'always' }));
  });
  // roots are nodes without incoming links
  const hasParent = new Set(edges.map((e) => e.to));
  const roots = nodes.filter((n) => !hasParent.has(n.id));
  // depth = longest path from a root (relaxation, awx guarantees a DAG)
  const depth = {};
  nodes.forEach((n) => {
    depth[n.id] = 0;
  });
  for (let i = 0; i < nodes.length; i++) {
    let changed = false;
    edges.forEach((e) => {
      if (depth[e.from] + 1 > depth[e.to]) {
        depth[e.to] = depth[e.from] + 1;
        changed = true;
      }
    });
    if (!changed) break;
  }
  // group the nodes in columns by depth
  const columns = {};
  nodes.forEach((n) => {
    (columns[depth[n.id]] = columns[depth[n.id]] || []).push(n);
  });
  const maxDepth = Math.max(0, ...Object.keys(columns).map(Number));
  const maxRows = Math.max(1, ...Object.values(columns).map((c) => c.length));
  const height = MARGIN * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y;
  const width = MARGIN * 2 + START_W + GAP_X + (maxDepth + 1) * NODE_W + maxDepth * GAP_X;
  // position the nodes, each column vertically centered
  const pos = {};
  Object.entries(columns).forEach(([d, list]) => {
    list.sort((a, b) => a.id - b.id);
    const colH = list.length * NODE_H + (list.length - 1) * GAP_Y;
    const y0 = (height - colH) / 2;
    list.forEach((n, i) => {
      pos[n.id] = {
        x: MARGIN + START_W + GAP_X + Number(d) * (NODE_W + GAP_X),
        y: y0 + i * (NODE_H + GAP_Y),
      };
    });
  });
  const start = { x: MARGIN, y: height / 2 - START_H / 2 };
  // build the link paths
  const links = edges.map((e) => ({
    type: e.type,
    d: linkPath(pos[e.from].x + NODE_W, pos[e.from].y + NODE_H / 2, pos[e.to].x, pos[e.to].y + NODE_H / 2),
  }));
  roots.forEach((r) => {
    links.push({
      type: 'start',
      d: linkPath(start.x + START_W, start.y + START_H / 2, pos[r.id].x, pos[r.id].y + NODE_H / 2),
    });
  });
  return {
    nodes: nodes.map((n) => ({ ...n, ...pos[n.id] })),
    links,
    width,
    height,
    start,
  };
});
</script>
<template>
  <!-- a panel as the job's output : its toolbar on top - what it is at the left, the legend and
       the fit at the right - and the graph under it, scrolled sideways when it is wider -->
  <!-- full screen : the panel lifted over the page (teleported, so no card clips it), a dimmed
       backdrop under it -->
  <Teleport to="body" :disabled="!fullscreen">
    <div v-if="fullscreen" class="awx-workflow-backdrop" @click="fullscreen = false" />
    <div class="awx-workflow" :class="{ 'awx-fullscreen': fullscreen }" :role="fullscreen ? 'dialog' : null">
      <div class="awx-workflow-toolbar">
        <div class="awx-workflow-label">
          <FaIcon icon="diagram-project" />
          <span>{{ t('workflow.title') }}</span>
          <span class="awx-workflow-count">{{ t('workflow.nodes', { count: workflow.nodes?.length || 0 }) }}</span>
        </div>
        <div class="awx-workflow-tools">
          <span class="awx-workflow-legend"
            ><span class="legend-line" :style="{ background: edgeColors.success }"></span
            >{{ t('workflow.onSuccess') }}</span
          >
          <span class="awx-workflow-legend"
            ><span class="legend-line" :style="{ background: edgeColors.failure }"></span
            >{{ t('workflow.onFailure') }}</span
          >
          <span class="awx-workflow-legend"
            ><span class="legend-line" :style="{ background: edgeColors.always }"></span
            >{{ t('workflow.always') }}</span
          >
          <span class="awx-tool-sep" />
          <!-- full screen : zoom out, the zoom (a click : actual size), zoom in, the whole graph -->
          <template v-if="fullscreen">
            <button
              type="button"
              class="awx-tool-btn awx-tool-icon"
              :aria-label="t('workflow.zoomOut')"
              :title="t('workflow.zoomOut')"
              @click="zoomBy(1 / 1.25)"
            >
              <FaIcon icon="minus" />
            </button>
            <button type="button" class="awx-tool-btn awx-zoom" :title="t('workflow.actualSize')" @click="zoomTo(1)">
              {{ Math.round(view.k * 100) }}%
            </button>
            <button
              type="button"
              class="awx-tool-btn awx-tool-icon"
              :aria-label="t('workflow.zoomIn')"
              :title="t('workflow.zoomIn')"
              @click="zoomBy(1.25)"
            >
              <FaIcon icon="plus" />
            </button>
            <button type="button" class="awx-tool-btn" @click="fitView()">
              <FaIcon icon="arrows-left-right-to-line" />{{ t('workflow.fitScreen') }}
            </button>
          </template>
          <button
            v-else
            type="button"
            class="awx-tool-btn"
            :class="{ active: fit }"
            :aria-pressed="fit"
            @click="fit = !fit"
          >
            <FaIcon icon="arrows-left-right-to-line" />{{ t('workflow.fit') }}
          </button>
          <button
            type="button"
            class="awx-tool-btn awx-tool-icon"
            :title="fullscreen ? t('workflow.exitFullscreen') : t('workflow.fullscreen')"
            :aria-label="fullscreen ? t('workflow.exitFullscreen') : t('workflow.fullscreen')"
            @click="fullscreen = !fullscreen"
          >
            <FaIcon :icon="fullscreen ? 'compress' : 'expand'" />
          </button>
        </div>
      </div>
      <!-- the room around the graph, outside its scrolling box : the scrollbar (when it shows)
         as far from the panel's edge as the graph is from its top -->
      <div class="awx-workflow-body">
        <div class="awx-workflow-scroll" :class="{ 'awx-fit': fit }">
          <!-- full screen : the svg the window's size, the graph in it moved and zoomed (a
               group's transform) - the wheel zooms around the pointer, a drag moves it -->
          <svg
            ref="stage"
            :class="{ 'awx-stage': fullscreen, 'awx-dragging': dragging }"
            :width="fullscreen || fit ? '100%' : graph.width"
            :height="fullscreen ? '100%' : fit ? null : graph.height"
            :viewBox="fullscreen ? null : `0 0 ${graph.width} ${graph.height}`"
            preserveAspectRatio="xMinYMid meet"
            @wheel="onWheel"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <g :transform="fullscreen ? `translate(${view.x} ${view.y}) scale(${view.k})` : null">
              <!-- links -->
              <path
                v-for="(l, i) in graph.links"
                :key="'link' + i"
                :d="l.d"
                fill="none"
                :stroke="edgeColors[l.type]"
                stroke-width="2"
                opacity="0.8"
              />
              <!-- start node -->
              <g>
                <rect
                  :x="graph.start.x"
                  :y="graph.start.y"
                  :width="START_W"
                  :height="START_H"
                  :rx="START_H / 2"
                  class="awx-start"
                />
                <text
                  :x="graph.start.x + START_W / 2"
                  :y="graph.start.y + START_H / 2 + 4"
                  text-anchor="middle"
                  class="awx-start-text"
                >
                  START
                </text>
              </g>
              <!-- workflow nodes -->
              <g
                v-for="n in graph.nodes"
                :key="n.id"
                class="awx-node"
                :class="{ 'awx-node-open': hasOutput(n) }"
                @click="openNode(n)"
              >
                <rect
                  :x="n.x"
                  :y="n.y"
                  :width="NODE_W"
                  :height="NODE_H"
                  rx="6"
                  class="awx-node-rect"
                  :style="{ stroke: statusColor(n.status) }"
                  :stroke-dasharray="n.status == 'skipped' || n.do_not_run ? '4 3' : null"
                />
                <circle
                  :cx="n.x + 14"
                  :cy="n.y + NODE_H / 2"
                  r="5"
                  :fill="statusColor(n.status)"
                  :class="{ 'awx-pulse': n.status == 'running' }"
                />
                <text :x="n.x + 26" :y="n.y + 22" class="awx-node-name">{{ truncate(n.name) }}</text>
                <text :x="n.x + 26" :y="n.y + 40" class="awx-node-status" :style="{ fill: statusColor(n.status) }">
                  {{ n.status }}
                  <template v-if="n.elapsed > 0">· {{ Math.round(n.elapsed) }}s</template>
                </text>
                <title>{{ n.name }} ({{ n.status }})</title>
              </g>
            </g>
          </svg>
        </div>
      </div>
    </div>
  </Teleport>
</template>
<style lang="scss" scoped>
/* full screen : the window's width and height but a margin, over a dimmed page */
.awx-workflow-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1055;
  background: rgba(0, 0, 0, 0.5);
}
.awx-workflow.awx-fullscreen {
  position: fixed;
  inset: 1.5rem;
  z-index: 1056;
  display: flex;
  flex-direction: column;
  margin: 0;
  box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.3);
  .awx-workflow-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
  /* the graph : the whole of the panel's body, moved by a drag and zoomed by the wheel */
  .awx-workflow-body {
    padding: 0;
  }
  .awx-workflow-scroll {
    flex: 1 1 auto;
    overflow: hidden;
    padding: 0;
    background: none;
  }
  .awx-stage {
    display: block;
    cursor: grab;
    touch-action: none;
    user-select: none;
    &.awx-dragging {
      cursor: grabbing;
    }
  }
  /* its header : a dialog's, larger than the panel's on the page */
  .awx-workflow-toolbar {
    padding: 0.625rem 0.75rem 0.625rem 1.25rem;
  }
  .awx-workflow-label {
    font-size: 1.125rem;
    gap: 0.625rem;
  }
  .awx-workflow-count {
    font-size: 0.9375rem;
  }
  .awx-workflow-tools {
    font-size: 0.9375rem;
  }
  .awx-zoom {
    min-width: 3.5rem;
    justify-content: center;
    font-variant-numeric: tabular-nums;
  }
}
.awx-workflow {
  margin-bottom: 1.25rem;
  border: 1px solid var(--af-field-border);
  border-radius: 0.5rem;
  overflow: hidden;
  background-color: var(--af-bg-light-subtle-color, var(--bs-body-bg));

  /* the toolbar : as the job output's */
  .awx-workflow-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem 0.375rem 1rem;
    border-bottom: 1px solid var(--af-field-border);
    background: var(--bs-tertiary-bg);
  }
  .awx-workflow-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    font-size: 0.875rem;
  }
  .awx-workflow-count {
    font-weight: 400;
    font-size: 0.8rem;
    color: var(--bs-secondary-color);
  }
  .awx-workflow-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.8125rem;
    color: var(--bs-secondary-color);
  }
  .awx-tool-sep {
    width: 1px;
    height: 1.25rem;
    background: var(--af-field-border);
  }
  .awx-tool-icon {
    padding: 0.3rem 0.5rem;
  }
  .awx-tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--bs-body-color);
    &:hover {
      background: var(--bs-secondary-bg);
    }
    &.active {
      border-color: var(--bs-primary-border-subtle);
      background: var(--bs-primary-bg-subtle);
      color: var(--bs-primary-text-emphasis);
    }
  }

  /* the graph : scrolled sideways, a soft shade at an edge with more of it beyond (the shades
     ride on the content's edges : they show only where it is cut) */
  /* the room around the graph : as much under it (above the scrollbar) as over it, and the
     scrollbar, when it shows, as far again from the panel's edge */
  .awx-workflow-body {
    padding: 1rem;
  }
  .awx-workflow-scroll {
    overflow-x: auto;
    padding-bottom: 1rem;
    background:
      linear-gradient(to right, var(--af-bg-light-subtle-color), transparent) left / 2.5rem 100% no-repeat local,
      linear-gradient(to left, var(--af-bg-light-subtle-color), transparent) right / 2.5rem 100% no-repeat local,
      radial-gradient(farthest-side at 0 50%, rgba(0, 0, 0, 0.14), transparent) left / 0.75rem 100% no-repeat scroll,
      radial-gradient(farthest-side at 100% 50%, rgba(0, 0, 0, 0.14), transparent) right / 0.75rem 100% no-repeat scroll;
    svg {
      display: block;
    }
    &.awx-fit {
      overflow-x: hidden;
    }
  }

  .legend-line {
    display: inline-block;
    width: 18px;
    height: 3px;
    border-radius: 2px;
    vertical-align: middle;
    margin-right: 5px;
  }

  .awx-start {
    fill: var(--bs-secondary);
  }

  .awx-start-text {
    fill: var(--bs-light);
    font-size: 0.7rem;
    font-weight: bold;
    letter-spacing: 1px;
  }

  /* a node that ran : a click opens its output */
  .awx-node-open {
    cursor: pointer;
    &:hover .awx-node-rect {
      fill: var(--af-row-hover-bg);
    }
  }
  .awx-node-rect {
    fill: var(--bs-body-bg);
    stroke-width: 2;
  }

  .awx-node-name {
    fill: var(--bs-body-color);
    font-size: 0.8rem;
    font-weight: 600;
  }

  .awx-node-status {
    font-size: 0.7rem;
  }

  .awx-pulse {
    animation: awx-pulse 1.5s ease-in-out infinite;
  }

  @keyframes awx-pulse {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
    100% {
      opacity: 1;
    }
  }
}
</style>
