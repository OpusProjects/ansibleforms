<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { toast } from 'vue-sonner';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '@/stores/app';
import axios from 'axios';
import TokenStorage from '@/lib/TokenStorage';
import State from '@/lib/State';
import Helpers from '@/lib/Helpers';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import YAML from 'yaml';
import Time from '@/lib/Time';
import BsColumnPicker from '@/components/BsColumnPicker.vue';
import { headerWidth } from '@/lib/tableCells';

// INIT

const { t } = useI18n();

const router = useRouter();
const route = useRoute();
const store = useAppStore();
dayjs.extend(utc);

// DATA

const jobs = ref([]);
// the jobs loaded once : until then the menu shows the counts it had
const jobsLoaded = ref(false);
const job = ref(null);
const isLoading = ref(false);
const lines = ref(1000);
const jobId = ref(null);
const displayedJobs = ref([]);
const showExtraVars = ref(false);
const showArtifacts = ref(false);
const viewAsYaml = ref(false);
const approvalMessage = ref(null);
const approvalTitle = ref(null);
const hide = ref(false);
const collapsed = ref({});
const showDelete = ref(false);
const showAbort = ref(false);
const showRelaunch = ref(false);
const showApprove = ref(false);
const runningJobsInterval = ref(null);
const showReject = ref(false);
const relaunchVerbose = ref(false);
const relaunchWithEdit = ref(false);
const tempJobId = ref(null);
const noOfRecords = ref(500);
// the left menu's status filter : null shows every job ; ?status= opens the page on one
// (the approvals bell in the header links to ?status=approve)
const statusFilter = ref(route.query.status || null);
watch(
  () => route.query.status,
  (status) => (statusFilter.value = status || null),
);
// a status picked in the left menu : the address follows, so a reload or a shared link
// opens the same view (the job that is open, if any, stays open)
function selectStatus(status) {
  statusFilter.value = status;
  const query = { ...route.query };
  if (status) query.status = status;
  else delete query.status;
  // from a job's page a status goes back to the list ; on the list it only filters
  if (isJobPage.value) router.push({ path: '/jobs', query });
  else router.replace({ query });
}

// a job that is opened (/jobs/:id) has a page of its own : its actions in the header, and
// its output - not the list. The list's status filter rides along in
// the address, so going back opens the list as it was left.
const isJobPage = computed(() => !!route.params.id);
function backToJobs() {
  router.push({ path: '/jobs', query: route.query });
}
// a job's page and the list open at the top
// to the top when a job opens or closes : the page scrolls in #app, below the header
watch(isJobPage, () => document.getElementById('app')?.scrollTo({ top: 0 }));

/**
 * How long a job ran, from its start to its end : 6s, 2m 05s, 1h 02m 05s ; none while it has
 * no end (running, waiting).
 *
 * Args:
 *   j (object): the job.
 *
 * Returns:
 *   number|null: the seconds, or null.
 */
function durationSeconds(j) {
  if (!j.start || !j.end) return null;
  const s = Math.round((new Date(j.end) - new Date(j.start)) / 1000);
  return Number.isFinite(s) && s >= 0 ? s : null;
}
function formatDuration(seconds) {
  if (seconds == null) return '–';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  const two = (n) => String(n).padStart(2, '0');
  if (h) return `${h}h ${two(m)}m ${two(sec)}s`;
  if (m) return `${m}m ${two(sec)}s`;
  return `${sec}s`;
}

// ─── DataTable-style state (sort / column visibility) ─────────────────────
// the table fits its frame (a fixed layout) : the short columns a width of their own, the form
// and the user share the rest, a long value cut with an ellipsis (its full text in the tooltip)
const columnDefs = computed(() => [
  { key: 'id', label: t('jobs.id'), filterable: true, sortable: true, type: 'number', width: '4.5rem' },
  { key: 'form', label: t('jobs.form'), filterable: true, sortable: true },
  {
    key: 'job_type',
    label: t('jobs.jobType'),
    filterable: true,
    sortable: true,
    // as wide as its header, in the language shown
    width: headerWidth(t('jobs.jobType')),
    render: (j) => j.job_type || 'ansible',
  },
  { key: 'status', label: t('jobs.status'), filterable: true, sortable: true, width: '7.5rem' },
  {
    key: 'start',
    label: t('jobs.startTime'),
    filterable: true,
    sortable: true,
    width: '13.25rem',
    render: (j) => formatTime(j.start),
  },
  {
    key: 'end',
    label: t('jobs.endTime'),
    filterable: true,
    sortable: true,
    width: '13.25rem',
    render: (j) => formatTime(j.end),
  },
  {
    // how long it ran : sorted by its seconds, not its text
    key: 'duration',
    label: t('jobs.duration'),
    sortable: true,
    width: '5.5rem',
    render: (j) => formatDuration(durationSeconds(j)),
    type: 'number',
    sortValue: (j) => durationSeconds(j) ?? -1,
  },
  {
    key: 'user',
    label: t('jobs.user'),
    filterable: true,
    sortable: true,
    render: (j) => `${j.user || ''}${j.user_type ? ' (' + j.user_type + ')' : ''}`,
  },
]);
const hiddenColumns = ref(new Set());
// the search on the title line : a job whose shown columns (or a step's id or target) hold it
const search = ref('');
const sortKey = ref(null);
const sortDir = ref(1); // 1 asc, -1 desc

const visibleColumns = computed(() => columnDefs.value.filter((c) => !hiddenColumns.value.has(c.key)));

function cellText(item, col) {
  if (!item) return '';
  if (col.render) return String(col.render(item) ?? '');
  const v = item[col.key];
  return v == null ? '' : String(v);
}

function toggleSort(key) {
  if (sortKey.value === key) {
    sortDir.value = -sortDir.value;
  } else {
    sortKey.value = key;
    sortDir.value = 1;
  }
}

// a preset of the Columns button : its hidden columns, kept like a toggle
function applyColumnPreset(hidden) {
  hiddenColumns.value = hidden;
  try {
    Helpers.setCookie('dt_cols_jobs', JSON.stringify([...hidden]), 365);
  } catch (e) {
    /* ignore */
  }
}

function toggleColumn(key) {
  const s = new Set(hiddenColumns.value);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  hiddenColumns.value = s;
  try {
    Helpers.setCookie('dt_cols_jobs', JSON.stringify([...s]), 365);
  } catch (e) {
    /* ignore */
  }
}

// COMPUTED

// Check if user can relaunch jobs
const canRelaunchJobs = computed(() => {
  return store?.profile?.options?.allowJobRelaunch;
});

