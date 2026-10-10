<script setup>
import { computed, ref } from 'vue';

/******************************************************************/
/*                                                                */
/*  Ansible Output component                                      */
/*  Pretty print Ansible output                                   */
/*  Classes are old bulma classes                                 */
/*  But restyled to match the new bootstrap 5 design              */
/*                                                                */
/*  @props:                                                       */
/*      output: String                                            */
/*      jobLog: String (may contain ANSI color codes)             */
/*      numbered: Boolean - a line number on the left of each    */
/*                line, and a caret on each PLAY and TASK that   */
/*                folds its lines away (a job's page) ; an AWX   */
/*                workflow's nodes each their own card           */
/*      workflow: Object - the workflow's graph, for the cards'  */
/*                run times                                       */
/*                                                                */
/******************************************************************/

const props = defineProps({
  output: {
    type: String,
    required: true,
  },
  jobLog: {
    type: String,
    required: false,
  },
  numbered: {
    type: Boolean,
    default: false,
  },
  // the sections' copy button's tooltip (numbered)
  copyLabel: {
    type: String,
    default: 'Copy',
  },
  // the job's own card's title (numbered) : the playbook, or the AWX job template
  title: {
    type: String,
    default: '',
  },
  // an AWX workflow's graph (job.awx_workflow) : each node's run time on its card
  workflow: {
    type: Object,
    default: null,
  },
});

// ─── numbered : the output as lines, the PLAYs and TASKs foldable ────────────

/**
 * The span tags a line leaves open : carried into the next line (a colour that runs over
 * several lines), each line its own well-formed HTML.
 *
 * Args:
 *   html (string): the line, with the tags carried from the lines before it.
 *   open (string[]): the opening tags still open before it.
 *
 * Returns:
 *   string[]: the opening tags still open after it.
 */
function openSpans(html, open) {
  const stack = [...open];
  for (const m of html.matchAll(/<span\b[^>]*>|<\/span>/gi)) {
    if (m[0][1] === '/') stack.pop();
    else stack.push(m[0]);
  }
  return stack;
}

// parsed in an inert template : nothing in it runs or loads, its text read as the browser does
const parser = typeof document !== 'undefined' ? document.createElement('template') : null;

/**
 * A line's text, its tags left out.
 *
 * Args:
 *   html (string): the line.
 *
 * Returns:
 *   string: its text, trimmed.
 */
function plain(html) {
  if (!parser) return '';
  parser.innerHTML = html;
  return (parser.content.textContent || '').trim();
}

/**
 * The level of a line that starts a section : 1 an AWX workflow's node (or its summary), 2 a PLAY (or the
 * recap), 3 a TASK (or a handler), 0 for any other line.
 *
 * Args:
 *   html (string): the line.
 *
 * Returns:
 *   number: its level.
 */
