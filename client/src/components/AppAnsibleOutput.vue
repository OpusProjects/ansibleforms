<script setup>
import { computed } from 'vue';

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
  <div class="ansible" v-html="output"></div>
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
  background-color: var(--af-bg-light-subtle-color);

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
