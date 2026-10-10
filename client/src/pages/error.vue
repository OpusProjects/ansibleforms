<script setup>
import { computed } from 'vue';
import { useAppStore } from '@/stores/app';

const store = useAppStore();

const errorMessageHtml = computed(() => store.errorMessage?.replaceAll('\n', '<br>').replace('Error: ', ''));
</script>

<template>
  <section class="min-vh-100 bg-light d-flex align-items-center">
    <div class="container">
      <div class="row justify-content-center">
        <div class="col-md-6 col-lg-5">
          <div class="alert alert-warning shadow-sm p-4">
            <strong v-if="store.errorMessage !== ''" v-html="errorMessageHtml"></strong><br /><br />
            This is the end of the line I'm afraid.<br />
            You'll need to fix a few things, here are some steps:<br />
            <ol class="mt-2">
              <li>Make sure you have a MySQL database running.</li>
              <li>If the AnsibleForms schema is not present, provide root access so I can create it</li>
              <li>Login as local admin</li>
              <li>
                Double check your environment variables.
                <router-link class="btn btn-sm btn-secondary ms-2" to="/settings/general">Settings</router-link>
              </li>
              <li>
                Check the logfiles.
                <router-link class="btn btn-sm btn-secondary ms-2" to="/settings/logs">Logs</router-link>
              </li>
              <li>
                Make sure you have a valid config.yaml file.<br />
                Or make a repository to host your forms.
                <router-link class="btn btn-sm btn-success ms-2" to="/settings/repositories"
                  >Create repository</router-link
                >
              </li>
              <li>Double check firewalls, hostname, username and password</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
