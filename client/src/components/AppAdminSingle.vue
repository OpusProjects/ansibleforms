<script setup>

    /******************************************************************/
    /*                                                                */
    /*  App Admin Single component                                    */
    /*  Create a single admin page with a form and update/save button */
    /*                                                                */
    /*  @props:                                                       */
    /*      settings: Object                                          */
    /*                                                                */
    /*  @emits:                                                       */
    /*      test: Function                                            */
    /*      import: Function                                          */
    /*      saved: Function (after a successful update)               */
    /*                                                                */
    /******************************************************************/

    import { ref, onMounted, computed, watch } from "vue";
    import axios from "axios";
    import Helpers from "@/lib/Helpers";
    import { toast } from "vue-sonner";
    import TokenStorage from "@/lib/TokenStorage";
    import { useVuelidate } from "@vuelidate/core";
    import { required, helpers, email, sameAs } from "@vuelidate/validators";
    import { useI18n } from 'vue-i18n';

    const { t } = useI18n();



    const props = defineProps({
        settings: Object,
        apiVersion: {
            type: [String, Number],
            default: 2
        }
    });

    const emit = defineEmits(["test","import","saved"]);

    const objectLabel = computed(() => props.settings?.label || '');
    const objectIcon = computed(() => props.settings?.icon || '');
    const objectDescription = computed(() => props.settings?.description || '');
    const objectType = computed(() => props.settings?.type || '');
    const fields = computed(() => props.settings?.fields || []);
    const actions = computed(() => props.settings?.actions || []);
    const toggleFields = computed(() => fields.value.filter(f => f.isToggle));

    // make a dictionary of the fields with the key as the key of the field and the value as the field itself
    const fieldsDict = computed(() => fields.value.reduce((acc, field) => {
        acc[field.key] = field;
        return acc;
    }, {}));

    // validation
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
            ruleObj.item[field.key] = rule
        })
        return ruleObj
    };
    const item = ref({});
    const originalItem = ref(null);
    const isDirty = computed(() => {
        if (originalItem.value === null) return false;
        return JSON.stringify(item.value) !== JSON.stringify(originalItem.value);
    });
    const rules = computed(() => getRules())

    const $v = useVuelidate(rules, { item });
    

    function objectTitle(prefix = '', suffix = '') {
        return `${prefix} ${objectLabel.value} ${suffix}`.trim()
    }

    async function loadItem() {
        try {
            const result = await axios.get(
                `/api/v${props.apiVersion}/${objectType.value}/`,
                TokenStorage.getAuthentication()
            );
            item.value = result.data;
            for(const field of fields.value){
                if(field.type == 'checkbox'){
                    item.value[field.key] = !!item.value[field.key]; // convert to boolean
                }
            }
            originalItem.value = JSON.parse(JSON.stringify(item.value));

        } catch (err) {
            console.log(objectTitle('Error loading'));
            toast.error(Helpers.parseAxiosResponseError(err, "Failed to load item"));
        }
    }

    function doEmit(action) {

        $v.value.item.$touch();
        if (action == 'test' && isInvalid.value) {
            return;
        }
        emit(action, item.value);
    }



    async function updateItem() {
        if (!isInvalid.value) {
            try{
                await axios.put(`/api/v${props.apiVersion}/${objectType.value}/`, item.value, TokenStorage.getAuthentication());
                toast.success(objectTitle('', t('settings.common.isUpdated')));
                emit('saved', item.value);
                loadItem();
            }catch(err){
                const errorMessage = err.response?.data?.error || err.message;
                const errorDetail = err.response?.data?.details || "";
                toast.error(errorDetail ? `${errorMessage}: ${errorDetail}` : errorMessage);
            }
        } else {
            $v.value.item.$touch()
        }
    }


    function isDisabled(field) {
        if (!field.dependency) {
            return false;
        }
        const dependencyField = fieldsDict.value[field.dependency];
        if (!dependencyField) {
            return true;
        }
        let isCurrentFieldDisabled;
        if(field.negateDependency){
            isCurrentFieldDisabled = item.value[dependencyField.key];
        }else{
            isCurrentFieldDisabled = !item.value[dependencyField.key];
        }
        const isParentFieldDisabled = isDisabled(dependencyField);
        return isCurrentFieldDisabled || isParentFieldDisabled;
    }

    const  isInvalid = computed(() => {
        // check if any field is invalid, but only check the ones that are not disabled
        for (const field of fields.value) {
            if (!disabledFields.value[field.key] && $v.value.item[field.key].$invalid) {
                return true;
            }
        }
        return false
    })

    // Opt-in per settings definition. Hiding a field whose dependency is not met is the
    // default and stays that way ; LDAP asks to show them greyed instead, so an admin can
    // see the whole shape of the configuration before switching it on.
    const showDisabled = computed(() => !!props.settings?.showDisabledFields);

    // Whether a field appears at all. showDisabledFields greys unmet fields instead of
    // hiding them, but a field can opt back out with hideWhenDisabled - used for the TLS
    // certificate chain, where a certificate box is meaningless until TLS is switched on.
    function isVisible(field) {
        if (!disabledFields.value[field.key]) return true;
        // A seed-managed record disables every field. That must not also HIDE them -
        // visibility is about an unmet dependency, and on a page without
        // showDisabledFields the whole form would otherwise vanish.
        if (isManaged.value && !isDisabled(field)) return true;
        return showDisabled.value && !field.hideWhenDisabled;
    }

    // Owned by the declarative config seed (https://ansibleforms.com/seed). The API answers 403, and the
    // seed re-applies on every start, so an editable form here could only mislead. The
    // values stay visible - an operator still needs to read what is in force.
    const isManaged = computed(() => !!item.value?.managed);

    const disabledFields = computed(() => {
        const disabledFields = {};
        for (const field of fields.value) {
            disabledFields[field.key] = isManaged.value || isDisabled(field);
        }
        return disabledFields;
    })

    const rows = computed(() => {
        const rows = [];
        for (const field of fields.value) {
            // toggles render above the rows, so they are not part of the grid.
            // 'isAction' was also skipped here : that flag is gone, since the only
            // fields that carried it are on AppAdminMulti pages which never read it
            if (field.isToggle) {
                continue;
            }
            const line = field.line || 0;
            if (!rows[line]) {
                rows[line] = [];
            }
            rows[line].push(field);
        }
        return rows;
    })

    for (const field of fields.value) {
        if (field.onChange) {
            watch(() => item.value[field.key], (newVal, oldVal) => {
                if (oldVal !== undefined) field.onChange(newVal, item.value);
            });
        }
    }

    onMounted(async () => {
        await loadItem();
    });

    defineExpose({
        loadItem
    });
