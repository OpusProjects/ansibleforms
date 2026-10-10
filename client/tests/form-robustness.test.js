// Two ways a single bad value took out a whole page.
//
// These read the component source rather than mounting it: both fixes live inside
// <script setup> closures that depend on the whole form state, and standing that up would
// test the harness rather than the guard. Each assertion here was checked by putting the
// bug back and confirming it fails.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compileFieldRules, validateField } from '@engine/validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, '..', p), 'utf8');

describe('a sameAs naming a field that does not exist', () => {
  // fields.find() returns undefined for a typo, or for a field renamed or removed after
  // the rule was written. Reading .label off it threw inside the rules computation, so
  // the ENTIRE form failed to initialise - a blank page and a console TypeError, rather
  // than a validation message about the one field. The rules live in the shared form
  // engine since 6.4, so this runs them rather than reading the component.
  const field = { name: 'confirm', type: 'text', sameAs: 'renamed_away' };

  it('building the rules does not throw', () => {
    expect(() => compileFieldRules(field, [field])).not.toThrow();
  });

  it('falls back to the name it was given', () => {
    const { errors } = validateField(field, 'x', { values: {} }, [field]);
    expect(errors).toEqual([{ type: 'sameAs', description: "Must match the field 'renamed_away'" }]);
  });
});

describe('the schema page countdown', () => {
  // it ends with window.location.href = baseURI. Left running after the component was
  // gone, it navigated the browser to the app root from wherever the user had got to.
  const src = read('src/pages/schema.vue');

  it('clears on unmount', () => {
    expect(src).toMatch(/onBeforeUnmount\(stopCountdown\)/);
    expect(src).toMatch(/import\s*\{[^}]*onBeforeUnmount[^}]*\}\s*from\s*['"]vue['"]/);
  });

  it('clears any previous interval before starting a new one', () => {
    // lastIndexOf : onBeforeUnmount also appears up in the vue import, before this function
    const fn = src.slice(src.indexOf('function startCountdown'), src.lastIndexOf('onBeforeUnmount'));
    expect(fn).toContain('setInterval');
    // two live intervals decremented the counter twice a second and fired the reload early
    expect(fn.indexOf('stopCountdown()')).toBeGreaterThan(-1);
    expect(fn.indexOf('stopCountdown()')).toBeLessThan(fn.indexOf('setInterval'));
  });

  it('nulls the handle so a second stop is harmless', () => {
    const fn = src.slice(src.indexOf('function stopCountdown'), src.indexOf('function startCountdown'));
    expect(fn).toMatch(/countdownInterval\s*=\s*null/);
  });
});