// job output filtered
const filteredJobOutput = computed(() => {
  if (!hide.value) return job.value?.output?.replace(/\r\n/g, '<br>') || '';
  return (
    job.value?.output
      ?.replace(/<span class='low[^<]*<\/span>/g, '')
      .replace(/\r\n/g, '<br>')
      .replace(/(<br>\s*){3,}/gi, '<br><br>') || ''
  );
});
// subjob output filtered
const filteredSubJobOutput = computed(() => {
  if (!hide.value) return subjob.value?.output?.replace(/\r\n/g, '<br>') || '';
  return (
    subjob.value?.output
      ?.replace(/<span class='low[^<]*<\/span>/g, '')
      .replace(/\r\n/g, '<br>')
      .replace(/(<br>\s*){3,}/gi, '<br><br>') || ''
  );
});
// current job index, expressed in the pager's own index space (position
// within parentJobs). A subjob resolves to its parent so deep-linking a
// child still opens the page that holds its parent row.
const displayedJobIndex = computed(() => {
  if (!jobId.value) return -1;
  const selected = jobs.value.find((e) => e.id == jobId.value);
  if (!selected) return -1;
  const targetId = selected.parent_id ? selected.parent_id : selected.id;
  return parentJobs.value.findIndex((e) => e.id == targetId);
});
// the statuses of the left menu (AppJobsSidebar), for the page title and the line under it
// (the labels are spelled out, not built from the status, so the i18n key check can find them)
const MENU_STATUSES = [
  {
    status: 'running',
    icon: 'play',
    label: () => t('jobs.menu.running'),
    description: () => t('jobs.description.running'),
  },
  {
    status: 'approve',
    icon: 'hourglass-half',
    label: () => t('jobs.menu.approve'),
    description: () => t('jobs.description.approve'),
  },
  {
    status: 'success',
    icon: 'check',
    label: () => t('jobs.menu.success'),
    description: () => t('jobs.description.success'),
  },
  {
    status: 'failed',
    icon: 'xmark',
    label: () => t('jobs.menu.failed'),
    description: () => t('jobs.description.failed'),
  },
  {
    status: 'aborted',
    icon: 'ban',
    label: () => t('jobs.menu.aborted'),
    description: () => t('jobs.description.aborted'),
  },
];
// the page title is the view picked in the left menu (its name and icon, as in the menu)
const pageTitle = computed(() => {
  // a job's page : the job's name (the form it ran), its id until the job is loaded
  if (isJobPage.value) {
    return { title: job.value?.form || t('jobs.jobTitle', { id: route.params.id }), icon: 'file-lines' };
  }
  const m = MENU_STATUSES.find((x) => x.status === statusFilter.value);
  return m ? { title: m.label(), icon: m.icon } : { title: t('jobs.menu.all'), icon: 'list' };
});
// the line under the page title : what the status picked in the left menu shows
const pageDescription = computed(() => {
  // a job's page : what the page is for (the job's name is the title)
  if (isJobPage.value) return t('jobs.description.job');
  return MENU_STATUSES.find((m) => m.status === statusFilter.value)?.description() || t('jobs.description.all');
});
// the table's message when no job is shown : a status picked in the menu, a column
// filter, or simply no jobs at all
const emptyMessage = computed(() => {
  if (statusFilter.value) {
    const entry = MENU_STATUSES.find((m) => m.status === statusFilter.value);
    return t('jobs.empty.status', { status: (entry ? entry.label() : statusFilter.value).toLowerCase() });
  }
  return search.value.trim() ? t('jobs.empty.filtered') : t('jobs.empty.none');
});

// main jobs
const parentJobs = computed(() => {
  let list = jobs.value?.filter((x) => !x.parent_id) || [];

  // the left menu's status filter
  if (statusFilter.value) list = list.filter((x) => x.status === statusFilter.value);

  // The search (case-insensitive, on the text the columns show), as every table's : a job
  // whose shown columns hold it, or a multistep job whose steps' id or target does, so a
  // job is found by one of its steps
  const needle = search.value.trim().toLowerCase();
  if (needle) {
    const allJobs = jobs.value || [];
    list = list.filter(
      (item) =>
        visibleColumns.value.some((col) => cellText(item, col).toLowerCase().includes(needle)) ||
        allJobs.some(
          (c) =>
            c.parent_id === item.id &&
            (String(c.id ?? '')
              .toLowerCase()
              .includes(needle) ||
              String(c.target ?? '')
                .toLowerCase()
                .includes(needle)),
        ),
    );
  }

  // Sorting.
  if (sortKey.value) {
    const col = columnDefs.value.find((c) => c.key === sortKey.value);
    if (col) {
      const dir = sortDir.value;
      list = [...list].sort((a, b) => {
        let av = col.sortValue ? col.sortValue(a) : col.render ? col.render(a) : a[col.key];
        let bv = col.sortValue ? col.sortValue(b) : col.render ? col.render(b) : b[col.key];
        if (col.type === 'number') {
          av = Number(av);
          bv = Number(bv);
          if (isNaN(av)) av = 0;
          if (isNaN(bv)) bv = 0;
        } else {
          av = av == null ? '' : String(av);
          bv = bv == null ? '' : String(bv);
        }
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }
  }

  return list;
});
// subjobs
const subjobs = computed(() => {
  return job.value?.subjobs || [];
});
// all jobs that are running
const runningJobs = computed(() => {
  return jobs.value?.filter(
    (x) => x.start && dayjs().diff(x.start, 'hours') < 6 && (x.status == 'running' || x.abort_requested),
  );
});
// the last subjob id
const subjobId = computed(() => {
  return subjobs.value.slice(-1)[0];
});
// current subjob, if any
const subjob = computed(() => {
  return jobs.value?.filter((x) => x.id == subjobId.value)[0] || null;
});

// WATCHERS

// watch route changes, get job id and load the output
watch(
  () => route.params.id,
  async (id) => {
    if (id) {
      jobId.value = id;
      await loadOutput(id);
      // Expand parent if this is a child job
      const selectedJob = jobs.value.find((j) => j.id == id);
      if (selectedJob && selectedJob.parent_id) {
        collapsed.value[selectedJob.parent_id] = true;
      }
    }
  },
);

// persist lines when user changes the select; also reload jobs
watch(lines, async (val, oldVal) => {
  try {
    Helpers.setCookie('jobs_lines', String(val), 365);
  } catch (e) {}
  if (val !== oldVal) {
    await loadJobs();
  }
});

// METHODS

// copy string to clipboard
async function copyToClipboard(textToCopy) {
  // Navigator clipboard api needs a secure context (https)
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(textToCopy);
  } else {
    // Use the 'out of viewport hidden text area' trick
    const textArea = document.createElement('textarea');
    textArea.value = textToCopy;

    // Move textarea out of the viewport so it's not visible
    textArea.style.position = 'absolute';
    textArea.style.left = '-999999px';

    document.body.prepend(textArea);
    textArea.select();

    try {
      document.execCommand('copy');
    } catch (error) {
      console.error(error);
    } finally {
      textArea.remove();
    }
  }
}

// copy object to clipboard as json or yaml
async function clip(v, doNotStringify = false, asYaml = false) {
  if (doNotStringify) {
    try {
      await copyToClipboard(v);
      toast.success('Copied to clipboard');
    } catch (err) {
      toast.error('Error copying to clipboard : \n' + err.toString());
    }
  } else {
    try {
      if (asYaml) {
        await copyToClipboard(YAML.stringify(v));
      } else {
        await copyToClipboard(JSON.stringify(v, null, 2));
      }
      toast.success('Copied to clipboard');
    } catch (err) {
      toast.error('Error copying to clipboard : \n' + err.toString());
    }
  }
}
// copy the job's output as it reads on screen (the filter applied or not) : the output is
// html - colored spans, <br> for the line breaks - so it is copied as its plain text
function copyOutput() {
  const html = filteredJobOutput.value.replace(/<br\s*\/?>/gi, '\n');
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
  clip(text, true);
}
// load jobs
async function loadJobs() {
  if (!isLoading.value) {
    try {
      isLoading.value = true;
      const result = await axios.get(`/api/v2/job?records=${lines.value}`, TokenStorage.getAuthentication());
      if (result.status === 200) {
        jobs.value = result.data.records;
        jobsLoaded.value = true;
        if (jobId.value) {
          await loadOutput(jobId.value);
        }
      } else {
        toast.error(result.data.error);
      }
    } catch (err) {
      if (err.response && err.response.data && err.response.data.error) {
        toast.error(err.response.data.error);
      } else {
        toast.error(t('jobs.failedToLoad'));
      }
    } finally {
      isLoading.value = false;
      State.refreshApprovals();
    }
  }
}
// get child jobs by parent id
function childJobs(id) {
  if (isLoading.value) return [];
  const all = jobs.value.filter((x) => x.parent_id === id);

  // a search the steps match (their id or target) : those steps shown, so a multistep job
  // does not have to be unfolded to see why it is listed
  const needle = search.value.trim().toLowerCase();

  let visible;
  if (collapsed.value[id]) {
    visible = all;
  } else if (needle) {
    visible = all.filter(
      (c) =>
        String(c.id ?? '')
          .toLowerCase()
          .includes(needle) ||
        String(c.target ?? '')
          .toLowerCase()
          .includes(needle),
    );
  } else {
    visible = [];
  }
  return visible.sort((a, b) => (a.id > b.id ? 1 : -1));
}

// load job output
async function loadOutput(id, sub = false) {
  if (!id) {
    job.value = null;
    return;
  }
  if (!sub) {
    jobId.value = id;
  }
  const result = await axios.get(`/api/v2/job/${id}`, TokenStorage.getAuthentication());
  if (result.status === 200) {
    const data = result.data;
    if (!sub) {
      job.value = data;
      if (subjobId.value) {
        await loadOutput(subjobId.value, true);
      }
    } else {
      const idx = getJobIndex(id);
      jobs.value[idx] = data;
    }
  } else {
    toast.error(result.data?.error || 'Failed to load job output');
  }
}
// load running jobs
async function loadRunningJobs() {
  // using await
  for (const item of runningJobs.value) {
    const result = await axios.get(`/api/v2/job/${item.id}`, TokenStorage.getAuthentication());
    if (result.status == 200 && noOfRecords.value != result.data.no_of_records) {
      await loadJobs(); // no of records changed ; reload jobs
      noOfRecords.value = result.data.no_of_records;
      return; // Exit early - loadJobs() has refreshed everything
    }
    const idx = getJobIndex(item.id);
    if (idx !== -1) {
      jobs.value[idx] = result.data;
    }
    if (item.id == jobId.value) {
      job.value = result.data;
    }
  }
}
// download with axios
async function downloadWithAxios(url, headers) {
  const response = await axios({
    method: 'get',
    headers: headers.headers,
    url,
    responseType: 'arraybuffer',
  });
  Helpers.forceFileDownload(response);
}
// download a job
async function download(id) {
  try {
    await downloadWithAxios(`/api/v2/job/${id}/download`, TokenStorage.getAuthentication());
  } catch (err) {
    toast.error(err.toString());
  }
}
// display a subset of jobs (by pagination)
// where the pager is, for the footer's range (1-10 of 64)
const pagerState = ref({ page: 1, pageSize: 10 });
function setDisplayJobs(jobs, state) {
  displayedJobs.value = jobs;
  if (state) pagerState.value = state;
}
const jobsRange = computed(() => {
  const total = parentJobs.value.length;
  if (!total || !displayedJobs.value.length) return t('dataTable.rangeOf', { from: 0, to: 0, total });
  const from = (pagerState.value.page - 1) * pagerState.value.pageSize + 1;
  return t('dataTable.rangeOf', { from, to: from + displayedJobs.value.length - 1, total });
});
// format time
// a job time in the user's time zone (Profile > Preferences)
function formatTime(t) {
  return Time.format(t);
}
// get job index by id
function getJobIndex(id) {
  return jobs.value.findIndex((x) => x.id === id);
}
// show approval (approve or reject)
// The job is read for its approval text only : it is not selected (jobId, job), so closing
// the modal without approving or rejecting leaves the page as it was, without the job output.
// Confirming does open the output (jobAction), to follow the job that was just approved.
async function showApproval(id, reject) {
  try {
    const result = await axios.get(`/api/v2/job/${id}`, TokenStorage.getAuthentication());
    if (result.status === 200) {
      const approvalJob = result.data;
      approvalMessage.value = replacePlaceholders(approvalJob.approval?.message || '', approvalJob.extravars);
      approvalTitle.value = replacePlaceholders(approvalJob.approval?.title, approvalJob.extravars) || 'Approve';
      if (reject) {
        showReject.value = true;
      } else {
        showApprove.value = true;
      }
    } else {
      toast.error(result.data?.error || 'Failed to get job output');
    }
  } catch (err) {
    toast.error(`Failed to get job output: ${err.toString()}`);
  }
}
// replace placeholders in a string
function replacePlaceholders(msg, extravars) {
  if (!msg) {
    return '';
  }
  return msg.replace(
    /\$\(([^\)]+)\)/g, // eslint-disable-line
    (placeholderWithDelimiters, placeholderWithoutDelimiters) =>
      Helpers.htmlEncode(String(findExtravar(extravars, placeholderWithoutDelimiters) || placeholderWithDelimiters)),
  );
}
// find extravars
function findExtravar(data, expr) {
  var outputValue = '';
  expr.split(/\s*\.\s*/).reduce((master, obj, level, arr) => {
    if (level === arr.length - 1) {
      try {
        outputValue = master[obj];
      } catch (err) {
        outputValue = '/bad placeholder/';
      }
    } else {
      outputValue = master;
    }
    return master[obj];
  }, data);
  return outputValue;
}
async function jobAction(id, action, method = 'post', uri_suffix = '') {
  try {
    jobId.value = id;
    var result;
    const uri = `/api/v2/job/${id}${uri_suffix}`;
    switch (method) {
      case 'get':
        result = await axios.get(uri, TokenStorage.getAuthentication());
        break;
      case 'post':
        result = await axios.post(uri, {}, TokenStorage.getAuthentication());
        break;
      case 'delete':
        result = await axios.delete(uri, TokenStorage.getAuthentication());
        id = undefined; // reset id after delete
        jobId.value = undefined;
        break;
      case 'patch':
        result = await axios.patch(uri, {}, TokenStorage.getAuthentication());
        break;
      default:
        throw new Error('Invalid method');
    }
    if (result.status == 200) {
      toast.success(result.data.message || `Job ${id} ${action}ed successfully`);
      await loadJobs();
      // If relaunch, navigate to the new job
      if (action === 'relaunch' && result.data.id) {
        getJob(result.data.id);
      } else {
        await loadOutput(id);
      }
      tempJobId.value = undefined;
    } else {
      toast.error(result.data.message || `Failed to ${action} job ${id}`);
    }
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err) || `Failed to ${action} job ${id}`);
  } finally {
    await loadJobs();
  }
}
// ─── selection : the jobs ticked on the left, deleted together ───────────────
const selected = ref(new Set());
const showBulkDelete = ref(false);

