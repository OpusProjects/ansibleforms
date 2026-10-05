<script setup>
/******************************************************************/
/*                                                                */
/*  App AnsibleForms Form component                               */
/*  From yaml, builds a form                                      */
/*  Including validations, defaults, dependencies, ...            */
/*  Dynamic fields are evaluated                                  */
/*                                                                */
/*  @props:                                                       */
/*      currentForm: Object                                       */
/*      constants: Object                                         */
/*      status: String                                            */
/*      submitLabel: String                                       */
/*      submitIcon: String                                        */
/*      showExtraVars: Boolean                                    */
/*      fileProgress: Object                                      */
/*                                                                */
/*  @emits:                                                      */
/*      update:status                                             */
/*      change                                                    */
/*      submit                                                    */
/*      abort                                                     */
/*                                                                */
/******************************************************************/

import { useRoute } from 'vue-router';
import { toast } from 'vue-sonner';
import { useVuelidate } from '@vuelidate/core';
import { useTemplateRef, nextTick, inject, toRaw } from 'vue';
import { useAppStore } from '@/stores/app';
import Helpers from '@/lib/Helpers';
import { buildVuelidateRules } from '@/lib/validationRules';
import HtmlSanitizer from '@/lib/HtmlSanitizer';
import TokenStorage from '@/lib/TokenStorage';
import axios from 'axios';
import YAML from 'yaml';

// INIT
//----------------------------------------------------------------

// for vuelidate, no ref needed, a ref will be created by useVuelidate
var v$ = null;

// use
const route = useRoute();
const { t } = useI18n();

const store = useAppStore();

// define
const emit = defineEmits(['update:status', 'change', 'submit-action', 'abort', 'save', 'cancel']);

const form = defineModel();

// PROPS
//----------------------------------------------------------------

const props = defineProps({
  currentForm: {
    type: Object,
    required: true,
  },
  constants: {
    type: Object,
    required: true,
  },
  status: {
    type: String,
    default: '',
  },
  submitLabel: {
    type: String,
    default: '',
  },
  submitIcon: {
    type: String,
    default: 'circle-play',
  },
  showExtraVars: {
    type: Boolean,
    default: false,
  },
  fileProgress: {
    type: Object,
    default: () => {
      return {};
    },
  },
  initialData: {
    type: Object,
    default: () => {
      return {};
    },
  },
  // 'form' (default) renders the full form including submit buttons,
  // status bar and job-launching UI handled by the parent page.
  // 'subform' renders only the fields and validation, with Save/Cancel
  // buttons. Used by AppListField to edit a single row of a list.
  // 'wizard' renders only the fields and validation, with no footer
  // buttons (the wizard parent owns Back/Next/Skip/Submit). Use the
  // exposed `validateForm()` method to gate navigation.
  mode: {
    type: String,
    default: 'form',
    validator: (v) => ['form', 'subform', 'wizard'].includes(v),
  },
  // Optional array of subform definitions (validated forms of type
  // "subform") provided by the server alongside a form. Propagated
  // down so nested <AppListField> fields can resolve their target
  // subform without extra API calls.
  subforms: {
    type: Array,
    default: () => [],
  },
  // Parent form data injected into subforms as __parent__ so fields
  // can cross-reference the parent form's values via $(____parent__.field).
  parentData: {
    type: Object,
    default: () => null,
  },
  // Name of the ROOT form when `currentForm` is a subform (a wizard step or a
  // list row being edited). Empty when this component IS the root form.
  //
  // The query endpoint resolves a field from the form definition, and a subform
  // cannot be resolved on its own: the schema forbids it from carrying `roles`,
  // so the server's role check denies it to every non-admin and Form.load throws.
  // Sending the subform's own name therefore answered 500 on every query field in
  // a wizard step or a list row - for everyone except an admin, who short-circuits
  // the role check and so never saw it. The root form is what carries the roles,
  // and the server looks the subform up inside it.
  rootFormName: {
    type: String,
    default: '',
  },
});

// Edit stack injected from the parent form page (provided by form.vue).
// Used to open subform editors for yaml+subform fields.
const editStack = inject('formEditStack', null);

// DATA
//----------------------------------------------------------------

const interval = ref(undefined); // interval how fast fields need to be re-evaluated and refreshed
const externalData = ref({}); // object to hold external data
const hideForm = ref(false); // flag to hide form
const watchdog = ref(0); // main loop counter
const loopDelay = ref(100); // main loop delay
const isInitializing = ref(false); // flag set during pre-fill initialization to suppress defaults
// A prefill (relaunch with edit values / load from store) is RETAINED for the whole init
// phase instead of being consumed on first use. Deleting it on apply used to destroy the
// value it had just restored: initiateDefaults only hands a prefill back as the field's
// default while the entry still exists, so the next resetField wrote the field's ORIGINAL
// default (typically the `__auto__` sentinel) straight over the restored value, with no
// way back. Retention makes a reset cost a re-evaluation instead of the value.
const prefillValues = ref({}); // the restored values, field-filtered; never deleted from during init
const prefillApplied = ref({}); // name -> true once applied and still matching
const prefillFlagged = ref({}); // name -> reason; terminal, never applied
const prefillApplyCount = ref({}); // name -> how many times we actually had to WRITE it
const waitingFields = ref({}); // name -> true while its dependencies are not evaluated yet
const cycleFields = ref({}); // name -> true; in a dependency cycle or force-released, exempt from the gate
const warnedOnce = ref({}); // dedup key -> true, for warnings raised from inside the loop
// Bumped whenever the form actually gets somewhere - a field reaches a status it did not
// have, or a value is restored. The stall watchdog watches THIS rather than elapsed time, so
// a deep chain of slow queries is never mistaken for a form that is stuck.
const progressCounter = ref(0);
const MAX_PREFILL_APPLIES = 10; // re-applying a prefill this often means the chain above it never settles
const protectedFields = ref({}); // tracks fields with prefill/manual values that should not be reset
const dynamicFieldDependencies = ref({}); // which fields need to be re-evaluated if other fields change
const dynamicFieldDependentOf = ref({}); // which fields are dependend from others
const unevaluatedFields = ref([]); // list of unevaluatedFields
const defaults = ref({}); // holds default info per field
const dynamicFieldStatus = ref({}); // holds the status of dynamics fields (running=currently being evaluated, variable=depends on others, fixed=only need 1-time lookup, default=has defaulted, undefined=trigger eval/query)
const queryresults = ref({}); // holds the results of dynamic dropdown boxes
const queryerrors = ref({}); // holds errors of dynamic dropdown boxes
const fieldOptions = ref({}); // holds a couple of fieldoptions for fast access (valueColumn,ignoreIncomplete, ...), only for expression, query and list

const warnings = ref([]); // holds form warnings.
const showWarnings = ref(false); // flag to show/hide warnings
const visibility = ref({}); // holds which fields are visiable or not
const canSubmit = ref(false); // flag must be true to enable submit - allows to finish background queries - has a watchdog in case not possible
const validationsLoaded = ref(false); // ready flag if field validations are ready, we don't show the form otherwise
const pretasksFinished = ref(false); // ready flag for form pre tasks (future use - use to be gitpulls)
const timeout = ref(undefined); // determines how long we should show the result of run
const showHidden = ref(false); // flag to show/hide hidden field / = debug mode
const pauseJsonOutput = ref(false); // flag to pause jsonoutput interval
const containerSize = ref({
  x: 0,
  width: 0,
}); // width of container

const containerRef = useTemplateRef('containerRef');

// Define submit dropdown actions
const submitActions = computed(() => [
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

// COMPUTED
//----------------------------------------------------------------

const status = computed({
  get() {
    return props.status;
  },
  set(value) {
    emit('update:status', value);
  },
});

const showDebugButtons = computed(() => {
  return store.profile.options?.showDebugButtons;
});

// calculated fields that are not yet evaluated
const unevaluatedFieldsWarning = computed(() => {
  if (canSubmit.value) {
    return undefined;
  } else {
    // one sentence per language and count : "x is unevaluated", "x, y are unevaluated"
    return t('form.unevaluated', { fields: unevaluatedFields.value.join(', ') }, unevaluatedFields.value.length);
  }
});

// vuelidate rules - the rules themselves live in the form engine shared with the server
// (@engine/validate.js), so the MCP server and the launch validation apply the same ones
const rules = computed(() => {
  props.currentForm.fields.forEach((ff) => {
    if (!ff.label) {
      ff.label = ff.name;
    }
  });
  return {
    form: buildVuelidateRules(props.currentForm.fields, {
      getValue: (name) => form.value[name],
      getValues: () => form.value,
      resolve: (text) => replacePlaceholderInString(text, false),
      warn: (w) => warnings.value.push(w),
    }),
  };
});

// form is ready when all validations are loaded, the form is loaded and all pretasks are finished
const formIsReady = computed(() => validationsLoaded.value && pretasksFinished.value);

// set field groups in to groups
const fieldGroups = computed(() => {
  // bundle all groups and make unique
  return (
    props.currentForm.fields
      ?.reduce(
        (pV, cV) => {
          if ('group' in cV) {
            return [...pV, cV.group];
          } else {
            return pV;
          }
        },
        [''],
      )
      .filter((v, i, a) => a.indexOf(v) === i) || []
  );
});

// fields that don't declare a "line" get one of their own, so they end up on a
// row on their own.  Derived here instead of written back onto the currentForm
// definition.
const fieldLineMap = computed(() => {
  var linecount = 0;
  const lines = new Map();
  props.currentForm.fields?.forEach((cV) => {
    linecount++;
    lines.set(cV, 'line' in cV ? cV.line : `__line__${linecount}`);
  });
  return lines;
});

// the line a field belongs to, declared or synthetic
function fieldLine(field) {
  return 'line' in field ? field.line : fieldLineMap.value.get(field);
}

// set fieldLines in to groups
const fieldLines = computed(() => {
  return (
    props.currentForm.fields
      ?.reduce(
        (pV, cV) => {
          return [...pV, fieldLine(cV)];
        },
        [''],
      )
      .filter((v, i, a) => a.indexOf(v) === i) || []
  );
});

// flag if formloop is busy or not (evaluating fields)
const formLoopIsBusy = computed(() => loopDelay.value != 500);

// the interval to refresh json generation
const loopDivider = computed(() => 5000 / loopDelay.value);

// computed field labels with placeholder support
const fieldLabels = computed(() => {
  const labels = {};
  props.currentForm.fields?.forEach((field) => {
    if (field.label && typeof field.label === 'string' && /\$\(([^)]+)\)/.test(field.label)) {
      // Has placeholder - create reactive computed
      labels[field.name] = computed(() => {
        form.value; // Track form for reactivity
        const result = replacePlaceholderInString(field.label, false);
        return result.value !== undefined ? result.value : field.label;
      });
    } else {
      // No placeholder - use static value
      labels[field.name] = field.label || field.name;
    }
  });
  return labels;
});

// computed field help text with placeholder support
const fieldHelp = computed(() => {
  const help = {};
  props.currentForm.fields?.forEach((field) => {
    if (field.help && typeof field.help === 'string' && /\$\(([^)]+)\)/.test(field.help)) {
      // Has placeholder - create reactive computed
      help[field.name] = computed(() => {
        form.value; // Track form for reactivity
        const result = replacePlaceholderInString(field.help, false);
        return result.value !== undefined ? result.value : field.help;
      });
    } else {
      // No placeholder - use static value
      help[field.name] = field.help || '';
    }
  });
  return help;
});

// computed field placeholders with placeholder support
const fieldPlaceholders = computed(() => {
  const placeholders = {};
  props.currentForm.fields?.forEach((field) => {
    if (field.placeholder && typeof field.placeholder === 'string' && /\$\(([^)]+)\)/.test(field.placeholder)) {
      // Has placeholder - create reactive computed
      placeholders[field.name] = computed(() => {
        form.value; // Track form for reactivity
        const result = replacePlaceholderInString(field.placeholder, false);
        return result.value !== undefined ? result.value : field.placeholder;
      });
    } else {
      // No placeholder - use static value
      placeholders[field.name] = field.placeholder || '';
    }
  });
  return placeholders;
});

// METHODS
//----------------------------------------------------------------

function changed() {
  emit('change', { visibility: visibility.value });
}

// we inject the file into the form validation object
async function handleFiles(e) {
  const name = e.target.name;
  const files = e.target.files;
  if (!name) return;
  if (!files) return;
  form.value[name] = files[0];
  v$.value.form[name].$touch();
}

// handle blur event to touch field and show validation errors
function handleBlur(fieldName) {
  if (v$.value.form[fieldName]) {
    v$.value.form[fieldName].$touch();
  }
}

// get errors to display - validIf/validIfNot errors show immediately, others only when touched
function getErrorsToDisplay(fieldName) {
  const field = v$.value.form[fieldName];
  if (!field) return [];

  // Start with normal errors (for touched fields)
  let errorsToShow = [...field.$errors];

  // Add validIf/validIfNot errors even if field isn't touched (external validation)
  const silentErrors = field.$silentErrors || [];
  silentErrors.forEach((error) => {
    if (error.$params?.type === 'validIf' || error.$params?.type === 'validIfNot') {
      // Check if not already in errorsToShow
      if (!errorsToShow.find((e) => e.$uid === error.$uid)) {
        errorsToShow.push(error);
      }
    }
  });

  return errorsToShow;
}

