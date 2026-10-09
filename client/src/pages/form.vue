<script setup>
import { ref, reactive, computed, provide, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { toast } from 'vue-sonner';
import Profile from '@/lib/Profile';
import Form from '@/lib/Form';
import { useAppStore } from '@/stores/app';
import Helpers from '@/lib/Helpers';
import axios from 'axios';
import State from '@/lib/State';
import Navigate from '@/lib/Navigate';
import TokenStorage from '@/lib/TokenStorage';
import YAML from 'yaml';
import Time from '@/lib/Time';

// use
const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const store = useAppStore();

// refs
const key = ref(0); // key to force rerender
const authenticated = ref(false); // flag to show/hide form, only show if authenticated, otherwise redirect to login (is automatically done by the router)
const currentForm = ref(null); // holds the current form
const formConfig = ref({}); // holds the form configuration
const constants = ref({}); // holds the constants
const formLoaded = ref(false); // flag to know if form is loaded
const showHelp = ref(false); // flag to show/hide help
const mainForm = ref(null); // the non-wizard AppForm, for its awaitStable gate
const formNotFound = ref(false); // flag to know if form is not found
// why it could not be loaded, when we know : shown instead of the generic message so a
// 403 does not read as "this form does not exist"
const loadError = ref('');
// consecutive failed job polls ; reset on every success so only a sustained outage stops
// the chain, not a single blip
const pollFailures = ref(0);
const filterOutput = ref(true); // flag to show/hide filter output

// ---------------------------------------------------------------------------
// Nested subform editor stack
//
// Each entry represents a subform currently being edited as a tab:
//   { id, title, subform, snapshot, onSave }
// - `snapshot` is a deep clone of the row at the time the tab was opened
//   and is passed to <AppForm :initialData>. The edited value comes back via
//   the `@save` event and is forwarded to the list field's `onSave` callback.
// - Parent tabs are rendered disabled so the user cannot skip over an
//   in-progress edit; use Save or × to come back to them.
// ---------------------------------------------------------------------------
// Edit stack for nested subform editing.
//
// Each entry represents a subform currently being edited:
//   { id, title, subtitle, subform, snapshot, draft, showHelp, onSave }
// - `snapshot` is a deep clone of the row at the time editing began and is
//   passed to <AppForm :initialData>. The edited value comes back via the
//   `@save` event and is forwarded to the list field's `onSave` callback.
// - While the stack is non-empty, the main form is hidden and the deepest
//   subform in the stack takes its place (title / help / breadcrumbs all
//   switch to the active entry). Earlier entries remain mounted (v-show)
//   so their drafts are preserved when the user goes deeper and back.
// - AppListField components call `pushEdit(...)` (injected) to open a new
//   level at any nesting depth; closing a level also removes its descendants.
// ---------------------------------------------------------------------------
const editStack = reactive([]);
let nextEditId = 1;

// The deepest (currently visible) subform entry, or undefined when the main
// form is shown. Drives the title, breadcrumbs and help block in the template.
const activeEntry = computed(() => editStack[editStack.length - 1]);

function pushEdit({ title, subtitle, subform, row, parentData, onSave }) {
  const id = `edit-${nextEditId++}`;
  const snapshot = row ? JSON.parse(JSON.stringify(row)) : {};
  const entry = reactive({
    id,
    title,
    subtitle,
    subform,
    snapshot,
    parentData: parentData ? Helpers.safeDeepClone(parentData) : null,
    draft: {},
    showHelp: subform?.showHelp === true,
    onSave,
  });
  editStack.push(entry);
  return id;
}

function popEdit(id) {
  const idx = editStack.findIndex((e) => e.id === id);
  if (idx < 0) return;
  // Remove the target entry and anything pushed on top of it.
  editStack.splice(idx, editStack.length - idx);
}

function saveEdit(id, value) {
  const entry = editStack.find((e) => e.id === id);
  if (!entry) return;
  try {
    entry.onSave?.(value);
  } finally {
    popEdit(id);
  }
}

provide('formEditStack', {
  push: pushEdit,
  pop: popEdit,
});

// ---------------------------------------------------------------------------
// Wizard mode
//
// When a form has a `wizard:` array, we render a sequence of subforms as
// steps. Each step is an <AppForm mode="wizard"> with its own draft and
// validation. Cross-step references work through `__parent__.<stepname>.field`
// (the wizard injects every prior step's raw draft under its namespace).
//
// State:
//   wizardSteps      : computed array of resolved steps with metadata
//   wizardIndex      : currently visible step index
//   wizardDrafts     : reactive { stepName: rawDraft }
//   wizardVisibility : { stepName: { fieldName: bool } } (from each step)
//   wizardSkipped    : reactive { stepName: true } when user pressed Skip
//   wizardRefs       : refs to each AppForm so we can call validateForm()
// ---------------------------------------------------------------------------
const wizardIndex = ref(0);
const wizardDrafts = reactive({});
const wizardVisibility = reactive({});
const wizardSkipped = reactive({});
// Set only after a step's validateForm() returned true. Drives the green
// “done” badge in the stepper and gates final submit.
const wizardCompleted = reactive({});
// Plain object map of stepName -> AppForm component instance (filled by
// the template ref callback). Not reactive — we only ever read it from
// click handlers, never from templates/computeds.
const wizardRefs = { value: {} };

function setWizardRef(stepName, el) {
  if (!stepName) return;
  if (el) wizardRefs.value[stepName] = el;
  else delete wizardRefs.value[stepName];
}

const wizardActive = computed(() => Array.isArray(currentForm.value?.wizard) && currentForm.value.wizard.length > 0);

// Resolve each step definition: subform lookup, step namespace (`name`
// defaults to subform name), title, defaultModel, etc. The summary step
// is appended automatically — authors don't declare it in YAML, and its
// title is always taken from the active locale (language-agnostic).
const wizardSteps = computed(() => {
  if (!wizardActive.value) return [];
  const subforms = currentForm.value?.subforms || [];
  // Skip any author-declared summary entries; we always append our own.
  const inputSteps = currentForm.value.wizard.filter((raw) => !raw?.summary);
  const steps = inputSteps.map((raw, i) => {
    const sub = subforms.find((s) => s.name === raw.subform);
    const stepName = raw.name || raw.subform;
    return {
      index: i,
      name: stepName,
      title: raw.title || sub?.description || stepName,
      help: raw.help || sub?.help || '',
      showHelp: raw.showHelp === true || sub?.showHelp === true,
      defaultModel: raw.defaultModel || '',
      when: raw.when || '',
      optional: raw.optional === true,
      subform: sub,
      subformName: raw.subform,
    };
  });
  // Append the synthetic summary step. Title comes from i18n so it's
  // always shown in the user's language.
  steps.push({
    index: steps.length,
    name: '__summary__',
    title: t('form.summary'),
    isSummary: true,
  });
  return steps;
});

// Evaluate `when:` for a step against the current wizard state.
// Returns true when there's no `when:` (always show) or when the expression
// evaluates truthy. Falsy/error -> step is hidden.
// Supports `$(__parent__.<stepname>.<field>)` placeholders, mirroring how
// regular expressions resolve inside subform fields.
function evalWhen(expr) {
  if (!expr || typeof expr !== 'string') return true;
  try {
    // Build a context object that mirrors what a subform field would see:
    //   __parent__.<stepname>.<field>
    const context = { __parent__: {} };
    Object.keys(wizardDrafts).forEach((k) => {
      context.__parent__[k] = wizardDrafts[k];
    });
    // Replace every $(path) placeholder with the JS literal value.
    const replaced = expr.replace(/\$\(([^)]+)\)/g, (_, path) => {
      const v = Helpers.replacePlaceholders(path, context);
      if (v === undefined) return 'undefined';
      return JSON.stringify(v);
    });
    // Dynamic evaluation is by design here : a `when` is an author-written
    // JS expression coming from config.yaml, not from end user input.
    return !!new Function(`return (${replaced});`)();
  } catch (e) {
    // Hide the step on evaluation failure; this matches how expression
    // fields silently degrade until their inputs are resolvable.
    return false;
  }
}

function isWizardStepVisible(step) {
  if (!step) return false;
  if (step.isSummary) return true;
  if (step.optional && wizardSkipped[step.name]) return false;
  if (!evalWhen(step.when)) return false;
  return true;
}

// __parent__ data injected into each step's AppForm. We expose every
// step's raw draft under its namespace, so a field in step "network"
// can reference $(__parent__.basics.kind) -> raw value from step "basics".
//
// varsFiles data (currentForm.vars) is spread in flat, top-level, so a step
// can reach it via $(__parent__.someVarsKey). For a non-wizard form this
// comes for free : __parent__ there is the root AppForm's own form.value,
// and that root form is mounted and injects its own .vars into itself. A
// wizard-active root form never mounts an AppForm at all, so nothing ever
// does that injection - this is the substitute. Step namespaces are spread
// after, so a step name always wins over a same-named vars key.
const wizardParentData = computed(() => {
  const out = { ...(currentForm.value?.vars || {}) };
  for (const step of wizardSteps.value) {
    if (step.isSummary) continue;
    out[step.name] = wizardDrafts[step.name] || {};
  }
  return out;
});

// Per-step output: fields shaped by buildFormOutput, then wrapped under
// the step's `defaultModel` prefix. Honours per-field `model`/`output`.
function buildWizardStepOutput(step) {
  if (!step?.subform?.fields) return {};
  const visMap = wizardVisibility[step.name] || {};
  return Helpers.buildWizardStepOutput(step.subform.fields, wizardDrafts[step.name] || {}, step.defaultModel || '', {
    isVisible: (item) => !!visMap[item.name],
    subforms: currentForm.value?.subforms || [],
  });
}

// Merged wizard extravars: deep-merge of every visible step's output, in
// declaration order. Hidden / skipped steps contribute nothing.
const wizardMergedOutput = computed(() => {
  if (!wizardActive.value) return {};
  let merged = {};
  for (const step of wizardSteps.value) {
    if (step.isSummary) continue;
    if (!isWizardStepVisible(step)) continue;
    merged = Helpers.deepMerge(merged, buildWizardStepOutput(step));
  }
  return merged;
});