/**
 * Whether a job can be deleted : as its row's delete icon - not one waiting for approval, and
 * a running one by an admin only.
 *
 * Args:
 *   j (object): the job.
 *
 * Returns:
 *   boolean: it can be deleted.
 */
function canDelete(j) {
  return j.status != 'approve' && ((j.status != 'running' && !j.abort_requested) || store.isAdmin);
}
// the jobs of the page that can be ticked, and whether they all are
const pageSelectable = computed(() => displayedJobs.value.filter(canDelete));
const pageAllSelected = computed(
  () => pageSelectable.value.length > 0 && pageSelectable.value.every((j) => selected.value.has(j.id)),
);

/**
 * Ticks or unticks a job.
 *
 * Args:
 *   id (number): the job.
 */
function toggleSelected(id) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

/**
 * Ticks every job of the page that can be deleted, or unticks them all.
 */
function togglePage() {
  const next = new Set(selected.value);
  const all = pageAllSelected.value;
  for (const j of pageSelectable.value) {
    if (all) next.delete(j.id);
    else next.add(j.id);
  }
  selected.value = next;
}

/**
 * Deletes the ticked jobs, one after another, and says how many were.
 */
async function deleteSelected() {
  showBulkDelete.value = false;
  const ids = [...selected.value];
  let done = 0;
  for (const id of ids) {
    try {
      await axios.delete(`/api/v2/job/${id}`, TokenStorage.getAuthentication());
      done++;
    } catch (err) {
      toast.error(Helpers.parseAxiosResponseError(err) || `Failed to delete job ${id}`);
    }
  }
  if (done) toast.success(t('jobs.deletedSelected', { count: done }));
  selected.value = new Set();
  await loadJobs();
}