// calculate the size of the container
function calcContainerSize() {
  var rect = containerRef.value?.getBoundingClientRect();
  if (rect) {
    containerSize.value.x = rect.x;
    containerSize.value.width = rect.width;
  }
}

// prevent default focus
function preventFocus(e) {
  e.preventDefault();
}

// set some expression field options
function setExpressionFieldEditable(fieldname, value) {
  if (
    typeof form.value[fieldname] == 'string' ||
    typeof form.value[fieldname] == 'number' ||
    form.value[fieldname] == undefined
  ) {
    fieldOptions.value[fieldname].editable = value;
  } else {
    toast.warning('You can only edit string or number expression fields.');
  }
  if (!value) {
    resetField(fieldname);
  }
}

function setExpressionFieldViewable(fieldname, value) {
  fieldOptions.value[fieldname].viewable = value;
}

function setExpressionFieldDebug(fieldname, value) {
  fieldOptions.value[fieldname].debug = value;
}

// copy to clipboard
function clip(v, doNotStringify = false) {
  try {
    Helpers.copyToClipboard(doNotStringify ? v : JSON.stringify(v))
      .then(() => toast.success(t('form.copiedToClipboard')))
      .catch((err) => toast.error(err?.message || err));
  } catch (err) {
    toast.error(err.toString());
  }
}

// copy YAML field to clipboard as YAML (modeled output, matching what user sees)
function clipYaml(fieldName) {
  try {
    const raw = form.value[fieldName];
    if (!raw) {
      toast.warning('No data to copy');
      return;
    }
    // Use __output__ (modeled) if available, otherwise fall back to raw
    // This matches what the user sees on screen
    const value = raw.__output__ ?? raw;
    const yamlContent = YAML.stringify(value);
    Helpers.copyToClipboard(yamlContent)
      .then(() => toast.success(t('form.copiedYamlToClipboard')))
      .catch((err) => toast.error(err?.message || err));
  } catch (err) {
    toast.error(err.toString());
  }
}

// Build the YAML preview for a `yaml`-typed field with a subform. The
// raw value carries the real password values so they can be saved /
// downloaded / copied verbatim, but the on-screen YAML masks any
// password-typed subform fields. Returns "" when there is no value to
// display (the template falls back to the placeholder).
function yamlSubformPreview(field) {
  const raw = form.value[field.name];
  if (!raw || typeof raw !== 'object') return '';
  const value = raw.__output__ ?? raw;
  const resolvedSubform = field.subform ? props.subforms.find((s) => s.name === field.subform) : null;
  const masked = resolvedSubform?.fields
    ? Helpers.maskPasswordsForDisplay(value, resolvedSubform.fields, props.subforms || [])
    : value;
  return YAML.stringify(masked);
}

// Create a list of fields per group
function filterfieldsByGroup(group) {
  return props.currentForm.fields.filter((el) => {
    return (
      (('group' in el && el.group === group) || (!('group' in el) && group == '')) &&
      (el.hide !== true || showHidden.value)
    );
  });
}

// create of fields per group & line
function filterfieldsByGroupAndLine(group, line) {
  const fields = filterfieldsByGroup(group).filter((el) => {
    return fieldLine(el) === line && (el.hide !== true || showHidden.value);
  });
  // console.log(`[${group || 'default'}] [${line}] => ${fields.map(x => x.name).join(",")}`)
  return fields;
}

// check if a field must be shown based on dependencies
function checkDependencies(field) {
  const dependencyFn = field.dependencyFn || 'and';
  const isAnd = dependencyFn == 'and' || dependencyFn == 'nand';
  const isOr = dependencyFn == 'or' || dependencyFn == 'nor';

  if ('dependencies' in field) {
    var result;
    if (dependencyFn == 'and' || dependencyFn == 'nand') {
      result = true; // and starts with true
    } else {
      result = false; // or starts with false
    }
    for (let i = 0; i < field.dependencies.length; i++) {
      const item = field.dependencies[i];
      var value;
      var column = '';
      var inversed = item.name.startsWith('!'); // detect ! => inversion
      var fieldname = inversed ? item.name.slice(1) : item.name; // drop the !
      var columnRegex = /(.+)\.(.+)/g; // detect a "." in the field
      var tmpArr = columnRegex.exec(fieldname); // found aaa.bbb
      var tmp;
      if (tmpArr && tmpArr.length > 0) {
        fieldname = tmpArr[1]; // aaa
        column = tmpArr[2]; // bbb
      } else {
        if (fieldname in fieldOptions.value) {
          column = fieldOptions.value[fieldname].valueColumn || ''; // get placeholder column
        }
      }
      if (column) {
        value = Helpers.getFieldValue(form.value[fieldname], column, false);
      } else {
        value = form.value[fieldname];
      }

      // dependency on validated
      if (item.isValid != undefined) {
        if (fieldOptions.value[fieldname]['hasDependencies'] || false) {
          tmp = item.isValid != v$.value.form[fieldname]?.$invalid && fieldOptions.value[fieldname]['dependencyOk'];
        } else {
          tmp = item.isValid != v$.value.form[fieldname]?.$invalid;
        }
        if (isAnd && ((!inversed && !tmp) || (inversed && tmp))) {
          result = false;
          // console.log("and not valid")
          break;
        }
        if (isOr && ((!inversed && tmp) || (inversed && !tmp))) {
          result = true;
          // console.log("or valid")
          break;
        }
      } else {
        tmp = item.values?.includes(value);
        if (isAnd && ((!inversed && !tmp) || (inversed && tmp))) {
          result = false;
          // console.log("and not valid")
          break;
        }
        if (isOr && ((!inversed && tmp) || (inversed && !tmp))) {
          result = true;
          // console.log("or valid")
          break;
        }
      }
    }
    // console.log("sub => " + result)
    // invert if nand or nor
    if (dependencyFn == 'nand' || dependencyFn == 'nor') {
      result = !result;
      // console.log("inverting")
    }
    // console.log("final => " + result)
    fieldOptions.value[field.name]['dependencyOk'] = result;
    if (result) {
      setVisibility(field.name, true);
    } else {
      setVisibility(field.name, false);
    }
  }
}

// set field visibility
function setVisibility(fieldname, status) {
  if (visibility.value[fieldname] != status) {
    visibility.value[fieldname] = status;
    // A prefilled/manually-set value - dependency-driven visibility flicker (the
    // dependencies: block re-evaluates every tick and can toggle before its own
    // dependent fields settle) must not wipe it, same guard evaluateDynamicFields
    // already applies when resetting a field's dependents.
    if (protectedFields.value[fieldname]) {
      return;
    }
    if (status) {
      // Field is becoming visible - reset to default value
      resetField(fieldname);
    } else {
      // Field is becoming hidden - clear its value to undefined
      form.value[fieldname] = undefined;
      setFieldStatus(fieldname, undefined);
      // Notify dependent fields that this field's value has changed to undefined -
      // checkDependencies drives this every tick automatically, not a user action
      evaluateDynamicFields(fieldname);
    }
  }
}

//----------------------------------------------------------------
// check if an entire group can be shown, based on field depencies
// hide a group if all fields inside are hidden
//----------------------------------------------------------------
function checkGroupDependencies(group) {
  var result = false;
  filterfieldsByGroup(group).forEach((item, _i) => {
    if (visibility.value[item.name]) {
      result = true;
    }
  });
  return result;
}

// get group class
function getGroupClass(group) {
  var result = [];
  if (checkGroupDependencies(group)) {
    result.push('card');
    if (group && props.currentForm.fieldGroupClasses) {
      var bg = props.currentForm.fieldGroupClasses[group];
      if (bg) result.push(bg);
    }
  }
  return result;
}

// reset value of field - only for expression
// Per-field generation counter.
//
// The loop tracked concurrency only through dynamicFieldStatus: "running" before the
// await, "fixed" after. But resetField - called whenever a dependency changes - sets the
// status back to undefined WHILE a request is in flight, so the next tick fires a second
// one and neither response carried any identity. Whichever landed last won: pick A=1
// (slow request starts), switch to A=2 (fast request returns, field correct), then the
// first response arrives and overwrites it with the value derived from A=1 - flagged
// "fixed", so nothing re-evaluates it and that is what gets submitted.
//
// Bumping this on every reset lets a response check whether it is still the current one.
const fieldGeneration = ref({});
function bumpFieldGeneration(fieldname) {
  fieldGeneration.value[fieldname] = (fieldGeneration.value[fieldname] || 0) + 1;
  return fieldGeneration.value[fieldname];
}
function isCurrentGeneration(fieldname, gen) {
  return (fieldGeneration.value[fieldname] || 0) === gen;
}

//----------------------------------------------------------------
// prefill (relaunch with edit values / load from store)
//----------------------------------------------------------------

// a warning the loop can raise without pushing the same text on every tick
function addWarningOnce(key, html) {
  if (warnedOnce.value[key]) return;
  warnedOnce.value[key] = html;
  warnings.value.push(html);
  showWarnings.value = false;
}

// take back a warning raised with addWarningOnce, once it no longer holds
function clearWarningOnce(key) {
  const html = warnedOnce.value[key];
  if (!html) return;
  delete warnedOnce.value[key];
  const i = warnings.value.indexOf(html);
  if (i >= 0) warnings.value.splice(i, 1);
}

// A field this one depends on has no value (yet) - typically an input the user has not
// filled in. The readiness gate lets such a field through (an input is final the moment
// it exists), so a placeholder on it cannot resolve : that is waiting for the user, not a
// reference that "never produced a value", and it must not be reported as one.
function dependsOnEmptyField(fieldname) {
  return (dynamicFieldDependentOf.value[fieldname] || []).some((dep) => {
    if (!(dep in fieldOptions.value) || visibility.value[dep] === false) return false;
    const v = form.value[dep];
    return (
      v === undefined ||
      v === null ||
      v === '' ||
      (Array.isArray(v) && v.length === 0) ||
      v === '__auto__' ||
      v === '__none__' ||
      v === '__all__'
    );
  });
}

// this field still wants its restored value
function isPrefillPending(fieldname) {
  return fieldname in prefillValues.value && !prefillApplied.value[fieldname] && !prefillFlagged.value[fieldname];
}

// give up on restoring this field, and say why - a flagged field no longer blocks
// initialisation from completing
function flagPrefill(fieldname, reason) {
  prefillFlagged.value[fieldname] = reason;
  addWarningOnce(
    `prefill:${fieldname}`,
    `<span class="text-warning">'${fieldname}' could not be pre-filled</span><br><span>${reason}</span>`,
  );
}

// Does the restored value still exist in the field's option list? Never set a value that is
// not one of the options - the select would report "no selection" and clear it again.
// Deliberately the same comparison BsInputSelectAdvancedTable.objectEqual makes: stricter
// here and we flag a value the dropdown would happily have shown; looser and we write one it
// then throws away.
function optionMatchesValue(option, value, valueColumn) {
  const o = toRaw(option);
  const v = toRaw(value);
  if (o && v && typeof o === 'object' && typeof v === 'object') {
    if (valueColumn && valueColumn in o && valueColumn in v) return o[valueColumn] === v[valueColumn];
    return JSON.stringify(o) === JSON.stringify(v);
  }
  if (o && typeof o === 'object') {
    const key = valueColumn && valueColumn in o ? valueColumn : Object.keys(o)[0];
    return o[key] === v;
  }
  return o === v;
}
function prefillMatchesOptions(fieldname, value) {
  const def = props.currentForm.fields.find((f) => f.name === fieldname);
  const options = def?.values || queryresults.value[fieldname] || [];
  const valueColumn = fieldOptions.value[fieldname]?.valueColumn || '';
  const wanted = [].concat(value ?? []);
  if (wanted.length === 0) return true; // restoring "nothing" is always possible
  return wanted.every((v) => options.some((o) => optionMatchesValue(o, v, valueColumn)));
}

// Apply a restored value. Safe to call repeatedly - it only counts an application when the
// value actually had to be written, so re-confirming an already-correct field never burns
// the watchdog budget; only genuine churn does.
function applyPrefill(fieldname, { validateOptions = false } = {}) {
  if (!(fieldname in prefillValues.value) || prefillFlagged.value[fieldname]) return false;
  const value = prefillValues.value[fieldname];
  if (validateOptions && !prefillMatchesOptions(fieldname, value)) {
    flagPrefill(fieldname, 'the stored value is no longer one of the available options');
    return false;
  }
  if (JSON.stringify(toRaw(form.value[fieldname])) !== JSON.stringify(toRaw(value))) {
    if ((prefillApplyCount.value[fieldname] || 0) >= MAX_PREFILL_APPLIES) {
      flagPrefill(
        fieldname,
        `it was restored ${MAX_PREFILL_APPLIES} times without settling - a field it depends on keeps changing`,
      );
      return false;
    }
    prefillApplyCount.value[fieldname] = (prefillApplyCount.value[fieldname] || 0) + 1;
    form.value[fieldname] = value;
  }
  if (!prefillApplied.value[fieldname]) progressCounter.value++;
  protectedFields.value[fieldname] = true;
  prefillApplied.value[fieldname] = true;
  setFieldStatus(fieldname, 'fixed');
  return true;
}