</script>
<template>
    <AppSettings :icon="objectIcon" :title="objectLabel" :description="objectDescription">
        <template #actions>
            <!-- the action bar holds buttons only : the 'isAction' checkbox row that
                 used to render here reached nothing, because the only fields carrying
                 that flag live in the aap and oauth2_providers blocks, and both of
                 those pages use AppAdminMulti, which never had this slot -->
            <BsButton v-for="action in actions" :key="action.name" v-show="!action.dependency || item[action.dependency]" :icon="action.icon" cssClass="ms-3" @click="doEmit(action.name)">{{ action.title }}</BsButton>
            <BsButton cssClass="ms-3" icon="save" :colorClass="isDirty && !isManaged ? 'primary' : 'secondary'" :disabled="!isDirty || isManaged" @click="updateItem()">{{ t('settings.common.save') }}</BsButton>
        </template>
        <template #default>
            <div v-if="isManaged" class="alert alert-secondary py-2">
                <FaIcon icon="lock" class="me-2" />
                {{ t('settings.common.seedManagedNotice') }}
            </div>
            <BsInput v-for="field in toggleFields" :key="field.key" type="checkbox" :isSwitch="true" :disabled="isManaged" v-model="item[field.key]" :label="field.label" :help="field.help" class="mb-1" />
            <template v-for="(cols, rIdx) in rows" :key="rIdx">
                <div v-if="cols && cols.some(f => isVisible(f))" class="row">
                    <div :class="field.type === 'checkbox' ? 'col-auto' : 'col'" v-for="field in cols" :key="field.key" v-show="isVisible(field)">
                        <BsInput :isFloating="false" :placeholder="field.placeholder" :description="field.description" :style="field.style" :icon="field.icon" :help="field.help" :type="field.type" :values="field.values" :liveSync="field.type === 'editor'" v-model="$v.item[field.key].$model" :disabled="disabledFields[field.key]" :label="field.label" :required="field.required" :hasError="$v.item[field.key].$invalid && $v.item[field.key].$dirty && !disabledFields[field.key]" :errors="$v.item[field.key].$errors" />
                    </div>
                </div>
            </template>
        </template>
        <template #footer>
            <slot></slot>
        </template>
    </AppSettings>

</template>
<style scoped>
:deep(.card-body) {
  padding-top: 1.25rem;
  /* 1rem, and nothing added on top of it. This used to be 0.5rem plus a 1.25rem
     padding-bottom on the last row, which put 28px below the last field while a plain
     card sat at 16px. One padding, zero trailing margin - measured equal on every page. */
  padding-bottom: 1rem;
}
:deep(.card-body > .row:last-child > .col > .mb-3) {
  margin-bottom: 0 !important;
}
:deep(.card-body .mb-3:has(.form-check) > .form-label) {
  display: none;
}
:deep(.card-body > .mb-3:has(.form-check) > p) {
  margin-top: 0;
  margin-bottom: 0.25rem;
}
</style>