const activeWizardStep = computed(() => wizardSteps.value[wizardIndex.value] || null);

// Navigation
function wizardGoTo(index) {
  if (index < 0 || index >= wizardSteps.value.length) return;
  // When jumping forward, validate the current step first (fail-closed).
  // Jumping backwards is always allowed.
  if (index > wizardIndex.value) {
    const step = activeWizardStep.value;
    if (step && !step.isSummary && !wizardSkipped[step.name]) {
      const ref = wizardRefs.value[step.name];
      if (!ref || typeof ref.validateForm !== 'function') {
        // Can't validate → don't advance.
        return;
      }
      if (!ref.validateForm()) return;
      wizardCompleted[step.name] = true;
    }
  }
  wizardIndex.value = index;
}
function wizardBack() {
  // walk backwards skipping hidden steps
  for (let i = wizardIndex.value - 1; i >= 0; i--) {
    if (isWizardStepVisible(wizardSteps.value[i])) {
      wizardIndex.value = i;
      return;
    }
  }
}
function wizardNext() {
  const step = activeWizardStep.value;
  if (!step) return;
  // Validate the current step before advancing (summary steps have no form).
  if (!step.isSummary) {
    const ref = wizardRefs.value[step.name];
    // Fail-closed: if the ref isn't available, don't silently advance.
    if (!ref || typeof ref.validateForm !== 'function') {
      toast.warning(t('form.invalidData'));
      return;
    }
    if (!ref.validateForm()) return;
    wizardCompleted[step.name] = true;
    // Re-entering an optional step clears any prior skip mark.
    if (wizardSkipped[step.name]) delete wizardSkipped[step.name];
  } else {
    wizardCompleted[step.name] = true;
  }
  // walk forwards skipping hidden steps
  for (let i = wizardIndex.value + 1; i < wizardSteps.value.length; i++) {
    if (isWizardStepVisible(wizardSteps.value[i])) {
      wizardIndex.value = i;
      return;
    }
  }
}
function wizardSkipCurrent() {
  const step = activeWizardStep.value;
  if (!step || !step.optional) return;
  wizardSkipped[step.name] = true;
  // Skipping clears any prior completion mark.
  delete wizardCompleted[step.name];
  // walk forwards to next visible step
  for (let i = wizardIndex.value + 1; i < wizardSteps.value.length; i++) {
    if (isWizardStepVisible(wizardSteps.value[i])) {
      wizardIndex.value = i;
      return;
    }
  }
}

// Returns the index of the last *non-summary* visible step. Used to know
// whether to render Next or Submit.
const wizardLastInputIndex = computed(() => {
  let last = -1;
  wizardSteps.value.forEach((s, i) => {
    if (!s.isSummary && isWizardStepVisible(s)) last = i;
  });
  return last;
});

const wizardHasSummary = computed(() => wizardSteps.value.some((s) => s.isSummary));

// Rows shown in the summary step body: one entry per non-summary step
// with its visual status (ok / skipped / hidden / pending) so the user
// sees at a glance what was done and what wasn't.
const wizardSummaryRows = computed(() => {
  return wizardSteps.value
    .filter((s) => !s.isSummary)
    .map((s) => {
      let status, statusLabel;
      if (!isWizardStepVisible(s) && !wizardSkipped[s.name]) {
        status = 'hidden';
        statusLabel = t('form.wizardSummaryHidden');
      } else if (wizardSkipped[s.name]) {
        status = 'skipped';
        statusLabel = t('form.wizardSummarySkipped');
      } else if (wizardCompleted[s.name]) {
        status = 'ok';
        statusLabel = t('form.wizardSummaryOk');
      } else {
        status = 'pending';
        statusLabel = t('form.wizardSummaryPending');
      }
      return { name: s.name, title: s.title, index: s.index, status, statusLabel };
    });
});

// Submit from the wizard: build merged extravars, then route through the
// existing launch path. File fields inside wizard steps are not supported
// in v1 — they would need a multi-step upload flow.
/**
 * Every visible non-summary step is either completed or explicitly skipped.
 *
 * This lived inside wizardSubmit, so it ran for the direct Submit only. Schedule, Run
 * later and Store went through handleWizardSubmitAction, whose own validation is a no-op
 * on the summary step (`if (step && !step.isSummary)`) - so from the summary you could
 * persist a RECURRING SCHEDULE whose extra_vars came from a wizard whose steps had never
 * been filled in, and it then fired unattended against the playbook. The regular form
 * validates for every action; the wizard now does too.
 */
function wizardStepsComplete() {
  for (const s of wizardSteps.value) {
    if (s.isSummary) continue;
    if (!isWizardStepVisible(s)) continue;
    if (wizardSkipped[s.name]) continue;
    if (!wizardCompleted[s.name]) {
      toast.warning(t('form.invalidData'));
      // Jump back to the offending step so the user can fix it.
      wizardIndex.value = s.index;
      return false;
    }
  }
  return true;
}

function wizardSubmit() {
  // Validate active step if it's not the summary
  const step = activeWizardStep.value;
  if (step && !step.isSummary) {
    const ref = wizardRefs.value[step.name];
    if (!ref || typeof ref.validateForm !== 'function') {
      toast.warning(t('form.invalidData'));
      return;
    }
    if (!ref.validateForm()) return;
    wizardCompleted[step.name] = true;
  }
  if (!wizardStepsComplete()) return;
  // For wizard submit we bypass file-upload (none expected in v1)
  status.value = 'initializing';
  const postdata = {
    files: {},
    extravars: Helpers.deepClone(wizardMergedOutput.value) || {},
    formName: currentForm.value.name,
    rawFormData: Helpers.deepClone(wizardMergedOutput.value) || {},
    credentials: {},
  };
  if (enableVerbose.value) {
    postdata.extravars.__verbose__ = true;
  }
  // Collect credentials from steps: any field with asCredential=true.
  for (const s of wizardSteps.value) {
    if (s.isSummary || !s.subform?.fields) continue;
    if (!isWizardStepVisible(s)) continue;
    const draft = wizardDrafts[s.name] || {};
    s.subform.fields
      .filter((f) => f.asCredential === true)
      .forEach((f) => {
        postdata.credentials[f.name] = draft[f.name];
      });
  }
  launchForm(postdata);
}

// Submit dropdown actions for the wizard's final step (mirrors AppForm's
// submitActions list so the user gets the same Schedule / Run later / Store
// options as on a regular form).
const wizardSubmitActions = computed(() => [
  {
    key: 'schedule',
    label: t('form.scheduleRecurring'),
    icon: 'calendar-plus',
    roleOption: 'allowScheduledJobs',
  },
  {
    key: 'run-later',
    label: t('form.runLaterOneTime'),
    icon: 'clock',
    roleOption: 'allowPlannedJobs',
    divider: true,
  },
  {
    key: 'store',
    label: t('form.store'),
    icon: 'file-export',
    roleOption: 'allowStoredJobs',
  },
]);

// Route the wizard's final-step submit dropdown actions. Validates the
// active step (if not the summary) and ensures formdata mirrors the merged
// wizard output before opening schedule/store offcanvases.
function handleWizardSubmitAction(action) {
  // Refuse while a run is already under way. The button is only disabled for
  // 'initializing'/'submitting', but launchForm sets status to 'running' within
  // milliseconds - so it re-enabled itself immediately and stayed enabled for the whole
  // job. A second click launched a SECOND Ansible job and overwrote timeout.value, which
  // orphaned the first poll chain: nothing could clear it any more, so it kept polling
  // and writing job/status every 2s after the user had navigated away, with the output
  // pane alternating between the two jobs.
  if (status.value !== '') return;
  const step = activeWizardStep.value;
  if (step && !step.isSummary) {
    const ref = wizardRefs.value[step.name];
    if (ref && typeof ref.validateForm === 'function') {
      if (!ref.validateForm()) return;
    }
  }
  // Every action, not just 'submit' : schedule/run-later/store used to skip this
  if (!wizardStepsComplete()) return;
  // Make sure formdata reflects merged wizard output for downstream consumers.
  generateJsonOutput();
  switch (action) {
    case 'submit':
      wizardSubmit();
      break;
    case 'schedule':
      openScheduleOffcanvas('schedule');
      break;
    case 'run-later':
      openScheduleOffcanvas('run-later');
      break;
    case 'store':
      storeCtx.value = buildMainStoreCtx();
      openStoreOffcanvas();
      break;
  }
}

const hideForm = ref(false); // possible action to hide form onsubmit for example
const formdata = ref({}); // the eventual object sent to the api in the correct hierarchy
const showExtraVars = ref(false); // flag to show/hide extravars
const job = ref({}); // holds the job data
const message = ref(''); // holds the message of the job
const error = ref(''); // holds the error of the job
const viewAsYaml = ref(true); // flag to show extravars as yaml
const subjob = ref({}); // output of last subjob
const form = ref({}); // the form data mapped to the form -> hold the real data
const visibility = ref({}); // holds which fields are visiable or not
const timeout = ref(undefined); // determines how long we should show the result of run
const enableVerbose = ref(false); // flag to enable verbose mode
const jobId = ref(undefined); // holds the current jobid
const abortTriggered = ref(false); // flag abort is triggered,
const pauseJsonOutput = ref(false); // flag to pause jsonoutput interval
const fileProgress = ref({}); // holds the progress of file uploads
const status = ref(''); // status of form
const initialFormData = ref({}); // holds initial data for pre-filling the form

// Schedule off-canvas state
const showScheduleOffcanvas = ref(false);
const scheduleAction = ref('schedule'); // 'schedule' or 'run-later'
const scheduleForm = ref({
  name: '',
  one_time_run: false,
  cron: '',
  run_at: null,
});
const scheduleSubmitting = ref(false);

// Store off-canvas state
const showStoreOffcanvas = ref(false);
const storeForm = ref({
  name: '',
  description: '',
  expires_at: null,
});
const storeSubmitting = ref(false);

// Load off-canvas state
const showLoadOffcanvas = ref(false);
const storedJobs = ref([]);
const loadSubmitting = ref(false);

