/** Decide before any map or mesh download. Narrow desktop windows retain full detail. */
export function isMobileDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}
export const MOBILE = typeof navigator !== 'undefined' &&
  (isMobileDevice(navigator.userAgent, navigator.maxTouchPoints) ||
    (typeof location !== 'undefined' && new URLSearchParams(location.search).get('quality') === 'mobile'));
export const mobileBudget = { pixelRatio: 1, fps: 30, renderSplats: 250_000, pagedSplats: 16 * 65536 } as const;