//----------------------------------------------------------------
// dependency readiness - a field may only evaluate once every field it
// references has actually been evaluated
//----------------------------------------------------------------

// A dependency is ready exactly when its value is substitutable into a placeholder: the
// accept-list below is the same one replacePlaceholderInString applies. "default" counts as
// ready on purpose - a field that legitimately failed and fell back to its default must not
// deadlock everything underneath it.
function isReadyDependency(fieldname) {
  if (!(fieldname in fieldOptions.value)) return true; // constants, credentials, env - always available
  if (!fieldOptions.value[fieldname].isDynamic) return true; // static: final once initForm ran
  if (visibility.value[fieldname] === false) return true; // deliberately undefined; waiting on it would deadlock
  if (cycleFields.value[fieldname]) return true; // cyclic or force-released, already warned
  const status = dynamicFieldStatus.value[fieldname];
  return status === 'fixed' || status === 'variable' || status === 'default';
}
function depsReady(fieldname) {
  return (dynamicFieldDependentOf.value[fieldname] || []).every(isReadyDependency);
}

function resetField(fieldname) {
  // reset to default value
  // reset this field status
  // console.log(`[${fieldname}] reset`)
  // While initialising, a reset means this field has to be restored again once its
  // options have reloaded - initiateDefaults below hands the prefilled value back as the
  // default, so the value survives, but it has to be re-confirmed as applied.
  if (isInitializing.value && fieldname in prefillValues.value) {
    prefillApplied.value[fieldname] = false;
  }
  initiateDefaults(fieldname);
  // any response still in flight for this field is now stale
  bumpFieldGeneration(fieldname);
  setFieldStatus(fieldname, undefined);
  form.value[fieldname] = defaults.value[fieldname];
}

// reset number field => input type number seems to evaluate to empty string instead of undefined
// Only called from the automatic loop today (an empty-string number field it just
// found), not from a template handler - treat it as system-driven.
function setFieldUndefined(fieldname) {
  // reset to undefined
  form.value[fieldname] = undefined;
  evaluateDynamicFields(fieldname);
  changed(); // refresh json output
}

// instead of taking the default value, see if it needs to be evaluated
// allowing dynamic defaults
function getDefaultValue(fieldname, value) {
  if (value != undefined) {
    var _value = replacePlaceholderInString(value).value;
    // console.log(`${fieldname} -> ${value} -> ${_value}`)
    if (fieldOptions.value[fieldname].evalDefault) {
      var r;
      try {
        r = Helpers.evalSandbox(_value);
        return r;
      } catch (err) {
        console.log(`Error evaluating default value : ${err.toString()}`);
      }
    } else {
      return _value;
    }
  } else {
    return value;
  }
}

// load default value in field => only for expressions
function setFieldToDefault(fieldname) {
  // reset to default value
  // console.log(`defaulting ${fieldname}`)
  try {
    // A field still waiting for its restored value must not be defaulted out from
    // under itself. This stays armed for the whole init phase now that prefills are
    // retained rather than consumed on first use.
    if (isInitializing.value && isPrefillPending(fieldname)) {
      return; // Don't apply default, let initialData win
    }

    // if there is a default, set "default" status
    if (defaults.value[fieldname] != undefined) {
      setFieldStatus(fieldname, 'default');
    } else {
      // if no default, set to undefined
      var prevState = dynamicFieldStatus.value[fieldname];

      if (prevState == 'running') {
        // console.log(`defaulting ${fieldname}`)
        // if the field was running, don't re-eval, we just did that
        setFieldStatus(fieldname, undefined, false);
      } else {
        // if the field was something diff, re-eval
        // console.log(`defaulting ${fieldname}`)
        setFieldStatus(fieldname, undefined, true);
      }
    }
    // set default value
    form.value[fieldname] = defaults.value[fieldname];
  } catch (err) {
    // this error should not hit, unless we have a bug
    console.log('Error: ' + err.toString());
    throw err;
  }
}

// set dynamic field status, only for expressions and lists
function setFieldStatus(fieldname, status, reeval = true) {
  // console.log(`[${fieldname}] ----> ${status}`)
  if (fieldOptions.value[fieldname]?.isDynamic) {
    var prevState = dynamicFieldStatus.value[fieldname];
    dynamicFieldStatus.value[fieldname] = status;
    if (prevState != status) progressCounter.value++;
    // evaluated after all : an earlier "could not be evaluated" was only too early
    if (status === 'fixed') clearWarningOnce(`unresolved:${fieldname}`);
    if (reeval && prevState != status) {
      // this field's value changed meaning, so everything downstream has to be
      // re-derived from it
      evaluateDynamicFields(fieldname);
    }
  }
}

// if 2 dependend fields (parent-child) both have defaults
// hasDefaultDependencies used to re-admit a field that had fallen back to "default" while a
// dependency was also stuck at "default" - a deliberate busy-loop, because nothing else
// would re-trigger it. It was inert for enum/query (dynamicFieldDependentOf only ever
// covered `expression` fields), and now that the map is complete it would fire on every tick
// for those too. The readiness gate replaces it: a field waits instead of defaulting, and
// when a dependency leaves "default" that status change already cascades a resetField
// through the reverse map.

// first time run, load all the default values (can be dynamic)
function initiateDefaults(fieldname = undefined) {
  props.currentForm.fields
    .filter((x) => !fieldname || fieldname == x.name)
    .forEach((item, _i) => {
      // During initialization the restored value IS the default. Reading the retained
      // snapshot (rather than a queue that gets consumed on first use) is what makes a
      // reset recoverable: resetField writes this back, instead of the field's original
      // default clobbering a value we had already restored correctly.
      if (isInitializing.value && item.name in prefillValues.value && !prefillFlagged.value[item.name]) {
        defaults.value[item.name] = prefillValues.value[item.name];
      } else if (item.name in externalData.value) {
        defaults.value[item.name] = externalData.value[item.name];
      } else {
        defaults.value[item.name] = getDefaultValue(item.name, item.default);
      }
    });
}

// add dynamic field dependency
function addDynamicFieldDependency(fields, field, foundfield) {
  var columnRegex = /([^.]+)\..+/g; // detect a "." in the field
  var tmpArr = columnRegex.exec(foundfield); // found aaa.bbb
  if (tmpArr && tmpArr.length > 0) {
    foundfield = tmpArr[1]; // aaa
  }
  foundfield = foundfield?.replace(/\[[0-9]*\]/, ''); // xxx[y] => xxx
  if (fields.includes(foundfield)) {
    // does field xxx exist in our form ?
    // The forward map (what a field depends ON) is written here, from the very same
    // scan as the reverse map, so the two can never disagree. It used to be built by a
    // separate pass that only looked at `expression` fields, leaving enum/query
    // with no entry at all - which meant the loop could not answer "are my dependencies
    // ready?" for exactly the fields that need it most.
    if (!(field in dynamicFieldDependentOf.value)) {
      dynamicFieldDependentOf.value[field] = [];
    }
    if (dynamicFieldDependentOf.value[field].indexOf(foundfield) === -1) {
      dynamicFieldDependentOf.value[field].push(foundfield);
    }
    if (foundfield in dynamicFieldDependencies.value) {
      // did we declare it before ?
      if (dynamicFieldDependencies.value[foundfield].indexOf(field) === -1) {
        // allready in there ?
        dynamicFieldDependencies.value[foundfield].push(field); // push it
        if (foundfield == field) {
          // we capture self references
          warnings.value.push(
            `<span class="text-warning">'${foundfield}' has a self reference</span><br><span>This will cause a racing condition</span>`,
          );
          toast.error("You defined a self reference on field '" + foundfield + "'");
        }
      }
    } else {
      dynamicFieldDependencies.value[foundfield] = [field];
      if (foundfield == field) {
        // we capture self references
        warnings.value.push(
          `<span class="text-warning">'${foundfield}' has a self reference</span><br><span>This will cause a racing condition</span>`,
        );
        toast.error("You defined a self reference on field '" + foundfield + "'");
      }
    }
  } else {
    // we capture bad references
    if (!Object.keys(form.value).includes(foundfield))
      warnings.value.push(
        `<span class="text-warning">'${field}' has a reference to unknown field '${foundfield}'</span><br><span>Your form might not function as expected</span>`,
      );
  }
}

// get placeholder matches
function getPlaceholderMatches(fields, field, s) {
  var matches = [];
  // console.log(typeof s)
  if (s && typeof s == 'string') {
    var testRegex = /\$\(([^)]+)\)/g;
    matches = s.matchAll(testRegex);
  }
  for (var match of matches) {
    // foundmatch = match[0];                                              // found $(xxx)
    var foundfield = match[1]; // found xxx
    addDynamicFieldDependency(fields, field, foundfield);
  }
}

// Find variable devDependencies
// we analyse which fields are dependent on others
// if they change, we then know which other fields to re-evaluate
function findVariableDependencies() {
  var temp = {};
  var finishedFlag = false;
  var fields = [];
  // create a list of the fields
  props.currentForm.fields.forEach((item, _i) => {
    if (!item?.name) return;
    fields.push(item.name);
  });
  // whilst checking, we also check if fields are unique
  var dups = Helpers.findDuplicates(fields);
  dups.forEach((item, _i) => {
    warnings.value.push(
      `<span class="text-warning">'${item}' has duplicates</span><br><span>Each field must have a unique name</span>`,
    );
    toast.error("You have duplicates for field '" + item + "'");
  });

  // check for reserved/internal field names that would cause conflicts
  const reservedNames = ['__user__', '__parent__', '__output__', '__jobid__'];
  // topFields from job.model.js - these are safe to use as they're wrapped and passed to playbooks
  const safeDoubleUnderscoreNames = [
    '__template__',
    '__awx__',
    '__runner__',
    '__playbook__',
    '__tags__',
    '__limit__',
    '__executionEnvironment__',
    '__check__',
    '__diff__',
    '__verbose__',
    '__keepExtravars__',
    '__credentials__',
    '__inventory__',
    '__awxCredentials__',
    '__ansibleCredentials__',
    '__vaultCredentials__',
    '__instanceGroups__',
    '__scmBranch__',
    '__playbookSubPath__',
  ];

  props.currentForm.fields.forEach((item) => {
    if (!item?.name) return;
    if (reservedNames.includes(item.name)) {
      warnings.value.push(
        `<span class="text-warning">'${item.name}' is a reserved field name</span><br><span>This will conflict with internal fields. Please choose a different name.</span>`,
      );
      toast.error(`Field name '${item.name}' is reserved for internal use`);
    }
    if (
      item.name.startsWith('__') &&
      !safeDoubleUnderscoreNames.includes(item.name) &&
      !reservedNames.includes(item.name)
    ) {
      warnings.value.push(
        `<span class="text-warning">'${item.name}' starts with '__' (double underscore)</span><br><span>This prefix is reserved for internal fields. Please choose a different name or use one of the documented field names.</span>`,
      );
      toast.error(`Field name '${item.name}' uses reserved prefix '__'`);
    }
  });

  // do the analysis
  props.currentForm.fields.forEach((item, _i) => {
    // while we are looping, we also check if there are issues
    if (!item?.name) return;
    if (item.dependencies) {
      item.dependencies.forEach((dep) => {
        const depBase = dep.name?.startsWith('!') ? dep.name.slice(1) : dep.name;
        const depRoot = depBase?.split('.')[0]; // handle dot-notation like CREDENTIALS.prompt_ontap
        if (!(fields.includes(depBase) || depRoot in form.value)) {
          warnings.value.push(
            `<span class="text-warning">'${item.name}' has bad dependencies</span><br><span>${dep.name} is not a valid field name</span>`,
          );
        }
      });
    }
    if (item.notIn && !fields.includes(item.notIn.field)) {
      warnings.value.push(
        `<span class="text-warning">'${item.name}' has bad 'notIn' validation</span><br><span>${item.notIn.field} is not a valid field name</span>`,
      );
    }
    if (item.in && !fields.includes(item.in.field)) {
      warnings.value.push(
        `<span class="text-warning">'${item.name}' has bad 'in' validation</span><br><span>${item.in.field} is not a valid field name</span>`,
      );
    }
    if (item.sameAs && !fields.includes(item.sameAs)) {
      warnings.value.push(
        `<span class="text-warning">'${item.name}' has bad 'sameAs' validation</span><br><span>${item.sameAs} is not a valid field name</span>`,
      );
    }

    getPlaceholderMatches(fields, item.name, item.expression ?? item.query);
    getPlaceholderMatches(fields, item.name, item.default);
    // A `dependencies:` block is a real dependency too - it decides whether this field
    // is even shown - so it belongs in the same graph as the $() references. Without
    // it, a field could be gated on a value it never waits for.
    if (item.dependencies) {
      item.dependencies.forEach((dep) => {
        if (!dep?.name) return;
        addDynamicFieldDependency(fields, item.name, dep.name.startsWith('!') ? dep.name.slice(1) : dep.name);
      });
    }
    // a dependent default that references another defaulted field is a known trap
    if (defaults.value[item.name] != undefined) {
      (dynamicFieldDependentOf.value[item.name] || []).forEach((foundfield) => {
        if (
          fieldOptions.value[foundfield] &&
          fieldOptions.value[foundfield].type == 'expression' &&
          defaults.value[foundfield] != undefined
        ) {
          warnings.value.push(
            `<span class="text-warning">'${item.name}' has a default, referencing field '${foundfield}' which also has a default</span><br><span>Try to avoid dependent fields with both a default</span>`,
          );
        }
      });
    }
  });

  // Check for self/circular references (A depends on B depends on ... depends on A) by
  // computing the transitive closure into a SEPARATE scratch map, not into
  // dynamicFieldDependencies itself. That used to be mutated into the closure directly,
  // so a field several hops upstream (e.g. `clusters`, at the root of a 7+ level chain
  // in a form like this one) reset every single downstream field on every transition,
  // not just its direct dependents - and each of those resets triggered its own status
  // transition, which triggered its own all-fields reset, compounding into a runaway
  // churn that never settled. dynamicFieldDependencies only needs the direct (one-hop)
  // edges: a dependent that's 2+ hops away still gets reset correctly, just one tick
  // later, as each intermediate field settles and cascades to ITS direct dependents in
  // turn - the normal, cheap way this is meant to propagate.
  var closureCheck = Helpers.deepClone(dynamicFieldDependencies.value);
  while (!finishedFlag) {
    finishedFlag = true;
    temp = Helpers.deepClone(closureCheck); // copy dependencies to temp
    for (const [key, value] of Object.entries(temp)) {
      // loop all found dependencies and dig deeper
      value.forEach((item, _i) => {
        if (item in temp) {
          // can we go deeper?
          temp[item].forEach((item2, _j) => {
            if (closureCheck[key].indexOf(item2) === -1) {
              // already in there?
              closureCheck[key].push(item2); // push it
              if (key == item2) {
                // we capture self references
                // A cycle can never satisfy the readiness gate - every member
                // waits for another member - so mark it exempt. Without this
                // a circular form would deadlock outright instead of merely
                // racing as it used to.
                cycleFields.value[key] = true;
                warnings.value.push(
                  `<span class="text-warning">'${key}' has a self reference</span><br><span>This will cause a racing condition</span>`,
                );
                toast.error("You defined a self reference on field '" + key + "'");
              }
              finishedFlag = false;
            }
          });
        }
      });
    }
  }
}

