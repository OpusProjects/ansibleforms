<script setup>

    /******************************************************************/
    /*                                                                */
    /*  App Admin Multi component                                     */
    /*  Creates a table with CRUD actions for a given object type     */
    /*  Optional actions: test, preview, trigger                      */
    /*                                                                */
    /*  @props:                                                       */
    /*      settings: Object                                          */
    /*      busyItems: Object                                         */
    /*                                                                */
    /*  @emits:                                                       */
    /*      test: Object                                              */
    /*      preview: Object                                           */
    /*      trigger: Object                                           */
    /*                                                                */
    /******************************************************************/

    import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue';
    import { watch } from 'vue';    
    import { toast } from 'vue-sonner';
    import axios from 'axios';
    import Helpers from '@/lib/Helpers';
    import TokenStorage from '@/lib/TokenStorage';
    import { useVuelidate } from "@vuelidate/core";
    import yaml from 'yaml';
    import { required, helpers, email, sameAs } from "@vuelidate/validators";
    import { useI18n } from 'vue-i18n';
    import BsDataTable from './BsDataTable.vue';

    // INIT

    const { t } = useI18n();
    const emit = defineEmits(['test','preview','trigger','reset','sync']);

    // PROPS

    const props = defineProps({
        settings: {
            type: Object,
            required: true
        },
        busyItems: {
            type: Object,
            default: () => ({})
        },
        apiVersion: {
            type: [String, Number],
            default: 2
        }
    })

    // DATA

    const itemList = ref([]);
    const parentLists = ref({});
    const childLists = ref({});
    const loading = ref(false);
    const itemId = ref(undefined);
    const action = ref('');
    const pagination = ref({ currentId: undefined, enabled: true });
    const activeChild = ref(0);
    const interval = ref(null);
    const config = ref({});

    // flatten
    const isFlat = props.settings.flat || false;
    const reloadSeconds = props.settings.reloadSeconds === false ? false : (props.settings.reloadSeconds || 60)*1000;
    const removeDoubles = props.settings.removeDoubles || false;
    const idKey = props.settings.idKey || 'id';
    const objectType = props.settings.type;
    const objectLabel = computed(() => props.settings.label || '');
    const objectLabelPlural = computed(() => props.settings.labelPlural || `${objectLabel.value}s`);
    const objectIcon = computed(() => props.settings.icon);
    const objectDescription = computed(() => props.settings.description || '');
    const children = computed(() => props.settings.children || []);
    const actions = computed(() => props.settings.actions || []);
    const fields = computed(() => props.settings.fields || []);
    const childFields = computed(() => props.settings.childFields || {});
    const noCreate = computed(() => props.settings.noCreate === true);

    // VUELIDATE

    function getRules() {
        const ruleObj = { item: {} }
        fields.value.forEach(field => {
            var rule = {}
            if (field.required) {
                rule.required = helpers.withMessage(`${field.label} is required`, required)
            }
            if (field.type == 'email') {
                rule.email = helpers.withMessage(`${field.label} must be a valid email address`, email)
            }
            if (field.type == 'checkbox' && field.required) {
                rule.checkboxRequired = helpers.withMessage(`${field.label} is required`, sameAs(computed(() => true)))
            }
            // regex validation
            if (field.regex && field.regex.expression) {
                // a malformed pattern must not throw out of the rules builder and take the
                // whole form down - report it and skip the rule, as AppForm does
                var regexObj = null
                try { regexObj = new RegExp(field.regex.expression) } catch (e) {
                    console.error(`Field '${field.key || field.label}': invalid regex '${field.regex.expression}' (${e.message}); the rule is ignored.`)
                }
                var description = field.regex.description
                // only when there is a usable pattern - otherwise regexObj.test would
                // throw at validation time instead
                if (regexObj) {
                    rule.regex = helpers.withMessage(description, (value) => !helpers.req(value) || regexObj.test(value))
                }
            }
            // A field can also carry a FUNCTION validator, returning the reason it is
            // invalid or '' when it is fine. A regex cannot express every rule - the cron
            // fields need "the start of a range must not exceed its end", which is why
            // they saved values croner then refused, leaving the job unregistered and the
            // page reporting success. The message is dynamic, so it rides on $response
            // rather than being fixed when the rule is built.
            if (typeof field.validator === 'function') {
                const check = field.validator
                rule.custom = helpers.withMessage(
                    ({ $response }) => $response || `${field.label} is not valid`,
                    (value) => {
                        if (!helpers.req(value)) return true
                        let message
                        try { message = check(value) || '' } catch (e) {
                            // a throwing validator must not take the whole form down, as
                            // the regex branch above already guards against
                            console.error(`Field '${field.key || field.label}': validator threw (${e.message}); the rule is ignored.`)
                            return true
                        }
                        return message ? { $valid: false, $response: message } : true
                    }
                )
            }
            if (field.type == 'editor' && field.lang == 'yaml') {
                rule.editorType = helpers.withMessage(
                    `${field.label} must be valid YAML`,
                    (value) => {
                        if (!helpers.req(value)) return true;
                        try {
                            const parsed = yaml.parse(value);
                            return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
                        } catch (e) {
                            return false;
                        }
                    }
                );
            }
            ruleObj.item[field.key] = rule
            // if (field.type == 'password') {
            //     rule = {}
            //     rule.password_comfirmation = sameAs(computed(() => item.value.password))
            //     ruleObj.item["password2"] = rule
            // }
        });
        return ruleObj

    };
    const item = ref({});
    const rules = computed(() => getRules());
    const $v = useVuelidate(rules, { item });

    // METHODS
    
    function objectTitle(prefix = '', suffix = '') {
        return `${prefix} ${objectLabel.value} ${suffix}`.trim()
    }
    // Selection state only - see loadItems for why the list is no longer blanked here.
    function resetSelection() {
        itemId.value = undefined;
        pagination.value.currentId = undefined; // reset selected item
        action.value = '';
    }
    // Keep only ids that still exist in the loaded list. Assigning a new Set rather than
    // mutating, because BsDataTable takes selectedIds as a prop and compares by identity.
    function pruneSelection() {
        if (!selectedIds.value.size) return;
        const present = new Set((itemList.value || []).map(r => r[idKey]));
        const kept = [...selectedIds.value].filter(id => present.has(id));
        if (kept.length !== selectedIds.value.size) selectedIds.value = new Set(kept);
    }
    async function loadItems(force=true) {
        // if the offcanvas or a confirmation is open, do not load items.
        // 'delete' belongs here too: it was missing, so the 60 second auto-reload ran
        // resetItems(), which clears action - and the delete confirmation simply vanished
        // with nothing deleted and no message, on a timer, while the user was reading it.
        if (['select', 'edit', 'new', 'change_password', 'delete'].includes(action.value) && !force){ 
            return 
        }
        // Clear the SELECTION, not the list.
        //
        // resetItems() blanked itemList before the request, so on every 60 second refresh
        // BsPagination briefly saw an empty dataList: its clamp watcher then called
        // setPage(1) and the reader was thrown back to page 1 mid-read. (BsDataTable
        // already stopped re-keying the paginator on a data change for this same reason;
        // this was the other half.) Assigning the new list when it arrives also removes
        // the "no data" flicker.
        resetSelection();
        itemList.value = await loadList(objectType,isFlat);
        // Drop selected rows that are no longer there. resetSelection() clears the SINGLE
        // item selection (the offcanvas), not the multi-select set, so without this the
        // toolbar kept counting rows that had been deleted - by this admin elsewhere, by
        // another one, or by whatever writes the underlying file - and a bulk action was
        // sized off a number that no longer described anything on screen. Ids are stable
        // (see flatRow), so a row that is still there keeps its selection across the
        // 60 second reload, which is the point of not simply clearing it.
        pruneSelection();
        for (const field of fields.value) {
            if (field.parent && field.values && typeof field.values == 'string') {
                // a dropdown source can live on another api version than the page
                // itself
                const list = await loadList(field.values, false, field.valuesApiVersion);
                // an optional reference (a credential's secret store) must be clearable : a
                // select has no way back to "nothing" without an empty option
                parentLists.value[field.parent] = field.clearable
                    ? [{ [field.valueKey]: '', [field.labelKey]: '' }, ...list]
                    : list;
            }
            if (field.parent && field.values && Array.isArray(field.values)) {
                parentLists.value[field.parent] = field.values;
            }
        }
    }
    /**
     * A row for a FLAT list, whose records are bare values (known hosts are ssh key lines).
     *
     * The id is the VALUE, not the array index. An index is positional, and this list is
     * reloaded every 60 seconds while `selectedIds` survives that reload - so once anything
     * added or removed an entry, every selected index pointed at a DIFFERENT row and bulk
     * delete removed the wrong host keys, behind a confirmation that only says
     * "Delete N item(s)?". The known_hosts file changes exactly when this page is in use
     * (a repository clone or pull over ssh adds to it), so that was not a rare race.
     *
     * The value is also what the delete endpoint takes (`?name=`), so id and name being the
     * same thing is the honest model here rather than a coincidence.
     */
    function flatRow(value) {
        const name = String(value);
        return { id: name, name };
    }
    async function loadList(type,isFlat=false,version=undefined) {
        const apiVersion = version || props.apiVersion;
        try {
            const result = await axios.get(`/api/v${apiVersion}/${type}/`, TokenStorage.getAuthentication());
            if (apiVersion == 2) {
                if(isFlat){
                    const records = Array.isArray(result.data.records) ? result.data.records : [];
                    if (records.length === 0) return [];
                    // If primitives (strings/numbers)
                    if (typeof records[0] !== 'object' || records[0] === null) {
                        const deduped = removeDoubles ? Array.from(new Set(records)) : records;
                        return deduped.map((val) => flatRow(val));
                    }
                    // Objects: ensure id & name exist generically
                    return records.map((obj, idx) => {
                        const out = { ...obj };
                        // establish id
                        if (out[idKey] === undefined && out.id === undefined) {
                            out.id = idx;
                        } else if (out.id === undefined) {
                            out.id = out[idKey];
                        }
                        // establish name fallback (used in selection/delete modals)
                        if (out.name === undefined) {
                            const fallback = out[idKey] ?? out.id ?? out.label ?? `item_${idx}`;
                            out.name = String(fallback);
                        }
                        return out;
                    });
                }
                return result.data.records;
            } else {
                throw new Error("Unsupported API version");
            }
        } catch (err) {
            toast.error(Helpers.parseAxiosResponseError(err, "Failed to load data"))
        }



    }
    // set while a record is being read into `item`, so the dependency watchers above do
    // not mistake the load for a user edit
    const loadingItem = ref(false);
    async function loadItem() {
        if (itemId.value) {
            loadingItem.value = true;
            try {
                var result
                if (isFlat) {
                    // find by id, NOT itemList[itemId] : that indexed the array by the id,
                    // which only worked while a flat id happened to BE the array index. It
                    // is the value now (see flatRow), and it was already wrong for a flat
                    // list of objects, where loadList sets id from the record's own idKey.
                    item.value = itemList.value.find(r => r[idKey] === itemId.value)
                } else {
                    result = await axios.get(`/api/v${props.apiVersion}/${objectType}/${itemId.value}`, TokenStorage.getAuthentication())
                    item.value = result.data;
                    for (const field of fields.value) {
                        if (field.type == 'checkbox') {
                            item.value[field.key] = !!item.value[field.key]
                        }
                        if (field.type == 'editor' && item.value[field.key] === null) {
                            item.value[field.key] = ''
                        }
                        // if (field.isKey) {
                        //     itemPassword.value[field.key] = item.value[field.key]
                        // }
                    }
                    delete item.value.password // remove password ; updates don't need password
                    delete item.value.token // remove token, update don't need token
                    delete item.value.client_secret // do not return client_secret in the API
                    // TODO : in de future, do not return passwords in the api

                    for (const childList of children.value) {
                        childLists.value[childList.type] = (await loadList(childList.type)).filter(child => child[childList.key] == itemId.value)
                    }
                }
            } catch (err) {
                toast.error(Helpers.parseAxiosResponseError(err, "Failed to load item"))
            } finally {
                // released on the error path too, or every later dependency change on
                // this page would be ignored
                await nextTick();
                loadingItem.value = false;
            }
        }
    }
    // What to call the record in the delete confirmation.
    //
    // `selectedItem.name` alone rendered an empty bold span for anything without a `name`
    // column - backups are keyed by `folder` (describeBackup returns no name at all), so
    // the prompt read "Are you sure you want to delete ?" and you could not tell which
    // backup you were about to destroy. Falls back through the page's own key.
    const deleteLabel = computed(() => {
        const it = selectedItem.value;
        if (!it) return '';
        return it.name ?? it.title ?? it.username ?? it[idKey] ?? it.id ?? '';
    });

    async function selectItem(value) {
        itemId.value = value[idKey];
        pagination.value.currentId = value[idKey];
        await loadItem()
        action.value = 'select';    
        removeUnwantedProperties()
        // Set defaults for all fields with defaultMap
        fields.value.forEach(field => {
            if (field.defaultMap && field.dependency && item.value[field.dependency] && !item.value[field.key]) {
                console.log("Setting default")
                setFieldDefaults(field.dependency);
            }
        });
    }
    async function editItem(value) {
        itemId.value = value[idKey];
        pagination.value.currentId = value[idKey];
        await loadItem()
        action.value = 'edit';    
        removeUnwantedProperties()
        // Set defaults for all fields with defaultMap
        fields.value.forEach(field => {
            if (field.defaultMap && field.dependency && item.value[field.dependency] && !item.value[field.key]) {
                console.log("Setting default")
                setFieldDefaults(field.dependency);
            }
        });        
    }
    function setItemProperty(setting) { // to set a property of an item (example status for repos)
        const founditem = itemList.value.find((x) => { 
            return x[idKey] == setting.id ;  
        })
        if (founditem) {
            founditem[setting.key] = setting.value
        }
    }
    async function changePasswordItem(value) {
        itemId.value = value[idKey];
        await loadItem()
        action.value = 'change_password';    
        item.value.password = '';
        item.value.client_secret = ''; // reset client secret
        item.value.token = '';
        pagination.value.currentId = value[idKey];
        removeUnwantedProperties()
    }
    async function deleteItem(value) {
        itemId.value = value[idKey];
        await loadItem()
        action.value = 'delete';   
        pagination.value.currentId = value[idKey]; 
    }
    function unselectItem() {
        itemId.value = undefined;
        pagination.value.currentId = undefined;
        action.value = '';
    }
    function newItem() {
        item.value = {};
        fields.value.forEach(field => {
            if (field.type === 'editor' && item.value[field.key] === undefined) {
                item.value[field.key] = '';
            }
            if (field.type === 'select' && field.parent && field.valueKey) {
                const list = parentLists.value[field.parent] || [];
                if (list.length > 0 && item.value[field.key] === undefined) {
                    item.value[field.key] = list[0][field.valueKey];
                }
            }
        });
        action.value = 'new';
    }
    async function createItem() {
        var invalid = isInvalid.value
        if (!invalid) {
            try {
                await axios.post(`/api/v${props.apiVersion}/${objectType}/`, item.value, TokenStorage.getAuthentication())
                toast.success(objectTitle('', t('settings.common.isCreated')));
                loadItems();
            }
            catch (err) {
                toast.error(Helpers.parseAxiosResponseError(err, "Failed to save item"))
            }
        } else {
            $v.value.item.$touch()
        }
    }
    async function updateItem(passwordOnly=false) {
        var invalid
        if(passwordOnly){
            invalid = isInvalidPassword.value
        }else{
            invalid = isInvalid.value
        }
        if (!invalid) {
            try {
                await axios.put(`/api/v${props.apiVersion}/${objectType}/${itemId.value}`, item.value, TokenStorage.getAuthentication())
                toast.success(objectTitle('', t('settings.common.isUpdated')));
                loadItems();
            } catch (err) {
                toast.error(Helpers.parseAxiosResponseError(err, "Failed to update item"))
            }
        } else {
            $v.value.item.$touch()
        }
    }
    async function removeItem() {
        try {
            if(isFlat){
                await axios.delete(`/api/v${props.apiVersion}/${objectType}?name=${encodeURIComponent(item.value.name)}`, TokenStorage.getAuthentication())
            }else{
                await axios.delete(`/api/v${props.apiVersion}/${objectType}/${itemId.value}`, TokenStorage.getAuthentication())
            }
            toast.success(objectTitle('', t('settings.common.isDeleted')));
            unselectItem();
            loadItems();
        } catch (err) {
            toast.error(Helpers.parseAxiosResponseError(err, "Failed to delete item"))
        }

    }
    function testItem(value) {
        emit('test', value)
    }
    function previewItem(value){
        emit('preview', value)
    }
    function triggerItem(value){
        emit('trigger', value)
    }
    function resetItem(value) {
        emit('reset', value)
    }
    function getParentValues(key) {
        if (!key) return []
        if (Array.isArray(key)) return key
        if (!parentLists.value) return []
        return parentLists.value[key] || []
    }

    function showField(field) {
        // Only hide if noInput is set, not readonly
        if (field.noInput) return false;
        let depShow = true;
        if (field.dependency) {
            const depValue = item.value[field.dependency];
            if (Array.isArray(field.dependencyValues)) {
                depShow = field.dependencyValues.includes(depValue);
            } else if (field.negateDependency) {
                depShow = !depValue;
            } else {
                depShow = depValue;
            }
        }
        if (field.type == 'password' && ["new","change_password"].includes(action.value)) return depShow;
        if (field.type != 'password' && action.value == 'change_password') return false;
        if (field.type == 'password' && action.value != 'change_password') return false;
        return depShow;
    }

    // Set dynamic defaults for fields with defaultMap when dependency changes
    function setFieldDefaults(depKey) {
        fields.value.forEach(field => {
            if (field.defaultMap && field.dependency === depKey) {
                const depValue = item.value[depKey];
                const def = field.defaultMap[depValue];
                if (typeof def === 'function') {
                    item.value[field.key] = def(config.value);
                } else if (def !== undefined) {
                    item.value[field.key] = def;
                }
            }
        });
    }


    // Recompute a dependent default only when the USER changed the dependency.
    //
    // loadItem replaces item.value wholesale, so loading an existing record moves e.g.
    // `provider` from undefined to 'azuread' and this watcher fired - and
    // setFieldDefaults has no "only when empty" guard, unlike the loops in
    // selectItem/editItem that spell that rule out. So opening an OAuth2 provider whose
    // redirect_uri had been customised replaced it with the computed default, and Save
    // then persisted that: the custom callback URL was lost by merely looking at it.
    //
    // The watcher cannot tell a load from an edit by itself, so the load says so.
    fields.value.forEach(field => {
        if (field.dependency) {
            watch(() => item.value[field.dependency], () => {
                if (loadingItem.value) return;
                setFieldDefaults(field.dependency);
            });
        }
    });

    // Load config (AnsibleForms URL) on mount
    onMounted(async () => {
        try {
            const result = await axios.get(`/api/v2/settings`, TokenStorage.getAuthentication());
            config.value = result.data;
        } catch (err) {
            // fallback: leave config empty
        }
    });
    function removeUnwantedProperties(){
        for (const field of fields.value) {
            if (field.type == 'password' && !["new","change_password"].includes(action.value)) {
                delete item.value[field.key]
            }
            if (field.type != 'password' && field.key!=idKey && !field.password_related && action.value=='change_password') {
                delete item.value[field.key]
            }
        }
    }

    // COMPUTED

    const selectedItem = computed(() => {
        return itemList.value.find((item) => item[idKey] == itemId.value);
    });
    const title = computed(() => {
        if (action.value == 'change_password') {
            return t('settings.common.changePassword')
        }
        if (action.value == 'new') {
            return t('settings.common.newItem', { item: objectLabel.value })
        } else if (action.value == 'edit') {
            return `${t('settings.common.edit')} ${objectLabel.value}`
        } else {
            return objectLabel.value
        }

    });

    const  isInvalid = computed(() => {
        // check if any field is invalid, but only check the ones that are not disabled
        for (const field of fields.value) {
            if (showField(field) && !["password","token","client_secret"].includes(field.key) && $v.value.item[field.key]?.$invalid) {
                return true;
            }
        }
        return false
    })
    const  isInvalidPassword = computed(() => {
        // check if any field is invalid, but only check the ones that are not disabled
        for (const field of fields.value) {
            if (showField(field) && (["password","token","client_secret"].includes(field.key) || field.key == idKey) && $v.value.item[field.key]?.$invalid) {
                return true;
            }
        }
        return false
    })

    // BsDataTable mode (always on — BsDataTable is the only table renderer)
    const dataTableSelectable = computed(() => props.settings.selectable !== false);
    const selectedIds = ref(new Set());
    const activeRowId = ref(null);

    const hasEditAction = computed(() => actions.value.some(a => a.name === 'edit'));
    const dataTableShowRowMenu = computed(() => actions.value.length > 0);

    const dataTableColumns = computed(() => {
        // Include every field as a possible column (so the user can opt any of
        // them in via the column picker). Skip explicit `noTable` opt-outs and
        // password-like fields whose values are never returned by the API.
        const SECRET_KEYS = new Set(['password', 'token', 'client_secret']);
        return fields.value
            .filter(f => !f.noTable && !SECRET_KEYS.has(f.key) && f.type !== 'password')
            .map(f => {
                const col = {
                    key: f.key,
                    label: f.label,
                    sortable: f.sortable !== false,
                    filterable: f.filterable || false,
                    mobileHidden: f.mobileHidden || false,
                    // Fields previously flagged `hidden: true` keep that as the
                    // default visibility but remain available in the column
                    // picker so users can show them when wanted.
                    defaultHidden: !!f.hidden,
                };
                // a field may bring its own cell renderer (see config/settings.js) :
                // without this a `datetime` column shows the raw value it was sent
                if (typeof f.render === 'function') {
                    col.render = f.render;
                }
                // a field-level render wins : the select branch below would otherwise
                // silently overwrite one the config deliberately supplied
                if (f.type === 'select' && f.parent && typeof f.render !== 'function') {
                    col.render = (val) => {
                        const list = parentLists.value[f.parent] || [];
                        const found = list.find(itm => itm[f.valueKey] == val);
                        // ESCAPED. BsDataTable escapes a plain cell value but passes
                        // render() output to v-html verbatim, and both branches here are
                        // server data: found[labelKey] is e.g. a GROUP NAME, shown in the
                        // Group column of Admin > Users. A group named `<img src=x
                        // onerror=...>` therefore executed in the browser of everyone who
                        // opened that page. The seed badge below already follows the rule
                        // this codebase states - nothing reaches v-html unescaped,
                        // whatever its provenance - this renderer did not.
                        return escapeHtml(found ? found[f.labelKey] : (val ?? ''));
                    };
                }
                if (f.type === 'checkbox') {
                    col.type = 'checkbox';
                }
                return col;
            });
    });

    // Only when something is actually seeded : an always-present column would be an
    // empty stripe on every instance that does not use a config seed.
    const anyManaged = computed(() => (itemList.value || []).some(isManaged));
    const columnsWithManaged = computed(() => {
        if (!anyManaged.value) return dataTableColumns.value;
        return [...dataTableColumns.value, {
            key: 'managed',
            label: t('settings.common.seedManaged'),
            sortable: true,
            filterable: false,
            // static markup only - nothing from the row is interpolated, because
            // render() output goes through v-html
            // Text only. This app loads the FontAwesome SVG core and renders icons via
            // the FaIcon component - there is no webfont CSS - so an <i class="fas ...">
            // here produced an empty element and a stray gap, not a lock.
            render: (val) => val
                ? '<span class="badge text-bg-secondary">' + escapeHtml(t('settings.common.seedManaged')) + '</span>'
                : '',
        }];
    });

    // Records the declarative config seed owns (docs/seed.md). The API answers 403 on
    // them, so offering Edit and Delete would only produce an error - and the seed
    // re-applies on every start, so even a successful change would be reverted.
    // Read-only actions (test, preview, trigger) stay available.
    // Every action that ends in a write the guard refuses. 'change_password' goes
    // through changePasswordItem -> updateItem(true) -> the SAME PUT /:id as Edit, so
    // leaving it out offered a form whose Save answered 403. test/preview/trigger/
    // reset/sync are deliberately absent : they are read-only or write only runtime
    // status, which the seed does not own.
    const MANAGED_BLOCKS = new Set(['edit', 'delete', 'change_password']);
    const isManaged = (item) => !!(item && item.managed);
    // The badge below is built as markup because BsDataTable passes render() output to
    // v-html. Only a locale string goes in, but it is escaped anyway : the rule in this
    // codebase is that nothing reaches v-html unescaped, whatever its provenance.
    const escapeHtml = (s) => String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Whether a per-row action should be enabled. Honours `dependency`,
    // `dependencyValues`, and `negateDependency` from the action definition.
    /**
     * The in-progress label for a row, from the `busyItems` prop.
     *
     * That prop was declared and documented, and credentials.vue and aap.vue both pass a
     * map of "testing..." strings into it - but nothing in this component ever read it,
     * so pressing Test gave no per-row feedback at all and a second click fired another
     * request. The parents key that map by the record id.
     */
    // Only the action that is actually running wears the label - swapping every entry in
    // the menu to "Testing..." would say Edit and Delete were testing something too. Both
    // pages that pass busyItems populate it from their `test` handler.
    function busyAction(action, item) {
        return !!busyLabel(item) && action?.name === 'test';
    }

    function busyLabel(item) {
        if (!item) return '';
        return props.busyItems?.[item.id] ?? props.busyItems?.[item[idKey]] ?? '';
    }

    function isActionEnabled(action, item) {
        if (isManaged(item) && MANAGED_BLOCKS.has(action.name)) return false;
        if (!action.dependency) return true;
        // an array dependency means "enabled if ANY of these fields is truthy"
        if (Array.isArray(action.dependency)) {
            return action.dependency.some(dep => !!item[dep]);
        }
        const v = item[action.dependency];
        if (Array.isArray(action.dependencyValues)) {
            return action.dependencyValues.includes(v);
        }
        if (action.negateDependency) return !v;
        return !!v;
    }

    // Map child-list `fields` (settings.js → childFields) to BsDataTable
    // column defs so the read-only child tables get the same sort / filter /
    // column-picker behaviour as the main table.
    function childTableColumns(fieldList) {
        if (!Array.isArray(fieldList)) return [];
        return fieldList.map(f => ({
            key: f.key,
            label: f.label,
            sortable: f.sortable !== false,
            filterable: f.filterable !== false,
            defaultHidden: !!f.hidden,
            type: f.type === 'checkbox' ? 'checkbox' : undefined,
        }));
    }

    function dispatchAction(action, item) {
        if (!isActionEnabled(action, item)) return;
        // a row that is already running its action must not start it again
        if (busyLabel(item)) return;
        switch (action.name) {
            case 'edit': return editItem(item);
            case 'delete': return deleteItem(item);
            case 'change_password': return changePasswordItem(item);
            case 'select': return selectItem(item);
            case 'preview': return previewItem(item);
            case 'test': return testItem(item);
            case 'trigger': return triggerItem(item);
            case 'reset': return resetItem(item);
            default: return emit(action.name, item);
        }
    }

    function onDataTableRowClick(item) {
        if (!dataTableSelectable.value) {
            activeRowId.value = item[idKey];
            // A seed-managed row must open READ-ONLY here too. Clicking the row is the
            // normal way to edit on these pages (selectable:false + an edit action), and
            // it bypasses isActionEnabled entirely - so greying out the menu's Edit was
            // decorative: the click still opened a live form whose Save answered 403.
            if (hasEditAction.value && !isManaged(item)) {
                editItem(item);
            } else {
                // No edit action defined → open the read-only "show" offcanvas
                // (used by pages like groups that have children to display).
                selectItem(item);
                emit('row-select', item);
            }
        }
    }

    async function bulkDelete() {
        // only what is still on screen : a selected row that has since disappeared must not
        // be guessed at, and the count in the confirmation has to be the count acted on
        const present = new Map(itemList.value.map(r => [r[idKey], r]));
        const ids = [...selectedIds.value].filter(id => present.has(id));
        if (!ids.length) return;
        if (!confirm(`Delete ${ids.length} item(s)?`)) return;
        try {
            await Promise.all(ids.map(id => {
                if (isFlat) {
                    // `?? id` used to stand in here. With an index-based id that sent
                    // `?name=3` and asked the server to delete an entry literally named
                    // "3" - a wrong request rather than an error. The row is guaranteed
                    // present now, so there is nothing to fall back to.
                    const name = present.get(id).name;
                    return axios.delete(`/api/v${props.apiVersion}/${objectType}?name=${encodeURIComponent(name)}`, TokenStorage.getAuthentication());
                }
                return axios.delete(`/api/v${props.apiVersion}/${objectType}/${id}`, TokenStorage.getAuthentication());
            }));
            toast.success(t('settings.common.isDeleted'));
            selectedIds.value = new Set();
            await loadItems();
        } catch (err) {
            toast.error(Helpers.parseAxiosResponseError(err, "Failed to delete items"));
        }
    }


    // HOOKS

    onMounted(async () => {
        loading.value = true
        await loadItems();
        loading.value = false;
        // set interval await (only if reloadSeconds is not explicitly disabled)
        if (reloadSeconds !== false) {
            interval.value = setInterval(async () => {
                await loadItems(false);
            }, reloadSeconds);
        }
    });


    onBeforeUnmount(() => {
        if (interval.value) {
            clearInterval(interval.value);
            interval.value = null;
        }
    });

    defineExpose({
        loadItems,
        setItemProperty
    });