describe('the log viewer filter', () => {
  // The filter is used as a regex. String.match compiles its argument, so a half typed
  // pattern threw a SyntaxError from inside a computed and broke the whole page - and
  // you cannot type '[abc]' without passing through '['.
  const src = read('src/pages/logs.vue');

  it('compiles the pattern inside a try/catch', () => {
    const fn = src.slice(src.indexOf('const filterMatcher'), src.indexOf('const filtered'));
    expect(fn).toContain('new RegExp');
    expect(fn).toMatch(/catch\s*\{/);
  });

  it('falls back to a substring match rather than dropping the filter', () => {
    const fn = src.slice(src.indexOf('const filterMatcher'), src.indexOf('const filtered'));
    expect(fn).toMatch(/toLowerCase\(\)\.includes\(needle\)/);
  });

  it('no longer calls String.match with the raw filter', () => {
    expect(src).not.toMatch(/x\.match\(filter\.value\)/);
  });

  // and the behaviour itself, on a copy of the logic
  it('an invalid pattern narrows instead of throwing', () => {
    const build = (f) => {
      if (!f) return null;
      try {
        const re = new RegExp(f);
        return (l) => re.test(l);
      } catch {
        const n = f.toLowerCase();
        return (l) => l.toLowerCase().includes(n);
      }
    };
    const lines = ['error [db] down', 'info ok', 'warn [db] slow'];
    expect(() => lines.filter(build('['))).not.toThrow();
    expect(lines.filter(build('['))).toEqual(['error [db] down', 'warn [db] slow']);
    expect(lines.filter(build('^error'))).toEqual(['error [db] down']);
  });
});

describe('the cron editor accepts named weekdays', () => {
  // The "unsupported feature" gate was a single /[w?@]/i over the WHOLE expression, meant
  // to catch the nearest-weekday modifier ('15W'), '?' and '@daily'. It also matched the
  // 'w' in WED, so '0 8 * * WED' was reported as unsupported - red border, no description,
  // no next-run badges - for an expression croner accepts and the scheduler runs. Only
  // Wednesday was affected, which is why nobody caught it: every other day name is clean.
  //
  // The logic moved to config/cron.js when the save validator was made to share it (see
  // 'a cron field is validated with the same check the editor uses' below), so these two
  // assertions follow it there. The behaviour is also asserted end to end against croner
  // itself in server/tests/cron-agreement.test.mjs.
  const src = read('src/config/cron.js');

  it('no longer tests the raw expression for w', () => {
    expect(src).not.toMatch(/const UNSUPPORTED = \/\[w\?@\]\/i/);
  });

  it('symbols are tested on the raw expression, w only after name resolution', () => {
    expect(src).toMatch(/const UNSUPPORTED_SYMBOL = \/\[\?@\]\//);
    expect(src).toMatch(/NEAREST_WEEKDAY\.test\(normalizeNames\(parts\[i\], fields\[i\]\)\)/);
  });

  it('only wed contains the letter, which is what made this so narrow', () => {
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    expect(days.filter((d) => /w/i.test(d))).toEqual(['wed']);
  });

  it('a named weekday survives normalization, a real modifier does not', () => {
    // mirrors normalizeNames for the dow field
    const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const norm = (e) => DOW.reduce((a, n, i) => a.replace(new RegExp(n, 'gi'), String(i)), e.replace(/-sun/gi, '-7'));
    expect(/w/i.test(norm('WED'))).toBe(false);
    expect(/w/i.test(norm('mon-wed'))).toBe(false);
    expect(/w/i.test('15W')).toBe(true); // dom is not name-normalized, so this still trips
  });
});

describe('bindings that were passed as literal strings', () => {
  it('BsInput binds defaultValue on the select_advanced branch', () => {
    const src = read('src/components/BsInput.vue');
    expect(src).not.toMatch(/[^:]defaultValue="defaultValue"/);
  });

  it('BsInputRaw declares the cssClass prop it reads', () => {
    const src = read('src/components/BsInputRaw.vue');
    const props = src.slice(src.indexOf('defineProps({'), src.indexOf('// COMPUTED'));
    expect(props).toMatch(/cssClass:\s*\{/);
    expect(src).toContain('props.cssClass');
  });

  // Generalised, because BsInputRaw was fixed and its sibling BsInputFileRaw was not:
  // it read props.cssClass without declaring it, so the value was always undefined and
  // the class silently never applied. An undeclared prop is not an error in Vue, and
  // nothing in the build or the linter notices - only a scan does.
  it('every component declares every prop it reads', () => {
    const files = [];
    (function walk(dir) {
      for (const entry of readdirSync(path.join(here, '..', dir), { withFileTypes: true })) {
        const p = dir + '/' + entry.name;
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.vue')) files.push(p);
      }
    })('src');
    expect(files.length).toBeGreaterThan(40);
    const offenders = [];
    for (const file of files) {
      const src = read(file);
      const at = src.indexOf('defineProps');
      if (at === -1) continue;
      // the props object literal, by brace matching - a regex cannot find its end
      const start = src.indexOf('{', at);
      if (start === -1) continue;
      let depth = 0,
        end = -1;
      for (let i = start; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) {
          end = i;
          break;
        }
      }
      if (end === -1) continue;
      const block = src.slice(start, end + 1);
      const declared = new Set([...block.matchAll(/^\s*['"]?([a-zA-Z_][a-zA-Z0-9_]*)['"]?\s*:/gm)].map((m) => m[1]));
      const used = new Set([...src.matchAll(/\bprops\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]));
      const missing = [...used].filter((u) => !declared.has(u));
      if (missing.length) offenders.push(`${file}: ${missing.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('and the file input is given the class, like every other raw input', () => {
    // declaring the prop is only half of it - BsInputForForm did not pass it either,
    // while BsInput passes cssClass to every other raw input it renders
    const src = read('src/components/BsInputForForm.vue');
    const tag = /<BsInputFileRaw[^>]*>/.exec(src);
    expect(tag).not.toBeNull();
    expect(tag[0]).toMatch(/:cssClass="cssClass"/);
  });
});

describe('the data table paginator', () => {
  const src = read('src/components/BsDataTable.vue');

  it('re-keys on a FILTER change, not on every items change', () => {
    // filteredItems returns props.items by IDENTITY when nothing is filtered, so watching
    // it meant "the parent replaced the array" counted as "the filter changed".
    // AppAdminMulti reloads every 60s in two steps (itemList=[], then the new array), so
    // the paginator was remounted twice a minute and threw the reader back to page 1.
    const block = src.slice(src.indexOf('const filterVersion'), src.indexOf('// ─── Cell rendering'));
    expect(block).toMatch(/watch\(\s*\[globalFilter, columnFilters\]/);
    expect(block).not.toMatch(/watch\(filteredItems, \(\) => \{\s*filterVersion/);
  });

  it('still clears the shift-select anchor when the data changes', () => {
    const block = src.slice(src.indexOf('const filterVersion'), src.indexOf('// ─── Cell rendering'));
    expect(block).toMatch(/watch\(filteredItems, \(\) => \{\s*anchorIndex = null;\s*\}\)/);
  });

  it('hiding a column drops its filter', () => {
    // the filter inputs render only for visible columns, but filteredItems applies every
    // entry - so a hidden column kept filtering with no control left to clear it
    const block = src.slice(src.indexOf('function toggleColumn'), src.indexOf('// Restore column visibility'));
    const drop = block.slice(block.indexOf('function dropFiltersOfHidden'));
    expect(drop).toMatch(/delete next\[k\]/);
    expect(drop).toMatch(/columnFilters\.value = next/);
    // both ways of hiding a column go through it : the picker and a preset
    const toggle = block.slice(0, block.indexOf('\n}\n'));
    expect(toggle).toMatch(/dropFiltersOfHidden\(s\)/);
    const preset = block.slice(block.indexOf('function applyPreset'));
    expect(preset.slice(0, preset.indexOf('\n}\n'))).toMatch(/dropFiltersOfHidden\(s\)/);
  });
});

describe('copying to the clipboard reports what actually happened', () => {
  // vue3-clipboard's copyText(text, container, callback) invokes the callback UNGUARDED,
  // so calling it with only the text threw a TypeError inside the synthetic click
  // dispatch. That never reaches the caller's try/catch, so every copy logged an uncaught
  // error and the success toast fired even when nothing had been copied.
  it('the helper passes a callback and rejects on failure', () => {
    const src = read('src/lib/Helpers.js');
    const fn = src.slice(src.indexOf('copyToClipboard(text)'), src.length);
    expect(fn).toMatch(/copyText\(String\(text \?\? ''\), undefined, \(err\) =>/);
    expect(fn).toMatch(/err \? reject\(err\) : resolve\(\)/);
  });

  it('no component calls copyText directly any more', () => {
    for (const f of ['src/components/BsSshKey.vue', 'src/components/AppForm.vue', 'src/pages/admin/knownHosts.vue']) {
      expect(read(f)).not.toMatch(/\bcopyText\(/);
    }
  });

  it('every call site toasts success only after the promise resolves', () => {
    for (const f of ['src/components/BsSshKey.vue', 'src/components/AppForm.vue', 'src/pages/admin/knownHosts.vue']) {
      const src = read(f);
      const calls = [...src.matchAll(/Helpers\.copyToClipboard\([^)]*\)([\s\S]{0,220})/g)];
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c[1]).toMatch(/\.then\(/);
        expect(c[1]).toMatch(/\.catch\(/);
      }
    }
  });
});

describe('the paginator does not emit a slice from an out-of-range page', () => {
  // displayedItems recomputes as soon as pageSize changes, while `page` is still the old
  // too-large number; the watcher that clamps it runs afterwards. On the audit page each
  // emit starts a request, so two were in flight and the last to answer won.
  const src = read('src/components/BsPagination.vue');

  it('change() skips while the page is beyond the last one', () => {
    const fn = src.slice(src.indexOf('function change()'), src.indexOf('// COMPUTED'));
    expect(fn).toMatch(/if ?\(pages\.value\.length && page\.value > pages\.value\.length\) return/);
  });

  it('an empty list still emits, so a cleared table is not stuck', () => {
    // pages.length === 0 is falsy, so the guard does not fire
    const guard = (pagesLen, page) => !!(pagesLen && page > pagesLen);
    expect(guard(0, 1)).toBe(false);
    expect(guard(10, 3)).toBe(false);
    expect(guard(3, 10)).toBe(true);
  });
});

describe('admin list pages: dialogs and dependent defaults', () => {
  const src = read('src/components/AppAdminMulti.vue');

  it('the auto-reload does not close an open delete confirmation', () => {
    // 'delete' was missing from the guard, so the 60s reload ran resetItems(), which
    // clears `action` - the confirmation vanished with nothing deleted and no message
    const fn = src.slice(src.indexOf('async function loadItems'), src.indexOf('async function loadList'));
    expect(fn).toMatch(/'change_password', 'delete'\]\.includes\(action\.value\)/);
  });

  it('the delete confirmation names the record even without a `name`', () => {
    // backups are keyed by folder and have no name at all, so the prompt read
    // "Are you sure you want to delete ?"
    expect(src).toMatch(/const deleteLabel = computed/);
    expect(src).toMatch(/\{\{ deleteLabel \}\}/);
    expect(src).not.toMatch(/\{\{ selectedItem\.name \}\}/);
  });

  it('loading a record does not re-apply dependent defaults over it', () => {
    // loadItem replaces item.value wholesale, so the dependency watcher fired and
    // setFieldDefaults - which has no "only when empty" guard - overwrote a saved
    // redirect_uri with the computed default. Measured: opening an OAuth2 provider
    // showed the default instead of the stored custom URL, and Save persisted it.
    const w = src.slice(src.indexOf('fields.value.forEach((field) => {\n  if (field.dependency)'), src.length);
    expect(w.slice(0, 400)).toMatch(/if \(loadingItem\.value\) return;/);
  });

  it('the loading flag is released even when the load fails', () => {
    const fn = src.slice(src.indexOf('async function loadItem'), src.indexOf('async function selectItem'));
    expect(fn).toMatch(/finally \{/);
    expect(fn).toMatch(/loadingItem\.value = false/);
  });
});

describe('the settings page saves both halves or neither', () => {
  const src = read('src/pages/admin/settings.vue');

  it('an invalid settings half stops the combined save', () => {
    const fn = src.slice(
      src.indexOf('async function saveActiveTab'),
      src.indexOf('async function loadEnvironmentVariables'),
    );
    expect(fn).toMatch(/if \(\(?await saveSettings\(\)\)? === false\) return;/);
  });

  it('and says why instead of returning silently', () => {
    const fn = src.slice(src.indexOf('async function saveSettings'), src.indexOf('async function saveSettings') + 900);
    expect(fn).toMatch(/toast\.error/);
    expect(fn).toMatch(/return false;/);
  });

  it('a REFUSED settings half stops it too, not just an invalid one', () => {
    // Only the vuelidate branch used to answer false. A 409 from a concurrent edit, a 423
    // from the designer lock or any 500 left the catch returning undefined, which passes
    // the `=== false` guard - so the environment half was written anyway and the user got
    // an error toast and a success toast for one button press.
    const fn = src.slice(
      src.indexOf('async function saveSettings'),
      src.indexOf('async function importConfigToDatabase'),
    );
    const catchBlock = fn.slice(fn.indexOf('} catch (err) {'));
    expect(catchBlock).toMatch(/return false;/);
    // and the success path has to be distinguishable from it
    expect(fn.slice(0, fn.indexOf('} catch (err) {'))).toMatch(/return true;/);
  });
});

describe('a query field inside a subform is bound to its ROOT form', () => {
  // A subform cannot be resolved as a form of its own: the schema forbids it from carrying
  // `roles`, so the server's role check denies it to every non-admin and Form.load throws.
  // Sending the subform's own name answered 500 on every query field inside a wizard step
  // or a list row - for everyone except an admin, who short-circuits the role check.
  const form = read('src/components/AppForm.vue');
  const page = read('src/pages/form.vue');

  it('the request names the root form, and the subform separately', () => {
    const body = form.slice(form.indexOf('const body = {'), form.indexOf('/api/v2/query'));
    expect(body).toMatch(/formName: props\.rootFormName \|\| props\.currentForm\.name/);
    expect(form).toMatch(/if \(props\.rootFormName\) body\.subformName = props\.currentForm\.name;/);
  });

  it('every subform mount point supplies the root name', () => {
    // the wizard step and the list-row edit stack ; the main form deliberately does not.
    // The tag ends at the '>' that closes a LINE - a lazy match to the first '>' stops
    // inside `:ref="(el) => ..."` and silently reads only half the attributes.
    const mounts = page
      .split('<AppForm')
      .slice(1)
      .map((s) => s.slice(0, s.search(/>\s*\r?\n/)));
    const subformMounts = mounts.filter((m) => /:currentForm="(step\.subform|entry\.subform)"/.test(m));
    expect(subformMounts.length).toBe(2);
    for (const m of subformMounts) expect(m).toMatch(/:rootFormName="currentForm\?\.name \|\| ''"/);
  });

  it('values are sent keyed by the raw placeholder, not as a flat field map', () => {
    // a flat map cannot express $(city.name), $(rows[0].id) or placeholderColumn, all of
    // which are documented; the server got all three wrong when it re-derived them
    const body = form.slice(form.indexOf('const body = {'), form.indexOf('/api/v2/query'));
    expect(body).toMatch(/values: placeholderCheck\.resolved \|\| \{\}/);
    expect(body).not.toMatch(/values: \{ \.\.\.\(props\.constants/);
  });

  it('the resolver returns what it resolved', () => {
    const fn = form.slice(
      form.indexOf('function replacePlaceholderInString'),
      form.indexOf('function replacePlaceholders(item)'),
    );
    expect(fn).toMatch(/resolved\[match\[1\]\] = fieldvalue/);
    expect(fn).toMatch(/"?resolved"?: resolved/);
  });
});

describe('the periodic refresh does not disturb the reader', () => {
  const src = read('src/components/AppAdminMulti.vue');

  it('the list is not blanked before the refetch', () => {
    // resetItems() emptied itemList first, so BsPagination saw an empty dataList and its
    // clamp watcher called setPage(1) - back to page 1 every 60 seconds, plus a "no data"
    // flicker. BsDataTable already stopped re-keying the paginator; this was the other half.
    const fn = src.slice(src.indexOf('async function loadItems'), src.indexOf('async function loadList'));
    expect(fn).toMatch(/resetSelection\(\);/);
    expect(fn).not.toMatch(/resetItems\(\);/);
  });

  it('resetSelection clears the selection but not the rows', () => {
    const fn = src.slice(src.indexOf('function resetSelection'), src.indexOf('async function loadItems'));
    expect(fn).toMatch(/itemId\.value = undefined/);
    expect(fn).not.toMatch(/itemList\.value = \[\]/);
  });
});

describe('a row action in progress is visible and not repeatable', () => {
  const src = read('src/components/AppAdminMulti.vue');

  it('the busyItems prop is actually read', () => {
    // it was declared, documented, and passed by credentials.vue and aap.vue - and read
    // by nothing, so pressing Test gave no feedback and a second click fired again
    expect(src).toMatch(/function busyLabel\(item\)/);
    expect(src).toMatch(/props\.busyItems\?\.\[item\.id\]/);
  });

  it('only the running action wears the label', () => {
    // otherwise Edit and Delete would both read "Testing..."
    expect(src).toMatch(/function busyAction\(action, item\)/);
    expect(src).toMatch(/action\?\.name === 'test'/);
    expect(src).toMatch(/busyAction\(action, item\) \? busyLabel\(item\) : action\.title/);
  });

  it('a busy row refuses a second dispatch', () => {
    const fn = src.slice(src.indexOf('function dispatchAction'), src.indexOf('function dispatchAction') + 500);
    expect(fn).toMatch(/if \(busyLabel\(item\)\) return;/);
  });
});

describe('the form page always reaches a definite state', () => {
  const src = read('src/pages/form.vue');

  it('a load that throws is caught', () => {
    // Form.load throws on every non-200 (403 for a form your roles no longer grant, 404,
    // 500 for a config error). Nothing caught it, so currentForm stayed null and
    // formNotFound stayed false - the template fell to the bare spinner and stayed there.
    // Measured as a non-admin opening a role-restricted form: spinner for ever with the
    // fix removed, the alert with it in place.
    const fn = src.slice(src.indexOf('onMounted(async () =>'), src.indexOf('// Watch for route changes'));
    expect(fn).toMatch(/try \{\s*\n\s*await loadForm\(\);/);
    expect(fn).toMatch(/formNotFound\.value = true/);
  });

  it('the reason is shown rather than a generic message', () => {
    // a 403 must not read as "this form does not exist"
    expect(src).toMatch(/\{\{ loadError \|\| t\('form\.formNotFoundMsg'\) \}\}/);
  });
});

describe('one failed job poll does not end the polling', () => {
  const src = read('src/pages/form.vue');
  const fn = src.slice(src.indexOf('async function getJob'), src.indexOf('async function getJob') + 4000);

  it('found the function, so these assertions are not vacuous', () => {
    expect(fn).toContain('/api/v2/job/');
  });

  it('a transient failure retries instead of stopping', () => {
    // the catch scheduled nothing, so a VPN reconnect or a server restart stopped the
    // poll for good - and "error" has no case in formStatus, so it rendered as "Pending"
    // with no spinner and no abort button
    expect(fn).toMatch(/pollFailures\.value\+\+/);
    expect(fn).toMatch(/timeout\.value = setTimeout\(async \(\) => await getJob\(id\), 2000\)/);
  });

  it('a sustained outage still gives up', () => {
    expect(fn).toMatch(/pollFailures\.value < 5/);
    expect(fn).toMatch(/status\.value = ['"]error['"]/);
  });

  it('a successful poll forgets earlier failures', () => {
    expect(fn).toMatch(/pollFailures\.value = 0/);
  });
});

describe('form field rules cannot take the whole form down', () => {
  // The rules are built inside a computed, so a throw there blanks the whole form. They
  // live in the shared form engine since 6.4 : run them.
  it('a malformed pattern is reported, not thrown', () => {
    const field = { name: 'host', type: 'text', regex: { expression: '^[a-z', description: 'x' } };
    let built;
    expect(() => {
      built = compileFieldRules(field);
    }).not.toThrow();
    expect(built.warnings).toEqual([expect.stringContaining("Field 'host': the regex '^[a-z' is not valid")]);
    // and the rule is only registered when there is a usable pattern
    expect(built.rules).toEqual([]);
  });

  it('a regex without an expression does not match everything', () => {
    // new RegExp(undefined) compiles to /(?:)/, which matches every string - the
    // constraint silently never failed. Say so and skip the rule instead.
    const built = compileFieldRules({ name: 'host', type: 'text', regex: { description: 'no expression' } });
    expect(built.rules).toEqual([]);
    expect(built.warnings).toEqual([expect.stringContaining('regex must be given as { expression')]);
  });

  it('a bare string is used as the pattern', () => {
    const field = { name: 'host', type: 'text', regex: '^prod-' };
    expect(validateField(field, 'test-1', { values: {} }).errors.map((e) => e.type)).toEqual(['regex']);
    expect(validateField(field, 'prod-1', { values: {} }).errors).toEqual([]);
  });
});

describe('a non-numeric prefill is ignored, not submitted as NaN', () => {
  const src = read('src/components/AppForm.vue');
  const fn = src.slice(src.indexOf("if (item.type == 'number')"), src.indexOf("if (item.type == 'checkbox')"));

  it('parseInt is gone', () => {
    // it RETURNS NaN and never throws, so the catch was unreachable: ?count=abc launched
    // the job with count: null while the box looked empty.
    // Comments stripped first: the comment explaining this fix names parseInt, so
    // matching the raw slice matched the PROSE and failed against the fixed file.
    const code = fn.replace(/\/\/[^\n]*/g, '');
    expect(code).not.toContain('parseInt');
    expect(code).toMatch(/Number\.isFinite\(parsed\)/);
  });
});

describe('the wizard cannot launch the same job twice', () => {
  const src = read('src/pages/form.vue');
  const fn = src.slice(src.indexOf('function handleWizardSubmitAction'), src.indexOf('const hideForm'));

  it('found the function, so these assertions are not vacuous', () => {
    expect(fn).toContain("case 'submit'");
  });

  it('it refuses while a run is already under way', () => {
    // the button is only disabled for initializing/submitting, but launchForm sets
    // status to 'running' within milliseconds - so it re-enabled itself immediately and
    // a second click launched a second Ansible job AND orphaned the first poll chain
    // (timeout.value was overwritten, so nothing could clear it any more)
    expect(fn).toMatch(/if \(status\.value !== ''\) return;/);
  });

  it('and the button stays disabled for the whole run', () => {
    expect(src).toMatch(/:disabled="status !== ''"/);
    expect(src).not.toMatch(/:disabled="status === 'initializing' \|\| status === 'submitting'"/);
  });
});

describe('every wizard action checks the steps are complete', () => {
  const src = read('src/pages/form.vue');

  it('the check is its own function, not buried in submit', () => {
    // it used to live inside wizardSubmit, so schedule/run-later/store skipped it - and
    // handleWizardSubmitAction's own validation is a no-op on the summary step. From the
    // summary you could persist a RECURRING SCHEDULE whose extra_vars came from a wizard
    // whose steps were never filled in, which then fired unattended.
    expect(src).toMatch(/function wizardStepsComplete\(\)/);
  });

  it('handleWizardSubmitAction runs it before dispatching any action', () => {
    const fn = src.slice(src.indexOf('function handleWizardSubmitAction'), src.indexOf('const hideForm'));
    const check = fn.indexOf('wizardStepsComplete()');
    const dispatch = fn.indexOf('switch (action)');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(dispatch);
  });
});

describe('onSuccess/onFailure timers do not outlive the page', () => {
  const src = read('src/pages/form.vue');

  it('every doAction timer is tracked', () => {
    // their ids were discarded, and `router` still works after unmount - so
    // onSuccess: [{home: 30}] yanked the user off whatever page they had moved to
    // bounded by the NEXT declaration after doAction : `const hideForm` sits BEFORE it,
    // so using that as the end ran the slice to the end of the file and picked up every
    // other setTimeout in the component
    const at = src.indexOf('function doAction');
    const end = src.slice(at + 10).search(/\n(?:function|const|async function) /) + at + 10;
    const fn = src.slice(at, end);
    expect(fn).not.toMatch(/setTimeout\(/);
    expect([...fn.matchAll(/laterInThisForm\(/g)].length).toBe(6);
  });

  it('and cancelled on unmount', () => {
    const fn = src.slice(src.lastIndexOf('onBeforeUnmount('));
    expect(fn).toMatch(/for \(const id of actionTimers\.value\) clearTimeout\(id\)/);
  });
});

describe('a stale field response cannot overwrite a newer one', () => {
  const src = read('src/components/AppForm.vue');

  it('there is a per-field generation counter', () => {
    // concurrency was tracked only through dynamicFieldStatus, and resetField clears that
    // while a request is in flight - so two requests raced and the LAST to land won, even
    // if it was the older one. That value was then flagged "fixed" and submitted.
    expect(src).toMatch(/function bumpFieldGeneration\(fieldname\)/);
    expect(src).toMatch(/function isCurrentGeneration\(fieldname, gen\)/);
  });

  it('resetField invalidates anything in flight', () => {
    // Bounded by the next top level declaration, not by a character count. It was
    // `indexOf(...) + 500`, and the prefill fix added a six line comment near the top of
    // the function that pushed the bumpFieldGeneration call to offset 621 - so the test
    // went red on a function that still does exactly what it is being asked about. A
    // magic window measures how long the comments are, which is not the property under
    // test; the same trap is written up on the doAction test above.
    const at = src.indexOf('function resetField');
    const end = src.slice(at + 10).search(/\n(?:function|const|async function) /) + at + 10;
    const fn = src.slice(at, end);
    expect(fn).toMatch(/bumpFieldGeneration\(fieldname\)/);
  });

  it('the query response is dropped when it is no longer current', () => {
    const at = src.search(/await axios\.post\(\s*`\/api\/v2\/query/);
    const around = src.slice(at - 300, at + 900);
    expect(around).toMatch(/const gen = fieldGeneration\.value\[item\.name\] \|\| 0;/);
    expect(around).toMatch(/if \(!isCurrentGeneration\(item\.name, gen\)\) return;/);
  });
});

describe('a refresh does not overwrite what the user is typing', () => {
  const src = read('src/components/AppForm.vue');

  it('the refresh path honours the editable toggle', () => {
    // clearing the status makes the next tick re-run the expression over form.value, so a
    // field with editable: true and refresh: "30s" lost the typed value every 30s
    const fn = src.slice(
      src.indexOf("if (item.refresh && typeof item.refresh == 'string')"),
      src.indexOf("if (item.refresh && typeof item.refresh == 'string')") + 900,
    );
    expect(fn).toMatch(/!fieldOptions\.value\[item\.name\]\?\.editable/);
  });
});

describe('a form is not submitted while its fields are still resolving', () => {
  // AppForm computes canSubmit (every dynamic field settled) and emits a "submit" event
  // when it flips - but "submit" is not in defineEmits and nothing binds it, so that
  // whole path was dead: form.vue called submitForm() the instant the button was pressed.
  // A slow query/expression field was then read while still undefined and the job ran
  // with a missing or stale extravar, silently.
  const appForm = read('src/components/AppForm.vue');
  const formPage = read('src/pages/form.vue');

  it('AppForm exposes the gate rather than only emitting it', () => {
    expect(appForm).toMatch(/function awaitStable\(timeoutMs = 10000\)/);
    const exposed = appForm.slice(appForm.indexOf('defineExpose({'), appForm.indexOf('defineExpose({') + 200);
    expect(exposed).toMatch(/awaitStable,/);
  });

  it('it resolves on canSubmit and gives up after the timeout', () => {
    const fn = appForm.slice(appForm.indexOf('function awaitStable'), appForm.indexOf('defineExpose({'));
    expect(fn).toMatch(/if \(canSubmit\.value\) \{\s*clearInterval\(timer\);\s*resolve\(true\);\s*\}/);
    expect(fn).toMatch(/resolve\(false\)/);
    expect(fn).toMatch(/clearInterval\(timer\)/);
  });

  // scoped to handleSubmitAction : the WIZARD's switch has its own `case 'submit':` and
  // it comes first in the file, so an unscoped indexOf found the wrong one
  const mainSubmitCase = () => {
    const h = formPage.indexOf('async function handleSubmitAction');
    return formPage.slice(h, h + 1400);
  };

  it('form.vue awaits it before launching', () => {
    const fn = mainSubmitCase();
    const wait = fn.indexOf('await mainForm.value.awaitStable()');
    const launch = fn.indexOf('submitForm({');
    expect(wait).toBeGreaterThan(-1);
    expect(wait).toBeLessThan(launch);
  });

  it('and tells the user when it gave up, instead of submitting anyway', () => {
    const fn = mainSubmitCase();
    expect(fn).toMatch(/t\('form\.tooLongToEvaluate'\)/);
    expect(fn).toMatch(/return;/);
  });

  it('the main AppForm carries the ref the gate is reached through', () => {
    expect(formPage).toMatch(/<AppForm\s+v-if="!wizardActive"\s+ref="mainForm"/);
  });
});

describe('no rules builder can be taken down by a bad regex', () => {
  // Validation rules are built inside computeds, so a `new RegExp` that throws there
  // kills the whole component - blank form, console error, instead of one field's
  // message. AppForm was fixed first; the same construct existed unguarded in
  // the table field (gone since 7.0.0) and unprotected against a malformed pattern in
  // AppAdminMulti and change-password. This test covers every site so a new one cannot
  // reintroduce it.
  // AppForm builds its rules from the shared engine since 6.4 ; the
  // engine's own guard is run in 'form field rules cannot take the whole form down'
  const sites = [
    ['src/components/AppAdminMulti.vue', 'field.regex.expression'],
    ['src/pages/change-password.vue', 'field.regex.expression'],
  ];

  // Comments are stripped everywhere below: the comments explaining these fixes quote
  // `new RegExp` and `rule.regex`, so searching the raw file located the PROSE and the
  // assertions then failed against correct code.
  const code = (file) => read(file).replace(/\/\/[^\n]*/g, '');

  it.each(sites)('%s builds its RegExp inside a try', (file) => {
    const src = code(file);
    const at = src.indexOf('new RegExp(');
    expect(at).toBeGreaterThan(-1);
    // the construction must sit in a try - look back a short way for it
    expect(src.slice(Math.max(0, at - 200), at)).toMatch(/try\s*\{/);
  });

  it.each(sites)('%s only registers the rule when the pattern compiled', (file) => {
    const src = code(file);
    const at = src.indexOf('rule.regex');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 400), at)).toMatch(/if \(regexObj\) \{/);
  });

  it('every dynamic RegExp in the client is either guarded or built from a literal', () => {
    // a sweep, so a new unguarded site anywhere is caught
    const files = [
      'src/pages/login.vue',
      'src/pages/logs.vue',
      'src/pages/change-password.vue',
      'src/components/AppForm.vue',
      'src/components/AppAdminMulti.vue',
      '../server/src/lib/formEngine/validate.js',
    ];
    const unguarded = [];
    for (const f of files) {
      const src = code(f);
      for (const m of src.matchAll(/new RegExp\(/g)) {
        const before = src.slice(Math.max(0, m.index - 320), m.index);
        // guarded by a try, OR built from a source that has already had every regex
        // metacharacter escaped - that pattern is valid by construction and cannot throw
        // (AppForm's placeholder substitution does this)
        const escapedSource = /replace\(\/\[\.\*\+\?\^\$\{\}\(\)\|\[\\\]\\\\\]\/g/.test(before);
        if (!/try\s*\{/.test(before) && !escapedSource) unguarded.push(`${f}@${m.index}`);
      }
    }
    expect(unguarded).toEqual([]);
  });
});

describe('an emptied dropdown clears the value it had selected', () => {
  // getLabels() wraps its whole body in `if (props.values.length > 0)`, and recalc() -
  // the only thing that emits update:modelValue - lives inside it. So when the list went
  // from N rows to ZERO nothing was emitted: the box looked empty while form[name] still
  // held the old row, and that stale value was submitted. The sibling component has
  // always called recalc() in this watcher.
  it('both sibling components recalc when values change', () => {
    for (const f of [
      'src/components/BsInputSelectAdvancedTable.vue',
      'src/components/BsInputSelectAdvancedTable2.vue',
    ]) {
      const src = read(f);
      const at = src.search(/watch\(\s*\(\) => props\.values/);
      expect(at).toBeGreaterThan(-1);
      const fn = src.slice(at, src.indexOf('{ deep: true }', at));
      expect(fn).toMatch(/recalc\(\);/);
    }
  });
});

describe('a null first row does not blank the whole select', () => {
  // typeof null === "object", so a null first entry fell into the else and
  // Object.keys(null) threw - the exception escaped the watcher and the select rendered
  // with no labels and no rows. Reachable from `values: [~, a, b]` or a jq result.
  it('both components guard the first element', () => {
    for (const f of [
      'src/components/BsInputSelectAdvancedTable.vue',
      'src/components/BsInputSelectAdvancedTable2.vue',
    ]) {
      const code = read(f).replace(/\/\/[^\n]*/g, '');
      expect(code).toMatch(/if \(!props\.values\[0\] \|\| typeof props\.values\[0\] !== ['"]object['"]\)/);
    }
  });

  it('and the hazard is real', () => {
    expect(typeof null).toBe('object');
    expect(() => Object.keys(null)).toThrow();
  });
});

describe('the file picker is always reset', () => {
  // the early returns (wrong extension, unparsable file) skipped the reset at the end, so
  // the input kept its value: re-picking the SAME path fired no change event and the
  // button was dead until a different file was chosen
  it.each(['src/components/AppListField.vue'])('%s resets in a finally', (file) => {
    const src = read(file);
    const at = src.indexOf('async function handleFileLoad');
    expect(at).toBeGreaterThan(-1);
    const fn = src.slice(at, at + 2600);
    expect(fn).toMatch(/\} finally \{/);
    const fin = fn.indexOf('} finally {');
    expect(fn.slice(fin)).toMatch(/event\.target\.value = ''/);
  });
});

describe('dropdown positioning actually runs', () => {
  const src = read('src/components/BsInputSelectAdvanced.vue');

  it('every input-group branch carries the ref toggle() needs', () => {
    // toggle() gates everything on `if (dt)`, and BsInputForForm always passes
    // :isFloating="false" - so the branch that was missing the ref is the one every form
    // field renders. Without it the panel always dropped downward (clipped off-screen)
    // and kept width:100% instead of the computed multi-column width.
    const groups = [...src.matchAll(/<div[^>]*class="input-group"[^>]*>/g)].map((m) => m[0]);
    expect(groups.length).toBeGreaterThan(3);
    for (const g of groups) expect(g).toMatch(/ref="dtRef"/);
  });

  it('the containerSize watcher is deep', () => {
    // AppForm mutates containerSize.value.x/.width IN PLACE, so the getter returns the
    // same object and a shallow watcher could never fire - the width stayed stale after
    // a window resize until the dropdown was closed and reopened
    const at = src.search(/watch\(\s*\(\) => props\.containerSize/);
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 240)).toMatch(/\{ deep: true \}/);
  });
});

describe('the list download survives a scalar row', () => {
  it('a non-object row is passed through instead of probed with `in`', () => {
    // `k in row` throws on a string/number, and applySubformModeling passes non-object
    // rows straight through - so loading a plain YAML list and pressing Download failed
    // with a TypeError the user could make nothing of
    const src = read('src/components/AppListField.vue');
    expect(src).toMatch(/if \(!row \|\| typeof row !== 'object'\) return row;/);
  });

  it('and the hazard is real', () => {
    expect(() => 'x' in 'one').toThrow();
  });
});

describe('an empty percentage cell is not a progress bar', () => {
  const src = read('src/components/BsInputSelectAdvancedTable.vue');

  it('the guard requires an actual number', () => {
    const at = src.indexOf('function getProgressHtml');
    const fn = src.slice(at, at + 900);
    expect(fn).toMatch(/String\(value\)\.trim\(\) !== (""|'')/);
    expect(fn).toMatch(/value !== null && value !== undefined/);
  });

  it('and the hazard is real', () => {
    // both coerce to 0, so isNaN says "this is a number" while parseInt gives NaN
    expect(isNaN('')).toBe(false);
    expect(isNaN(null)).toBe(false);
    expect(Number.isNaN(parseInt(''))).toBe(true);
  });
});

describe('applying a default does not steal keyboard focus', () => {
  // "isSelected" makes the parent close the dropdown and focus its input. select() is
  // also called non-interactively from getLabels() to apply a default, and getLabels()
  // re-runs from the props.values watcher every time the backing query resolves - so a
  // query landing while the user was typing in another field pulled the caret out of it.
  //
  // NOTE ON VERIFICATION: this is pinned at source level. Reproducing it in a browser
  // needs a single-select enum whose values come from a QUERY and whose default matches a
  // returned row, resolving mid-typing - which needs a configured datasource. A live run
  // against the demo form showed focus retained both with and without the fix, i.e. that
  // form does not exercise it, so it is not evidence either way and is not cited as such.
  const src = read('src/components/BsInputSelectAdvancedTable.vue');
  const code = src.replace(/\/\/[^\n]*/g, '');

  it('select() distinguishes a click from a programmatic default', () => {
    expect(code).toMatch(/function select\(i, fromUser = true\)/);
    expect(code).toMatch(/if \(fromUser\) emit\(['"]isSelected['"]\)/);
  });

  it('every call inside getLabels is marked programmatic', () => {
    const at = code.indexOf('function getLabels() {');
    const fn = code.slice(at, code.indexOf('onMounted(() => {', at));
    const calls = [...fn.matchAll(/select\((0|i)(,\s*false)?\)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const c of calls) expect(c[0]).toMatch(/, false\)$/);
  });

  it('the click handler still moves focus', () => {
    // the template passes one argument, so fromUser defaults to true
    expect(src).toMatch(/@click="disabled \? null : select\(v\.index\)"/);
  });
});

describe('a cron field is validated with the same check the editor uses', () => {
  // The save rule used to be a hand written regex in config/settings.js while BsCron had
  // its own logic. A regex cannot compare the two ends of a range, so `0 0 * * 5-1` saved
  // and croner then refused it - cron.service.js logs and returns, so the job was never
  // registered and the repository silently stopped syncing. The regex also refused the
  // month and weekday NAMES that BsCron previews as valid and croner runs.
  const settings = read('src/config/settings.js');
  const bsCron = read('src/components/BsCron.vue');
  const admin = read('src/components/AppAdminMulti.vue');

  it('settings.js no longer carries its own cron pattern', () => {
    expect(settings).not.toMatch(/CRON_EXPRESSION/);
    expect(settings).toMatch(/import \{ cronValidationMessage \} from '\.\/cron'/);
  });

  it('every cron field uses the shared validator', () => {
    // one entry per field object, not per line : a formatted field spans several lines
    const cronFields = [...settings.matchAll(/\{[^{}]*\}/g)]
      .map((m) => m[0])
      .filter((l) => /type:\s*['"]cron['"]/.test(l));
    expect(cronFields.length).toBe(2); // repositories, schedules
    for (const line of cronFields) {
      expect(line).toMatch(/validator: cronValidator\(t\)/);
      expect(line).not.toMatch(/regex:/);
    }
  });

  it('BsCron delegates instead of keeping a second copy', () => {
    expect(bsCron).toMatch(/from '@\/config\/cron'/);
    expect(bsCron).toMatch(/cronValidationMessage\(t, props\.modelValue\)/);
    // the logic must not still be here, or the two can drift apart again
    expect(bsCron).not.toMatch(/function fieldError/);
    expect(bsCron).not.toMatch(/const FIELD_SPECS/);
  });

  it('AppAdminMulti honours a function validator, so the rule can block a save', () => {
    const block = admin.slice(
      admin.indexOf("typeof field.validator === 'function'"),
      admin.indexOf("field.type == 'editor'"),
    );
    expect(block).toMatch(/rule\.custom/);
    expect(block).toMatch(/\$valid: false/);
    // a throwing validator must not take the whole form down
    expect(block).toMatch(/catch/);
  });
});

describe('a flat admin list identifies rows by value, not by position', () => {
  // knownhosts is the one `flat: true` page, and its records are bare ssh key lines. Rows
  // were built as { id: arrayIndex, name: value } - a POSITIONAL identity - while the page
  // reloads every 60 seconds and the multi-select set survives that reload (resetSelection
  // clears the single-item selection, not selectedIds). So once anything added or removed
  // an entry, every selected index pointed at a different row and bulk delete removed the
  // WRONG host keys, behind a confirmation that only says "Delete N item(s)?".
  //
  // known_hosts changes exactly when this page is in use - a repository clone or pull over
  // ssh appends to it - so this was not a rare race.
  const src = read('src/components/AppAdminMulti.vue');

  it('rows are built through flatRow, which keys on the value', () => {
    expect(src).toMatch(/function flatRow\(value\)/);
    const fn = src.slice(src.indexOf('function flatRow(value)'), src.indexOf('async function loadList'));
    expect(fn).toMatch(/const name = String\(value\);/);
    expect(fn).toMatch(/return \{ id: name, name \};/);
  });

  it('and no flat branch mints an index as an id any more', () => {
    expect(src).not.toMatch(/map\(\(val, idx\) => \(\{ id: idx/);
    // the flat/primitive branch must go through it
    expect([...src.matchAll(/=> flatRow\(val\)/g)].length).toBe(1);
  });

  it('a flat record is looked up by id rather than by array position', () => {
    // itemList[itemId] only worked while a flat id happened to BE the index; it was
    // already wrong for a flat list of objects, whose id comes from the record's own key
    expect(src).not.toMatch(/item\.value = itemList\.value\[itemId\.value\]/);
    expect(src).toMatch(/itemList\.value\.find\(\(?r\)? => r\[idKey\] === itemId\.value\)/);
  });

  it('bulk delete acts only on rows that are still there', () => {
    const fn = src.slice(src.indexOf('async function bulkDelete'), src.indexOf('// HOOKS'));
    expect(fn).toMatch(/const present = new Map\(itemList\.value\.map/);
    expect(fn).toMatch(/\.filter\(\(?id\)? => present\.has\(id\)\)/);
    // the old fallback sent ?name=<numeric id> and asked the server to delete an entry
    // literally named "3" - a wrong request rather than an error
    expect(fn).not.toMatch(/row\?\.name \?\? id/);
  });

  it('the selection is pruned to what the reload returned', () => {
    expect(src).toMatch(/function pruneSelection\(\)/);
    const load = src.slice(src.indexOf('async function loadItems'), src.indexOf('async function loadList'));
    expect(load).toMatch(/pruneSelection\(\);/);
    const fn = src.slice(src.indexOf('function pruneSelection'), src.indexOf('async function loadItems'));
    // a new Set, because BsDataTable takes it as a prop and compares by identity
    expect(fn).toMatch(/selectedIds\.value = new Set\(kept\)/);
  });

  // and the property itself, on the two identity strategies
  it('a positional id remaps after an insert; a value id does not', () => {
    const byIndex = (list) => list.map((v, i) => ({ id: i, name: v }));
    const byValue = (list) => list.map((v) => ({ id: String(v), name: String(v) }));
    const before = ['host-a', 'host-b', 'host-c'];
    const after = ['host-new', 'host-a', 'host-b', 'host-c']; // an ssh pull prepended one

    // the user selected 'host-b'
    const pickedIndex = byIndex(before).find((r) => r.name === 'host-b').id;
    const pickedValue = byValue(before).find((r) => r.name === 'host-b').id;

    // after the 60s reload, resolve the selection again
    const resolvedByIndex = byIndex(after).find((r) => r.id === pickedIndex);
    const resolvedByValue = byValue(after).find((r) => r.id === pickedValue);

    expect(resolvedByIndex.name).toBe('host-a'); // the bug: a different host key
    expect(resolvedByValue.name).toBe('host-b'); // the fix: the one that was selected
  });
});

describe('"could not be evaluated" is not raised for a field that is only waiting for input', () => {
  // An input without an expression counts as ready the moment it exists, so a dependent
  // expression ran while that input was still empty and was reported as referring to
  // something that "never produced a value" - on every fresh form, and the warning stayed
  // after the field evaluated fine once the input was filled in.
  const src = read('src/components/AppForm.vue').replace(/\/\/[^\n]*/g, '');

  it('both warning sites skip a field whose dependency is still empty', () => {
    const sites = [...src.matchAll(/addWarningOnce\(\s*`unresolved:/g)];
    expect(sites).toHaveLength(2);
    for (const m of sites) {
      expect(src.slice(Math.max(0, m.index - 120), m.index)).toMatch(/if \(!dependsOnEmptyField\(item\.name\)\) \{/);
    }
  });

  it('an empty dependency is undefined, null, empty, an empty list or an enum sentinel', () => {
    const fn = src.slice(
      src.indexOf('function dependsOnEmptyField'),
      src.indexOf('// this field still wants its restored value'),
    );
    for (const t of ['v === undefined', 'v === null', "v === ''", 'v.length === 0', "'__auto__'"])
      expect(fn).toContain(t);
    expect(fn).toContain('visibility.value[dep] === false');
  });

  it('the warning is taken back once the field evaluates', () => {
    const fn = src.slice(src.indexOf('function setFieldStatus'), src.indexOf('function setFieldStatus') + 800);
    expect(fn).toMatch(/if \(status === ['"]fixed['"]\) clearWarningOnce\(`unresolved:\$\{fieldname\}`\)/);
  });
});