// Context describing what to store / what to load into. Set just before
// opening the store or load off-canvas so a single dialog is reused by both
// the main form and any active subform tab. Shape:
//   { scope: 'form' | 'subform',
//     formName: string,       // used as stored_jobs.form_name
//     title: string,          // displayed in the off-canvas header
//     getData: () => object,  // payload to serialise on Save
//     onLoad: (parsed) => void // applies a loaded record
//   }
const storeCtx = ref(null);

function buildMainStoreCtx() {
  return {
    scope: 'form',
    formName: currentForm.value.name,
    title: currentForm.value.name,
    getData: () => {
      // Wizard forms persist per-step drafts (without password values)
      // instead of merged extravars. That makes load-from-store
      // round-trippable into the wizard UI without trying to split a
      // flattened tree back into step buckets.
      if (wizardActive.value) {
        const drafts = {};
        for (const step of wizardSteps.value) {
          if (step.isSummary || !step.subform?.fields) continue;
          const src = wizardDrafts[step.name] || {};
          const clean = {};
          step.subform.fields.forEach((f) => {
            if (f.type === 'password' || f.type === 'constant') return;
            if (f.name in src) clean[f.name] = src[f.name];
          });
          drafts[step.name] = clean;
        }
        return {
          __wizard__: true,
          drafts,
          skipped: { ...wizardSkipped },
          completed: { ...wizardCompleted },
        };
      }
      return getFilteredRawFormData();
    },
    onLoad: (parsed) => {
      // Wizard load: restore per-step drafts and skip/completion marks.
      // Backwards compatible: if the stored blob is a flat object
      // (legacy or non-wizard form), fall back to initialFormData.
      if (wizardActive.value && parsed && parsed.__wizard__ === true) {
        Object.keys(wizardDrafts).forEach((k) => delete wizardDrafts[k]);
        Object.keys(wizardSkipped).forEach((k) => delete wizardSkipped[k]);
        Object.keys(wizardCompleted).forEach((k) => delete wizardCompleted[k]);
        Object.keys(wizardVisibility).forEach((k) => delete wizardVisibility[k]);
        const drafts = parsed.drafts || {};
        for (const step of wizardSteps.value) {
          if (step.isSummary) continue;
          wizardDrafts[step.name] = drafts[step.name] ? Helpers.deepClone(drafts[step.name]) : {};
        }
        if (parsed.skipped) Object.assign(wizardSkipped, parsed.skipped);
        if (parsed.completed) Object.assign(wizardCompleted, parsed.completed);
        wizardIndex.value = 0;
        key.value++;
        return;
      }
      initialFormData.value = parsed;
      key.value++;
    },
  };
}

/******************************** */
// computed
/******************************** */

// Build the output object for a subform draft, using the shared helper.
// `model`, `output`, `outputObject`, `valueColumn` on the subform's
// fields are all honoured, and nested list fields recurse through their
// own subform definitions.
function buildSubformOutput(entry) {
  if (!entry?.subform?.fields) return {};
  return Helpers.buildFormOutput(entry.subform.fields, entry.draft || {}, {
    subforms: currentForm.value.subforms || [],
  });
}

// When editing a subform, the right-hand "Extravars" panel switches to show
// the draft of the active subform instead of the main-form output. Outside
// subform editing this is just `formdata`. In wizard mode the panel shows
// the current step's contribution (or the merged result on the summary).
const displayedOutput = computed(() => {
  if (activeEntry.value) return buildSubformOutput(activeEntry.value);
  if (wizardActive.value) {
    const step = activeWizardStep.value;
    if (step?.isSummary) return wizardMergedOutput.value;
    if (step?.subform?.fields) return buildWizardStepOutput(step);
    return wizardMergedOutput.value;
  }
  return formdata.value;
});
const displayedOutputYaml = computed(() => {
  // Mask password-typed fields for display only - the underlying formdata
  // still carries the real values for submission / store / download.
  let fields;
  if (activeEntry.value) {
    fields = activeEntry.value.subform?.fields;
  } else if (wizardActive.value) {
    const step = activeWizardStep.value;
    fields = step?.subform?.fields;
    // For the summary step / merged view, build a synthetic field list
    // covering every visible step so password masking still finds them.
    if (!fields) {
      const all = [];
      for (const s of wizardSteps.value) {
        if (s.isSummary || !s.subform?.fields) continue;
        if (!isWizardStepVisible(s)) continue;
        // Prefix each field's model with the step's defaultModel so masking
        // walks the right paths in the merged tree.
        s.subform.fields.forEach((f) => {
          const prefix = s.defaultModel ? s.defaultModel.replace(/^\.+|\.+$/g, '') : '';
          const apply = (m) =>
            typeof m === 'string' ? (m.startsWith('/') ? m.slice(1) : prefix ? `${prefix}.${m}` : m) : m;
          let nextModel;
          if (Array.isArray(f.model)) nextModel = f.model.map(apply);
          else if (typeof f.model === 'string') nextModel = apply(f.model);
          else nextModel = prefix ? `${prefix}.${f.name}` : f.name;
          all.push({ ...f, model: nextModel });
        });
      }
      fields = all;
    }
  } else {
    fields = currentForm.value?.fields;
  }
  const subforms = currentForm.value?.subforms || [];
  const masked = Array.isArray(fields)
    ? Helpers.maskPasswordsForDisplay(displayedOutput.value, fields, subforms)
    : displayedOutput.value;
  return YAML.stringify(masked);
});
const displayedOutputTitle = computed(() => {
  if (activeEntry.value) return `${t('form.subformOutput')} - ${activeEntry.value.title}`;
  if (wizardActive.value) {
    const step = activeWizardStep.value;
    if (step?.isSummary) return t('form.extraVars');
    return `${t('form.subformOutput')} - ${step?.title || ''}`;
  }
  return t('form.extraVars');
});

