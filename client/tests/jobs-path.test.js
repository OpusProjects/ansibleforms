import { describe, it, expect } from 'vitest';
import { jobsPath, statusFromSlug, JOBS_STATUS_SLUGS } from '../src/lib/jobsPath.js';

describe('jobsPath', () => {
  it('names a status in the address as a page', () => {
    expect(jobsPath(null)).toBe('/jobs');
    expect(jobsPath('running')).toBe('/jobs/running');
    expect(jobsPath('approve')).toBe('/jobs/approval');
    expect(jobsPath('nonsense')).toBe('/jobs');
  });

  it('reads the status back from the address', () => {
    expect(statusFromSlug('approval')).toBe('approve');
    expect(statusFromSlug('failed')).toBe('failed');
    expect(statusFromSlug('73')).toBe(null);
    expect(statusFromSlug(undefined)).toBe(null);
  });

  it('has a name for every status, none a number', () => {
    expect(JOBS_STATUS_SLUGS).toEqual(['running', 'approval', 'success', 'failed', 'aborted']);
    for (const slug of JOBS_STATUS_SLUGS) expect(jobsPath(statusFromSlug(slug))).toBe(`/jobs/${slug}`);
  });
});
