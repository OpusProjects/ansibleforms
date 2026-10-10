<script setup>
import { useRouter } from 'vue-router';
import { ref } from 'vue';
import axios from 'axios';
import { toast } from 'vue-sonner';
import TokenStorage from '@/lib/TokenStorage';
import { useVuelidate } from '@vuelidate/core';
import Navigate from '@/lib/Navigate';
import Helpers from '@/lib/Helpers';
import { required, helpers, sameAs } from '@vuelidate/validators';

const router = useRouter();

const item = ref({
  // the server requires the current password before it will set a new one : a stolen
  // access token expires, an account takeover does not
  currentPassword: '',
  password: '',
  password2: '',
});

const fields = [
  {
    key: 'password',
    label: 'Password',
    type: 'password',
    sortable: false,
    required: true,
    filterable: false,
    icon: 'lock',
  },
];

// signed in with the public default password : the server refuses everything else until it is
// changed (code password_change_required), so this page cannot be closed
const mustChange = !!TokenStorage.getPayload()?.user?.mustChangePassword;

async function updateItem() {
  if (!$v.$invalid) {
    try {
      await axios.put(`/api/v2/profile`, item.value, TokenStorage.getAuthentication());
      if (mustChange) {
        // the session still carries the default password's mark : sign in again with the new one
        toast.success('Password is changed, sign in with your new password');
        TokenStorage.clear();
        router.push({ name: '/login' });
        return;
      }
      toast.success('Password is changed');
      Navigate.toHome(router);
    } catch (err) {
      toast.error(Helpers.parseAxiosResponseError(err, 'Failed to change the password'));
    }
  } else {
    toast.warning('Invalid form data');
    $v.value.item.$touch();
  }
}

function getRules() {
  const ruleObj = { item: {} };
  fields.forEach((field) => {
    var rule = {};
    if (field.required) {
      rule.required = helpers.withMessage(`${field.label} is required`, required);
    }
    // regex validation
    if (field.regex && field.regex.expression) {
      // a malformed pattern must not throw out of the rules builder and take the
      // whole form down - report it and skip the rule, as AppForm does
      var regexObj = null;
      try {
        regexObj = new RegExp(field.regex.expression);
      } catch (e) {
        console.error(
          `Field '${field.key || field.label}': invalid regex '${field.regex.expression}' (${e.message}); the rule is ignored.`,
        );
      }
      var description = field.regex.description;
      // only when there is a usable pattern - see the guard above
      if (regexObj) {
        rule.regex = helpers.withMessage(description, (value) => !helpers.req(value) || regexObj.test(value));
      }
    }

    ruleObj.item[field.key] = rule;
    if (field.type == 'password') {
      rule = {};
      rule.password_comfirmation = sameAs(computed(() => item.value.password));
      ruleObj.item['password2'] = rule;
    }
  });
  return ruleObj;
}

const rules = getRules();
// added outside getRules() : that loop appends a 'Confirm' box for every password-typed
// field, and the current password must not get one
rules.item.currentPassword = {
  required: helpers.withMessage('Current password is required', required),
};

const $v = useVuelidate(rules, { item });
//
</script>