// filter job output
const filteredJobOutput = computed(() => {
  if (!filterOutput.value) return job.value.output?.replace(/\r\n/g, '<br>') || '';
  return (
    job.value.output
      ?.replace(/<span class='low[^<]*<\/span>/g, '')
      .replace(/\r\n/g, '<br>')
      .replace(/(<br>\s*){3,}/gi, '<br><br>') || ''
  );
});

// filter subjob output
const filteredSubJobOutput = computed(() => {
  if (!filterOutput.value) return subjob.value.output?.replace(/\r\n/g, '<br>') || '';
  return (
    subjob.value.output
      ?.replace(/<span class='low[^<]*<\/span>/g, '')
      .replace(/\r\n/g, '<br>')
      .replace(/(<br>\s*){3,}/gi, '<br><br>') || ''
  );
});

const formStatus = computed(() => {
  if (status.value == 'running') {
    return {
      label: t('form.running'),
      color: 'primary',
      icon: 'spinner',
      disabled: true,
      reload: false,
      abort: true,
    };
  } else if (status.value == 'success') {
    return {
      label: t('form.finished'),
      color: 'success',
      icon: 'check',
      disabled: false,
      reload: true,
      abort: false,
    };
  } else if (status.value == 'failed') {
    return {
      label: t('form.failed'),
      color: 'danger',
      icon: 'exclamation-triangle',
      disabled: false,
      reload: true,
      abort: false,
    };
  } else if (status.value == 'warning') {
    return {
      label: t('form.finishedWithWarning'),
      color: 'warning',
      icon: 'exclamation-triangle',
      disabled: false,
      reload: true,
      abort: false,
    };
  } else if (status.value == 'approve') {
    return {
      label: t('form.waitingForApproval'),
      color: 'warning',
      icon: 'spinner',
      disabled: false,
      reload: true,
      abort: false,
    };
  } else if (status.value == 'abandoned') {
    return {
      label: t('form.abandoned'),
      color: 'warning',
      icon: 'exclamation-triangle',
      disabled: false,
      reload: true,
      abort: false,
    };
  } else if (status.value == 'rejected') {
    return {
      label: t('form.rejected'),
      color: 'warning',
      icon: 'exclamation-triangle',
      disabled: false,
      reload: true,
      abort: false,
    };
  } else if (status.value == 'aborted') {
    return {
      label: t('form.aborted'),
      color: 'warning',
      icon: 'exclamation-triangle',
      disabled: false,
      reload: true,
      abort: false,
    };
  } else if (status.value == 'initializing') {
    return {
      label: t('form.initializing'),
      color: 'primary',
      icon: 'spinner',
      disabled: true,
      reload: false,
      abort: false,
    };
  } else if (status.value == 'stabilizing') {
    return {
      label: t('form.stabilizingForm'),
      color: 'primary',
      icon: 'spinner',
      disabled: true,
      reload: false,
      abort: false,
    };
  } else if (status.value == 'submitting') {
    return {
      label: t('form.submittingForm'),
      color: 'primary',
      icon: 'spinner',
      disabled: true,
      reload: false,
      abort: false,
    };
  } else {
    return {
      label: t('form.pending'),
      color: 'secondary',
      icon: 'spinner',
      disabled: false,
      reload: false,
      abort: false,
    };
  }
});

/******************************** */
// methods
/******************************** */

async function reloadForm(reset = true) {
  if (reset) {
    resetResult();
  }
  await loadForm();
  key.value++;
}

// ─── the forms menu (the Forms page's categories, in the left column) ─────────────────────

/**
 * Whether a form is in a category : one of its categories is it, or below it.
 *
 * Args:
 *   form (object): the form (its categories).
 *   category (string): a category, as Infra/Linux.
 *
 * Returns:
 *   boolean: true when the form is listed in that category.
 */
function formInCategory(form, category) {
  const own = form?.categories?.length ? form.categories : ['Default'];
  return own.some((c) => c === category || String(c).startsWith(category + '/'));
}

// the category highlighted : the one browsed on the Forms page before opening the form (All
// Forms included), when the form is in it ; else the form's own first category
const menuCategory = computed(() => {
  let browsed = null;
  try {
    browsed = sessionStorage.getItem('af_forms_category');
  } catch (e) {
    // no storage : the form's own category
  }
  if (browsed === '' || (browsed && formInCategory(currentForm.value, browsed))) return browsed;
  return currentForm.value?.categories?.[0] || '';
});

/**
 * Opens the Forms page on a category of the menu.
 *
 * Args:
 *   category (string): the category ; empty for All Forms.
 */
function openCategory(category) {
  router.push(category ? { path: '/', query: { category: encodeURIComponent(category) } } : { path: '/' });
}

function toggleShowExtraVars() {
  showExtraVars.value = !showExtraVars.value;
  // Generate JSON immediately when opening extravars panel to avoid delay
  if (showExtraVars.value) {
    generateJsonOutput();
  }
}

// Timers scheduled by onSuccess/onFailure actions. They are tracked so onBeforeUnmount
// can cancel them: their ids used to be discarded, and `router` stays functional after
// the component is gone - so a form with `onSuccess: [{home: 30}]` yanked the user off
// whatever page they had navigated to 30 seconds later, and `clear`/`reload` ran a
// Form.load and wrote to dead refs on a destroyed component.
const actionTimers = ref([]);
function laterInThisForm(fn, seconds) {
  actionTimers.value.push(setTimeout(fn, seconds * 1000));
}

// do action after form submit
function doAction(a, jobid) {
  const action = Object.keys(a)[0];
  const value = a[action];
  var wait;
  var form = '';
  if (typeof value == 'string') {
    var tmp = value.split(/,(.*)/s);
    wait = parseInt(tmp[0]);
    form = tmp[1];
  } else {
    wait = parseInt(value);
  }
  if (action == 'clear') {
    laterInThisForm(() => {
      reloadForm(false);
    }, wait);
  }
  if (action == 'home') {
    laterInThisForm(() => {
      Navigate.toHome(router);
    }, wait);
  }
  if (action == 'load') {
    laterInThisForm(() => {
      Navigate.toPath(router, '/form', { form: form, __previous_jobid__: jobid }, true);
    }, wait);
  }
  if (action == 'reload') {
    laterInThisForm(() => {
      reloadForm();
    }, wait);
  }
  if (action == 'hide') {
    laterInThisForm(() => {
      hideForm.value = true;
    }, wait);
  }
  if (action == 'show') {
    laterInThisForm(() => {
      hideForm.value = false;
    }, wait);
  }
}

// when the form component triggers a change
// we can regenerate the json output
// for this we need to know which fields are visible
// so we the child passes the visibility information
function formChanged(formObjectData) {
  visibility.value = formObjectData.visibility;
  generateJsonOutput();
}

// Per-wizard-step change handler: stores visibility under the step's name
// so wizardMergedOutput can respect per-step `visible:` rules.
function wizardStepChanged(stepName, formObjectData) {
  wizardVisibility[stepName] = formObjectData.visibility || {};
}

// Get filtered raw form data (excludes constants, passwords, system fields)
function getFilteredRawFormData() {
  if (wizardActive.value) {
    // Wizard rawFormData is the merged extravars (without passwords - we
    // rebuild from drafts so password fields don't leak into stored jobs).
    const result = {};
    for (const step of wizardSteps.value) {
      if (step.isSummary || !step.subform?.fields) continue;
      if (!isWizardStepVisible(step)) continue;
      const draftClone = { ...(wizardDrafts[step.name] || {}) };
      step.subform.fields.forEach((f) => {
        if (f.type === 'password' || f.type === 'constant') delete draftClone[f.name];
      });
      const stepOutput = Helpers.buildWizardStepOutput(
        step.subform.fields.filter((f) => f.type !== 'password' && f.type !== 'constant'),
        draftClone,
        step.defaultModel || '',
        { subforms: currentForm.value?.subforms || [] },
      );
      Object.assign(result, Helpers.deepMerge(result, stepOutput));
    }
    return result;
  }
  const rawFormData = {};
  (currentForm.value.fields || []).forEach((field) => {
    const fieldName = field.name;

    // Skip if field value not in form
    if (!(fieldName in form.value)) return;

    // Skip constants (loaded from config, not user input)
    if (field.type === 'constant') return;

    // Skip password fields for security
    if (field.type === 'password') return;

    // Skip system fields
    if (fieldName === 'server' || fieldName === 'database' || fieldName === 'metadata') return;

    // Include this field
    rawFormData[fieldName] = form.value[fieldName];
  });
  return rawFormData;
}

// generate the form json output
function generateJsonOutput(filedata = {}) {
  if (wizardActive.value) {
    // In wizard mode the canonical output lives in wizardMergedOutput;
    // we just mirror it into formdata so downstream consumers (download,
    // copy, schedule) keep working unchanged.
    formdata.value = Helpers.deepClone(wizardMergedOutput.value) || {};
    return;
  }
  try {
    formdata.value = Helpers.buildFormOutput(currentForm.value.fields || [], form.value, {
      isVisible: (item) => !!visibility.value[item.name],
      overrides: filedata,
      subforms: currentForm.value.subforms || [],
    });
  } catch (err) {
    toast.error('Failed to generate json output.\r\nContact the developer.\r\n' + (err.message || err.toString()));
  }
}

// upload a file
async function uploadFile(fieldname, file) {
  // toast.info(`Start uploading ${file.name}`);
  var uploadFormData = new FormData();
  uploadFormData.append('file', file);
  const config = {
    ...TokenStorage.getAuthenticationMultipart(),
    onUploadProgress: (progressEvent) => {
      fileProgress.value[fieldname] = Math.round((progressEvent.loaded / progressEvent.total) * 100);
      if (fileProgress.value[fieldname] == 100) {
        toast.success(`File ${file.name} uploaded`);
        setTimeout(() => {
          fileProgress.value[fieldname] = undefined;
        }, 2000);
      }
    },
  };
  const result = await axios.post(`/api/v2/job/upload/`, uploadFormData, config);
  return result.data;
}

async function submitForm(formObjectData) {
  var postdata = {};
  postdata.files = {};

  // the visibility data is passed from the AppForm component
  // we need it to know which fields are visible and which are not
  visibility.value = formObjectData.visibility;

  currentForm.value.fields
    ?.filter((f) => f.type == 'file' && form.value[f.name]?.name)
    .forEach((f) => {
      postdata.files[f.name] = form.value[f.name];
    });

  try {
    const fileKeys = Object.keys(postdata.files);
    const uploadPromises = fileKeys.map(async (key) => {
      try {
        var result = await uploadFile(key, postdata.files[key]);
        postdata.files[key] = result;
      } catch (e) {
        console.log(e);
        throw new Error('Failed uploading files', { cause: e });
      }
    });
    await Promise.all(uploadPromises);
  } catch (err) {
    toast.error(err.toString());
    resetResult();
    throw new Error('Failed uploading files', { cause: err });
  }

  pauseJsonOutput.value = true;
  generateJsonOutput(postdata.files);
  postdata.extravars = formdata.value;
  if (enableVerbose.value) {
    postdata.extravars.__verbose__ = true;
  }
  postdata.formName = currentForm.value.name;
  // Store raw form data for potential re-use (exclude sensitive/irrelevant fields)
  postdata.rawFormData = getFilteredRawFormData();
  console.log('Submitting with rawFormData:', Object.keys(postdata.rawFormData));
  postdata.credentials = {};
  currentForm.value.fields
    ?.filter((f) => f.asCredential == true)
    .forEach((f) => {
      postdata.credentials[f.name] = formdata.value[f.name];
    });
  launchForm(postdata);
}

async function copyToClipboard(textToCopy) {
  // Navigator clipboard api needs a secure context (https)
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(textToCopy);
  } else {
    // Use the 'out of viewport hidden text area' trick
    const textArea = document.createElement('textarea');
    textArea.value = textToCopy;

    // Move textarea out of the viewport so it's not visible
    textArea.style.position = 'absolute';
    textArea.style.left = '-999999px';

    document.body.prepend(textArea);
    textArea.select();

    try {
      document.execCommand('copy');
    } catch (error) {
      console.error(error);
    } finally {
      textArea.remove();
    }
  }
}

// copy to clipboard
async function clip(v, doNotStringify = false, asYaml = false) {
  if (doNotStringify) {
    try {
      await copyToClipboard(v);
      toast.success('Copied to clipboard');
    } catch (err) {
      toast.error('Error copying to clipboard : \n' + err.toString());
    }
  } else {
    try {
      if (asYaml) {
        await copyToClipboard(YAML.stringify(v));
      } else {
        await copyToClipboard(JSON.stringify(v, null, 2));
      }
      toast.success('Copied to clipboard');
    } catch (err) {
      toast.error('Error copying to clipboard : \n' + err.toString());
    }
  }
}

// reset result
function resetResult() {
  clearTimeout(timeout.value);
  status.value = '';
  message.value = '';
  error.value = '';
  subjob.value = {};
  job.value = {};
}

// Handle submit action from AppForm component
async function handleSubmitAction({ action, visibility: formVisibility }) {
  visibility.value = formVisibility;

  switch (action) {
    case 'submit':
      // Main submit action - trigger form submission
      status.value = 'initializing';
      // Wait for every dynamic field to settle first. AppForm computes this (canSubmit)
      // and even emits a "submit" event when it flips, but that event is not declared and
      // nothing listens to it - so submitForm used to run the instant the button was
      // pressed and a slow query/expression field was read while still undefined, sending
      // the job a missing or stale extravar with no sign anything was wrong.
      if (mainForm.value?.awaitStable && !(await mainForm.value.awaitStable())) {
        toast.warning(t('form.tooLongToEvaluate'));
        status.value = '';
        return;
      }
      submitForm({ visibility: formVisibility });
      break;
    case 'schedule':
      openScheduleOffcanvas('schedule');
      break;
    case 'run-later':
      openScheduleOffcanvas('run-later');
      break;
    case 'store':
      storeCtx.value = buildMainStoreCtx();
      openStoreOffcanvas();
      break;
  }
}

// Open schedule off-canvas
function openScheduleOffcanvas(action = 'schedule') {
  scheduleAction.value = action;

  // Reset schedule form with appropriate defaults
  if (action === 'schedule') {
    scheduleForm.value = {
      name: '',
      one_time_run: false,
      cron: '0 0 * * *', // Default: daily at midnight
      run_at: null,
    };
  } else {
    // run-later
    scheduleForm.value = {
      name: '',
      one_time_run: true,
      cron: '',
      run_at: null,
    };
  }

  showScheduleOffcanvas.value = true;
}

// Close schedule off-canvas
function closeScheduleOffcanvas() {
  showScheduleOffcanvas.value = false;
  scheduleSubmitting.value = false;
}

// Create schedule via API
async function createSchedule() {
  // Simple validation
  if (!scheduleForm.value.name) {
    toast.warning(t('form.nameRequired'));
    return;
  }

  // Ensure type is set based on action
  scheduleForm.value.one_time_run = scheduleAction.value === 'run-later';

  if (!scheduleForm.value.one_time_run && !scheduleForm.value.cron) {
    toast.warning(t('form.cronRequired'));
    return;
  }

  if (scheduleForm.value.one_time_run && !scheduleForm.value.run_at) {
    toast.warning(t('form.runAtRequired'));
    return;
  }

  scheduleSubmitting.value = true;

  try {
    // Use the existing formdata which is already modelled by generateJsonOutput
    generateJsonOutput();

    const scheduleData = {
      name: scheduleForm.value.name,
      one_time_run: scheduleForm.value.one_time_run,
      form: currentForm.value.name,
      extra_vars: YAML.stringify(formdata.value),
    };

    // Add type-specific fields
    if (!scheduleForm.value.one_time_run) {
      scheduleData.cron = scheduleForm.value.cron;
    } else {
      scheduleData.run_at = scheduleForm.value.run_at;
    }

    await axios.post('/api/v2/schedule', scheduleData, TokenStorage.getAuthentication());

    const successMessage =
      scheduleAction.value === 'schedule'
        ? `Schedule "${scheduleForm.value.name}" created successfully`
        : `Job "${scheduleForm.value.name}" scheduled successfully`;
    toast.success(successMessage);
    closeScheduleOffcanvas();
  } catch (error) {
    console.error('Error creating schedule:', error);
    toast.error(error.response?.data?.message || 'Failed to create schedule');
  } finally {
    scheduleSubmitting.value = false;
  }
}

// Store off-canvas functions
function openStoreOffcanvas() {
  // Reset store form
  storeForm.value = {
    name: '',
    description: '',
    expires_at: null,
  };

  showStoreOffcanvas.value = true;
}

function closeStoreOffcanvas() {
  showStoreOffcanvas.value = false;
  storeSubmitting.value = false;
}

async function createStoredJob() {
  // Simple validation
  if (!storeForm.value.name) {
    toast.warning(t('form.nameRequired'));
    return;
  }

  const ctx = storeCtx.value || buildMainStoreCtx();
  storeSubmitting.value = true;

  try {
    const storedJobData = {
      name: storeForm.value.name,
      description: storeForm.value.description || '',
      form_name: ctx.formName,
      form_data: JSON.stringify(ctx.getData()),
      expires_at: storeForm.value.expires_at || null,
    };

    await axios.post('/api/v2/stored-jobs', storedJobData, TokenStorage.getAuthentication());

    toast.success(`Form data saved as "${storeForm.value.name}"`);
    closeStoreOffcanvas();
  } catch (error) {
    console.error('Error storing job:', error);
    if (error.response?.status === 409) {
      toast.error('A saved form with this name already exists');
    } else {
      toast.error(error.response?.data?.message || 'Failed to save form data');
    }
  } finally {
    storeSubmitting.value = false;
  }
}

// Load off-canvas functions
async function openLoadOffcanvas() {
  // If called from the main-form toolbar button there's no active context yet;
  // assume main-form scope.
  if (!storeCtx.value) storeCtx.value = buildMainStoreCtx();
  const ctx = storeCtx.value;
  showLoadOffcanvas.value = true;
  loadSubmitting.value = true;

  try {
    const response = await axios.get(
      `/api/v2/stored-jobs?form_name=${encodeURIComponent(ctx.formName)}`,
      TokenStorage.getAuthentication(),
    );
    storedJobs.value = response.data.records || [];
  } catch (error) {
    console.error('Error fetching stored jobs:', error);
    toast.error('Failed to load saved forms');
    storedJobs.value = [];
  } finally {
    loadSubmitting.value = false;
  }
}

function closeLoadOffcanvas() {
  showLoadOffcanvas.value = false;
}

async function loadStoredJob(storedJob) {
  try {
    loadSubmitting.value = true;

    const parsedData = JSON.parse(storedJob.form_data);
    const ctx = storeCtx.value || buildMainStoreCtx();
    ctx.onLoad(parsedData);

    closeLoadOffcanvas();
    toast.success(`Loaded "${storedJob.name}"`);
  } catch (error) {
    console.error('Error loading stored job:', error);
    toast.error('Failed to load form data');
  } finally {
    loadSubmitting.value = false;
  }
}

// Triggered by store / load actions inside a subform's Save dropdown.
// `value` is the current in-progress draft emitted by AppForm so we can
// snapshot partial edits without forcing validation.
function handleSubformAction(entry, { action, value }) {
  storeCtx.value = {
    scope: 'subform',
    formName: entry.subform.name,
    title: entry.subform.description || entry.subform.name,
    getData: () => value,
    onLoad: (parsed) => {
      entry.snapshot = parsed;
      entry.reloadKey = (entry.reloadKey || 0) + 1;
    },
  };
  if (action === 'store') openStoreOffcanvas();
  else if (action === 'load') openLoadOffcanvas();
}

// trigger a job abort
async function abortJob(id) {
  // no id yet : the job is still being created
  if (!id) return;
  toast.warning('Aborting job ' + id);
  try {
    const result = await axios.post(`/api/v2/job/${id}/abort`, {}, TokenStorage.getAuthentication());
    if (result.status == 200) {
      abortTriggered.value = true;
    }
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err, 'Failed to abort job'));
  }
}
// download with axios
async function downloadWithAxios(url, headers) {
  const response = await axios({
    method: 'get',
    headers: headers.headers,
    url,
    responseType: 'arraybuffer',
  });
  Helpers.forceFileDownload(response);
}
// download a job
async function download(id) {
  try {
    await downloadWithAxios(`/api/v2/job/${id}/download`, TokenStorage.getAuthentication());
  } catch (err) {
    toast.error(err.toString());
  }
}
// get job output
async function getJob(id, final) {
  try {
    // get the job result
    const result = await axios.get(`/api/v2/job/${id}`, TokenStorage.getAuthentication());
    pollFailures.value = 0; // a poll got through : forget earlier blips
    // store the job result
    job.value = result.data;
    status.value = job.value.status;
    // multistep and subjobs ?
    if (job.value.job_type == 'multistep' && job.value.subjobs.length > 0) {
      const lastsubjob = job.value.subjobs.slice(-1)[0];
      try {
        const subjobresult = await axios.get(`/api/v2/job/${lastsubjob}`, TokenStorage.getAuthentication());
        subjob.value = subjobresult.data;
      } catch (e) {
        console.error('Error getting job : ' + lastsubjob);
      }
    }
    // if the job is not final, we need to keep checking
    if (!['success', 'error', 'failed', 'warning', 'rejected', 'abandoned', 'aborted'].includes(status.value)) {
      // try again
      if (status.value == 'approve') {
        State.refreshApprovals(); // refresh approvals if needed
      }
      timeout.value = setTimeout(async () => await getJob(id), 2000);
    } else {
      // the job seems finished
      if (!final) {
        // have we done a final result check?
        // 1 final check
        timeout.value = setTimeout(async () => await getJob(id, true), 2000);
      } else {
        // any frontend actions to do?
        if (currentForm.value.onFinish) {
          currentForm.value.onFinish.forEach((action) => doAction(action, id));
        }
        if (status.value == 'success' && currentForm.value.onSuccess) {
          currentForm.value.onSuccess.forEach((action) => doAction(action, id));
        }
        if (status.value == 'failed' && currentForm.value.onFailure) {
          currentForm.value.onFailure.forEach((action) => doAction(action, id));
        }
        if (status.value == 'aborted' && currentForm.value.onAbort) {
          currentForm.value.onAbort.forEach((action) => doAction(action, id));
        }
        abortTriggered.value = false;
        message.value = Helpers.getJobMessageByStatus(status.value);
        if (status.value == 'success') {
          toast.success(message.value);
        } else if (status.value == 'failed') {
          toast.error(message.value);
        } else {
          toast.warning(message.value);
        }
        clearTimeout(timeout.value);
        State.refreshApprovals(); // refresh approvals if needed
      }
    }
  } catch (err) {
    console.log('error getting job ' + err.toString());
    toast.error('Failed to get job');

    // optional chaining : on a network failure err.response is undefined, so this threw a
    // TypeError from inside the catch itself, killing the poll chain with an unhandled
    // rejection. launchForm and openLoadOffcanvas already use err.response?.status.
    if (err.response?.status != 401) {
      // Retry rather than ending the chain. This branch scheduled nothing, so a single
      // failed poll - a VPN reconnect, a laptop resume, a server restart - stopped the
      // polling for good while the job was still running. And "error" has no case in
      // formStatus, so it fell through to the "Pending" label with no spinner and no
      // abort button: the only way out was closing the output or reloading the page.
      pollFailures.value++;
      if (pollFailures.value < 5) {
        timeout.value = setTimeout(async () => await getJob(id), 2000);
      } else {
        message.value = 'Error in axios call to get job\n\n' + err.toString();
        status.value = 'error';
      }
    }
  }
}