</script>
<template>
    <BsModal v-if="action == 'delete'" @close="unselectItem">
        <template #title>
            {{ t('common.delete') }} {{ objectLabel }}
        </template>
        <template #default>
            <p class="mt-3 fs-6 user-select-none">
                {{ t('settings.common.deleteConfirm') }} <strong>{{ deleteLabel }}</strong>?
            </p>
        </template>
        <template #footer>
            <BsButton icon="trash" @click="removeItem()">{{ t('common.delete') }}</BsButton>
        </template>
    </BsModal>
    <AppSettings :icon="objectIcon" :title="objectLabelPlural" :description="objectDescription">
        <template #default>
            <BsDataTable v-if="!loading && itemList!=undefined"
                :items="itemList"
                :columns="columnsWithManaged"
                :idKey="idKey"
                :selectedIds="selectedIds"
                :selectable="dataTableSelectable"
                :activeId="!dataTableSelectable ? activeRowId : null"
                :name="Helpers.cleanupString(objectLabelPlural)"
                @update:selectedIds="selectedIds = $event"
                @row-click="onDataTableRowClick"
            >
                <template v-if="dataTableSelectable" #bulk-actions="{ count }">
                    <BsButton v-if="count" cssClass="ms-2 btn-sm btn-outline-danger" icon="trash" @click="bulkDelete">
                        {{ t('common.delete') }} ({{ count }})
                    </BsButton>
                </template>
                <template v-if="dataTableShowRowMenu" #row-actions="{ item }">
                    <div class="dropdown">
                        <a role="button" class="bs-dt-row-menu px-2" data-bs-toggle="dropdown" data-bs-strategy="fixed">
                            <font-awesome-icon icon="ellipsis-vertical" />
                        </a>
                        <ul class="dropdown-menu dropdown-menu-end">
                            <template v-for="(action, idx) in actions" :key="action.name + idx">
                                <li v-if="action.name === 'delete'"><hr class="dropdown-divider" /></li>
                                <li>
                                    <a class="dropdown-item"
                                       :class="{ 'disabled text-muted': !isActionEnabled(action, item) || !!busyLabel(item), 'text-danger': action.name === 'delete' && isActionEnabled(action, item) }"
                                       href="#"
                                       @click.prevent="dispatchAction(action, item)">
                                        <font-awesome-icon :icon="busyAction(action, item) ? 'spinner' : (action.icon || 'circle')"
                                                           :spin="busyAction(action, item)" class="me-2" />{{ busyAction(action, item) ? busyLabel(item) : action.title }}
                                    </a>
                                </li>
                            </template>
                        </ul>
                    </div>
                </template>
            </BsDataTable>
            <div class="spinner-border" role="status" v-if="loading">
                <span class="visually-hidden">{{ t('settings.common.loading') }}</span>
            </div>
        </template>
        <template #footer>
            <slot></slot>
        </template>
        <!-- action buttons go BELOW the card, never in the header : see AppSettings -->
        <template v-if="!noCreate" #actions>
            <BsButton cssClass="ms-3" icon="plus" @click="newItem()">{{ t('settings.common.newItem', { item: objectLabel }) }}</BsButton>
        </template>
    </AppSettings>
    <BsOffCanvas v-if="!loading" :show="['select', 'edit', 'new', 'change_password'].includes(action)" :icon="objectIcon" :title="title" @close="unselectItem">
        <template #actions>
            <BsButton v-if="action == 'new'" icon="save" @click="createItem()">{{ t('settings.common.save') }}</BsButton>
            <BsButton v-if="action == 'edit'" icon="save" @click="updateItem()">{{ t('settings.common.save') }}</BsButton>
            <BsButton v-if="action == 'change_password'" icon="lock" @click="updateItem(true)">{{ t('settings.common.changePassword') }}</BsButton>
        </template>
        <template #default>
            <template v-for="field in fields" :key="field.key">
                <!-- DATETIME FIELD -->
                <div v-if="showField(field) && field.type === 'datetime'" class="row mb-3">
                    <label class="col-sm-2 col-form-label fw-bold">
                        {{ field.label }}
                        <span v-if="field.required" class="text-danger">*</span>
                    </label>
                    <div class="col-sm-10">
                        <BsDateTime 
                            v-model="$v.item[field.key].$model"
                            :icon="field.icon || 'calendar'"
                            :placeholder="field.placeholder"
                            :hasError="$v.item[field.key].$invalid && $v.item[field.key].$dirty"
                            :convertToUtc="field.convertToUtc !== undefined ? field.convertToUtc : true"
                            dateType="datetime"
                        />
                        <small v-if="field.help" class="form-text text-muted d-block mt-1">{{ field.help }}</small>
                        <div v-if="$v.item[field.key].$invalid && $v.item[field.key].$dirty" class="invalid-feedback d-block">
                            <div v-for="error in $v.item[field.key].$errors" :key="error.$uid">
                                {{ error.$message }}
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- CRON FIELD -->
                <div v-if="showField(field) && field.type === 'cron'" class="row mb-3">
                    <label class="col-sm-2 col-form-label fw-bold">
                        {{ field.label }}
                        <span v-if="field.required" class="text-danger">*</span>
                    </label>
                    <div class="col-sm-10">
                        <BsCron
                            v-model="$v.item[field.key].$model"
                            :icon="field.icon || 'stopwatch'"
                            :hasError="$v.item[field.key].$invalid && $v.item[field.key].$dirty"
                        />
                        <div v-if="$v.item[field.key].$invalid && $v.item[field.key].$dirty" class="invalid-feedback d-block">
                            <div v-for="error in $v.item[field.key].$errors" :key="error.$uid">
                                {{ error.$message }}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ALL OTHER FIELD TYPES -->
                <BsInput v-if="showField(field) && field.type !== 'datetime' && field.type !== 'cron'"
                    :isHorizontal="true" 
                    :type="field.type" 
                    :placeholder="field.placeholder" 
                    :icon="field.icon" 
                    :help="field.help"
                    :readonly="field.readonly" 
                    v-model="$v.item[field.key].$model" 
                    :isFloating="false" 
                    :required="field.required" 
                    :label="field.label" 
                    :hasError="$v.item[field.key].$invalid && $v.item[field.key].$dirty" 
                    :errors="$v.item[field.key].$errors" 
                    :valueKey="field.valueKey" 
                    :labelKey="field.labelKey" 
                    :style="field.style"
                    :lang="field.lang"
                    :values="getParentValues(field.parent)" />
            </template>
            <div v-if="action == 'select' && childLists">
                <ul class="nav nav-tabs">
                    <li class="nav-item" v-for="(childList, index) in children" :key="childList.type">
                        <a role="button" class="nav-link" @click="activeChild = index" :class="{ 'active': index == activeChild }"><span class="me-2">
                                <FaIcon :icon="childList.icon" />
                            </span>{{ childList.labelPlural }}</a>
                    </li>
                </ul>
                <div v-for="(childList, index) in children" :key="childList.type">
                    <div class="p-2 border border-top-0" v-if="index == activeChild">
                        <BsDataTable
                            :items="childLists[childList.type] || []"
                            :columns="childTableColumns(childFields[childList.type])"
                            :selectable="false"
                            :name="`child_${objectType}_${childList.type}`" />
                    </div>
                </div>
            </div>
        </template>
    </BsOffCanvas>
    
</template>
<style scoped>
/* 3-dot row action trigger: muted by default, inherits color when the row is
   selected/active (dark bg → light icon). */
.bs-dt-row-menu {
  color: var(--bs-secondary-color);
  text-decoration: none;
}
.bs-dt-row-menu:hover {
  color: var(--bs-body-color);
}
:deep(.bs-dt-selected) .bs-dt-row-menu,
:deep(.bs-dt-selected) .bs-dt-row-menu:hover {
  color: inherit;
}
</style>