// findVariableDependentOf is gone: dynamicFieldDependentOf is now filled by
// addDynamicFieldDependency, from the same scan that fills dynamicFieldDependencies, so both
// directions always describe the same graph and every field type is covered.

/**
 * @param {'raw'|'expression'} mode
 *   'expression' substitutes each value as a JAVASCRIPT LITERAL and consumes the quotes
 *   around the placeholder if there were any, so `'$(host)'.toUpperCase()` becomes
 *   `"web01".toUpperCase()` rather than pasting the text straight in. Raw substitution
 *   meant a field value could close the string it sat in and run code - and field values
 *   are seedable from the URL query string, so a crafted link was enough.
 *   'raw' is the previous behaviour, still used for queries: JSON quoting would produce
 *   double quotes, which are not string literals in MySQL.
 */
function replacePlaceholderInString(value, ignoreIncomplete = false, mode = 'raw') {
  //---------------------------------------
  // replace placeholders if possible
  //---------------------------------------
  var testRegex = /\$\(([^)]+)\)/g; // a regex to find field placeholders $(xxx)
  var retestRegex = /\$\(([^)]+)\)/g; // the same regex, to retest after, because a regex can only be used once
  var match = undefined;
  var matches;
  var foundmatch;
  var column = '';
  var foundfield;
  var fieldvalue;
  var targetflag;
  var hasPlaceholders = false;
  // What each placeholder resolved to, keyed by the RAW text between the brackets.
  //
  // A query is no longer sent as finished SQL - the server takes the query text from
  // the form definition and substitutes these itself, so it cannot be told which SQL to
  // run. It needs the VALUES though, and it must be this map rather than a flat field
  // dump: resolution here understands `$(city.name)`, `$(rows[0].id)` and
  // `placeholderColumn` (which makes a bare `$(city)` mean that record's chosen column).
  // Re-deriving that server-side was a second implementation of this function and got
  // all three wrong - the dotted forms were left in the SQL verbatim and
  // placeholderColumn pasted the whole record instead of the column.
  var resolved = {};
  if (typeof value !== 'string') {
    return { hasPlaceholders: false, value: value, resolved: resolved };
  }
  value = value?.replace(/\n+/g, ''); // put everything in 1 line.
  matches = [...value.matchAll(testRegex)]; // force match array
  for (match of matches) {
    foundmatch = match[0]; // found $(xxx)
    foundfield = match[1]; // found xxx
    var columnRegex = /([^.]+)\.(.+)/g; // detect a "." in the field
    var tmpArr = columnRegex.exec(foundfield); // found aaa.bbb
    if (tmpArr && tmpArr.length > 0) {
      foundfield = tmpArr[1]; // aaa
      column = tmpArr[2]; // bbb
    } else {
      if (foundfield in fieldOptions.value) {
        column = fieldOptions.value[foundfield].placeholderColumn || ''; // get placeholder column
      }
    }
    foundfield = foundfield?.replace(/\[[0-9]*\]/, ''); // make xxx[y] => xxx
    fieldvalue = undefined;
    targetflag = undefined;
    // fieldvalue from the branch below is already JSON/JS source text (an array/object
    // literal), not a raw value - an 'expression' placeholder must splice it in as-is
    var isObjectLiteral = false;

    if (foundfield in form.value) {
      // does field xxx exist in our form ?
      if (
        fieldOptions.value[foundfield] &&
        (['expression', 'list', 'constant'].includes(fieldOptions.value[foundfield].type) || column.includes('.')) &&
        (typeof form.value[foundfield] == 'object' || Array.isArray(form.value[foundfield]))
      ) {
        // For list fields, each row carries __output__ (buildFormOutput result with
        // model/valueColumn applied). Use that for serialisation so parent expressions
        // see the shaped output, not the raw storage fields.
        if (fieldOptions.value[foundfield].type === 'list' && Array.isArray(form.value[foundfield])) {
          const _shaped = form.value[foundfield].map((row) => row.__output__ ?? row);
          fieldvalue = JSON.stringify(_shaped);
        } else {
          fieldvalue = JSON.stringify(Helpers.replacePlaceholders(match[1], form.value)); // allow full object reference
        }
        isObjectLiteral = true;
        // Only 'raw' (SQL) substitution wants the bare, unquoted string here - an
        // 'expression' placeholder is JS source, where a quoted string IS the
        // correct literal ; stripping it there left an array/object's own quotes
        // untouched, and re-quoting the whole thing below then turned e.g. a list
        // into a one-element array holding its own JSON text as a string.
        if (mode !== 'expression' && typeof fieldvalue == 'string') {
          // drop quotes if string
          fieldvalue = fieldvalue?.replace(/^\"+/, '').replace(/\"+$/, ''); // eslint-disable-line
        }
      } else {
        fieldvalue = Helpers.getFieldValue(form.value[foundfield], column, true); // get value of aaa.bbb
      }
      if (foundfield in dynamicFieldStatus.value) {
        targetflag = dynamicFieldStatus.value[foundfield]; // and what is the currect status of xxx, in case it's also dyanmic ?
      } else {
        targetflag = 'fixed';
      }
    }
    if (
      ((targetflag == 'variable' || targetflag == 'fixed' || targetflag == 'default') && fieldvalue !== undefined) ||
      ((ignoreIncomplete || false) && value !== undefined)
    ) {
      // valid value ?
      if (fieldvalue === undefined) {
        fieldvalue = '__undefined__'; // catch undefined values
      }
      if (fieldvalue === null) {
        fieldvalue = '__null__'; // catch null values
      }
      if (mode === 'expression' && fieldvalue !== '__undefined__' && fieldvalue !== '__null__') {
        // An expression is JS source, so the substitution depends on where the
        // placeholder sits : quotes that wrap it are replaced along with it by a JS
        // literal (an apostrophe in the value cannot break out), a placeholder inside
        // a longer string is escaped and spliced in as text (a JS literal there
        // injected its own quotes into the middle of the string), and outside a
        // string a literal keeps a number a number so `$(count) + 1` still adds.
        // The __undefined__/__null__ sentinels stay on the raw path because the
        // post-processing below strips their quotes by string match.
        // isObjectLiteral : fieldvalue is already valid JS/JSON source (array/object) -
        // stringifying it again would wrap it as a quoted string instead of splicing it in
        value = Helpers.substituteExpressionPlaceholder(value, foundmatch, fieldvalue, isObjectLiteral);
      } else {
        fieldvalue = stringifyValue(fieldvalue);
        // exactly what was substituted here, so the server substituting the same
        // template into the same text produces the same string
        resolved[match[1]] = fieldvalue;
        // same reason as above - a value carrying $& must not be re-interpreted
        value = value?.replace(foundmatch, () => fieldvalue); // replace the placeholder with the value
      }
    } else {
      value = undefined; // cannot evaluate yet
    }
    hasPlaceholders = true;
  }
  if (retestRegex.test(value)) {
    // still placeholders found ?
    value = undefined; // cannot evaluate yet
  }
  if (value != undefined) {
    value = value.replaceAll("'__undefined__'", 'undefined'); // replace undefined values
    value = value.replaceAll('__undefined__', 'undefined');
    value = value.replaceAll("'__null__'", 'null'); // replace undefined values
    value = value.replaceAll('__null__', 'null');
  }
  return { hasPlaceholders: hasPlaceholders, value: value, resolved: resolved }; // return the result
}

// replace placeholders
function replacePlaceholders(item) {
  //---------------------------------------
  // replace placeholders if possible
  //---------------------------------------
  // an expression is evaluated as JS, a query is sent as SQL - they need different
  // substitution, so say which one this is
  var newValue = item.expression || item.query; // make a copy of our item
  return replacePlaceholderInString(newValue, item.ignoreIncomplete, item.expression ? 'expression' : 'raw');
}
// stringify value if needed
function stringifyValue(fieldvalue) {
  if (typeof fieldvalue === 'object' || Array.isArray(fieldvalue)) {
    return JSON.stringify(fieldvalue); // if object, we need to stringify it
  } else {
    return fieldvalue;
  }
}
// in case of unexpected error in the etneral loop, we stop the loop
function stopLoop(error) {
  clearInterval(interval.value);
  toast.error('Expression interval stopped !\n' + error);
}

// trigger this when a field has changed and we need to see if it has an impact.
//
// A dependent is reset unconditionally: the readiness gate in the loop is what keeps a
// reset from being premature, and prefill retention (prefillValues) is what keeps it from
// being destructive - resetField restores the prefilled value as the field's default while
// initialising, so a cascade during prefill costs a re-evaluation, not the value. Guards
// that skipped protected/pending fields here were removed with the gate: with retention,
// every prefilled field is protected AND pending for the whole init phase, so those guards
// would have blocked every system cascade and frozen the chain.
function evaluateDynamicFields(fieldname) {
  // console.log(`${fieldname} changed`)
  // if this field is dependency
  if (fieldname in dynamicFieldDependencies.value) {
    // are any fields dependent from this field ?
    canSubmit.value = false; // after each dependency reset, we block submitting, untill all fields are resolved
    // set all variable ones to dirty
    dynamicFieldDependencies.value[fieldname].forEach((item, _i) => {
      // loop all dynamic fields and reset them
      // set all variable fields blank and re-evaluate
      if (!fieldOptions.value[item].editable) {
        resetField(item);
      }
    });
  }
  calcContainerSize();
}

// validate form before submit
function validateForm() {
  var isValid = true;
  // final touch to force validation
  v$.value.form.$touch();
  // loop all fields and check if it valid, skip hidden fields
  props.currentForm.fields.forEach((item) => {
    if (visibility.value[item.name] && v$.value.form[item.name]?.$invalid) {
      isValid = false;
    }
  });
  if (!isValid) {
    toast.warning(t('form.invalidData'));
    return false; // do not start if form is invalid
  } else {
    return true;
  }
}

// handle submit dropdown actions - just emit to parent
function handleSubmitAction(actionKey) {
  // Validate form before allowing actions
  if (!validateForm()) {
    return;
  }

  emit('submit-action', { action: actionKey, visibility: visibility.value });
}