// execute the form
async function launchForm(postdata) {
  message.value = 'Connecting with job api ';
  status.value = '';
  // the previous job is done with : until the server answers with the new id, the abort
  // button must not point at it (an abort clicked during the launch went to the old job)
  jobId.value = undefined;
  abortTriggered.value = false;
  try {
    status.value = 'running';
    const result = await axios.post(`/api/v2/job/`, postdata, TokenStorage.getAuthentication());
    jobId.value = result.data.id;
    if (currentForm.value.onSubmit) {
      currentForm.value.onSubmit.forEach((action) => {
        doAction(action, jobId.value);
      });
    }
    timeout.value = setTimeout(async () => await getJob(jobId.value), 2000);
  } catch (err) {
    status.value = 'failed';
    toast.error(Helpers.parseAxiosResponseError(err, 'Failed to invoke job launch'));
    if (err.response?.status != 401) {
      resetResult();
    }
  }
  pauseJsonOutput.value = false;
}

async function loadForm() {
  const formName = route.query.form ? decodeURIComponent(route.query.form) : undefined;
  if (!formName) {
    console.error('No form name provided in the URL');
    formNotFound.value = true;
    return;
  }
  if (route.query.preview) {
    const previewPayload = sessionStorage.getItem('designer-preview');
    let previewLoaded = false;
    if (previewPayload) {
      sessionStorage.removeItem('designer-preview');
      try {
        const { form, constants: previewConstants, subforms } = JSON.parse(previewPayload);
        const parsed = YAML.parse(form);
        // a comment-only / '---' buffer parses to null : that is not a form, and
        // wrapping it in forms:[null] would leave the page on the loader forever
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          console.error('Preview payload does not hold a form object');
          formNotFound.value = true;
          return;
        }
        // the designer resolves the subforms referenced by list/yaml fields and
        // wizard steps (the server does that on the normal path), otherwise a
        // wizard renders no steps and list fields render no columns
        if (Array.isArray(subforms) && !parsed.subforms) {
          parsed.subforms = subforms;
        }
        formConfig.value = { forms: [parsed], constants: previewConstants || {} };
        previewLoaded = true;
      } catch (e) {
        console.error('Failed to parse preview payload', e);
      }
    }
    if (!previewLoaded) {
      formConfig.value = await Form.load(formName);
    }
  } else {
    formConfig.value = await Form.load(formName);
  }
  if (formConfig.value.forms.length == 0) {
    console.error('No forms found in the configuration for form: ' + formName);
    formNotFound.value = true;
    return;
  } else {
    // Check for pre-fill data from query params BEFORE setting currentForm
    initialFormData.value = {};
    if (route.query.prefillJobId) {
      try {
        console.log('Loading pre-fill data from job:', route.query.prefillJobId);
        const result = await axios.get(
          `/api/v2/job/${route.query.prefillJobId}/rawformdata`,
          TokenStorage.getAuthentication(),
        );
        if (result.data) {
          initialFormData.value = result.data;
          toast.info(`Form pre-filled with data from previous job #${route.query.prefillJobId}`);
        } else {
          console.log('No data in result:', result.data);
        }
      } catch (err) {
        console.error('Failed to load pre-fill data:', err);

        let errorMessage = 'Failed to load previous job data';
        if (err.response?.data?.error) {
          errorMessage = err.response.data.error;
        } else if (err.response?.status === 404) {
          errorMessage = 'Previous job data not found or no longer available';
        } else if (err.response?.status === 403) {
          errorMessage = 'You do not have permission to relaunch jobs';
        } else if (err.response?.status === 400) {
          errorMessage = err.response.data?.error || 'Cannot load data: form mismatch';
        }

        toast.error(errorMessage);
      }
    }

    constants.value = formConfig.value.constants;

    // Now set currentForm which will trigger component rendering
    currentForm.value = formConfig.value.forms[0];
    formLoaded.value = true;

    // Initialize wizard drafts so v-model bindings have a stable target.
    if (Array.isArray(currentForm.value?.wizard)) {
      wizardIndex.value = 0;
      Object.keys(wizardDrafts).forEach((k) => delete wizardDrafts[k]);
      Object.keys(wizardVisibility).forEach((k) => delete wizardVisibility[k]);
      Object.keys(wizardSkipped).forEach((k) => delete wizardSkipped[k]);
      Object.keys(wizardCompleted).forEach((k) => delete wizardCompleted[k]);
      wizardRefs.value = {};
      currentForm.value.wizard.forEach((raw) => {
        if (raw?.summary) return;
        const stepName = raw.name || raw.subform;
        if (stepName) wizardDrafts[stepName] = {};
      });
    }

    // see if the help should be show initially
    if (currentForm.value?.showHelp && currentForm.value.showHelp === true) {
      showHelp.value = true;
    }
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) {
    return;
  }
  // A failed load used to leave the page on the bare spinner for ever: Form.load throws
  // on every non-200 (403 for a form your roles no longer grant, 404, 500 for a config
  // error) and nothing caught it, so currentForm stayed null and formNotFound stayed
  // false - the one branch that renders an explanation was never reached. The user got a
  // spinner, no toast, and only an unhandled rejection in devtools.
  try {
    await loadForm();
  } catch (err) {
    formNotFound.value = true;
    loadError.value = Helpers.parseAxiosResponseError(err, t('form.formNotFoundMsg'));
    toast.error(loadError.value);
  }
  resetResult();
});