// delete a job
async function deleteJob(id) {
  await jobAction(id, 'delete', 'delete');
  // the job of this page is gone (jobAction clears the id once the delete went through)
  if (isJobPage.value && !jobId.value) backToJobs();
}
// abort a job
async function abortJob(id) {
  await jobAction(id, 'abort', 'post', '/abort');
}
// relaunch a job (direct relaunch)
async function relaunchJob(id, verbose = false) {
  relaunchVerbose.value = false;
  await jobAction(id, 'relaunch', 'post', `/relaunch?verbose=${verbose}`);
}
// edit and relaunch - navigate to form with pre-filled data
async function editAndRelaunchJob(id) {
  relaunchWithEdit.value = false;
  // Get the job to find the form name
  try {
    const result = await axios.get(`/api/v2/job/${id}`, TokenStorage.getAuthentication());
    const formName = result.data.form;
    // Navigate to form with prefillJobId parameter
    router.push({ name: '/form', query: { form: formName, prefillJobId: id } });
    showRelaunch.value = false;
  } catch (err) {
    toast.error('Failed to load job data: ' + err.toString());
  }
}
// approve a job
async function approveJob(id) {
  await jobAction(id, 'approve', 'post', '/approve');
  State.refreshApprovals(); // refresh approvals before approving
}
// reject a job
async function rejectJob(id) {
  await jobAction(id, 'reject', 'post', '/reject');
}
// get job by id - navigation
function getJob(id) {
  router.push({ path: `/jobs/${id}`, query: route.query }).catch((_e) => {});
}
// check if approval is allowed for a job
function approvalAllowed(job) {
  if (store.profile?.roles?.includes('admin')) return true;
  if (!job.approval) return true;
  // not admin and approval - lets check access
  // The list endpoint returns `approval` as a JSON STRING, the single-job endpoint
  // returns it already PARSED - and loadRunningJobs writes a single-job payload into
  // this list. A multistep job going running -> approve mid-poll therefore reached
  // here as an object, and JSON.parse('[object Object]') threw inside the render,
  // breaking the jobs table for every non-admin approver.
  var approval = typeof job.approval === 'string' ? JSON.parse(job.approval) : job.approval;
  var access = approval?.roles?.filter((role) => store.profile?.roles?.includes(role));
  if (access?.length > 0) {
    return true;
  } else {
    return false;
  }
}
// keep track of collapsed multistep jobs
function toggleCollapse(id) {
  if (!collapsed.value[id]) {
    collapsed.value[id] = true;
  } else {
    collapsed.value[id] = false;
  }
}
// job background color
// the row of the job shown below the list stands out ; a job's status is its pill, not the
// row's colour
function jobBackground(job) {
  return job.id == jobId.value ? 'table-selected' : '';
}

// EVENTS

