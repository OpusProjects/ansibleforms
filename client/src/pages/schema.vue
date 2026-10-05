<script setup>
import axios from 'axios';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useAppStore } from '@/stores/app';
import { toast } from 'vue-sonner';
import State from '@/lib/State';

const store = useAppStore();

defineEmits(['recheckSchema']);

const error = store.errorMessage;
const loading = ref(false);
const countdown = ref(3);
let countdownInterval = null;

const success = computed(() => {
  return store.schemaData?.success?.join('<br>') || '';
});

const failed = computed(() => {
  return store.schemaData?.failed?.join('<br>') || '';
});

const isSchemaReady = computed(() => {
  return success.value && !failed.value && !error.value;
});

async function create() {
  loading.value = true;
  toast.info('Creating schema and tables...');
  try {
    const createResult = await axios.post(`/api/v2/schema`, {});
    toast.success(createResult.data.message);
    // Full page reload to reinitialize app with new database
    window.location.href = document.baseURI;
  } catch (error) {
    toast.error(error.message);
    loading.value = false;
  }
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function startCountdown() {
  // clear first : a second call used to leave the previous interval running, so the
  // counter dropped twice a second and the reload fired early
  stopCountdown();
  countdown.value = 3;
  countdownInterval = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      stopCountdown();
      window.location.href = document.baseURI;
    }
  }, 1000);
}

// Without this the countdown survived leaving the page and then navigated the browser to
// the app root regardless of where the user had gone in the meantime - a hard reload out
// from under them a few seconds after they left.
onBeforeUnmount(stopCountdown);

onMounted(async () => {
  try {
    const result = await State.checkDatabase();
    if (result) {
      startCountdown();
    }
  } catch (err) {
    // Database check failed, stay on schema page
    console.error('Database check failed:', err);
  }
});
</script>

<template>
  <section class="min-vh-100 bg-light d-flex align-items-center">
    <div class="container">
      <div v-if="!loading" class="row justify-content-center">
        <div class="col-12 col-md-8 col-lg-6">
          <div v-if="isSchemaReady" class="alert alert-success">
            <h5>Database is ready!</h5>
            <p class="mb-0">Redirecting to home in {{ countdown }} seconds...</p>
          </div>
          <div class="alert alert-danger" v-if="error != ''" v-text="error"></div>
          <div class="alert alert-success" v-if="success" v-html="success"></div>
          <div class="alert alert-warning" v-if="failed" v-html="failed"></div>
          <div v-if="error != 'Schema creation is disabled'">
            <form action="" class="card p-4 mb-3" v-if="failed && !success">
              <div class="mb-3">
                If this is the first time setup and you don't have your own schema and tables.<br /><br />
                Would you like me to try and create the schema and tables ?<br />
                I would create the following : <br /><br />
                <table class="table table-bordered">
                  <tbody>
                    <tr>
                      <th>Databaseschema</th>
                      <td>AnsibleForms</td>
                    </tr>
                    <tr>
                      <th>Tables</th>
                      <td>All required tables</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="mb-3">
                <button type="button" class="btn btn-success" @click="create()">
                  <span class="me-2"><font-awesome-icon icon="magic" /></span><span>Create</span>
                </button>
              </div>
            </form>
            <form action="" class="card p-4 mb-3" v-if="failed && success">
              <div>
                It appears that you have an unuseable schema. Part of the database is present, and part is missing.<br />
                Please contact your database or application administrator to either restore from a backup, or create the
                missing tables or remove the database so I can create it for you. When using K8s, it's best that you
                don't create a default database. For now there is nothing I can do for you, until the schema and tables
                are in a consistent state.
              </div>
            </form>
          </div>
          <div v-else class="card p-4 mb-3">
            <div>
              Schema creation is disabled by your administrator.<br />
              Please contact your database or application administrator to create the schema and tables.
            </div>
          </div>
          <div v-if="error == 'FATAL ERROR'" class="card p-4 mb-3">
            <div>Something went wrong. Most likely the database is simply not reachable.</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