// Watch for route changes to reload form when navigating with different query params
watch(
  () => route.query.form,
  async (newForm, oldForm) => {
    if (newForm && newForm !== oldForm) {
      console.log('Form query parameter changed, reloading form:', newForm);
      await reloadForm();
    }
  },
);

onBeforeUnmount(() => {
  clearTimeout(timeout.value);
  // the onSuccess/onFailure timers too : otherwise they navigate the router, or reload a
  // form, on a component that no longer exists
  for (const id of actionTimers.value) clearTimeout(id);
  actionTimers.value = [];
});
</script>

<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout" :class="{ 'd-none': hideForm }">
      <!-- the forms menu of the Forms page : the category browsed before opening the form
           highlighted ; a category goes back to the Forms page on it -->
      <AppFormsMenu class="d-none d-md-block" :currentCategory="menuCategory" @select="openCategory" />
      <div v-if="authenticated && currentForm" class="section container-fluid w-100 mt-3">
        <!-- BREADCRUMBS (only when editing a subform) -->
        <nav v-if="activeEntry" aria-label="breadcrumb">
          <ol class="breadcrumb mb-2">
            <li class="breadcrumb-item">{{ currentForm.name }}</li>
            <li v-for="e in editStack.slice(0, -1)" :key="'crumb-' + e.id" class="breadcrumb-item">{{ e.title }}</li>
            <li class="breadcrumb-item active fw-bold" aria-current="page">{{ activeEntry.title }}</li>
          </ol>
        </nav>

        <!-- TITLE : the form's (a subform's while editing one), its help in the info popover,
             its buttons at the right ; the divider under it, as on the other pages -->
        <div class="d-flex flex-wrap align-items-center border-bottom mb-3 pb-2 af-page-head">
          <h3 class="mb-0 me-3">
            {{ activeEntry ? activeEntry.subtitle || activeEntry.title : currentForm.name }}
            <AppInfoPopover
              v-if="activeEntry ? activeEntry.subform?.help : currentForm.help"
              :key="activeEntry ? 'help-' + activeEntry.id : 'help-form'"
              :text="activeEntry ? activeEntry.subform.help : currentForm.help"
              markdown
              placement="bottom"
              :startOpen="activeEntry ? activeEntry.showHelp : showHelp"
              :label="t('form.showHelp')"
            />
          </h3>
          <div class="d-flex flex-wrap align-items-center justify-content-end ms-auto af-form-buttons">
            <!-- a subform being edited : back to the form, load its values, its output -->
            <template v-if="activeEntry">
              <BsButton cssClass="text-nowrap" icon="arrow-left" @click="popEdit(activeEntry.id)">
                {{ t('form.back') }}
              </BsButton>
              <BsButton
                v-if="store.profile.options?.allowStoredJobs"
                cssClass="text-nowrap"
                icon="file-import"
                @click="handleSubformAction(activeEntry, { action: 'load', value: activeEntry.draft })"
              >
                {{ t('form.loadFromStore') }}
              </BsButton>
              <BsButton
                v-if="store.profile.options?.showExtraVars"
                cssClass="text-nowrap"
                cssClassToggle="text-nowrap"
                icon="eye"
                iconToggle="eye-slash"
                :toggle="showExtraVars"
                @click="toggleShowExtraVars()"
              >
                {{ t('form.showOutput') }}<template #toggle>{{ t('form.hideOutput') }}</template>
              </BsButton>
            </template>
            <!-- the form (or its wizard) : verbose, its extravars, reload, load its values -->
            <template v-else>
              <BsInputCheckboxRaw
                v-if="store.profile.options?.allowVerboseMode"
                v-model="enableVerbose"
                :label="'verbose'"
                cssClass="d-inline-block me-1"
              />
              <BsButton
                v-if="store.profile.options?.showExtraVars"
                cssClass="text-nowrap"
                cssClassToggle="text-nowrap"
                icon="eye"
                iconToggle="eye-slash"
                :toggle="showExtraVars"
                @click="toggleShowExtraVars()"
                >{{ t('form.showExtravars') }}<template #toggle>{{ t('form.hideExtravars') }}</template>
              </BsButton>
              <BsButton cssClass="text-nowrap" icon="redo" @click="reloadForm">
                {{ t('form.reloadForm') }}
              </BsButton>
              <BsButton
                v-if="store.profile.options?.allowStoredJobs"
                cssClass="text-nowrap"
                icon="file-import"
                @click="
                  storeCtx = buildMainStoreCtx();
                  openLoadOffcanvas();
                "
              >
                {{ t('form.loadFromStore') }}
              </BsButton>
            </template>
          </div>
        </div>
        <div class="row">
          <div class="col">
            <!-- WIZARD: stepper + per-step AppForm. Mounted instead of the
                 main form when currentForm.wizard is present. -->
            <div v-if="wizardActive && !activeEntry" class="mb-3">
              <!-- Per-step AppForm (or summary view) -->
              <template v-for="(step, idx) in wizardSteps" :key="step.name + ':' + key">
                <div v-show="idx === wizardIndex">
                  <!-- Step help -->
                  <div v-if="step.help && step.showHelp" class="alert alert-light" role="alert">
                    <vue-showdown :markdown="step.help" flavor="github" :options="{ ghCodeBlocks: true }" />
                  </div>

                  <!-- Regular subform step: stepper is injected into the
                       AppForm's #toolbarbuttons slot so it lands on the
                       same row as the show-hidden-fields / spinner icons. -->
                  <AppForm
                    v-if="!step.isSummary && step.subform"
                    mode="wizard"
                    :ref="(el) => setWizardRef(step.name, el)"
                    :currentForm="step.subform"
                    :constants="constants"
                    :subforms="currentForm?.subforms || []"
                    :rootFormName="currentForm?.name || ''"
                    :parentData="wizardParentData"
                    :showExtraVars="showExtraVars"
                    :initialData="wizardDrafts[step.name] || {}"
                    v-model="wizardDrafts[step.name]"
                    @change="(d) => wizardStepChanged(step.name, d)"
                  >
                    <template #toolbarbuttons>
                      <ol class="ansibleforms-wizard-stepper d-flex flex-wrap align-items-center list-unstyled mb-0">
                        <template v-for="(s, i) in wizardSteps" :key="'sb-' + s.name">
                          <li
                            v-if="isWizardStepVisible(s) || wizardSkipped[s.name]"
                            class="wizard-step d-flex align-items-center"
                            :class="{ active: i === wizardIndex }"
                          >
                            <button
                              type="button"
                              class="wizard-step-btn"
                              :title="s.title"
                              :class="[
                                i === wizardIndex
                                  ? 'is-current'
                                  : wizardSkipped[s.name]
                                    ? 'is-skipped'
                                    : wizardCompleted[s.name]
                                      ? 'is-done'
                                      : 'is-pending',
                              ]"
                              @click="wizardGoTo(i)"
                            >
                              <i v-if="wizardSkipped[s.name]" class="fa fa-forward"></i>
                              <i v-else-if="s.isSummary" class="fa fa-list-check"></i>
                              <i v-else-if="wizardCompleted[s.name]" class="fa fa-check"></i>
                              <span v-else>{{ i + 1 }}</span>
                            </button>
                            <span class="wizard-step-label ms-2 small">{{ s.title }}</span>
                            <span v-if="i < wizardSteps.length - 1" class="wizard-step-connector"></span>
                          </li>
                        </template>
                      </ol>
                    </template>
                  </AppForm>

                  <!-- Missing subform reference -->
                  <div v-else-if="!step.isSummary && !step.subform" class="alert alert-danger">
                    {{ t('form.wizardMissingSubform') || 'Wizard step references unknown subform' }}:
                    <strong>{{ step.subformName }}</strong>
                  </div>

                  <!-- Summary step: synthetic toolbar row (so the stepper
                       still appears in the same place as it does for
                       regular steps) + per-step status overview body. -->
                  <div v-else-if="step.isSummary">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                      <ol class="ansibleforms-wizard-stepper d-flex flex-wrap align-items-center list-unstyled mb-0">
                        <template v-for="(s, i) in wizardSteps" :key="'sm-' + s.name">
                          <li
                            v-if="isWizardStepVisible(s) || wizardSkipped[s.name]"
                            class="wizard-step d-flex align-items-center"
                            :class="{ active: i === wizardIndex }"
                          >
                            <button
                              type="button"
                              class="wizard-step-btn"
                              :title="s.title"
                              :class="[
                                i === wizardIndex
                                  ? 'is-current'
                                  : wizardSkipped[s.name]
                                    ? 'is-skipped'
                                    : wizardCompleted[s.name]
                                      ? 'is-done'
                                      : 'is-pending',
                              ]"
                              @click="wizardGoTo(i)"
                            >
                              <i v-if="wizardSkipped[s.name]" class="fa fa-forward"></i>
                              <i v-else-if="s.isSummary" class="fa fa-list-check"></i>
                              <i v-else-if="wizardCompleted[s.name]" class="fa fa-check"></i>
                              <span v-else>{{ i + 1 }}</span>
                            </button>
                            <span class="wizard-step-label ms-2 small">{{ s.title }}</span>
                            <span v-if="i < wizardSteps.length - 1" class="wizard-step-connector"></span>
                          </li>
                        </template>
                      </ol>
                      <div></div>
                    </div>
                    <p class="text-muted">{{ t('form.wizardSummaryDescription') }}</p>
                    <ul class="list-group">
                      <li
                        v-for="s in wizardSummaryRows"
                        :key="'sum-' + s.name"
                        class="list-group-item d-flex justify-content-between align-items-center"
                        :class="{ 'list-group-item-action': s.status !== 'hidden' }"
                        :role="s.status !== 'hidden' ? 'button' : null"
                        @click="s.status !== 'hidden' && wizardGoTo(s.index)"
                      >
                        <span>
                          <i
                            class="fa me-2"
                            :class="{
                              'fa-check text-success': s.status === 'ok',
                              'fa-forward text-warning': s.status === 'skipped',
                              'fa-eye-slash text-muted': s.status === 'hidden',
                              'fa-circle-exclamation text-danger': s.status === 'pending',
                            }"
                          ></i>
                          <strong>{{ s.title }}</strong>
                          <small class="text-muted ms-2">{{ s.statusLabel }}</small>
                        </span>
                        <i v-if="s.status !== 'hidden'" class="fa fa-pen text-muted"></i>
                      </li>
                    </ul>
                  </div>
                </div>
              </template>

              <!-- Navigation footer -->
              <div class="d-flex justify-content-between align-items-center mt-3">
                <div>
                  <BsButton v-if="wizardIndex > 0" icon="arrow-left" colorClass="secondary" @click="wizardBack">
                    {{ t('form.back') || 'Back' }}
                  </BsButton>
                </div>
                <div class="d-flex gap-2">
                  <BsButton
                    v-if="activeWizardStep?.optional && !activeWizardStep?.isSummary"
                    icon="forward"
                    colorClass="warning"
                    @click="wizardSkipCurrent"
                  >
                    {{ t('form.skip') || 'Skip' }}
                  </BsButton>
                  <BsButton
                    v-if="wizardIndex < wizardLastInputIndex || (wizardHasSummary && !activeWizardStep?.isSummary)"
                    icon="arrow-right"
                    colorClass="primary"
                    @click="wizardNext"
                  >
                    {{ t('form.next') || 'Next' }}
                  </BsButton>
                  <BsDropdownButton
                    v-else
                    :icon="status === 'initializing' || status === 'submitting' ? 'spinner' : 'circle-play'"
                    :label="t('form.submit')"
                    colorClass="primary"
                    :actions="wizardSubmitActions"
                    :disabled="status !== ''"
                    @click="handleWizardSubmitAction('submit')"
                    @action="handleWizardSubmitAction"
                  />
                </div>
              </div>
            </div>

            <!-- MAIN FORM: mounted always, hidden while editing a subform or running a wizard -->
            <AppForm
              v-if="!wizardActive"
              ref="mainForm"
              v-show="!activeEntry"
              :key="key"
              @change="formChanged"
              :currentForm="currentForm"
              :constants="constants"
              :showExtraVars="showExtraVars"
              :fileProgress="fileProgress"
              :initialData="initialFormData"
              v-model="form"
              :subforms="currentForm?.subforms || []"
              v-model:status="status"
              @submit-action="handleSubmitAction"
            >
            </AppForm>

            <!-- SUBFORMS: one AppForm per stacked edit, only the deepest is visible. -->
            <!-- Kept mounted (v-show) so draft state survives when going deeper and back. -->
            <template v-for="(entry, i) in editStack" :key="entry.id + ':' + (entry.reloadKey || 0)">
              <AppForm
                v-show="i === editStack.length - 1"
                mode="subform"
                :currentForm="entry.subform"
                :constants="constants"
                :subforms="currentForm?.subforms || []"
                :rootFormName="currentForm?.name || ''"
                :initialData="entry.snapshot"
                :parentData="entry.parentData"
                v-model="entry.draft"
                @save="(val) => saveEdit(entry.id, val)"
                @cancel="popEdit(entry.id)"
                @submit-action="(e) => handleSubformAction(entry, e)"
              >
              </AppForm>
            </template>
          </div>
          <div class="col-4" v-if="showExtraVars">
            <div class="d-flex justify-content-between">
              <div>
                <small v-if="activeEntry" class="text-muted fst-italic me-2">
                  {{ displayedOutputTitle }}
                </small>
                <BsButton
                  cssClass="btn-sm"
                  cssClassToggle="btn-sm"
                  :toggle="viewAsYaml"
                  @click="viewAsYaml = !viewAsYaml"
                >
                  <template #default>{{ t('form.viewAsYaml') }}</template>
                  <template #toggle>{{ t('form.viewAsJson') }}</template>
                </BsButton>
              </div>
              <!-- TOOLBAR ICONS-->
              <div>
                <span
                  class="ms-2"
                  role="button"
                  :title="t('form.copyExtravars')"
                  @click="clip(displayedOutput, false, viewAsYaml)"
                >
                  <font-awesome-icon icon="copy" class="text-primary" />
                </span>
              </div>
            </div>
            <div class="mt-4 p-3 card" v-if="!viewAsYaml">
              <VueJsonPretty :data="displayedOutput" />
            </div>
            <div class="mt-4 p-3 card" v-else>
              <pre
                v-highlightjs
              ><code language="yaml" style="border:none;padding:0">{{ displayedOutputYaml }}</code></pre>
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="!formNotFound" class="loader mx-auto">
        <div class="spinner-border" role="status">
          <span class="visually-hidden">{{ t('form.loading') }}</span>
        </div>
      </div>
      <div v-else class="alert alert-danger mt-5" role="alert">
        <h4 class="alert-heading">{{ t('form.formNotFound') }}</h4>
        <p>
          {{ loadError || t('form.formNotFoundMsg') }}
        </p>
      </div>
    </main>
  </div>

  <div class="flex-shrink-0" v-if="status != ''">
    <main class="d-flex container-xxl">
      <div class="container-fluid py-3">
        <div class="row my-3">
          <div class="col">
            <div class="d-grid">
              <button
                type="button"
                class="btn text-white"
                :class="'btn-' + formStatus.color"
                @click="resetResult()"
                :disabled="formStatus.disabled"
              >
                <FaIcon :icon="formStatus.icon"></FaIcon><span class="ms-3">{{ formStatus.label }}</span>
              </button>
            </div>
          </div>
          <div class="col" v-if="formStatus.abort && jobId && !abortTriggered && (currentForm.abortable || true)">
            <div class="d-grid">
              <button type="button" class="btn btn-danger text-white" @click="abortJob(jobId)">
                <FaIcon icon="stop"></FaIcon><span class="ms-3">{{ t('form.abort') }}</span>
              </button>
            </div>
          </div>
        </div>
        <BsButton
          v-if="status != ''"
          icon="filter"
          cssClass="btn-sm mb-3"
          cssClassToggle="btn-sm mb-3"
          iconToggle="filter-circle-xmark"
          :toggle="filterOutput"
          @click="filterOutput = !filterOutput"
        >
          <template #default>{{ t('form.applyFilter') }}</template>
          <template #toggle>{{ t('form.removeFilter') }}</template>
        </BsButton>
        <!-- awx workflow graph (only for awx workflow jobs) -->
        <div class="row" v-if="job.awx_workflow?.nodes?.length">
          <div class="col">
            <AppAwxWorkflow :workflow="job.awx_workflow" />
          </div>
        </div>
        <div class="row">
          <div class="col">
            <AppAnsibleOutput :output="filteredJobOutput" :jobLog="job.job_log">
              <template #title>
                <h3 v-if="job.job_type == 'multistep' && subjob?.output">
                  {{ t('form.mainJob') }} (jobid {{ job.id }})
                  <sup
                    ><span class="badge rounded-pill status" :class="Helpers.getColorClassByStatus(job.status, 'bg')">{{
                      job.status
                    }}</span></sup
                  >
                </h3>
              </template>
            </AppAnsibleOutput>
          </div>
          <div class="col" v-if="subjob.output">
            <AppAnsibleOutput :output="filteredSubJobOutput" :jobLog="subjob.job_log">
              <template #title>
                <h3>
                  {{ t('form.currentStep') }} (jobid {{ subjob.id }})
                  <sup
                    ><span
                      class="badge rounded-pill status"
                      :class="Helpers.getColorClassByStatus(subjob.status, 'bg')"
                      >{{ subjob.status }}</span
                    ></sup
                  >
                </h3>
              </template>
            </AppAnsibleOutput>
          </div>
        </div>

        <BsButton v-if="status != 'executing'" icon="rotate-right" @click="resetResult()">{{
          t('form.closeOutput')
        }}</BsButton>
        <BsButton v-if="status != 'executing'" cssClass="ms-3" icon="download" @click="download(jobId)"
          >{{ t('form.downloadOutput') }}
        </BsButton>
      </div>
    </main>
  </div>

  <!-- SCHEDULE OFF-CANVAS -->
  <BsOffCanvas
    :show="showScheduleOffcanvas"
    :title="scheduleAction === 'schedule' ? t('form.createSchedule') : t('form.runLater')"
    :icon="scheduleAction === 'schedule' ? 'calendar-plus' : 'clock'"
    @close="closeScheduleOffcanvas"
  >
    <template #default>
      <div class="mb-3">
        <label class="form-label">{{ t('form.scheduleName') }} <span class="text-danger">*</span></label>
        <input
          type="text"
          class="form-control"
          v-model="scheduleForm.name"
          :placeholder="scheduleAction === 'schedule' ? 'e.g., Daily Backup' : 'e.g., Maintenance Window'"
          :disabled="scheduleSubmitting"
        />
        <small class="form-text text-muted"
          >A descriptive name for this {{ scheduleAction === 'schedule' ? 'schedule' : 'job' }}</small
        >
      </div>

      <div class="mb-3" v-if="scheduleAction === 'schedule'">
        <label class="form-label">{{ t('form.cronExpression') }} <span class="text-danger">*</span></label>
        <input
          type="text"
          class="form-control font-monospace"
          v-model="scheduleForm.cron"
          placeholder="0 0 * * *"
          :disabled="scheduleSubmitting"
        />
        <small class="form-text text-muted">
          Examples:<br />
          <code>0 0 * * *</code> - Daily at midnight<br />
          <code>0 */6 * * *</code> - Every 6 hours<br />
          <code>0 9 * * 1-5</code> - Weekdays at 9am
        </small>
      </div>

      <div class="mb-3" v-if="scheduleAction === 'run-later'">
        <label class="form-label">{{ t('form.runAt') }} <span class="text-danger">*</span></label>
        <VueDatePicker v-model="scheduleForm.run_at" :disabled="scheduleSubmitting" :dark="store.theme === 'dark'" />
        <small class="form-text text-muted">Select the date and time to run this job once</small>
      </div>
    </template>
    <template #actions>
      <button class="btn btn-primary" @click="createSchedule" :disabled="scheduleSubmitting">
        <FaIcon :icon="scheduleSubmitting ? 'spinner' : 'save'" :spin="scheduleSubmitting" />
        <span class="ms-2">{{
          scheduleSubmitting
            ? t('form.creating')
            : scheduleAction === 'schedule'
              ? t('form.createSchedule')
              : t('form.scheduleJob')
        }}</span>
      </button>
    </template>
  </BsOffCanvas>

  <!-- STORE OFF-CANVAS -->
  <BsOffCanvas
    :show="showStoreOffcanvas"
    :title="storeCtx ? `${t('form.save')} ${storeCtx.title}` : t('form.saveFormData')"
    icon="file-export"
    @close="closeStoreOffcanvas"
  >
    <template #default>
      <div class="mb-3">
        <label class="form-label">{{ t('form.scheduleName') }} <span class="text-danger">*</span></label>
        <input
          type="text"
          class="form-control"
          v-model="storeForm.name"
          placeholder="e.g., Production Config"
          :disabled="storeSubmitting"
        />
      </div>

      <div class="mb-3">
        <label class="form-label">{{ t('form.description') }}</label>
        <textarea
          class="form-control"
          rows="3"
          v-model="storeForm.description"
          placeholder=""
          :disabled="storeSubmitting"
        />
      </div>

      <div class="mb-3">
        <label class="form-label">{{ t('form.expiresAt') }}</label>
        <VueDatePicker v-model="storeForm.expires_at" :disabled="storeSubmitting" :dark="store.theme === 'dark'" />
      </div>
    </template>
    <template #actions>
      <button class="btn btn-primary" @click="createStoredJob" :disabled="storeSubmitting">
        <FaIcon :icon="storeSubmitting ? 'spinner' : 'save'" :spin="storeSubmitting" />
        <span class="ms-2">{{ storeSubmitting ? t('form.saving') : t('form.save') }}</span>
      </button>
    </template>
  </BsOffCanvas>

  <!-- LOAD OFF-CANVAS -->
  <BsOffCanvas
    :show="showLoadOffcanvas"
    :title="storeCtx ? `${t('form.loadFromStore')} - ${storeCtx.title}` : t('form.loadSavedForm')"
    icon="file-import"
    @close="closeLoadOffcanvas"
  >
    <template #default>
      <div v-if="loadSubmitting" class="text-center py-4">
        <FaIcon icon="spinner" spin size="2x" />
        <p class="mt-2">{{ t('form.loadingSavedForms') }}</p>
      </div>

      <div v-else-if="storedJobs.length === 0" class="text-center py-4 text-muted">
        <FaIcon icon="inbox" size="3x" class="mb-3" />
        <p>{{ t('form.noSavedForms') }}</p>
      </div>

      <div v-else class="list-group">
        <a
          v-for="job in storedJobs"
          :key="job.id"
          href="#"
          class="list-group-item list-group-item-action"
          @click.prevent="loadStoredJob(job)"
        >
          <div class="d-flex w-100 justify-content-between align-items-start">
            <div>
              <h6 class="mb-1">{{ job.name }}</h6>
              <p v-if="job.description" class="mb-1 small text-muted">{{ job.description }}</p>
              <small class="text-muted">
                {{ t('form.created') }}: {{ Time.format(job.created_at) }}
                <span v-if="job.expires_at"> • {{ t('form.expires') }}: {{ Time.format(job.expires_at) }}</span>
              </small>
            </div>
          </div>
        </a>
      </div>
    </template>
  </BsOffCanvas>
