<script setup>
/******************************************************************/
/*                                                                */
/*  The Change password dialog : the password typed twice, beside */
/*  its label, and Change Password once both match. One dialog    */
/*  for every place a password or a secret is changed (the users  */
/*  list's row menu, a user's page, an SSO provider's page) ; the */
/*  caller saves it and closes it.                                */
/*                                                                */
/*  @props:                                                       */
/*      icon: String - the icon before the title (the record's)   */
/*      title: String - the dialog's title (Change password)      */
/*      label: String - the field's label (Password)              */
/*      repeat: Boolean - typed twice (a password, default) ; a   */
/*         secret pasted (an SSO provider's) is asked once        */
/*  @emits:                                                       */
/*      save (password) - both typed the same : the caller saves  */
/*      close - Close, the cross, Escape or the backdrop          */
/*                                                                */
/******************************************************************/
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  icon: { type: String, default: 'user' },
  title: { type: String, default: '' },
  label: { type: String, default: '' },
  repeat: { type: Boolean, default: true },
});
const emit = defineEmits(['save', 'close']);
const { t } = useI18n();

const password = ref('');
const repeated = ref(''); // the password typed again
// the second one typed differs from the first : said under it, and nothing is saved
const differs = computed(() => props.repeat && !!repeated.value && repeated.value !== password.value);
const ready = computed(() => !!password.value && (!props.repeat || repeated.value === password.value));

/**
 * Hands the password to the caller, once typed the same twice.
 */
function save() {
  if (ready.value) emit('save', password.value);
}
</script>

<template>
  <BsModal size="md" dialogClass="af-password-dialog" @close="emit('close')">
    <template #title> <FaIcon :icon="icon" class="me-2" />{{ title || t('settings.common.changePassword') }} </template>
    <template #default>
      <BsInput
        v-model="password"
        type="password"
        icon="lock"
        :isFloating="false"
        :isHorizontal="true"
        :required="true"
        :label="label || t('settings.fields.password')"
        @keyup.enter="!repeat && save()"
      />
      <div v-if="repeat" class="row mb-3">
        <label class="col-sm-2 col-form-label fw-bold"
          >{{ t('settings.common.repeatPassword') }}<span class="text-danger ms-1">*</span></label
        >
        <div class="col-sm-10">
          <div class="input-group">
            <span class="input-group-text text-gray-500"><FaIcon :fixedwidth="true" icon="lock" /></span>
            <input
              v-model="repeated"
              type="password"
              class="form-control"
              :class="{ 'is-invalid': differs }"
              autocomplete="new-password"
              @keyup.enter="save()"
            />
          </div>
          <div v-if="differs" class="invalid-feedback d-block">{{ t('settings.common.passwordsDiffer') }}</div>
        </div>
      </div>
    </template>
    <template #footer>
      <BsButton icon="lock" :disabled="!ready" @click="save()">{{
        title || t('settings.common.changePassword')
      }}</BsButton>
    </template>
  </BsModal>
</template>