// Save handler for subform mode (used by AppListField). Validates the form
// and, if valid, emits `save` with the current form value so the parent list
// can add/update the row.
// Each row carries both raw field values (for re-editing) and `__output__`
// (the buildFormOutput result with model/valueColumn applied) so that parent
// expressions like $(acls_base) serialise the shaped output, not the raw data.
function handleSubformSave() {
  if (!validateForm()) {
    return;
  }
  const raw = stripSubformInternals(form.value);
  const built = Helpers.buildFormOutput(props.currentForm.fields, raw, { subforms: props.subforms || [] });
  emit('save', { ...raw, __output__: built });
}

// Build the output object for a subform row emitted to the parent list.
// We intentionally keep the RAW per-field values here (only fields declared
// in the subform). Internal fields (__user__, __parent__, constants, vars)
// are filtered out. `model`, `output`, `outputObject` and `valueColumn` are
// applied at extravars generation time by `Helpers.buildFormOutput`, which
// walks the whole form tree recursively. Keeping rows raw means they can
// round-trip through Save -> Edit -> Save without losing data (e.g. full
// enum objects are preserved for re-editing).
function stripSubformInternals(src) {
  if (!src || typeof src !== 'object') return src;

  const out = {};
  const declaredFields = new Set((props.currentForm?.fields || []).map((f) => f.name));

  // Filter to only declared fields, excluding internals
  Object.keys(src).forEach((key) => {
    if (declaredFields.has(key)) {
      out[key] = src[key];
    }
  });

  return out;
}

// Subform dropdown actions attached to the Save button (Store only). "Load"
// is exposed as a separate top-toolbar button by the page (alongside Back),
// because loading replaces the current draft and feels more like an entry
// action than a commit action. Store keeps partial drafts without validation.
const subformActions = computed(() => [
  {
    key: 'store',
    label: t('form.store'),
    icon: 'file-export',
    roleOption: 'allowStoredJobs',
  },
]);

function handleSubformAction(actionKey) {
  // No validation for store/load - authors may want to save partial work.
  emit('submit-action', { action: actionKey, value: stripSubformInternals(form.value) });
}

// Open the subform editor for a yaml+subform field.
// The current field value (or an empty object built from subform defaults)
// becomes the draft. On save the value is written back to the field.
function openYamlSubformEditor(field) {
  if (!editStack) return;
  const resolvedSubform = props.subforms.find((s) => s.name === field.subform);
  if (!resolvedSubform) return;
  const title = field.label || field.name;
  // Build a starting draft from the current value, or an empty object so
  // the embedded AppForm runs its own default-evaluation pipeline
  // (initiateDefaults -> getDefaultValue), which honours placeholder
  // resolution and `evalDefault`. Pre-filling raw `f.default` here would
  // make the embedded form treat the value as user-supplied initialData
  // and skip that pipeline, leaving expression strings like
  // `$(otherfield) + 1` literally in the field.
  let row = form.value[field.name];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    row = {};
  } else {
    const rest = { ...row };
    delete rest.__output__;
    row = JSON.parse(JSON.stringify(rest));
  }

  // Resolve placeholders in titleEdit so $(__parent__.fieldname) works
  const subtitle = Helpers.resolveTitlePlaceholders(field.titleEdit || `Edit ${title}`, form.value);

  editStack.push({
    title,
    subtitle,
    subform: resolvedSubform,
    row,
    parentData: form.value,
    onSave: (value) => {
      form.value[field.name] = value;
      evaluateDynamicFields(field.name);
    },
  });
}

// Hidden file input refs for yaml+subform load buttons (keyed by field name).
const yamlSubformFileRefs = ref({});

function triggerYamlSubformLoad(fieldName) {
  yamlSubformFileRefs.value[fieldName]?.click();
}

async function handleYamlSubformLoad(event, fieldName) {
  const file = event.target.files?.[0];
  if (!file) return;
  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) {
    toast.error('Please select a .yml or .yaml file');
    return;
  }
  try {
    const text = await file.text();
    const parsed = YAML.parse(text);
    if (parsed === null || parsed === undefined) {
      toast.error('Invalid YAML file - no data found');
      return;
    }
    const value = Array.isArray(parsed) ? parsed[0] : parsed;
    if (Array.isArray(parsed)) toast.info('First array item loaded');

    // Apply modeling transformation: build __output__ from raw fields
    // so the modeled structure is immediately visible without manual edit
    const fieldDef = props.currentForm.fields?.find((f) => f.name === fieldName);
    const resolvedSubform = fieldDef?.subform ? props.subforms.find((s) => s.name === fieldDef.subform) : null;
    form.value[fieldName] = Helpers.applySubformModeling(value, resolvedSubform?.fields, props.subforms || []);

    toast.success(`Loaded from ${file.name}`);
    evaluateDynamicFields(fieldName);
  } catch (e) {
    toast.error(`Failed to parse ${file.name}: ${e.message}`);
  }
  event.target.value = '';
}

function handleYamlSubformDownload(fieldName, _label) {
  try {
    const raw = form.value[fieldName];
    if (!raw) {
      toast.error('No data to download');
      return;
    }

    // Strip constants, vars and internals — keep only declared subform fields.
    const fieldDef = props.currentForm.fields?.find((f) => f.name === fieldName);
    const resolvedSubform = fieldDef?.subform ? props.subforms.find((s) => s.name === fieldDef.subform) : null;
    const subformFieldNames = resolvedSubform?.fields?.map((f) => f.name) || null;
    const filtered =
      subformFieldNames && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.fromEntries(subformFieldNames.filter((k) => k in raw).map((k) => [k, raw[k]]))
        : raw;
    const value = Helpers.stripInternalFields(filtered);

    const yamlContent = YAML.stringify(value);
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fieldName || 'field'}.yml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Downloaded as YAML');
  } catch (e) {
    toast.error(`Failed to download: ${e.message}`);
  }
}

// initiate the defaults
function initForm() {
  pretasksFinished.value = false;
  interval.value = undefined;
  dynamicFieldDependencies.value = {};
  dynamicFieldDependentOf.value = {};
  defaults.value = {};
  dynamicFieldStatus.value = {};
  queryresults.value = {};
  queryerrors.value = {};
  fieldOptions.value = {};
  warnings.value = [];
  showWarnings.value = false;
  visibility.value = {};
  canSubmit.value = false;
  pretasksFinished.value = false;
  timeout.value = undefined;
  isInitializing.value = false;
  protectedFields.value = {};
  prefillValues.value = {};
  prefillApplied.value = {};
  prefillFlagged.value = {};
  prefillApplyCount.value = {};
  waitingFields.value = {};
  cycleFields.value = {};
  warnedOnce.value = {};

  // Take the restored values, but only for fields this form still declares. A stored job
  // from before the form was edited carries keys that match nothing, and every apply site
  // iterates over declared fields - so such a key could never be resolved and would keep
  // the form "initialising" for the rest of the session.
  const declaredFields = new Set(props.currentForm.fields.filter((f) => f?.name).map((f) => f.name));
  Object.keys(props.initialData).forEach((key) => {
    if (declaredFields.has(key)) {
      prefillValues.value[key] = props.initialData[key];
    } else {
      warnings.value.push(
        `<span class="text-warning">Stored value for '${key}' was ignored</span><br><span>This form no longer has a field with that name.</span>`,
      );
    }
  });
  // Set initializing flag to suppress defaults during load
  isInitializing.value = Object.keys(prefillValues.value).length > 0;

  // inject user
  form.value['__user__'] = TokenStorage.getPayload().user;
  fieldOptions.value['__user__'] = {
    type: 'expression',
  };

  // process aliases
  props.currentForm.fields.forEach((item) => {
    if (item.type == 'local') {
      item.hide = item.hide ?? true;
      item.output = item.output ?? false;
      item.type = 'expression';
      item.runLocal = true;
    }
    if (item.type == 'local_out') {
      item.hide = item.hide ?? true;
      item.type = 'expression';
      item.runLocal = true;
    }
    if (item.type == 'credential') {
      item.hide = item.hide ?? true;
      item.asCredential = true;
      item.type = 'expression';
      item.runLocal = true;
    }
    if (item.type == 'html') {
      item.runLocal = true;
    }
  });

  // initiate the constants
  if (props.constants) {
    Object.keys(props.constants).forEach((item) => {
      fieldOptions.value[item] = {
        type: 'constant',
      };
      form.value[item] = props.constants[item];
      dynamicFieldStatus.value[item] = 'fixed';
    });
  }

  // inject form-specific vars (varsFiles data) — loaded server-side into currentForm.vars
  if (props.currentForm.vars) {
    Object.keys(props.currentForm.vars).forEach((item) => {
      fieldOptions.value[item] = { type: 'constant' };
      form.value[item] = props.currentForm.vars[item];
      dynamicFieldStatus.value[item] = 'fixed';
    });
  }

  // inject parent form data as __parent__ so subform fields can reference
  // parent values via $(__parent__.fieldname)
  if (props.parentData && Object.keys(props.parentData).length > 0) {
    fieldOptions.value['__parent__'] = { type: 'constant' };
    form.value['__parent__'] = props.parentData;
    dynamicFieldStatus.value['__parent__'] = 'fixed';
  }

  // initialize defaults
  props.currentForm.fields.forEach((item) => {
    // extra query parameters and store in externalData
    if (route.query[item.name] != undefined) {
      var queryValue = route.query[item.name];
      if (item.type == 'number') {
        // parseInt RETURNS NaN, it never throws, so this catch was unreachable and
        // ?count=abc put NaN into the form: the number box rendered empty, the
        // required rule still passed (String(NaN) is non-empty) and the job was
        // launched with count: null - or `.nan` on the schedule path. parseInt
        // also truncated '12abc' to 12 just as silently. Ignore a value that is
        // not a number, so the field's own default applies.
        const parsed = Number(queryValue);
        // return, not continue : this is a forEach callback, not a loop
        if (!Number.isFinite(parsed)) return;
        queryValue = parsed;
      }
      if (item.type == 'checkbox') {
        if (queryValue.toLowerCase() === 'false') {
          queryValue = false;
        } else {
          queryValue = !!queryValue;
        }
      }
      externalData.value[item.name] = queryValue;
    }
    fieldOptions.value[item.name] = {};
    fieldOptions.value[item.name]['evalDefault'] = item.evalDefault ?? false;
    fieldOptions.value[item.name]['hasDependencies'] = 'dependencies' in item;
    fieldOptions.value[item.name]['dependencyOk'] = false;
    if (['expression', 'enum', 'html', 'yaml', 'list'].includes(item.type)) {
      fieldOptions.value[item.name]['isDynamic'] = !!(item.expression ?? item.query ?? item.value ?? false);
      fieldOptions.value[item.name]['valueColumn'] = item.valueColumn || '';
      fieldOptions.value[item.name]['placeholderColumn'] = item.placeholderColumn || '';
      fieldOptions.value[item.name]['type'] = item.type;
      // Only expression fields use the editable toggle feature
      if (item.type !== 'yaml') {
        fieldOptions.value[item.name]['editable'] = item.editable || false;
      }
      fieldOptions.value[item.name]['viewable'] = false;
      fieldOptions.value[item.name]['debug'] = false;
      fieldOptions.value[item.name]['ignoreIncomplete'] = item.ignoreIncomplete || false;
      if (item.refresh && typeof item.refresh == 'string' && /[0-9]+s/.test(item.refresh)) {
        fieldOptions.value[item.name]['refresh'] = item.refresh;
      }
      // Check if we have initialData for this field
      if (item.name in prefillValues.value) {
        // enum/query need their options loaded before a value can be checked
        // against them, so the loop applies those; html/expression/yaml recompute
        // from their expression rather than being restored.
        const needsOptionsFirst = ['enum', 'query'].includes(item.type) && (item.expression || item.query);
        const isReactiveField =
          (item.type === 'html' || item.type === 'expression' || item.type === 'yaml') &&
          (item.expression || item.query);

        if (!needsOptionsFirst && !isReactiveField) {
          applyPrefill(item.name);
        } else if (isReactiveField) {
          // Flagged, not deleted: the field is deliberately recomputed, and
          // recording that keeps it from blocking init from completing while
          // still leaving a record of what was stored.
          prefillFlagged.value[item.name] = 'computed field - re-evaluated instead of restored';
          dynamicFieldStatus.value[item.name] = undefined;
        } else {
          // For enum/query with expressions, set status to undefined so loop will load options first
          dynamicFieldStatus.value[item.name] = undefined;
        }
      } else {
        form.value[item.name] = externalData.value[item.name] ?? getDefaultValue(item.name, item.default);
      }
      // Same default for list fields.
      if (item.type == 'list' && form.value[item.name] === undefined) {
        form.value[item.name] = [];
      }
    } else {
      var fallbackvalue = undefined;
      if (item.type == 'checkbox') {
        fallbackvalue = false;
      }
      // Check if we have initialData for this field - if so, use it instead of evaluating default
      if (item.name in prefillValues.value) {
        applyPrefill(item.name);
      } else {
        form.value[item.name] =
          externalData.value[item.name] ?? getDefaultValue(item.name, item.default) ?? fallbackvalue;
      }
      // List fields are arrays - initialize to [] if still undefined.
      if (item.type == 'list' && form.value[item.name] === undefined) {
        form.value[item.name] = [];
      }
    }
    visibility.value[item.name] = true;
  });

  // reset the form
  v$.value.form.$reset();

  // set all defaults
  initiateDefaults();

  // find all variable dependencies (both directions, from one scan)
  findVariableDependencies();

  // Fill in everything that can be restored right away - the fields nothing has to be
  // fetched for. Everything else is left to the loop, which applies each field's value the
  // moment that field's own dependencies have been evaluated. There is no "has no
  // dependencies" shortcut here any more: that test was only ever standing in for the
  // readiness gate, and it read a map that was empty for enum/query anyway.
  props.currentForm.fields.forEach((item) => {
    if (!item?.name || !(item.name in prefillValues.value)) return;
    if (prefillApplied.value[item.name] || prefillFlagged.value[item.name]) return;
    const needsOptionsFirst = ['enum', 'query'].includes(item.type) && (item.expression || item.query);
    const isComputed = ['expression', 'html', 'yaml'].includes(item.type) && (item.expression || item.query);
    if (isComputed) {
      prefillFlagged.value[item.name] = 'computed field - re-evaluated instead of restored';
    } else if (!needsOptionsFirst) {
      applyPrefill(item.name);
    }
  });

  // for future use, run something before the form starts
  pretasksFinished.value = true;

  // start dynamic field loop (= infinite)
  startDynamicFieldsLoop();
}

