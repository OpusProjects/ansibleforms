<script setup>
/******************************************************************/
/*                                                                */
/*  The jobs left menu                                            */
/*                                                                */
/*  Shown on the jobs list, the scheduled jobs and the stored     */
/*  jobs pages, so all three keep the same menu (the header's     */
/*  Jobs link covers them all).                                   */
/*                                                                */
/*  @props:                                                       */
/*      jobs: Array - the jobs list's own jobs, for the counts.   */
/*            Given, this is the jobs list's menu : a status      */
/*            filters the list in place (select). Left out, the   */
/*            menu loads the jobs for its counts once, and a      */
/*            status opens the jobs list on it.                   */
/*      status: String - the status the list is filtered on       */
/*                                                                */
/*  @emits:                                                       */
/*      select: a status was picked (null : every job)            */
/*                                                                */
/*  Every link carries the role option its page needs, the one    */
/*  its route's beforeEnter guard checks : the menu only shows    */
/*  what the router lets through (tests/sidebar-route-parity).    */
/*                                                                */
/******************************************************************/

import { useI18n } from 'vue-i18n';
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import TokenStorage from '@/lib/TokenStorage';
import { useAppStore } from '@/stores/app';

// PROPS

const props = defineProps({
  jobs: { type: Array, default: null },
  status: { type: String, default: null },
});
const emit = defineEmits(['select']);

// INIT

const { t } = useI18n();
const router = useRouter();
const store = useAppStore();

const can = (permission) => !!store.profile?.options?.[permission];

// DATA

// the jobs for the counts when the page is not the jobs list (scheduled, stored jobs)
const ownJobs = ref([]);

// the statuses of the menu, with their names and icons, in the same order and with the
// same icons as the jobs list's page titles (pages/jobs.vue). The labels are spelled out,
// not built from the status, so the i18n key check can find them.
const MENU_STATUSES = [
  { status: 'running', icon: 'play', label: () => t('jobs.menu.running') },
  { status: 'approve', icon: 'hourglass-half', label: () => t('jobs.menu.approve') },
  { status: 'success', icon: 'check', label: () => t('jobs.menu.success') },
  { status: 'failed', icon: 'xmark', label: () => t('jobs.menu.failed') },
  { status: 'aborted', icon: 'ban', label: () => t('jobs.menu.aborted') },
];

// COMPUTED

const isJobsList = computed(() => props.jobs !== null);

// on the jobs list a status filters in place ; elsewhere it opens the jobs list on it
function pick(status) {
  if (isJobsList.value) emit('select', status);
  else router.push({ path: '/jobs', query: status ? { status } : {} });
}

const sections = computed(() => {
  const sections = [];
  if (can('showJobs')) {
    const all = (props.jobs ?? ownJobs.value).filter((x) => !x.parent_id);
    const count = (status) => all.filter((x) => x.status === status).length;
    sections.push({
      title: t('jobs.menu.status'),
      items: [
        {
          title: t('jobs.menu.all'),
          icon: 'list',
          badge: all.length,
          active: isJobsList.value && !props.status,
          action: () => pick(null),
        },
        ...MENU_STATUSES.map((m) => ({
          title: m.label(),
          icon: m.icon,
          badge: count(m.status),
          // a job waiting for approval needs someone : its count is red, like the header badge
          badgeAlert: m.status === 'approve' && count(m.status) > 0,
          active: isJobsList.value && props.status === m.status,
          action: () => pick(m.status),
        })),
      ],
    });
  }
  // the jobs that run later : on a schedule, or saved to be submitted again
  const planned = [
    { title: t('sidebar.schedules'), icon: 'clock', link: '/jobs/schedules', permission: 'allowScheduledJobs' },
    { title: t('sidebar.storedJobs'), icon: 'floppy-disk', link: '/jobs/stored', permission: 'allowStoredJobs' },
  ].filter((i) => can(i.permission));
  if (planned.length) sections.push({ title: t('jobs.menu.planned'), items: planned });
  return sections;
});

// METHODS

async function loadCounts() {
  if (isJobsList.value || !can('showJobs')) return;
  try {
    const result = await axios.get('/api/v2/job?records=500', TokenStorage.getAuthentication());
    ownJobs.value = result.data?.records || [];
  } catch (err) {
    // the counts are a hint : without them the menu still works
    ownJobs.value = [];
  }
}

// MOUNT

onMounted(loadCounts);
</script>
<template>
  <BsSidebar :sections="sections" storageKey="af_jobs_sidebar_collapsed" />
</template>
