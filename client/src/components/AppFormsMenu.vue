<script setup>
/******************************************************************/
/*                                                                */
/*  App AnsibleForms forms menu                                   */
/*  The forms' categories in the left column : All Forms, then    */
/*  each category with its sub categories and its forms' count.   */
/*  The Forms page filters its forms with it ; a form's page      */
/*  shows it too, the category browsed highlighted, and goes back */
/*  to the Forms page on a click.                                 */
/*                                                                */
/*  @props:                                                       */
/*      formConfig: Object - the categories and forms (Form.list) */
/*                  ; none, the menu loads them itself            */
/*      currentCategory: String - the category highlighted, as    */
/*                  Infra/Linux ; empty for All Forms             */
/*                                                                */
/*  @emits:                                                       */
/*      select: String - a category was clicked ('' : All Forms)  */
/*                                                                */
/******************************************************************/
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import Form from '@/lib/Form';
import TokenStorage from '@/lib/TokenStorage';

const { t } = useI18n();
const emit = defineEmits(['select']);
const props = defineProps({
  formConfig: {
    type: Object,
    default: null,
  },
  currentCategory: {
    type: String,
    default: '',
  },
});

// the categories and forms : the page's, or the menu's own when the page has none
const ownConfig = ref(null);
const config = computed(() => props.formConfig || ownConfig.value || {});
const forms = computed(() => config.value?.forms || []);
const roles = computed(() => TokenStorage.getPayload()?.user?.roles || []);
const isAll = computed(() => !props.currentCategory);

onMounted(async () => {
  if (props.formConfig) return;
  try {
    ownConfig.value = await Form.list();
  } catch (e) {
    // no menu, rather than no page : the form still works without it
    ownConfig.value = {};
  }
});
</script>

<template>
  <!-- the top padding follows the selection : with "All Forms" highlighted its bar is what
       the eye measures to, so it starts 20px down (16px + the rows' 4px margin) ; otherwise
       the eye measures to the text, inside the row's padding, so the row starts at 12px -->
  <div
    class="col-md-auto af-forms-sidebar bg-body-tertiary px-3 border-top-0"
    :style="{ paddingTop: isAll ? '16px' : '8px' }"
  >
    <ul class="list-unstyled mb-3">
      <li role="button">
        <div
          class="d-flex justify-content-between align-items-center menu-item p-2 my-1"
          :class="{ 'bg-primary-forced': isAll }"
          @click="emit('select', '')"
        >
          <span :class="{ 'text-light': isAll }">
            <span class="me-2">
              <FaIcon icon="check-double" :fixedwidth="true"></FaIcon>
            </span>
            {{ t('forms.allForms') }}</span
          >
          <span v-if="isAll" class="badge px-3 rounded-pill active">{{ forms.length }}</span>
          <span v-else class="badge px-3 rounded-pill">{{ forms.length }}</span>
        </div>
      </li>
      <AppMenuItem
        @click="(path) => emit('select', path)"
        v-for="item in config?.categories"
        :key="item.name"
        :currentPath="currentCategory"
        parent=""
        :menu="item"
        :forms="forms"
        :roles="roles"
      />
    </ul>
  </div>
</template>