//----------------------------------------------------------------
// starts the evaluation of dynamic fields (expression or query)
//----------------------------------------------------------------
async function startDynamicFieldsLoop() {
  var refreshCounter = 0;
  var hasUnevaluatedFields = false;
  var lastProgressCounter = -1;
  changed();
  interval.value = setInterval(async () => {
    hasUnevaluatedFields = false;
    unevaluatedFields.value = [];

    props.currentForm.fields.forEach(async (item) => {
      checkDependencies(item);
      if (visibility.value[item.name]) {
        var flag = dynamicFieldStatus.value[item.name];
        var placeholderCheck;

        // A field may only start evaluating once every field it references has been
        // evaluated - the same rule a person filling this form in by hand follows.
        // Until then it waits, silently: no default, no reset, no cascade, no status
        // change. That is the whole point. Previously "my dependency isn't ready"
        // came back from replacePlaceholders as an unresolved placeholder and was
        // handled as "evaluation failed" - setFieldToDefault, which for a field with
        // a default cascades a reset through everything below it. Every not-yet-ready
        // field did that on every tick, which on a deep form is a churn engine that
        // never settles.
        //
        // ignoreIncomplete is the author's explicit opt-out: evaluate now, with
        // whatever is resolvable, and accept being re-evaluated later.
        const gated =
          flag == undefined &&
          (item.expression || item.query) &&
          fieldOptions.value[item.name]?.isDynamic &&
          !item.ignoreIncomplete &&
          !cycleFields.value[item.name] &&
          !depsReady(item.name);

        if (!gated) delete waitingFields.value[item.name];

        if (gated) {
          waitingFields.value[item.name] = true;
          hasUnevaluatedFields = true;
          unevaluatedFields.value.push(item.name);
        } else if (item.expression && flag == undefined) {
          hasUnevaluatedFields = true;
          unevaluatedFields.value.push(item.name);
          setFieldStatus(item.name, 'running', false);
          placeholderCheck = replacePlaceholders(item);
          fieldOptions.value[item.name].expressionEval = placeholderCheck.value || 'undefined';

          if (placeholderCheck.value != undefined) {
            if (item.runLocal) {
              try {
                var result;
                if (placeholderCheck.value.at(0) == '{' && placeholderCheck.value.at(-1) == '}') {
                  result = Helpers.evalSandbox(`Object.assign(${placeholderCheck.value})`);
                } else {
                  result = Helpers.evalSandbox(placeholderCheck.value);
                }
                // html/expression/yaml recompute rather than restore
                if (item.type == 'html' || item.type == 'expression' || item.type == 'yaml') {
                  form.value[item.name] = result;
                }
                if (item.type == 'enum') {
                  queryresults.value[item.name] = [].concat(result);
                  // options are loaded, so the stored value can now be
                  // checked against them and restored
                  if (isPrefillPending(item.name)) {
                    applyPrefill(item.name, { validateOptions: true });
                  }
                }
                if (item.type == 'list' && !defaults.value[item.name]) form.value[item.name] = [].concat(result);
                if (item.type == 'list' && defaults.value[item.name])
                  form.value[item.name] = [].concat(defaults.value[item.name]);

                // Mark as fixed after successful evaluation - will re-evaluate when dependencies change via resetField
                setFieldStatus(item.name, 'fixed');
                delete queryerrors.value[item.name];
              } catch (err) {
                queryerrors.value[item.name] = err.toString();
                try {
                  setFieldToDefault(item.name);
                } catch (err) {
                  stopLoop('Defaulting ' + item.name);
                }
              }
            } else {
              try {
                const body = { expression: placeholderCheck.value };
                if (item.jq) body.jq = item.jq;
                const gen = fieldGeneration.value[item.name] || 0;
                const result = await axios.post(
                  `/api/v2/expression?noLog=${!!item.noLog}`,
                  body,
                  TokenStorage.getAuthentication(),
                );
                // a dependency changed (resetField bumped the generation)
                // while this was in flight: a newer request owns the field
                // now, so drop this stale answer - return, not continue: the
                // enclosing construct is a forEach callback, not a loop
                if (!isCurrentGeneration(item.name, gen)) return;
                const restresult = result.data;
                delete queryerrors.value[item.name];
                // html/expression/yaml recompute rather than restore
                if (item.type == 'html' || item.type == 'expression' || item.type == 'yaml') {
                  form.value[item.name] = restresult;
                }
                if (item.type == 'enum') {
                  queryresults.value[item.name] = [].concat(restresult ?? []);
                  // options are loaded, so the stored value can now be
                  // checked against them and restored
                  if (isPrefillPending(item.name)) {
                    applyPrefill(item.name, { validateOptions: true });
                  }
                }
                if (item.type == 'list' && !defaults.value[item.name])
                  form.value[item.name] = [].concat(restresult ?? []);
                if (item.type == 'list' && defaults.value[item.name])
                  form.value[item.name] = [].concat(defaults.value[item.name] ?? []);

                if (restresult == undefined && defaults.value[item.name] != undefined) {
                  if (item.type == 'expression') {
                    setFieldToDefault(item.name);
                  } else {
                    resetField(item.name);
                  }
                } else {
                  // Mark as fixed after successful evaluation - will re-evaluate when dependencies change via resetField
                  setFieldStatus(item.name, 'fixed');
                }
              } catch (error) {
                queryerrors.value[item.name] = error.toString();
                try {
                  setFieldToDefault(item.name);
                } catch (err) {
                  stopLoop('Defaulting ' + item.name);
                }
              }
            }
          } else {
            // Every dependency reported itself evaluated, yet a placeholder still
            // will not resolve - so this is a real failure (a reference to
            // something that never produces a value), not "too early". Default
            // once and say so; the gate above is what keeps this off the
            // every-tick path it used to be on.
            if (!dependsOnEmptyField(item.name)) {
              addWarningOnce(
                `unresolved:${item.name}`,
                `<span class="text-warning">'${item.name}' could not be evaluated</span><br><span>A field its expression refers to never produced a value.</span>`,
              );
            }
            setFieldToDefault(item.name);
          }
        } else if (item.query && flag == undefined) {
          hasUnevaluatedFields = true;
          unevaluatedFields.value.push(item.name);
          setFieldStatus(item.name, 'running', false);
          placeholderCheck = replacePlaceholders(item);

          if (placeholderCheck.value != undefined) {
            try {
              // Send the form and field, NOT the query text. The server
              // resolves the query from the definition with the caller's own
              // roles and substitutes these values itself - the endpoint used
              // to run whatever SQL the body contained, against any configured
              // datasource, for any authenticated user.
              //
              // `formName` must be the ROOT form: a subform carries no
              // `roles` (the schema forbids it) and so cannot be resolved on
              // its own - see the rootFormName prop. `values` is keyed by the
              // raw placeholder text, which is what makes `$(city.name)` and
              // placeholderColumn work; a flat field map cannot express them.
              const body = {
                formName: props.rootFormName || props.currentForm.name,
                fieldName: item.name,
                values: placeholderCheck.resolved || {},
                // kept so a settings user's designer preview still works, and
                // so an older client keeps functioning
                query: placeholderCheck.value,
                config: item.dbConfig,
              };
              if (props.rootFormName) body.subformName = props.currentForm.name;
              if (item.jq) body.jq = item.jq;
              const gen = fieldGeneration.value[item.name] || 0;
              const result = await axios.post(
                `/api/v2/query?noLog=${!!item.noLog}`,
                body,
                TokenStorage.getAuthentication(),
              );
              // a dependency changed while this was in flight : a newer
              // request owns the field now, so drop this answer
              // return, not continue : the enclosing construct is a
              // forEach callback, not a loop
              if (!isCurrentGeneration(item.name, gen)) return;
              const restresult = result.data;
              delete queryerrors.value[item.name];
              if (item.type == 'query' || item.type == 'enum') queryresults.value[item.name] = restresult;
              else if (item.type == 'yaml') form.value[item.name] = restresult;
              else if (item.type == 'list') form.value[item.name] = [].concat(restresult ?? []);
              else form.value[item.name] = restresult;

              // A query-backed enum/query field is restored the same way an
              // expression-backed one is - its options have just arrived, so the
              // stored value can be checked against them. This branch never had
              // a restore path at all, so such a field was simply never filled
              // back in.
              if ((item.type == 'query' || item.type == 'enum') && isPrefillPending(item.name)) {
                applyPrefill(item.name, { validateOptions: true });
              }

              // Mark as fixed after successful evaluation - will re-evaluate when dependencies change via resetField
              setFieldStatus(item.name, 'fixed');
            } catch (err) {
              queryerrors.value[item.name] = err.toString();
              try {
                if (item.type == 'expression') {
                  setFieldToDefault(item.name);
                } else {
                  resetField(item.name);
                }
              } catch (err) {
                stopLoop('Defaulting ' + item.name);
              }
            }
          } else {
            // As in the expression branch: dependencies are ready, so an
            // unresolved placeholder here is a genuine failure. Mark the field
            // defaulted rather than resetting it - a reset would clear the value
            // and put the field straight back into the queue it just failed out
            // of, once per tick.
            if (!dependsOnEmptyField(item.name)) {
              addWarningOnce(
                `unresolved:${item.name}`,
                `<span class="text-warning">'${item.name}' could not be evaluated</span><br><span>A field its query refers to never produced a value.</span>`,
              );
            }
            try {
              setFieldToDefault(item.name);
            } catch (err) {
              stopLoop('Defaulting ' + item.name);
            }
          }
        } else if (item.value && flag == undefined) {
          setFieldStatus(item.name, 'running', false);
          if (item.type == 'expression' || item.type == 'yaml') form.value[item.name] = item.value;
          setFieldStatus(item.name, 'fixed');
        } else if (flag == 'running') {
          // A request is still in flight. It entered no branch above, so without
          // this the form could call itself settled - and enable submit - while
          // answers were still on their way.
          hasUnevaluatedFields = true;
          unevaluatedFields.value.push(item.name);
        }
      } else {
        // A hidden field needs no per-tick upkeep. setVisibility already clears its
        // value and status once, on the transition to hidden, and a prefill it still
        // owns survives in prefillValues - so when it is shown again, resetField
        // hands that value straight back as its default. Re-defaulting or resetting
        // it on every tick, forever, is what this branch used to do.
        delete waitingFields.value[item.name];
      }
      if (item.type == 'number' && form.value[item.name] === '') {
        setFieldUndefined(item.name);
      }
      if (item.refresh && typeof item.refresh == 'string') {
        var match = item.refresh.match(/([0-9]+)s/g);
        if (match) {
          var secs = parseInt(match[0]);
          // Not while the user has the field open for editing. Clearing the
          // status makes the next tick re-run the expression and assign its
          // result over form.value[name] - so an `expression` field declared
          // with both `editable: true` and `refresh: "30s"` had whatever the
          // user typed silently replaced every 30 seconds, mid-edit.
          // evaluateDynamicFields already applies this rule; the refresh path
          // was the one place that did not.
          if (refreshCounter % (10 * secs) == 0 && !fieldOptions.value[item.name]?.editable) {
            setFieldStatus(item.name, undefined);
          }
        }
      }
    });

    // Settled means nothing is still waiting for a dependency and nothing is still in
    // flight. Initialisation is finished on top of that only when every restored value
    // has been put back, been flagged as impossible to put back, or belongs to a field
    // that is not shown - which is the "keep going until every field matches its prefill
    // value" rule.
    // The watchdog counts ticks in which NOTHING happened, not ticks in total: a chain of
    // seven slow queries makes steady progress and must never be mistaken for a stuck
    // form, while a form that truly cannot advance trips it within a couple of seconds.
    if (progressCounter.value !== lastProgressCounter) {
      lastProgressCounter = progressCounter.value;
      watchdog.value = 0;
    }

    const anyWaiting = Object.keys(waitingFields.value).length > 0;
    if (hasUnevaluatedFields || anyWaiting) {
      canSubmit.value = false;
      watchdog.value++;
      // A field that never becomes ready would otherwise hold the form forever: a lost
      // response, or a dependency that simply never resolves. Release it, evaluate with
      // what is there, and say which field it was. This has to fire well inside
      // awaitStable's 10s window, or a wizard step would time out instead.
      if (watchdog.value > 50) {
        Object.keys(waitingFields.value).forEach((name) => {
          cycleFields.value[name] = true; // exempt from the gate from now on
          delete waitingFields.value[name];
          addWarningOnce(
            `stalled:${name}`,
            `<span class="text-warning">'${name}' waited too long for the fields it depends on</span><br><span>It was evaluated anyway - its value may be incomplete.</span>`,
          );
        });
      }
    } else {
      if (isInitializing.value) {
        const unresolved = Object.keys(prefillValues.value).filter(
          (name) => !prefillApplied.value[name] && !prefillFlagged.value[name] && visibility.value[name] !== false,
        );
        if (unresolved.length == 0) {
          isInitializing.value = false;
          // protectedFields is intentionally NOT cleared here : it used to be, but
          // that wiped every prefilled field's protection in one shot the instant
          // loading looked done - and "looks done this one tick" isn't "guaranteed
          // no more internal settling", especially several dependency-levels deep.
        } else {
          // Nothing is waiting or running any more, yet these values still have not
          // gone back in - the chain they hang off cannot produce them. Say so and
          // finish, rather than holding the form hostage.
          watchdog.value++;
          if (watchdog.value > 50) {
            unresolved.forEach((name) => flagPrefill(name, 'the fields it depends on never produced it'));
            isInitializing.value = false;
          }
        }
      }
      // Submitting stays blocked until the restore is actually complete, so a relaunch
      // can never be sent with fields that had not been filled back in yet.
      canSubmit.value = !isInitializing.value;
      if (!isInitializing.value) watchdog.value = 0;
    }

    if (status.value == 'initializing') {
      status.value = '';
      nextTick(() => {
        if (validateForm()) {
          status.value = 'stabilizing';
          watchdog.value = 0;
        } else {
          status.value = '';
        }
      });
    }

    if (status.value == 'stabilizing') {
      if (canSubmit.value) {
        status.value = 'submitting';
        emit('submit', { visibility: visibility.value });
      } else {
        if (watchdog.value > 50) {
          status.value = '';
          toast.warning(t('form.tooLongToEvaluate'));
          toast.warning(unevaluatedFieldsWarning.value);
        }
      }
    }

    refreshCounter++;
    if (refreshCounter % loopDivider.value == 0) {
      if (!pauseJsonOutput.value && props.showExtraVars) {
        changed();
      }
    }
    if (watchdog.value > 50 || watchdog.value == 0) {
      loopDelay.value = 500;
    } else {
      loopDelay.value = 4;
    }
  }, loopDelay.value);
}