</template>
<style scoped lang="scss">
/* the form's buttons on its title line : the gap of the other pages' buttons */
.af-form-buttons {
  gap: 0.5rem;
}
*:has(.loader) {
  display: flex-columns;
  justify-content: center;
  align-items: center;
  margin: auto;
}

.badge.status {
  font-size: 0.75rem;
}

// Compact stepper used in the wizard's toolbar row. Sits inline with
// AppForm's right-side icon-buttons (spinner, show hidden, warnings).
.ansibleforms-wizard-stepper {
  .wizard-step:not(:last-child) .wizard-step-label {
    margin-right: 0.25rem;
  }

  .wizard-step-btn {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    line-height: 1;
    border: 1px solid transparent;
    background: var(--bs-body-bg, #fff);
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease;

    &.is-current {
      background: var(--bs-primary, #0d6efd);
      color: #fff;
      border-color: var(--bs-primary, #0d6efd);
      box-shadow: 0 0 0 0.15rem rgba(13, 110, 253, 0.25);
    }

    &.is-done {
      background: var(--bs-success, #198754);
      color: #fff;
      border-color: var(--bs-success, #198754);
    }

    &.is-skipped {
      background: transparent;
      color: var(--bs-warning, #ffc107);
      border-color: var(--bs-warning, #ffc107);
    }

    &.is-pending {
      background: transparent;
      color: var(--bs-secondary, #6c757d);
      border-color: var(--bs-secondary, #6c757d);
    }
  }

  .wizard-step-label {
    color: var(--bs-secondary, #6c757d);
    white-space: nowrap;
  }

  .wizard-step.active .wizard-step-label {
    color: var(--bs-body-color);
    font-weight: 600;
  }

  .wizard-step-connector {
    display: inline-block;
    width: 1rem;
    height: 1px;
    background: var(--bs-border-color, #dee2e6);
    margin: 0 0.25rem;
  }
}
</style>