// mounted
onMounted(async () => {
  // restore lines per-page from cookie if present
  try {
    const savedLines = Helpers.getCookie('jobs_lines');
    if (savedLines && !isNaN(parseInt(savedLines))) {
      lines.value = parseInt(savedLines);
    }
  } catch (e) {}

  // restore column visibility from cookie
  try {
    const savedCols = Helpers.getCookie('dt_cols_jobs');
    if (savedCols) {
      hiddenColumns.value = new Set(JSON.parse(savedCols));
    }
  } catch (e) {
    /* ignore */
  }

  if (route.params.id) {
    jobId.value = parseInt(route.params.id);
    try {
      await loadOutput(jobId.value);
    } catch (err) {
      // a deep link to a job that is gone (or not visible) must not
      // abort the mount : the list and the polling still have to start
      toast.error(Helpers.parseAxiosResponseError(err, 'Failed to load job output'));
    }
  }
  await loadJobs(true);
  // After jobs are loaded, expand parent if jobId is a child job
  if (jobId.value) {
    const selectedJob = jobs.value.find((j) => j.id == jobId.value);
    if (selectedJob && selectedJob.parent_id) {
      collapsed.value[selectedJob.parent_id] = true;
    }
  }
  runningJobsInterval.value = setInterval(loadRunningJobs, 5000);
});
// destroy
onBeforeUnmount(() => {
  clearInterval(runningJobsInterval.value);
});
</script>
<template>
  <AppNav />
  <!-- this page scrolls with the document : it is a stack of independent blocks
       (table, pager, output actions, workflow graph, job and subjob output), not
       a single pane, so it must not be trapped in one inner scroller -->
  <div class="flex-shrink-0">
    <!-- Modal - delete verify -->
    <BsModal v-if="showDelete" @close="showDelete = false">
      <template #title> {{ t('jobs.deleteJob') }} {{ tempJobId }} </template>
      <template #default
        ><p class="mt-3 fs-6 user-select-none">
          {{ t('jobs.deleteConfirm') }} <strong>{{ tempJobId }}</strong
          >?
        </p></template
      >
      <template #footer
        ><BsButton
          icon="trash"
          @click="
            deleteJob(tempJobId);
            showDelete = false;
          "
          >{{ t('common.delete') }}</BsButton
        ></template
      >
    </BsModal>
    <!-- Modal - the ticked jobs deleted together -->
    <BsModal v-if="showBulkDelete" @close="showBulkDelete = false">
      <template #title> {{ t('jobs.deleteSelected', { count: selected.size }) }} </template>
      <template #default
        ><p class="mt-3 fs-6 user-select-none">
          {{ t('jobs.deleteSelectedConfirm', { count: selected.size }) }}
        </p></template
      >
      <template #footer
        ><BsButton icon="trash" @click="deleteSelected()">{{ t('common.delete') }}</BsButton></template
      >
    </BsModal>
    <!-- Modal - abort verify -->
    <BsModal v-if="showAbort" @close="showAbort = false">
      <template #title> {{ t('jobs.abortJob') }} {{ tempJobId }} </template>
      <template #default
        ><p class="mt-3 fs-6 user-select-none">
          {{ t('jobs.abortConfirm') }} <strong>{{ tempJobId }}</strong
          >?
        </p></template
      >
      <template #footer
        ><BsButton
          icon="ban"
          @click="
            abortJob(tempJobId);
            showAbort = false;
          "
          >{{ t('jobs.abortJob') }}</BsButton
        ></template
      >
    </BsModal>
    <!-- Modal - relaunch verify -->
    <BsModal v-if="showRelaunch" @close="showRelaunch = false">
      <template #title> {{ t('jobs.relaunchJob') }} {{ tempJobId }} </template>
      <template #default>
        <p class="mt-3 fs-6 user-select-none">
          {{ t('jobs.relaunchChoose') }} <strong>{{ tempJobId }}</strong
          >:
        </p>
        <BsCheckbox
          v-if="store.profile.options?.allowVerboseMode"
          v-model="relaunchVerbose"
          :label="t('jobs.relaunchVerbose')"
          class="mt-2"
          :isSwitch="true"
          :inline="true"
        />
        <BsCheckbox
          v-model="relaunchWithEdit"
          :label="t('jobs.relaunchEdit')"
          class="mt-2"
          :isSwitch="true"
          :inline="true"
        />
      </template>
      <template #footer>
        <BsButton
          v-if="!relaunchWithEdit"
          icon="redo"
          @click="
            relaunchJob(tempJobId, relaunchVerbose);
            showRelaunch = false;
          "
          >{{ t('jobs.relaunch') }}</BsButton
        >
        <BsButton
          v-else
          icon="edit"
          @click="
            editAndRelaunchJob(tempJobId);
            showRelaunch = false;
          "
          >{{ t('jobs.editRelaunch') }}</BsButton
        >
      </template>
    </BsModal>
    <!-- Modal - approval -->
    <BsModal v-if="showApprove" @close="showApprove = false">
      <template #title> {{ t('jobs.approveJob') }} {{ tempJobId }} </template>
      <template #default>
        <p class="mt-3 fs-6 user-select-none">
          {{ t('jobs.approveConfirm') }} <strong>{{ tempJobId }}</strong
          >?
        </p>
        <BsDivider type="text" :text="t('jobs.approvalInfo')" />
        <p v-html="approvalMessage"></p>
      </template>
      <template #footer
        ><BsButton
          icon="circle-check"
          @click="
            approveJob(tempJobId);
            showApprove = false;
          "
          >{{ t('jobs.approve') }}</BsButton
        ></template
      >
    </BsModal>
    <!-- Modal - reject -->
    <BsModal v-if="showReject" @close="showReject = false">
      <template #title> {{ t('jobs.rejectJob') }} {{ tempJobId }} </template>
      <template #default
        ><p class="mt-3 fs-6 user-select-none">
          {{ t('jobs.rejectConfirm') }} <strong>{{ tempJobId }}</strong
          >?
        </p></template
      >
      <template #footer
        ><BsButton
          icon="circle-xmark"
          @click="
            rejectJob(tempJobId);
            showReject = false;
          "
          >{{ t('jobs.reject') }}</BsButton
        ></template
      >
    </BsModal>
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppJobsSidebar :jobs="jobs || []" :loaded="jobsLoaded" :status="statusFilter" @select="selectStatus" />
      <AppSettings :title="pageTitle.title" :description="pageDescription" :icon="pageTitle.icon">
        <template #headerActions>
          <!-- a job's page : the actions the list offers on its row (same rules), then the way back -->
          <div v-if="isJobPage" class="d-flex justify-content-end align-items-center gap-2">
            <template v-if="job">
              <BsButton
                v-if="job.status != 'running' && job.status != 'approve' && canRelaunchJobs"
                icon="redo"
                cssClass="text-nowrap"
                @click="
                  tempJobId = job.id;
                  showRelaunch = true;
                "
                >{{ t('jobs.relaunchJob') }}</BsButton
              >
              <BsButton
                v-if="job.status == 'running' && !job.abort_requested"
                icon="ban"
                cssClass="text-nowrap"
                @click="
                  tempJobId = job.id;
                  showAbort = true;
                "
                >{{ t('jobs.abortJob') }}</BsButton
              >
              <BsButton
                v-if="job.status != 'approve' && ((job.status != 'running' && !job.abort_requested) || store.isAdmin)"
                icon="trash-alt"
                cssClass="text-nowrap"
                @click="
                  tempJobId = job.id;
                  showDelete = true;
                "
                >{{ t('jobs.deleteJob') }}</BsButton
              >
              <BsButton
                v-if="job.status == 'approve' && approvalAllowed(job)"
                icon="circle-check"
                cssClass="text-nowrap"
                @click="
                  tempJobId = job.id;
                  showApproval(job.id);
                "
                >{{ t('jobs.approveJob') }}</BsButton
              >
              <BsButton
                v-if="job.status == 'approve' && approvalAllowed(job)"
                icon="circle-xmark"
                cssClass="text-nowrap"
                @click="
                  tempJobId = job.id;
                  showApproval(job.id, true);
                "
                >{{ t('jobs.rejectJob') }}</BsButton
              >
            </template>
            <BsButton icon="arrow-left" @click="backToJobs" cssClass="text-nowrap">{{ t('jobs.backToJobs') }}</BsButton>
          </div>
          <div v-else class="d-flex justify-content-end align-items-center">
            <!-- the search, as every table's on the title line -->
            <BsSearch v-model="search" class="af-table-search me-2" :placeholder="t('common.filter')" />
            <!-- the ticked jobs, deleted together -->
            <BsButton v-if="selected.size" icon="trash" cssClass="me-2 text-nowrap" @click="showBulkDelete = true">{{
              t('jobs.deleteSelected', { count: selected.size })
            }}</BsButton>
            <BsButton icon="refresh" @click="loadJobs" cssClass="me-2 text-nowrap">{{ t('jobs.refresh') }}</BsButton>
            <div class="input-group me-2" style="width: 160px">
              <span class="input-group-text">
                <FaIcon icon="list-ol" />
              </span>
              <select v-model="lines" class="form-select">
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="500">500</option>
                <option value="1000">1000</option>
              </select>
            </div>
            <!-- Column picker, with presets (BsColumnPicker, as the other tables) -->
            <BsColumnPicker
              class="me-2"
              :columns="columnDefs"
              :hidden="hiddenColumns"
              name="jobs"
              buttonClass="btn-outline-primary"
              @toggle="toggleColumn"
              @apply="applyColumnPreset"
            />
          </div>
        </template>
        <!-- the list : table and pager framed like the other tables, running to the card's edges -->
        <div v-if="!isJobPage" class="af-table-frame">
          <table class="custom-table af-table table-sm">
            <thead>
              <tr class="text-start">
                <!-- tick every job of the page that can be deleted -->
                <th class="af-jobs-select">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    :checked="pageAllSelected"
                    :disabled="!pageSelectable.length"
                    :aria-label="t('dataTable.selectAll', { count: pageSelectable.length })"
                    @change="togglePage()"
                  />
                </th>
                <th
                  v-for="col in visibleColumns"
                  :key="col.key"
                  :class="{ 'is-clickable': col.sortable, [col.key]: true }"
                  :style="{ userSelect: 'none', whiteSpace: 'nowrap', width: col.width || null }"
                  @click="col.sortable ? toggleSort(col.key) : undefined"
                >
                  {{ col.label }}
                  <span v-if="col.sortable" class="text-muted ms-1" style="font-size: 0.7em">
                    <template v-if="sortKey === col.key">
                      <font-awesome-icon :icon="sortDir === 1 ? 'sort-up' : 'sort-down'" />
                    </template>
                    <template v-else>
                      <font-awesome-icon icon="sort" class="opacity-25" />
                    </template>
                  </span>
                </th>
                <!-- the row's actions, at the right -->
                <th class="action"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="j in displayedJobs" :key="j.id">
                <!-- the whole row opens the job (a multistep job's id unfolds its steps instead) : the
                   actions cell too, where the icons keep their own action -->
                <tr :class="jobBackground(j)">
                  <!-- ticked to be deleted with others ; a job that cannot be deleted cannot be ticked -->
                  <td class="af-jobs-select">
                    <input
                      class="form-check-input"
                      type="checkbox"
                      :checked="selected.has(j.id)"
                      :disabled="!canDelete(j)"
                      @change="toggleSelected(j.id)"
                    />
                  </td>
                  <template v-for="col in visibleColumns" :key="col.key">
                    <td
                      v-if="col.key === 'id'"
                      role="button"
                      class="text-left"
                      @click="j.job_type == 'multistep' ? toggleCollapse(j.id) : getJob(j.id)"
                    >
                      <span>{{ j.id }}</span>
                      <template v-if="j.job_type == 'multistep'">
                        <span class="mx-2 float-end" v-if="!collapsed[j.id]"
                          ><font-awesome-icon icon="angle-right"
                        /></span>
                        <span class="mx-2 float-end" v-else><font-awesome-icon icon="angle-down" /></span>
                      </template>
                    </td>
                    <td v-else-if="col.key === 'status'" role="button" class="text-start" @click="getJob(j.id)">
                      <AppStatusPill :status="j.status" />
                    </td>
                    <!-- the form in the link blue, as a list's name : the row opens the job -->
                    <td
                      v-else
                      role="button"
                      class="text-start"
                      :class="{ 'af-row-open': col.key === 'form' }"
                      @click="getJob(j.id)"
                      :title="cellText(j, col)"
                    >
                      {{ cellText(j, col) }}
                    </td>
                  </template>
                  <!-- the row's menu, as every table's : what can be done with the job, Delete last -->
                  <td class="bs-dt-row-actions">
                    <div class="dropdown">
                      <!-- fixed, so the menu opens over the table's frame instead of being cut by it -->
                      <a
                        role="button"
                        class="bs-dt-row-menu px-2"
                        data-bs-toggle="dropdown"
                        data-bs-popper-config='{"strategy":"fixed"}'
                        :aria-label="t('common.actions')"
                      >
                        <font-awesome-icon icon="ellipsis-vertical" />
                      </a>
                      <ul class="dropdown-menu dropdown-menu-end">
                        <li>
                          <a class="dropdown-item" href="#" @click.prevent="getJob(j.id)"
                            ><font-awesome-icon icon="file-lines" class="me-2" />{{ t('jobs.openJob') }}</a
                          >
                        </li>
                        <!-- what can be done with it, apart from opening it -->
                        <li
                          v-if="
                            (j.status != 'running' && j.status != 'approve' && canRelaunchJobs) ||
                            (j.status == 'running' && !j.abort_requested) ||
                            (j.status == 'approve' && approvalAllowed(j))
                          "
                        >
                          <hr class="dropdown-divider" />
                        </li>
                        <li v-if="j.status != 'running' && j.status != 'approve' && canRelaunchJobs">
                          <a
                            class="dropdown-item"
                            href="#"
                            @click.prevent="
                              tempJobId = j.id;
                              showRelaunch = true;
                            "
                            ><font-awesome-icon icon="redo" class="me-2" />{{ t('jobs.relaunchJob') }}</a
                          >
                        </li>
                        <li v-if="j.status == 'running' && !j.abort_requested">
                          <a
                            class="dropdown-item"
                            href="#"
                            @click.prevent="
                              tempJobId = j.id;
                              showAbort = true;
                            "
                            ><font-awesome-icon icon="ban" class="me-2" />{{ t('jobs.abortJob') }}</a
                          >
                        </li>
                        <template v-if="j.status == 'approve' && approvalAllowed(j)">
                          <li>
                            <a
                              class="dropdown-item"
                              href="#"
                              @click.prevent="
                                tempJobId = j.id;
                                showApproval(j.id);
                              "
                              ><font-awesome-icon icon="circle-check" class="me-2" />{{ t('jobs.approveJob') }}</a
                            >
                          </li>
                          <li>
                            <a
                              class="dropdown-item"
                              href="#"
                              @click.prevent="
                                tempJobId = j.id;
                                showApproval(j.id, true);
                              "
                              ><font-awesome-icon icon="circle-xmark" class="me-2" />{{ t('jobs.rejectJob') }}</a
                            >
                          </li>
                        </template>
                        <li><hr class="dropdown-divider" /></li>
                        <li>
                          <a
                            class="dropdown-item"
                            :class="canDelete(j) ? 'text-danger' : 'disabled text-muted'"
                            href="#"
                            @click.prevent="
                              tempJobId = j.id;
                              showDelete = true;
                            "
                            ><font-awesome-icon icon="trash-alt" class="me-2" />{{ t('jobs.deleteJob') }}</a
                          >
                        </li>
                      </ul>
                    </div>
                  </td>
                </tr>
                <template v-for="c in childJobs(j.id)" :key="c.id">
                  <tr :class="jobBackground(c)">
                    <td class="table-info" role="button" @click="getJob(c.id)"></td>
                    <template v-for="col in visibleColumns" :key="col.key">
                      <td v-if="col.key === 'id'" role="button" class="text-end" @click="getJob(c.id)">{{ c.id }}</td>
                      <td
                        v-else-if="col.key === 'form'"
                        role="button"
                        class="text-start af-row-open"
                        @click="getJob(c.id)"
                        :title="c.target"
                      >
                        {{ c.target }}
                      </td>
                      <td v-else-if="col.key === 'status'" role="button" class="text-start" @click="getJob(c.id)">
                        <AppStatusPill :status="c.status" />
                      </td>
                      <td v-else role="button" class="text-start" @click="getJob(c.id)" :title="cellText(c, col)">
                        {{ cellText(c, col) }}
                      </td>
                    </template>
                    <td role="button" @click="getJob(c.id)"></td>
                  </tr>
                </template>
              </template>
              <!-- nothing to show : say why, above the pagination -->
              <tr v-if="!isLoading && parentJobs.length === 0" class="af-empty-row">
                <!-- 24px above the text ; below it 9px plus the pagination's own 16px margin, so the
                   message sits centred between the column filters and the pagination -->
                <td
                  :colspan="visibleColumns.length + 2"
                  class="text-center text-body-secondary pt-4"
                  style="padding-bottom: 9px"
                >
                  <FaIcon icon="circle-info" class="me-2" />{{ emptyMessage }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="job && isJobPage" class="row af-job-output">
          <div class="col">
            <h3 class="af-job-title">
              {{ t('jobs.jobTitle', { id: jobId }) }}
              <AppStatusPill :label="job.job_type || 'ansible'" tone="grey" />
              <AppStatusPill :status="job.status" />
            </h3>
            <BsButton
              v-if="store.profile.options?.showExtraVars"
              cssClass="btn-sm me-2 fw-normal"
              cssClassToggle="btn-sm me-2 fw-normal"
              icon="eye"
              iconToggle="eye-slash"
              :toggle="showExtraVars"
              @click="
                showExtraVars = !showExtraVars;
                showArtifacts = false;
              "
              >{{ t('jobs.showExtravars') }}<template #toggle>{{ t('jobs.hideExtravars') }}</template>
            </BsButton>
            <BsButton
              v-if="store.profile.options?.showArtifacts && job.job_type == 'awx'"
              cssClass="btn-sm me-2 fw-normal"
              cssClassToggle="btn-sm me-2 fw-normal"
              icon="square-poll-vertical"
              iconToggle="square-poll-horizontal"
              :toggle="showArtifacts"
              @click="
                showArtifacts = !showArtifacts;
                showExtraVars = false;
              "
              >{{ t('jobs.showArtifacts') }}<template #toggle>{{ t('jobs.hideArtifacts') }}</template>
            </BsButton>
            <BsButton @click="loadOutput(jobId)" icon="sync-alt" cssClass="btn-sm me-2 fw-normal">{{
              t('jobs.refreshOutput')
            }}</BsButton>
            <BsButton
              cssClass="btn-sm me-2 fw-normal"
              cssClassToggle="btn-sm me-2 fw-normal"
              icon="filter"
              iconToggle="filter-circle-xmark"
              :toggle="hide"
              @click="hide = !hide"
              >{{ t('jobs.applyFilter') }}<template #toggle>{{ t('jobs.removeFilter') }}</template></BsButton
            >
            <BsButton @click="copyOutput" icon="copy" cssClass="btn-sm me-2 fw-normal">{{
              t('jobs.copyOutput')
            }}</BsButton>
            <BsButton @click="download(jobId)" icon="download" cssClass="btn-sm me-2 fw-normal">{{
              t('jobs.downloadOutput')
            }}</BsButton>

            <!-- awx workflow graph (only for awx workflow jobs) -->
            <div class="row mt-4" v-if="job.awx_workflow?.nodes?.length">
              <div class="col">
                <AppAwxWorkflow :workflow="job.awx_workflow" />
              </div>
            </div>

            <div class="row mt-4">
              <div class="col">
                <AppAnsibleOutput :output="filteredJobOutput" :jobLog="job?.job_log">
                  <template #title>
                    <h3 v-if="subjob" class="af-job-title">
                      {{ t('jobs.mainJob') }} (jobid {{ jobId }})
                      <AppStatusPill :status="job.status" />
                    </h3>
                  </template>
                </AppAnsibleOutput>
              </div>
              <div class="col" v-if="subjob">
                <AppAnsibleOutput :output="filteredSubJobOutput" :jobLog="subjob?.job_log">
                  <template #title>
                    <h3 class="af-job-title">
                      {{ t('jobs.currentStep') }} (jobid {{ subjobId }})
                      <AppStatusPill :status="subjob.status" />
                    </h3>
                  </template>
                </AppAnsibleOutput>
              </div>
            </div>
          </div>

          <!-- extra vars column -->
          <div v-if="showExtraVars" class="col is-clipped-horizontal">
            <h3>{{ t('jobs.extravars') }}</h3>
            <div class="d-flex justify-content-between">
              <div>
                <BsButton
                  cssClass="btn-sm"
                  cssClassToggle="btn-sm"
                  :toggle="viewAsYaml"
                  @click="viewAsYaml = !viewAsYaml"
                >
                  <template #default>{{ t('jobs.viewAsYaml') }}</template>
                  <template #toggle>{{ t('jobs.viewAsJson') }}</template>
                </BsButton>
              </div>
              <!-- TOOLBAR ICONS-->
              <div>
                <span class="ms-2" role="button" title="Copy ExtraVars" @click="clip(job.extravars, false, viewAsYaml)">
                  <font-awesome-icon icon="copy" class="text-primary" />
                </span>
              </div>
            </div>
            <div class="mt-4 p-3 card is-clipped-horizontal" v-if="!viewAsYaml">
              <VueJsonPretty :data="job.extravars" />
            </div>
            <div class="mt-4 p-3 card is-clipped-horizontal" v-else>
              <pre
                v-highlightjs
              ><code language="yaml" style="border:none;padding:0">{{ YAML.stringify(job.extravars) }}</code></pre>
            </div>
          </div>
          <!-- extra vars column -->
          <div v-if="showArtifacts && job.job_type == 'awx'" class="col is-clipped-horizontal">
            <h3>{{ t('jobs.artifacts') }}</h3>
            <div class="d-flex justify-content-between">
              <div>
                <BsButton
                  cssClass="btn-sm"
                  cssClassToggle="btn-sm"
                  :toggle="viewAsYaml"
                  @click="viewAsYaml = !viewAsYaml"
                >
                  <template #default>{{ t('jobs.viewAsYaml') }}</template>
                  <template #toggle>{{ t('jobs.viewAsJson') }}</template>
                </BsButton>
              </div>
              <!-- TOOLBAR ICONS-->
              <div>
                <span
                  class="ms-2"
                  role="button"
                  title="Copy Artifacts"
                  @click="clip(job.awx_artifacts, false, viewAsYaml)"
                >
                  <font-awesome-icon icon="copy" class="text-primary" />
                </span>
              </div>
            </div>
            <div class="mt-4 p-3 card is-clipped-horizontal" v-if="!viewAsYaml">
              <VueJsonPretty :data="job.awx_artifacts" />
            </div>
            <div class="mt-4 p-3 card is-clipped-horizontal" v-else>
              <pre
                v-highlightjs
              ><code language="yaml" style="border:none;padding:0">{{ YAML.stringify(job.awx_artifacts) }}</code></pre>
            </div>
          </div>
        </div>
        <!-- the list's pager : the rows shown, the page size and boxes, under the card as every
             table's -->
        <template #footer>
          <div v-if="!isJobPage" class="af-table-pager">
            <span class="af-table-count">{{ jobsRange }}</span>
            <BsPagination
              v-if="!isLoading"
              :dataList="parentJobs"
              :buttonsShown="7"
              :index="displayedJobIndex"
              name="jobs"
              @change="setDisplayJobs"
            />
          </div>
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped>
/* the output box keeps 16px under it for what follows it (the log file, the form page's
   buttons) ; last in the job's card it would double the card's own padding */
.af-job-output :deep(.ansible:last-child) {
  margin-bottom: 0;
}
/* a job's titles : the type and status badges sit on the middle of the words, and the
   buttons under the title look as far from it as from the output under them (mt-4) : the
   title's line box has room under its letters, so its margin is the smaller one */
.af-job-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.125rem;
  .badge {
    font-size: 0.5em;
  }
}
/* approve and reject on a job waiting for approval : in the light theme the app darkens
   green and red text (textColors.scss), which made these two icons heavy ; they keep
   Bootstrap's own, lighter colors */
[data-bs-theme='light'] .af-approve-icon {
  color: var(--bs-success) !important;
}
[data-bs-theme='light'] .af-reject-icon {
  color: var(--bs-danger) !important;
}
/* the "no jobs" message is a table row, but not a job : no row separator under it */
.af-empty-row td {
  border-bottom: 0 !important;
  box-shadow: none !important;
}
.is-clipped-horizontal {
  overflow-x: hidden;
}
/* Status badge in the ansible-output headings. Same rule as form.vue, which
       renders the identical markup — scoped styles don't cross components, so
       it has to be repeated here rather than shared. Limited to the badge : the
       table's header cells carry their column key as a class, and a bare .status
       shrank the "status" column header too. */
.badge.status {
  font-size: 0.75rem;
}
/* the jobs table : the shared look (styles/tables.scss), plus every cell on one line (the
   action icons side by side, a date not broken in two) */
.custom-table {
  line-height: 1.2;
  /* the table fits its frame : the short columns their own width (columnDefs), the form and
     the user share the rest */
  table-layout: fixed;
  width: 100%;
  /* the form and the user keep some room : on a screen too narrow for it the table scrolls
     sideways in its frame, rather than cutting them to a letter */
  min-width: 71rem;
}
/* (the frame hides its overflow for its rounded corners : this one scrolls it instead) */
.af-table-frame:has(> .custom-table) {
  overflow-x: auto;
}
.custom-table tbody td {
  white-space: nowrap;
}
/* nine columns : a little less room between them than the lists' (styles/tables.scss), the
   first and last cells keeping theirs from the frame's edges */
.custom-table.af-table th:not(:first-child):not(:last-child),
.custom-table.af-table td:not(:first-child):not(:last-child) {
  padding-left: 0.6rem;
  padding-right: 0.6rem;
}
/* a value longer than its column : cut with an ellipsis, its full text in the tooltip */
.custom-table tbody td:not(.bs-dt-row-actions),
.custom-table thead th {
  overflow: hidden;
  text-overflow: ellipsis;
}
.custom-table th.action {
  /* the row's three dots, as the other tables' */
  width: 3.5rem;
}
/* the checkbox column : as wide as a checkbox and the first cell's padding */
.custom-table .af-jobs-select {
  width: calc(1.25rem + 1rem + 0.5rem);
  padding-right: 0.5rem;
}

tr.table-selected {
  border: 2px solid;
  border-left: none;
  border-right: none;
  td {
    border-left: none;
    border-right: none;
  }
}
</style>