// HOOKS
//----------------------------------------------------------------

onMounted(async () => {
  // const rules = getRules()
  v$ = useVuelidate(rules, { form }); // use vuelidate, form is a ref that holds the form data
  validationsLoaded.value = true;
  pretasksFinished.value = true;
  initForm();
  calcContainerSize();
  window.addEventListener('resize', calcContainerSize);
});

onUnmounted(() => {
  window.removeEventListener('resize', calcContainerSize);
  clearInterval(interval.value);
});

// Exposed for the wizard parent: lets it gate Next/Submit on validation.
// Returns true when the form is valid, false otherwise (and toasts a warning).
/**
 * Resolve once every dynamic field has settled, or false if it takes too long.
 *
 * AppForm already computes canSubmit and even emits a "submit" event when it flips - but
 * "submit" is not in defineEmits above and nothing binds it, so that whole path was dead
 * code: form.vue calls submitForm() the instant the button is pressed. A form with a slow
 * query or expression field could therefore be submitted while it was still resolving,
 * and generateJsonOutput built the extravars from a field that was still undefined or
 * holding its default - the job ran with a missing or stale value, silently.
 *
 * Exposed rather than emitted so the parent can AWAIT it on the path it actually uses.
 */
function awaitStable(timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (canSubmit.value) return resolve(true);
    const started = Date.now();
    const timer = setInterval(() => {
      if (canSubmit.value) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 100);
  });
}

