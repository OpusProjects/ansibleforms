<script setup>
import { computed } from 'vue';
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

// badge class for the workflow status
const statusBadges = {
  successful: 'text-bg-success',
  failed: 'text-bg-danger',
  error: 'text-bg-danger',
  running: 'text-bg-info',
  canceled: 'text-bg-warning',
};
function statusBadge(status) {
  return statusBadges[status] || 'text-bg-secondary';
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
  <div class="awx-workflow card p-3 mb-3">
    <div class="d-flex justify-content-between align-items-center flex-wrap mb-2">
      <h5 class="mb-0">
        {{ workflow.name }}
        <sup
          ><span class="badge rounded-pill" :class="statusBadge(workflow.status)">{{ workflow.status }}</span></sup
        >
      </h5>
      <div class="awx-workflow-legend small text-body-secondary">
        <span class="me-3"
          ><span class="legend-line" :style="{ background: edgeColors.success }"></span
          >{{ t('workflow.onSuccess') }}</span
        >
        <span class="me-3"
          ><span class="legend-line" :style="{ background: edgeColors.failure }"></span
          >{{ t('workflow.onFailure') }}</span
        >
        <span
          ><span class="legend-line" :style="{ background: edgeColors.always }"></span>{{ t('workflow.always') }}</span
        >
      </div>
    </div>
    <div class="awx-workflow-scroll">
      <svg :width="graph.width" :height="graph.height" :viewBox="`0 0 ${graph.width} ${graph.height}`">
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
        <g v-for="n in graph.nodes" :key="n.id" class="awx-node">
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
      </svg>
    </div>
  </div>
</template>
<style lang="scss" scoped>
.awx-workflow {
  background-color: var(--af-bg-light-subtle-color, var(--bs-body-bg));

  .awx-workflow-scroll {
    overflow-x: auto;
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