<template>
  <div class="d-flex align-items-center py-4 bg-body-tertiary login vh-100">
    <div class="card form-change-password w-100 m-auto">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <h5 class="card-title mb-0">Please Change Password</h5>
          <button v-if="!mustChange" class="btn-close" aria-label="Close" @click="Navigate.toHome(router)"></button>
        </div>
        <div v-if="mustChange" class="alert alert-warning py-2" role="alert">
          You signed in with the default password, which is public. Choose another one to continue.
        </div>
        <BsInput
          :isHorizontal="true"
          type="password"
          icon="key"
          v-model="$v.item['currentPassword'].$model"
          :isFloating="true"
          :required="true"
          label="Current password"
          :hasError="$v.item['currentPassword'].$invalid && $v.item['currentPassword'].$dirty"
          :errors="$v.item['currentPassword'].$errors"
        />
        <template v-for="field in fields" :key="field.key">
          <BsInput
            :isHorizontal="true"
            :type="field.type"
            :placeholder="field.placeholder"
            :icon="field.icon"
            :help="field.help"
            :readonly="field.readonly"
            v-model="$v.item[field.key].$model"
            :isFloating="true"
            :required="field.required"
            :label="field.label"
            :hasError="$v.item[field.key].$invalid && $v.item[field.key].$dirty"
            :errors="$v.item[field.key].$errors"
            :valueKey="field.valueKey"
            :labelKey="field.labelKey"
            :style="field.style"
            :lang="field.lang"
          />
          <BsInput
            v-if="field.type == 'password'"
            :isHorizontal="true"
            type="password"
            icon="lock"
            :help="field.help"
            :placeholder="field.placeholder"
            v-model="$v.item['password2'].$model"
            :isFloating="true"
            :required="true"
            label="Confirm"
            :hasError="$v.item['password2'].$invalid && $v.item['password2'].$dirty"
            :errors="$v.item['password2'].$errors"
          />
          <!-- password confirmation -->
        </template>
        <button class="btn btn-primary w-100 py-2" @click="updateItem()" :disabled="$v.$invalid">
          Change Password
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-change-password {
  max-width: 500px;
  padding: 1rem;
}

[data-bs-theme='light'] {
  .login {
    background-image: var(--af-login-background-light) !important;
    background-size: cover;
  }
}
[data-bs-theme='dark'] {
  .login {
    background-image: var(--af-login-background-dark) !important;
    background-size: cover;
  }
}
[data-bs-theme='color'] {
  .login {
    background-image: var(--af-login-background-color) !important;
    background-size: cover;
  }
}
</style>

<!-- <template>
  <section class="hero has-background-light is-fullheight">
    <div class="hero-body">
      <div class="container">
        <div class="columns is-centered">
          <div class="column is-5-tablet is-4-desktop is-3-widescreen">
            <div class="box">
              <BulmaInput icon="lock" focus="true" v-model="user.password" @enterClicked="update()" label="Password" type="password" placeholder="***********" :required="true" :hasError="v$.user.password.$invalid" :errors="[{if:v$.user.password.passwordComplexity.$invalid,label:v$.user.password.passwordComplexity.$params.description}]" />
              <BulmaInput icon="lock" type="password" v-model="user.password2" @enterClicked="update()" label="Password Again" placeholder="Password" :required="true" :hasError="v$.user.password2.$invalid" :errors="[{if:v$.user.password2.sameAsPassword.$invalid,label:'Passwords are not the same'}]" />
              <div class="field">
                <button class="button is-light" @click="update()">
                  <span class="icon has-text-info"><font-awesome-icon icon="key" /></span><span>Change Password</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
<script>
  import axios from 'axios'
  import BulmaInput from './../components/BulmaInput.vue'
  import TokenStorage from './../lib/TokenStorage'
  import { useVuelidate } from '@vuelidate/core'
  import { required, helpers,sameAs } from '@vuelidate/validators'

  export default{
    name: "AfUsers",
    props:{
      authenticated:{type:Boolean},
      isAdmin:{type:Boolean}
    },
    components:{BulmaInput},
    setup(){
      return { v$: useVuelidate() }
    },
    data(){
      return  {
          user:{
            password:"",
            password2:""
          }
        }
    },
    methods:{
      update(){
        var ref= this;
        if (!this.v$.user.password.$invalid && !this.v$.user.password2.$invalid) {
          axios.put(`/api/v2/profile`,this.user,TokenStorage.getAuthentication())
            .then((result)=>{
              ref.$toast.success("Password is changed");
              ref.$router.push({name:"Home"}).catch(err => {});
            }).catch((err)=>{
              ref.$toast.error(err.toString());
            });
        }else{
          this.$toast.warning("Invalid form data")
        }
      }
    },

  }
</script>
<style scoped>
  .cursor-progress{
    cursor:progress;
  }
  .select, .select select{
    width:100%;
  }
</style> -->