defineExpose({
  validateForm,
  visibility,
  awaitStable,
});
</script>
<template>
  <!-- FORM -->

  <div v-if="formIsReady" ref="containerRef">
    <!-- WARNINGS -->
    <BsOffCanvas
      v-if="showWarnings"
      :show="true"
      icon="triangle-exclamation"
      :title="t('form.formWarnings')"
      @close="showWarnings = false"
    >
      <template #default>
        <!-- text, not v-html : this is a comma-joined list of FIELD LABELS from
                     the form definition, which is a yaml file in a forms repository, plus
                     a translated word. No HTML is intended, and toast.warning() renders
                     the very same string as text already. -->
        <p v-if="!canSubmit && !formLoopIsBusy" class="mb-3">{{ unevaluatedFieldsWarning }}</p>
        <p v-for="(w, i) in warnings" :key="'warning' + i" class="mb-3" v-html="w"></p>
        <p v-for="(q, i) in Object.keys(queryerrors)" :key="'queryerror' + i" class="mb-3 has-text-danger">
          '{{ q }}' has query errors<br />{{ queryerrors[q] }}
        </p>
      </template>
    </BsOffCanvas>

    <div class="d-flex justify-content-between">
      <div>
        <slot name="toolbarbuttons"></slot>
      </div>
      <div>
        <!-- Unified warnings indicator: combines field-not-evaluated
                     notices with authoring warnings (deprecations, bad refs,
                     query errors). Clicking opens the warnings off-canvas. -->
        <span
          class="position-relative"
          role="button"
          v-if="(!canSubmit && !formLoopIsBusy) || warnings.length > 0 || Object.keys(queryerrors).length > 0"
          @click="showWarnings = true"
        >
          <popper :content="unevaluatedFieldsWarning || 'This form has warnings - click to review'">
            <font-awesome-icon icon="exclamation-triangle" size="lg" class="text-warning" />
          </popper>
          <span
            v-if="warnings.length + Object.keys(queryerrors).length > 0"
            class="badge rounded-pill bg-warning text-dark position-absolute top-0 start-100 translate-middle"
            style="font-size: 0.6rem"
          >
            {{ warnings.length + Object.keys(queryerrors).length }}
          </span>
        </span>

        <!-- loop busy -->
        <span class="ms-2" v-show="formLoopIsBusy">
          <font-awesome-icon icon="spinner" size="lg" class="text-warning" spin />
        </span>

        <!-- show hidden fields -->
        <span
          class="ms-2"
          v-show="!hideForm"
          v-if="showDebugButtons"
          title="Show hidden fields"
          role="button"
          :class="{ 'text-success': !showHidden, 'text-danger': showHidden }"
          @click="showHidden = !showHidden"
        >
          <font-awesome-icon :icon="showHidden ? 'search-minus' : 'search-plus'" />
        </span>
      </div>
    </div>

    <!-- GROUPS -->
    <template :key="group" v-for="group in fieldGroups">
      <div v-if="checkGroupDependencies(group)" v-show="!hideForm" class="mt-4 p-3" :class="getGroupClass(group)">
        <!-- GROUP TITLE -->
        <h3>{{ group }}</h3>

        <!-- ROWS -->
        <div :key="line" v-for="line in fieldLines" class="row">
          <!-- FIELDS -->
          <template :key="field.name" v-for="field in filterfieldsByGroupAndLine(group, line)">
            <div class="col py-0" v-if="visibility[field.name]" :class="field.width">
              <!-- TYPE = HTML (separate rendering, optional label) -->
              <div class="mt-3" v-if="field.type == 'html'">
                <!-- FIELD LABEL (only if label is explicitly set and different from field name) -->
                <label
                  v-if="field.label && field.label !== field.name"
                  class="flex-grow-1 fw-bold mb-2"
                  :class="{ 'text-body': !field.hide, 'text-grey': field.hide }"
                  >{{
                    typeof fieldLabels[field.name] === 'object'
                      ? fieldLabels[field.name].value
                      : fieldLabels[field.name]
                  }}
                </label>

                <div
                  v-show="!fieldOptions[field.name].viewable"
                  v-html="HtmlSanitizer.sanitize(v$.form[field.name].$model)"
                ></div>
                <!-- raw data -->
                <div
                  @dblclick="setExpressionFieldViewable(field.name, false)"
                  v-if="fieldOptions[field.name].viewable"
                  class="card p-2 limit-height"
                >
                  <VueJsonPretty :data="v$.form[field.name].$model || ''" />
                </div>
              </div>

              <!-- ALL OTHER FIELD TYPES -->
              <div v-else class="mt-3">
                <div class="d-flex">
                  <!-- FIELD LABEL -->
                  <label class="flex-grow-1 fw-bold mb-2" :class="{ 'text-body': !field.hide, 'text-grey': field.hide }"
                    >{{
                      typeof fieldLabels[field.name] === 'object'
                        ? fieldLabels[field.name].value
                        : fieldLabels[field.name]
                    }}
                    <span v-if="field.required" class="text-danger">*</span></label
                  >

                  <!-- FIELD DEBUG BUTTONS -->
                  <div>
                    <!-- refresh auto -->
                    <BsButton
                      @click="setFieldStatus(field.name, undefined)"
                      v-if="fieldOptions[field.name] && fieldOptions[field.name].refresh"
                      icon="arrow-rotate-right"
                      :spin="true"
                      cssClass="btn-sm"
                      >{{ fieldOptions[field.name].refresh }}</BsButton
                    >
                    <!-- refresh manual -->
                    <span
                      v-if="
                        (field.expression != undefined || field.query != undefined) &&
                        field.refresh & !fieldOptions[field.name].refresh
                      "
                      role="button"
                      class="me-2"
                      @click="setFieldStatus(field.name, undefined)"
                    >
                      <font-awesome-icon icon="arrow-rotate-right" />
                    </span>
                    <!-- enable field debug -->
                    <span
                      class="ms-2"
                      role="button"
                      :class="{
                        'text-success': !fieldOptions[field.name].debug,
                        'text-danger': fieldOptions[field.name].debug,
                      }"
                      @click="setExpressionFieldDebug(field.name, !fieldOptions[field.name].debug)"
                      v-if="field.expression && showDebugButtons"
                    >
                      <font-awesome-icon :icon="fieldOptions[field.name].debug ? 'search-minus' : 'search-plus'" />
                    </span>
                    <!-- expression edit buttons -->
                    <span
                      class="ms-2 text-warning"
                      role="button"
                      @click="setExpressionFieldEditable(field.name, true)"
                      v-if="
                        field.editable &&
                        field.type == 'expression' &&
                        !fieldOptions[field.name].editable &&
                        !fieldOptions[field.name].viewable
                      "
                    >
                      <font-awesome-icon icon="pencil-alt" />
                    </span>
                    <span
                      class="ms-2 text-danger"
                      role="button"
                      @click="setExpressionFieldEditable(field.name, false)"
                      v-if="
                        field.editable &&
                        field.type == 'expression' &&
                        fieldOptions[field.name].editable &&
                        !fieldOptions[field.name].viewable
                      "
                    >
                      <font-awesome-icon icon="times" />
                    </span>
                    <!-- raw content buttons -->
                    <!-- show -->
                    <span
                      class="ms-2 text-success"
                      role="button"
                      @click="setExpressionFieldViewable(field.name, true)"
                      v-if="
                        showDebugButtons &&
                        field.expression &&
                        !fieldOptions[field.name].viewable &&
                        !fieldOptions[field.name].editable
                      "
                    >
                      <font-awesome-icon icon="eye" />
                    </span>
                    <!-- copy -->
                    <span
                      class="ms-2 text-info"
                      role="button"
                      @click="clip(field.type == 'expression' ? v$.form[field.name].$model : queryresults[field.name])"
                      v-if="field.expression && fieldOptions[field.name].viewable && !fieldOptions[field.name].editable"
                    >
                      <font-awesome-icon icon="copy" />
                    </span>
                    <!-- close -->
                    <span
                      class="ms-2 text-danger"
                      role="button"
                      @click="setExpressionFieldViewable(field.name, false)"
                      v-if="field.expression && fieldOptions[field.name].viewable && !fieldOptions[field.name].editable"
                    >
                      <font-awesome-icon icon="times" />
                    </span>
                  </div>
                </div>
                <!-- DEBUG EXPRESSION -->
                <div
                  class="mb-3"
                  @dblclick="clip(field.expression, true)"
                  v-if="field.expression && fieldOptions[field.name].debug"
                >
                  <pre v-highlightjs><code language="javascript">{{ field.expression }}</code></pre>
                </div>
                <!-- DEBUG EVALUATION -->
                <div
                  class="mb-3"
                  @dblclick="clip(fieldOptions[field.name].expressionEval, true)"
                  v-if="field.expression && fieldOptions[field.name].debug && dynamicFieldStatus[field.name] != 'fixed'"
                >
                  <pre
                    v-highlightjs
                  ><code language="javascript">{{ fieldOptions[field.name].expressionEval }}</code></pre>
                </div>

                <!-- TYPE = LIST (nested subform rows) -->
                <div v-if="field.type == 'list' && field.subform">
                  <AppListField
                    v-model="v$.form[field.name].$model"
                    :field="field"
                    :subform="subforms.find((s) => s.name === field.subform)"
                    :subforms="subforms"
                    :constants="constants"
                    :parentFormData="form"
                    :name="field.name"
                    :showLoadButton="field.showLoadButton === true"
                    :showDownloadButton="field.showDownloadButton === true"
                    :hasError="v$.form[field.name].$invalid"
                    :errors="getErrorsToDisplay(field.name)"
                    :help="
                      typeof fieldHelp[field.name] === 'object' ? fieldHelp[field.name].value : fieldHelp[field.name]
                    "
                    @update:modelValue="evaluateDynamicFields(field.name)"
                  />
                </div>

                <!-- TYPE = ENUM -->
                <div v-if="field.type == 'enum'">
                  <BsInputForForm
                    type="select"
                    :containerSize="containerSize"
                    v-show="!fieldOptions[field.name].viewable"
                    :defaultValue="defaults[field.name]"
                    :required="field.required || false"
                    :multiple="field.multiple || false"
                    :name="field.name"
                    :placeholder="
                      (typeof fieldPlaceholders[field.name] === 'object'
                        ? fieldPlaceholders[field.name].value
                        : fieldPlaceholders[field.name]) || 'Select...'
                    "
                    :values="field.values || queryresults[field.name] || []"
                    :hasError="v$.form[field.name].$invalid"
                    :isLoading="!field.values && !['fixed', 'variable'].includes(dynamicFieldStatus[field.name])"
                    v-model="v$.form[field.name].$model"
                    :icon="field.icon"
                    :columns="field.columns || []"
                    :pctColumns="field.pctColumns || []"
                    :filterColumns="field.filterColumns || []"
                    :previewColumn="field.previewColumn || ''"
                    :valueColumn="field.valueColumn || ''"
                    @update:modelValue="evaluateDynamicFields(field.name)"
                    @blur="handleBlur(field.name)"
                    :sticky="field.sticky || false"
                    :horizontal="field.horizontal || false"
                    :errors="getErrorsToDisplay(field.name)"
                    :help="
                      typeof fieldHelp[field.name] === 'object' ? fieldHelp[field.name].value : fieldHelp[field.name]
                    "
                  />
                  <!-- raw query data -->
                  <div
                    @dblclick="setExpressionFieldViewable(field.name, false)"
                    v-if="fieldOptions[field.name].viewable"
                    class="card p-2 limit-height"
                  >
                    <VueJsonPretty :data="queryresults[field.name] || []" />
                  </div>
                </div>

                <!-- TYPE = DATEPICKER -->
                <div v-if="field.type == 'datetime'">
                  <BsInputForForm
                    type="datetime"
                    :icon="field.icon"
                    v-model="v$.form[field.name].$model"
                    :name="field.name"
                    :hasError="v$.form[field.name].$invalid"
                    :dateType="field.dateType"
                    :convertToUtc="field.convertToUtc"
                    @update:modelValue="evaluateDynamicFields(field.name)"
                    @blur="handleBlur(field.name)"
                    :placeholder="
                      typeof fieldPlaceholders[field.name] === 'object'
                        ? fieldPlaceholders[field.name].value
                        : fieldPlaceholders[field.name]
                    "
                    :errors="getErrorsToDisplay(field.name)"
                    :values="field.values"
                    :help="
                      typeof fieldHelp[field.name] === 'object' ? fieldHelp[field.name].value : fieldHelp[field.name]
                    "
                  />
                </div>

                <!-- TYPE = EXPRESSION -->
                <div
                  v-if="field.type == 'expression'"
                  :class="{
                    'is-loading':
                      (dynamicFieldStatus[field.name] == undefined || dynamicFieldStatus[field.name] == 'running') &
                      !fieldOptions[field.name].editable,
                  }"
                >
                  <div v-if="!fieldOptions[field.name].viewable">
                    <BsInputForForm
                      v-if="fieldOptions[field.name].editable"
                      :icon="field.icon"
                      type="text"
                      @focus="preventFocus"
                      @blur="handleBlur(field.name)"
                      :hasError="v$.form[field.name].$invalid"
                      v-model="v$.form[field.name].$model"
                      :name="field.name"
                      :required="field.required"
                      @change="evaluateDynamicFields(field.name)"
                      :errors="getErrorsToDisplay(field.name)"
                      :help="
                        typeof fieldHelp[field.name] === 'object' ? fieldHelp[field.name].value : fieldHelp[field.name]
                      "
                    />
                    <BsInputForForm
                      v-else
                      @dblclick="setExpressionFieldViewable(field.name, true)"
                      type="expression"
                      :icon="field.icon"
                      :hasError="v$.form[field.name].$invalid"
                      cssClass="text-info"
                      v-model="v$.form[field.name].$model"
                      :name="field.name"
                      :isHtml="field.isHtml"
                      :errors="getErrorsToDisplay(field.name)"
                      :help="
                        typeof fieldHelp[field.name] === 'object' ? fieldHelp[field.name].value : fieldHelp[field.name]
                      "
                    />
                  </div>
                  <!-- expression raw data -->
                  <div @dblclick="setExpressionFieldViewable(field.name, false)" v-else class="card p-2 limit-height">
                    <!-- <pre v-highlightjs><code lang="json">{{ v$.form[field.name].$model }}</code></pre> -->
                    <VueJsonPretty :data="v$.form[field.name].$model" />
                  </div>
                </div>

                <!-- TYPE = YAML -->
                <div
                  v-if="field.type == 'yaml'"
                  :class="{
                    'is-loading':
                      !['fixed', 'variable'].includes(dynamicFieldStatus[field.name]) &&
                      (field.expression || field.query),
                  }"
                >
                  <!-- YAML + subform: button bar + readonly preview -->
                  <div v-if="field.subform">
                    <div class="mb-2 d-flex gap-2">
                      <BsButton
                        cssClass="btn-sm"
                        icon="pencil-alt"
                        :title="`Edit ${field.label || field.name}`"
                        @click="openYamlSubformEditor(field)"
                      >
                        Edit
                      </BsButton>
                      <BsButton
                        v-if="field.showLoadButton"
                        cssClass="btn-sm"
                        icon="file-import"
                        @click="triggerYamlSubformLoad(field.name)"
                      >
                        Load YAML
                      </BsButton>
                      <BsButton
                        v-if="field.showDownloadButton"
                        cssClass="btn-sm"
                        icon="download"
                        :disabled="!v$.form[field.name].$model"
                        @click="handleYamlSubformDownload(field.name)"
                      >
                        Download
                      </BsButton>
                      <BsButton
                        v-if="v$.form[field.name].$model"
                        cssClass="btn-sm"
                        icon="copy"
                        :isIconButton="true"
                        @click="clipYaml(field.name)"
                      />
                      <!-- hidden file input for load -->
                      <input
                        v-if="field.showLoadButton"
                        :ref="
                          (el) => {
                            if (el) yamlSubformFileRefs[field.name] = el;
                          }
                        "
                        type="file"
                        accept=".yml,.yaml"
                        @change="handleYamlSubformLoad($event, field.name)"
                        style="display: none"
                      />
                    </div>
                    <div class="card p-3 limit-height" :class="{ 'border-danger': v$.form[field.name].$invalid }">
                      <pre
                        v-if="v$.form[field.name].$model && typeof v$.form[field.name].$model === 'object'"
                        v-highlightjs
                      ><code language="yaml" style="border:none;padding:0">{{ yamlSubformPreview(field) }}</code></pre>
                      <span v-else class="text-muted fst-italic">{{ field.placeholder || '(empty)' }}</span>
                    </div>
                    <div
                      v-if="v$.form[field.name].$invalid && getErrorsToDisplay(field.name).length > 0"
                      class="invalid-feedback d-block"
                    >
                      {{
                        getErrorsToDisplay(field.name)[0].$message ||
                        getErrorsToDisplay(field.name)[0].$params?.description
                      }}
                    </div>
                    <div class="form-text" v-if="fieldHelp[field.name]">
                      {{
                        typeof fieldHelp[field.name] === 'object' ? fieldHelp[field.name].value : fieldHelp[field.name]
                      }}
                    </div>
                  </div>
                  <!-- YAML without subform: normal editor -->
                  <div v-else-if="!fieldOptions[field.name].viewable">
                    <!-- YAML field: shows data from expression/query or allows manual editing -->
                    <BsYamlEditor
                      v-model="v$.form[field.name].$model"
                      :hasError="v$.form[field.name].$invalid"
                      :icon="field.icon"
                      :readonly="field.readonly === true"
                      :showLoadButton="field.showLoadButton === true"
                      :showDownloadButton="field.showDownloadButton === true"
                      :name="field.name"
                      :errors="getErrorsToDisplay(field.name)"
                      :help="
                        typeof fieldHelp[field.name] === 'object' ? fieldHelp[field.name].value : fieldHelp[field.name]
                      "
                      @update:modelValue="evaluateDynamicFields(field.name)"
                      @blur="handleBlur(field.name)"
                    />
                  </div>
                  <!-- Debug/view raw YAML data -->
                  <div @dblclick="setExpressionFieldViewable(field.name, false)" v-else class="card p-2 limit-height">
                    <VueJsonPretty :data="v$.form[field.name].$model" />
                  </div>
                </div>

                <!-- TYPE = TEXT, PASSWORD, TEXTAREA, NUMBER, CHECKBOX -->
                <BsInputForForm
                  v-if="['text', 'password', 'textarea', 'number', 'checkbox', 'radio'].includes(field.type)"
                  @focus="preventFocus"
                  @blur="handleBlur(field.name)"
                  @keydown="field.keydown ? evaluateDynamicFields(field.name) : null"
                  @change="evaluateDynamicFields(field.name)"
                  :hasError="v$.form[field.name].$invalid"
                  v-model="v$.form[field.name].$model"
                  :name="field.name"
                  v-bind="field.attrs"
                  :required="field.required"
                  :type="field.type"
                  :icon="field.icon"
                  :readonly="field.hide"
                  :placeholder="
                    typeof fieldPlaceholders[field.name] === 'object'
                      ? fieldPlaceholders[field.name].value
                      : fieldPlaceholders[field.name]
                  "
                  :isSwitch="field.switch"
                  :errors="getErrorsToDisplay(field.name)"
                  :values="field.values"
                  :help="
                    typeof fieldHelp[field.name] === 'object' ? fieldHelp[field.name].value : fieldHelp[field.name]
                  "
                />

                <!-- TYPE = FILE -->
                <BsInputForForm
                  v-if="field.type == 'file'"
                  :accept="(field.accept || []).join(',')"
                  :type="field.type"
                  @change="handleFiles"
                  :hasError="v$.form[field.name].$invalid"
                  :name="field.name"
                  :required="field.required"
                  :icon="field.icon"
                  :errors="getErrorsToDisplay(field.name)"
                  :progress="fileProgress[field.name]"
                  :help="
                    typeof fieldHelp[field.name] === 'object' ? fieldHelp[field.name].value : fieldHelp[field.name]
                  "
                />
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>
    <div class="d-grid my-3" v-if="mode === 'form' && status == ''">
      <BsDropdownButton
        :icon="submitIcon"
        :label="submitLabel || t('form.submit')"
        colorClass="primary"
        :actions="submitActions"
        @click="handleSubmitAction('submit')"
        @action="handleSubmitAction"
      />
    </div>
    <!-- Subform Save/Cancel buttons (used when embedded in AppListField) -->
    <div class="d-flex justify-content-end gap-2 my-3" v-if="mode === 'subform'">
      <BsButton icon="xmark" colorClass="secondary" @click="emit('cancel')">{{ t('form.cancel') }}</BsButton>
      <BsDropdownButton
        icon="check"
        :label="t('form.save')"
        colorClass="primary"
        :fullWidth="false"
        :menuEnd="true"
        :actions="subformActions"
        @click="handleSubformSave"
        @action="handleSubformAction"
      />
    </div>
    <!-- Wizard mode renders no footer buttons; the wizard parent owns
             Back/Next/Skip/Submit (gated by the exposed validateForm()). -->
  </div>

  <!-- LOADER & FORM NOT FOUND -->

  <div v-else>
    <h2>{{ t('form.loading') }}</h2>
    <div class="alert alert-info">{{ t('form.formNotReady') }}</div>
  </div>
</template>
<style scoped lang="scss">
.limit-height {
  max-height: 300px;
  overflow-y: scroll;
  overflow-x: clip;
}
pre {
  margin: 0;
}
</style>
