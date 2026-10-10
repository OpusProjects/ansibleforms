/******************************************************************/
/*                                                                */
/*  The jobs list's addresses : every job at /jobs, the jobs of a */
/*  status at /jobs/<status> - /jobs/running, /jobs/approval ...  */
/*  A status is named in the address as a page would be : the     */
/*  jobs waiting for an approval are 'approval', not the status   */
/*  'approve' they hold.                                          */
/*                                                                */
/******************************************************************/

// the status of a job -> its name in the address
const SLUGS = {
  running: 'running',
  approve: 'approval',
  success: 'success',
  failed: 'failed',
  aborted: 'aborted',
};

// the names in the address, for the router's route (/jobs/:status(running|approval|...))
export const JOBS_STATUS_SLUGS = Object.values(SLUGS);

/**
 * The jobs list's address for a status.
 *
 * Args:
 *   status (string|null): the status (running, approve ...) ; none, every job.
 *
 * Returns:
 *   string: /jobs, or /jobs/<its name>.
 */
export function jobsPath(status) {
  return status && SLUGS[status] ? `/jobs/${SLUGS[status]}` : '/jobs';
}

/**
 * The status an address names.
 *
 * Args:
 *   slug (string): the name in the address (running, approval ...).
 *
 * Returns:
 *   string|null: the status (running, approve ...), or null for none.
 */
export function statusFromSlug(slug) {
  return Object.keys(SLUGS).find((status) => SLUGS[status] === slug) || null;
}

export default { jobsPath, statusFromSlug, JOBS_STATUS_SLUGS };
