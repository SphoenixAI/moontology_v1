import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export class DesignBookReader {
  private readonly host: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly label: HTMLElement;
  private readonly status: HTMLElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly zoomOut: HTMLButtonElement;
  private readonly zoomIn: HTMLButtonElement;
  private readonly fit: HTMLButtonElement;
  private readonly loading = getDocument({ url: '/docs/moontology-design-provenance.pdf' });
  private readonly resize: ResizeObserver;
  private pdf: PDFDocumentProxy | null = null;
  private renderTask: RenderTask | null = null;
  private page = 1;
  private zoom = 1;
  private generation = 0;
  private disposed = false;

  constructor(host: HTMLElement) {
    this.host = host;
    host.innerHTML = `<div class="design-book__viewport"><canvas role="img" aria-label="Design book page 1"></canvas><p class="design-book__status" role="status">Loading the original PDF…</p></div><footer class="design-book__toolbar"><div><button type="button" data-action="previous" aria-label="Previous page">←</button><span class="design-book__page" aria-live="polite">01 / —</span><button type="button" data-action="next" aria-label="Next page">→</button></div><span class="design-book__hint">Reference · Decision · Rationale</span><div><button type="button" data-action="out" aria-label="Zoom out">−</button><button type="button" data-action="fit" aria-label="Fit page width">Fit</button><button type="button" data-action="in" aria-label="Zoom in">+</button></div></footer>`;
    this.viewport = host.querySelector('.design-book__viewport')!;
    this.canvas = host.querySelector('canvas')!;
    this.label = host.querySelector('.design-book__page')!;
    this.status = host.querySelector('.design-book__status')!;
    this.previous = host.querySelector('[data-action="previous"]')!;
    this.next = host.querySelector('[data-action="next"]')!;
    this.zoomOut = host.querySelector('[data-action="out"]')!;
    this.zoomIn = host.querySelector('[data-action="in"]')!;
    this.fit = host.querySelector('[data-action="fit"]')!;
    this.previous.onclick = () => this.changePage(-1);
    this.next.onclick = () => this.changePage(1);
    this.zoomOut.onclick = () => this.changeZoom(-.25);
    this.zoomIn.onclick = () => this.changeZoom(.25);
    this.fit.onclick = () => { this.zoom = 1; void this.render(); };
    this.resize = new ResizeObserver(() => { if (this.viewport.clientWidth) void this.render(); });
    this.resize.observe(this.viewport);
    this.updateControls();
    void this.loading.promise.then(pdf => {
      if (this.disposed) return;
      this.pdf = pdf; void this.render();
    }).catch(() => {
      if (!this.disposed) this.status.textContent = 'Unable to load the book. Download the PDF using the link above.';
    });
  }

  private changePage(delta: number): void {
    if (!this.pdf) return;
    this.page = Math.max(1, Math.min(this.pdf.numPages, this.page + delta));
    this.viewport.scrollTo(0, 0); void this.render();
  }
  private changeZoom(delta: number): void {
    this.zoom = Math.max(.5, Math.min(2, this.zoom + delta)); void this.render();
  }
  private updateControls(): void {
    this.previous.disabled = !this.pdf || this.page <= 1;
    this.next.disabled = !this.pdf || this.page >= this.pdf.numPages;
    this.zoomOut.disabled = !this.pdf || this.zoom <= .5;
    this.zoomIn.disabled = !this.pdf || this.zoom >= 2;
    this.fit.disabled = !this.pdf;
    this.label.textContent = `${String(this.page).padStart(2, '0')} / ${this.pdf ? String(this.pdf.numPages).padStart(2, '0') : '—'}`;
  }
  private async render(): Promise<void> {
    if (!this.pdf || this.disposed || !this.viewport.clientWidth) return;
    const generation = ++this.generation;
    const prior = this.renderTask;
    prior?.cancel();
    if (prior) await prior.promise.catch(() => {});
    this.updateControls();
    try {
      const page = await this.pdf.getPage(this.page);
      if (this.disposed || generation !== this.generation) return;
      const base = page.getViewport({ scale: 1 });
      const width = Math.max(200, this.viewport.clientWidth - 40);
      const viewport = page.getViewport({ scale: width / base.width * this.zoom });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.floor(viewport.width * ratio);
      this.canvas.height = Math.floor(viewport.height * ratio);
      this.canvas.style.width = `${viewport.width}px`;
      this.canvas.style.height = `${viewport.height}px`;
      this.canvas.setAttribute('aria-label', `Moontology design book, page ${this.page} of ${this.pdf.numPages}. Full document available from Download PDF.`);
      this.renderTask = page.render({ canvas: this.canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await this.renderTask.promise;
      if (generation === this.generation) this.status.hidden = true;
    } catch (error) {
      if (!this.disposed && generation === this.generation && !(error instanceof Error && error.name === 'RenderingCancelledException')) {
        this.status.hidden = false;
        this.status.textContent = 'This page could not render. Download the original PDF above.';
      }
    }
  }
  dispose(): void {
    this.disposed = true; this.generation++;
    this.resize.disconnect(); this.renderTask?.cancel();
    void this.loading.destroy(); this.host.replaceChildren();
  }
}