function headLevel(html) {
  const text = plain(html);
  // a workflow's banners (a node's output, the summary at the end) carry a row of stars ; the
  // summary's own line per node does not, and stays a plain line
  if (/^WORKFLOW( NODE)? \[.*\] \([^)]*\) \*{5,}/.test(text)) return 1;
  if (/^(PLAY \[|PLAY RECAP)/.test(text)) return 2;
  if (/^(TASK|RUNNING HANDLER) \[/.test(text)) return 3;
  return 0;
}

// the lines : their HTML (each one well formed), their level, and the end of their section
const lines = computed(() => {
  if (!props.numbered) return [];
  const raw = (props.output || '').split(/<br\s*\/?>|\r?\n/i);
  while (raw.length && !plain(raw[raw.length - 1])) raw.pop();
  let open = [];
  const out = raw.map((line) => {
    const html = open.join('') + line;
    open = openSpans(line, open);
    return { html: html + '</span>'.repeat(open.length), level: headLevel(line), end: 0 };
  });
  // each section ends before the next head of its level or above
  out.forEach((line, i) => {
    if (!line.level) return;
    let j = i + 1;
    while (j < out.length && !(out[j].level && out[j].level <= line.level)) j++;
    line.end = j;
  });
  // a summary (a PLAY RECAP, a workflow's summary) holds its own lines only - a host's counts,
  // a node's status : the line after them (the job's closing line) is not the summary's
  out.forEach((line, i) => {
    const text = plain(line.html);
    const own = /^PLAY RECAP/.test(text)
      ? /^\S.*\s:\s+ok=\d+/
      : /^WORKFLOW \[/.test(text) && line.level === 1
        ? /^WORKFLOW NODE \[/
        : null;
    if (!own) return;
    let j = i + 1;
    while (j < line.end && (!plain(out[j].html) || own.test(plain(out[j].html)))) j++;
    line.end = j;
  });
  return out;
});

// the folded sections, by their head line's index
const folded = ref(new Set());

/**
 * Folds or unfolds a section.
 *
 * Args:
 *   i (number): its head line's index.
 */
function toggle(i) {
  const next = new Set(folded.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  folded.value = next;
}

/**
 * A workflow card's header, read from its head line : an AWX workflow's node (WORKFLOW NODE
 * [name] (status)) or its summary (WORKFLOW [name] (status)).
 *
 * Args:
 *   line (object): the head line, with its index and its section's end.
 *
 * Returns:
 *   object: { name, kind, status, elapsed } - kind 'node' or 'summary' ; elapsed in
 *   seconds from the workflow's graph, or null.
 */
function headerOf(line) {
  const text = plain(line.html);
  const m = text.match(/^WORKFLOW( NODE)? \[(.*)\] \(([^)]*)\)/);
  if (m) {
    // the summary at the end (WORKFLOW, not WORKFLOW NODE) : the whole workflow
    const summary = !m[1];
    const graphNode = summary ? null : props.workflow?.nodes?.find((n) => n.name === m[2]);
    return {
      name: m[2],
      kind: summary ? 'summary' : 'node',
      // AWX's words as the app's own (its pills' labels) : successful a success, canceled aborted
      status: { successful: 'success', canceled: 'aborted' }[m[3]] ?? m[3],
      elapsed: graphNode?.elapsed > 0 ? graphNode.elapsed : null,
    };
  }
  return { name: text, kind: 'node', status: '', elapsed: null };
}

/**
 * A run time in seconds, short : 12s, 3m 04s.
 *
 * Args:
 *   seconds (number): the seconds.
 *
 * Returns:
 *   string: the run time.
 */
function shortDuration(seconds) {
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

// a section's lines copied : handed to the page, which copies them as its Copy Output does
const emit = defineEmits(['copy']);

/**
 * Hands a section's lines to the page as plain text : no colours, no line numbers.
 *
 * Args:
 *   node (object): the section's header - its first line's index (-1 : the job's own card,
 *     from its start) and its end.
 */
function copySection(node) {
  const from = node.index < 0 ? run.value.start : node.index + 1;
  const html = lines.value
    .slice(from, node.end)
    .map((l) => l.html)
    .join('<br>');
  const text = new DOMParser().parseFromString(html.replace(/<br>/g, '\n'), 'text/html').body.textContent || '';
  emit('copy', text);
}

// every foldable head : the sections with lines under them, and the job's own card (-1)
const foldable = computed(() => {
  const heads = lines.value.flatMap((l, i) => (l.level && l.end > i + 1 ? [i] : []));
  return run.value ? [-1, ...heads] : heads;
});
// all folded : the toolbar's toggle then expands
const allFolded = computed(() => foldable.value.length > 0 && foldable.value.every((i) => folded.value.has(i)));

/**
 * Folds every section, PLAY and TASK : an overview of the run.
 */
function collapseAll() {
  folded.value = new Set(foldable.value);
}

/**
 * Unfolds everything.
 */
function expandAll() {
  folded.value = new Set();
}

/**
 * A workflow node's output, as the HTML its section holds : its banner and its lines.
 *
 * Args:
 *   name (string): the node's name.
 *
 * Returns:
 *   string|null: its lines (joined by <br>), or null when it has none.
 */
function nodeOutput(name) {
  const head = lines.value.find(
    (l) => l.level === 1 && /^WORKFLOW NODE \[/.test(plain(l.html)) && headerOf(l).name === name,
  );
  if (!head) return null;
  const i = lines.value.indexOf(head);
  return lines.value
    .slice(i, head.end)
    .map((l) => l.html)
    .join('<br>');
}

// the job page's toolbar folds and unfolds it all ; the workflow's graph shows a node's output
defineExpose({ collapseAll, expandAll, allFolded, nodeOutput });

// the lines shown : those inside a folded section left out
const shown = computed(() => {
  const result = [];
  for (let i = 0; i < lines.value.length; i++) {
    const line = lines.value[i];
    result.push({ ...line, index: i });
    if (line.level && folded.value.has(i)) i = line.end - 1;
  }
  return result;
});

/**
 * Whether a line is AnsibleForms' own (the run's start and end : ok: [Running on RTE ...],
 * ok: [AWX job 4821 created, tracking]) rather than the playbook's - its brackets hold words,
 * where a playbook's ok: [host] holds a host.
 *
 * Args:
 *   line (object): the line.
 *
 * Returns:
 *   boolean: true when it is AnsibleForms' own.
 */
function ownLine(line) {
  return /^ok: \[[^\]]*\s[^\]]*\]/.test(plain(line.html));
}

// the job's own card (a playbook, an AWX job template) : its lines, its header and its status
const run = computed(() => {
  const all = lines.value;
  if (!all.length || all.some((l) => l.level === 1)) return null;
  // its start : after AnsibleForms' own lines (and the blank ones among them)
  let start = 0;
  while (start < all.length && (ownLine(all[start]) || !plain(all[start].html))) start++;
  // its end : after the recap's own lines, else the output's end
  const recap = all.findIndex((l) => /^PLAY RECAP/.test(plain(l.html)));
  const end = recap >= 0 ? all[recap].end : all.length;
  if (start >= end) return null;
  // its status : failed when a host failed or was unreachable in the recap
  let status = '';
  if (recap >= 0) {
    const counts = all.slice(recap + 1, end).map((l) => plain(l.html));
    status = counts.some((c) => /(failed|unreachable)=[1-9]/.test(c)) ? 'failed' : 'success';
  }
  return { start, end, status };
});

// the shown lines in cards : an AWX workflow's nodes (and its summary) each a card, its head
// line the card's header ; else the job's own card (its PLAYs, TASKs and recap folding inside).
// The lines before the first card, and those after the last (the job's closing line), a framed
// group of their own
const groups = computed(() => {
  if (run.value) {
    const { start, end, status } = run.value;
    const before = shown.value.filter((l) => l.index < start);
    const inside = folded.value.has(-1) ? [] : shown.value.filter((l) => l.index >= start && l.index < end);
    const after = shown.value.filter((l) => l.index >= end);
    const node = { name: props.title, kind: 'job', status, elapsed: null, index: -1, end, count: end - start };
    return [
      { node: null, lines: before },
      { node, lines: inside },
      { node: null, lines: after },
    ].filter((g) => g.node || g.lines.length);
  }
  const result = [{ node: null, lines: [] }];
  for (const line of shown.value) {
    const current = result[result.length - 1];
    if (line.level === 1) {
      result.push({
        node: { ...headerOf(line), index: line.index, end: line.end, count: line.end - line.index - 1 },
        lines: [],
      });
    } else if (current.node && line.index >= current.node.end) {
      result.push({ node: null, lines: [line] });
    } else {
      current.lines.push(line);
    }
  }
  return result.filter((g) => g.node || g.lines.length);
});

// Convert ANSI escape codes to HTML <span> tags for browser rendering
function ansiToHtml(text) {
  if (!text) return '';
  // Escape HTML special chars first (before inserting our own span tags)
  let result = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const colorMap = {
    90: 'color:#888', // GRAY
    91: 'color:#e74c3c', // RED
    92: 'color:#2ecc71', // GREEN
    93: 'color:#f1c40f', // YELLOW
    94: 'color:#3498db', // BLUE
    95: 'color:#9b59b6', // MAGENTA
    96: 'color:#1abc9c', // CYAN
    97: 'color:#ecf0f1', // WHITE
  };
  // Process sequentially, tracking open span depth so RESET closes ALL open spans
  let openSpans = 0;
  // eslint-disable-next-line no-control-regex -- \x1B is the ANSI escape byte we are parsing
  result = result.replace(/\x1B\[([0-9;]*)m/g, (_match, code) => {
    if (code === '0' || code === '') {
      // Reset — close every open span at once
      const close = '</span>'.repeat(openSpans);
      openSpans = 0;
      return close;
    }
    const style = colorMap[code];
    if (style) {
      openSpans++;
      return `<span style="${style}">`;
    }
    return '';
  });
  // Close any spans still open at end of string
  if (openSpans > 0) result += '</span>'.repeat(openSpans);
  // Strip any remaining unrecognised ANSI sequences
  // eslint-disable-next-line no-control-regex -- \x1B is the ANSI escape byte we are parsing
  result = result.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  return result;
}

const jobLogHtml = computed(() => ansiToHtml(props.jobLog));
</script>
<template>
  <slot name="title"></slot>
  <!-- numbered : each line its number, each PLAY and TASK a caret that folds it ; an AWX
       workflow's nodes each a card, its header folding it -->
  <div v-if="numbered" class="af-ansible-groups" :class="{ 'af-ansible-has-nodes': groups.some((g) => g.node) }">
    <div
      v-for="group in groups"
      :key="group.node ? group.node.index : 'lines' + group.lines[0].index"
      :class="{ 'af-node-card': group.node }"
    >
      <!-- a section's header : folds it (click, Enter, Space) ; its copy button copies its lines -->
      <div
        v-if="group.node"
        class="af-node-head"
        role="button"
        tabindex="0"
        :aria-expanded="!folded.has(group.node.index)"
        @click="toggle(group.node.index)"
        @keydown.enter.self.prevent="toggle(group.node.index)"
        @keydown.space.self.prevent="toggle(group.node.index)"
      >
        <FaIcon :icon="folded.has(group.node.index) ? 'chevron-right' : 'chevron-down'" class="af-node-chevron" />
        <FaIcon v-if="group.node.kind == 'summary'" icon="flag-checkered" class="af-node-flag" />
        <FaIcon v-else-if="group.node.kind == 'job'" icon="scroll" class="af-node-flag" />
        <span class="af-node-name">{{ group.node.name }}</span>
        <AppStatusPill v-if="group.node.status" :status="group.node.status" />
        <span class="af-node-meta">
          <span v-if="group.node.elapsed"><FaIcon icon="stopwatch" />{{ shortDuration(group.node.elapsed) }}</span>
          <span><FaIcon icon="list-ol" />{{ group.node.count }}</span>
          <button
            type="button"
            class="af-node-copy"
            :title="copyLabel"
            :aria-label="copyLabel"
            @click.stop="copySection(group.node)"
          >
            <FaIcon icon="copy" />
          </button>
        </span>
      </div>
      <div v-if="group.lines.length" class="ansible af-ansible-lines">
        <div
          v-for="line in group.lines"
          :key="line.index"
          class="af-ansible-line"
          :class="{ 'af-ansible-head': line.level }"
        >
          <span class="af-ansible-no">{{ line.index + 1 }}</span>
          <span class="af-ansible-fold">
            <button
              v-if="line.level && line.end > line.index + 1"
              type="button"
              class="af-ansible-caret"
              :aria-expanded="!folded.has(line.index)"
              @click="toggle(line.index)"
            >
              <FaIcon :icon="folded.has(line.index) ? 'caret-right' : 'caret-down'" />
            </button>
          </span>
          <span class="af-ansible-text"
            ><span v-html="line.html"></span
            ><span v-if="folded.has(line.index)" class="af-ansible-more" @click="toggle(line.index)">{{
              line.end - line.index - 1
            }}</span></span
          >
        </div>
      </div>
    </div>
  </div>
  <div v-else class="ansible" v-html="output"></div>
  <div v-if="jobLog" class="logfile">
    <div class="logfile-title">Logfile</div>
    <pre class="logfile-content" v-html="jobLogHtml"></pre>
  </div>
</template>
<style lang="scss">
.has-text-weight-bold {
  font-weight: bold;
}

.ansible {
  font-family: monospace;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 0.8rem;
  padding: 1rem;
  margin-bottom: 1rem;
  /* the fields' darker border, as the inputs and a repository's output */
  border: 1px solid var(--af-field-border);
  border-radius: 5px;
  background-color: var(--af-output-bg);

  span {
    &.tag {
      display: inline-block !important;
      padding: 0 0.2rem;
      border-radius: 3px;
      &.is-info {
        background-color: var(--af-ansible-output-bg-timestamp) !important;
        color: var(--af-ansible-output-timestamp) !important;
      }
      &.is-warning {
        background-color: var(--af-ansible-output-warning) !important;
        color: var(--bs-light) !important;
      }
      &.is-danger {
        background-color: var(--af-ansible-output-danger) !important;
        color: var(--bs-light) !important;
      }
      &.is-purple {
        background-color: var(--af-ansible-output-purple) !important;
        color: var(--bs-light) !important;
      }
      &.is-success {
        background-color: var(--af-ansible-output-success) !important;
        color: var(--bs-light) !important;
      }
    }
  }

  .has-text-danger {
    color: var(--af-ansible-output-danger) !important;
  }

  /* the -text-* variants, not the saturated ones used for the tag backgrounds :
           #198754 / #ff8800 as text on the pane background fail WCAG AA */
  .has-text-success {
    color: var(--af-ansible-output-text-success) !important;
  }

  .has-text-warning {
    color: var(--af-ansible-output-text-warning) !important;
  }

  /* a skipping, included or ignoring line : blue, as ansible prints it (its cyan) */
  .has-text-info {
    color: var(--af-ansible-output-text-info) !important;
  }

  /* a warning or deprecation : ansible's purple */
  .has-text-purple {
    color: var(--af-ansible-output-text-purple) !important;
  }

  /* a retry : ansible's grey */
  .has-text-muted {
    color: var(--bs-secondary-color) !important;
  }
}
.af-ansible-lines.ansible {
  /* the gutter from the panel's left edge : the numbers and carets in the server log's grey
     column, the whole height */
  padding: 0.5rem 0;
  font-size: 0.875rem;
  background: linear-gradient(
    to right,
    var(--af-output-gutter-bg) 4rem,
    var(--af-field-border) 4rem,
    var(--af-field-border) calc(4rem + 1px),
    var(--af-output-bg) calc(4rem + 1px)
  );
  .af-ansible-line {
    display: flex;
    align-items: flex-start;
    min-height: 1.2em;
    &:hover {
      background: var(--af-row-hover-bg);
    }
  }
  .af-ansible-no {
    flex: 0 0 2.75rem;
    padding-right: 0.5rem;
    text-align: right;
    color: var(--bs-tertiary-color);
    user-select: none;
  }
  .af-ansible-fold {
    flex: 0 0 1.25rem;
    display: flex;
    justify-content: center;
  }
  .af-ansible-caret {
    padding: 0;
    border: 0;
    background: none;
    line-height: 1.2;
    color: var(--bs-secondary-color);
    cursor: pointer;
    &:hover {
      color: var(--bs-body-color);
    }
  }
  .af-ansible-text {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 1rem 0 0.75rem;
  }
  /* a folded section : how many lines it hides, a click unfolds it */
  .af-ansible-more {
    margin-left: 0.5rem;
    padding: 0 0.4rem;
    border-radius: 0.25rem;
    background: var(--bs-secondary-bg);
    color: var(--bs-secondary-color);
    cursor: pointer;
    &::before {
      content: '+';
    }
  }
}
/* the output in sections, flat inside the panel's one frame (as a CI run's steps) : the lines
   before the first section, each section (the job, a workflow's node, its summary) and the
   closing line one under the other, a hairline between them, no frame of their own ; the
   line numbers' grey column runs through them all */
.af-ansible-groups.af-ansible-has-nodes {
  display: flex;
  flex-direction: column;
  > * + * {
    border-top: 1px solid var(--af-field-border);
  }
  .ansible {
    margin: 0;
    border: 0;
    border-radius: 0;
  }
}
.af-node-card {
  /* the header and the lines under it : the frame's darker grey, as between the sections */
  .af-node-head:not(:last-child) {
    border-bottom: 1px solid var(--af-field-border);
  }
}
.af-node-head {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.625rem 1rem;
  border: 0;
  background: var(--bs-tertiary-bg);
  text-align: left;
  color: var(--bs-body-color);
  &:hover {
    background: var(--af-row-hover-bg);
  }
  &:focus-visible {
    outline: 0;
    box-shadow: inset 0 0 0 0.2rem var(--bs-focus-ring-color);
  }
}
.af-node-head {
  cursor: pointer;
  user-select: none;
}
/* a section's copy : quiet, its colour the meta's, a soft background on hover */
.af-node-copy {
  /* closer to the line count than the meta's own gap */
  margin-left: -0.5rem;
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.4rem;
  border: 0;
  border-radius: 0.25rem;
  background: none;
  color: inherit;
  svg {
    margin: 0 !important;
  }
  &:hover {
    background: var(--bs-secondary-bg);
    color: var(--bs-body-color);
  }
  &:focus-visible {
    outline: 0;
    box-shadow: 0 0 0 0.2rem var(--bs-focus-ring-color);
  }
}
.af-node-chevron {
  width: 0.75rem;
  color: var(--bs-secondary-color);
}
.af-node-name {
  font-weight: 600;
}
/* the workflow's summary at the end : a flag before its name */
.af-node-flag {
  color: var(--bs-secondary-color);
}
.af-node-meta {
  display: inline-flex;
  align-items: center;
  gap: 1rem;
  margin-left: auto;
  font-size: 0.8rem;
  color: var(--bs-secondary-color);
  font-variant-numeric: tabular-nums;
  svg {
    margin-right: 0.3rem;
  }
}
.logfile {
  font-family: monospace;
  font-size: 0.8rem;
  background: #222;
  color: #c8c8c8;
  border-radius: 5px;
  border: 1px solid #444;
  margin-top: 1.5rem;
  margin-bottom: 1rem;
  padding: 0.5rem 1rem 1rem 1rem;
  .logfile-title {
    font-size: 0.9rem;
    font-weight: bold;
    color: #f6e58d;
    margin-bottom: 0.5rem;
  }
  .logfile-content {
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
}
</style>
