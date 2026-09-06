import assert from 'node:assert/strict';
import { mock } from 'node:test';
import console from 'node:console';
import { withDownloadTimeout } from '../src/assets/withDownloadTimeout.ts';

mock.timers.enable({ apis: ['setTimeout'] });
try {
  let progress, complete;
  const active = withDownloadTimeout(onProgress => {
    progress = onProgress;
    return new Promise(resolve => { complete = resolve; });
  }, 120000, 'Model stalled');
  mock.timers.tick(90000); progress({ loaded: 100 });
  mock.timers.tick(90000); progress({ loaded: 200 });
  mock.timers.tick(90000); complete('full-detail mesh');
  assert.equal(await active, 'full-detail mesh', 'An active download must survive the old two-minute deadline');

  const stalled = withDownloadTimeout(() => new Promise(() => {}), 120000, 'Model stalled');
  const rejection = assert.rejects(stalled, /no download progress for 120000ms/);
  mock.timers.tick(120001);
  await rejection;
  await assert.rejects(withDownloadTimeout(() => Promise.reject(new Error('HTTP 404')), 120000, 'Stalled'), /HTTP 404/);
  await assert.rejects(withDownloadTimeout(() => { throw new Error('Invalid URL'); }, 120000, 'Stalled'), /Invalid URL/);
  console.log('PASS: progressing downloads survive; stalled downloads and genuine loader errors still fail.');
} finally {
  mock.timers.reset();
}
