<script setup>
import axios from 'axios';
import TokenStorage from '@/lib/TokenStorage';
import ansiParse from '@/lib/AnsiParse';
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { toast } from 'vue-sonner';
import Helpers from '@/lib/Helpers';

const { t } = useI18n();

const log = ref('');
const isLoading = ref(false);
const filter = ref('');
const scroller = ref(null);
const refresh = ref(false);
const lines = ref(100);
const lineOptions = [
  { value: 100, label: '100' },
  { value: 200, label: '200' },
  { value: 300, label: '300' },
  { value: 400, label: '400' },
  { value: 500, label: '500' },
  { value: 1000, label: '1000' },
];

// The filter is a REGEX, which is the useful thing for a log - but String.match compiles
// its string argument, so a half typed one ('[', '(', '*', 'a{2,1}') threw a SyntaxError
// from inside this computed and took the whole page down. You cannot type '[abc]' without
// passing through '['. Compile it once here: while it is not valid yet, fall back to a
// plain case-insensitive substring match so the list keeps narrowing as you type.
const filterMatcher = computed(() => {
  const f = filter.value;
  if (!f) return null;
  try {
    const re = new RegExp(f);
    return (line) => re.test(line);
  } catch {
    const needle = f.toLowerCase();
    return (line) => line.toLowerCase().includes(needle);
  }
});

const filtered = computed(() => {
  const match = filterMatcher.value;
  const lines = log.value.split('\n').filter((x) => x != '');
  return (match ? lines.filter(match) : lines).map((x) => ansiParse(x));
});
async function scrollToBottom() {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const lastChildElement = scroller.value?.lastElementChild;
  lastChildElement?.scrollIntoView({
    behavior: 'smooth',
  });
}
watch(lines, async () => {
  await load(true);
});
watch(refresh, async () => {
  if (refresh.value) {
    await load(true);
  } else {
    stopAutoRefresh();
  }
});
// The auto refresh is a timer we own, not a recursive chain we can't stop : it
// is cleared when the switch goes off and when the page is left, otherwise the
// polling keeps running for the rest of the session.
let refreshTimer = null;
let stopped = false;

function stopAutoRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function scheduleAutoRefresh() {
  stopAutoRefresh();
  if (stopped || !refresh.value) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    load();
  }, 2000);
}

async function load(force = false) {
  if (isLoading.value || !(refresh.value || force)) return;
  isLoading.value = true;
  try {
    const result = await axios.get(`/api/v2/log?lines=${lines.value || 100}`, TokenStorage.getAuthentication());
    if (result.data != '...') {
      log.value = result.data;
      await scrollToBottom();
    }
  } catch (err) {
    // a failing log endpoint must not leave the page loading forever (that
    // disables both the refresh button and the auto refresh)
    if (!stopped) {
      refresh.value = false;
      toast.error(Helpers.parseAxiosResponseError(err));
    }
  } finally {
    // always released, also when the server answered the "..." placeholder
    isLoading.value = false;
  }
  scheduleAutoRefresh();
}
async function downloadWithAxios(url, authHeaders) {
  const response = await axios({
    method: 'get',
    headers: authHeaders.headers,
    url,
    responseType: 'arraybuffer',
  });
  Helpers.forceFileDownload(response);
}

async function download() {
  try {
    await downloadWithAxios(`/api/v2/log/download`, TokenStorage.getAuthentication());
  } catch (err) {
    toast.error(err.message);
  }
}
onMounted(async () => {
  await load(true);
});
onUnmounted(() => {
  stopped = true;
  stopAutoRefresh();
});
</script>
<template>
  <AppNav />
  <div class="af-fill-page">
    <main class="d-flex flex-nowrap af-settings-layout af-with-sidebar">
      <AppSidebar />
      <AppSettings :title="t('logs.title')" :description="t('logs.description')" icon="file-lines">
        <template #headerActions>
          <div class="ms-2">
            <BsInput
              :isFloating="false"
              type="checkbox"
              v-model="refresh"
              :label="t('logs.autoRefresh')"
              :isInline="true"
            ></BsInput>
          </div>
          <div class="ms-2">
            <BsInput
              :isFloating="false"
              type="select"
              icon="arrows-up-down"
              v-model="lines"
              :values="lineOptions"
              label=""
              :isInline="true"
            ></BsInput>
          </div>
          <div class="ms-2">
            <!-- the search box of the other pages : the placeholder goes on click, an X clears it -->
            <BsSearch v-model="filter" icon="filter" style="width: 16rem" :placeholder="t('logs.filterPlaceholder')" />
          </div>
          <!-- view controls only : these decide WHAT the card shows. Refresh re-reads the same
               view, it does not act on anything ; the download follows, with the page's buttons -->
          <BsButton class="ms-2 text-nowrap" icon="refresh" @click="load(true)">{{ t('jobs.refresh') }}</BsButton>
        </template>
        <template #actions>
          <BsButton class="text-nowrap" icon="download" @click="download()">{{ t('logs.download') }}</BsButton>
        </template>
        <template #default>
          <!-- tabindex : the scrolling box is the card body around us, and a
               scroll container is only driven by the arrow / page keys once
               something inside it holds the focus -->
          <div
            ref="scroller"
            id="scroller"
            class="font-monospace fs-6"
            tabindex="0"
            role="region"
            :aria-label="t('logs.title')"
          >
            <div v-for="(t, i) in filtered" :key="i">
              <div class="text-end pe-1 me-3 d-inline-block af-line-no" style="width: 40px">{{ i + 1 }}</div>
              <span v-for="(s, si) in t" :key="si" v-text="s.text" :class="s.foreground || ''"></span>
            </div>
          </div>
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped>
/* The viewport is filled by `af-fill-page` (the card body is the scrolling
   area), so the log itself only has to keep long lines from widening the page. */
#scroller {
  overflow-wrap: anywhere;
  /* the line numbers' grey column from the card's left border, and the lines from its top
     and bottom : the card body's padding taken back */
  margin: calc(-1 * var(--bs-card-spacer-y)) 0 calc(-1 * var(--bs-card-spacer-y)) calc(-1 * var(--bs-card-spacer-x));
}
</style>
<route lang="yaml">
meta:
  layout: standard
</route>
