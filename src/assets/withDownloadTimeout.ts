/** A progressing full-detail download may take longer than its inactivity limit. */
export function withDownloadTimeout<T>(
  start: (onProgress: (event: ProgressEvent) => void) => Promise<T>,
  inactivityMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: number;
    let settled = false;
    const finish = (): void => {
      settled = true;
      globalThis.clearTimeout(timer);
    };
    const renew = (): void => {
      if (settled) return;
      globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(() => {
        finish();
        reject(new Error(`${message}: no download progress for ${inactivityMs}ms`));
      }, inactivityMs);
    };
    renew();
    try {
      start(renew).then(
        value => { finish(); resolve(value); },
        error => { finish(); reject(error); },
      );
    } catch (error) {
      finish(); reject(error);
    }
  });
}
