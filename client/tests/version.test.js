// When the "newer version" banner shows (lib/Version.js, issue #660).
//
// Every server response names its build (X-App-Build) and the bundle carries the client's own.
// They only differ in a tab opened before an upgrade - and a development build on either side
// has nothing to compare, so it must never raise the banner.
import { describe, test, expect } from 'vitest';
import { isNewerBuild, clientSha } from '@/lib/Version';

describe('isNewerBuild', () => {
  test('a server on another build than the tab : the tab is stale', () => {
    expect(isNewerBuild('a1b2c3d', '19dd138')).toBe(true);
  });

  test('the same build on both sides : nothing to report', () => {
    expect(isNewerBuild('19dd138', '19dd138')).toBe(false);
  });

  test('a development build on either side is never reported', () => {
    expect(isNewerBuild('dev', '19dd138')).toBe(false);
    expect(isNewerBuild('19dd138', 'dev')).toBe(false);
  });

  test('no header (a development server, or a response without it) : nothing to report', () => {
    expect(isNewerBuild(undefined, '19dd138')).toBe(false);
    expect(isNewerBuild('', '19dd138')).toBe(false);
  });
});

describe('clientSha', () => {
  test("is 'dev' when the bundle was not built with a build identity", () => {
    expect(clientSha()).toBe('dev');
  });
});
