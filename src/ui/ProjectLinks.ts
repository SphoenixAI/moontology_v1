import { MOBILE } from '../runtime/deviceProfile';
import './projectLinks.css';

const githubIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.71 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15A10.8 10.8 0 0 1 12 6.16c.96 0 1.92.13 2.82.38 2.15-1.46 3.1-1.15 3.1-1.15.61 1.55.23 2.69.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.63 5.27-5.14 5.55.4.35.76 1.04.76 2.1v3.09c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z"/></svg>';

/** Presentation links are independent of the scene and robot-control lifecycle. */
export class ProjectLinks {
  private readonly nav = document.createElement('nav');
  private readonly dialog = document.createElement('dialog');
  private reader: { dispose(): void } | null = null;
  private disposed = false;
  private readonly onReaderChange: (open: boolean) => void;

  constructor(host: HTMLElement, onReaderChange: (open: boolean) => void) {
    this.onReaderChange = onReaderChange;
    this.nav.className = 'project-links glass-surface';
    this.nav.setAttribute('aria-label', 'Moontology project');
    this.nav.innerHTML = `<a href="https://github.com/SphoenixAI/moontology_v1" target="_blank" rel="noopener noreferrer" aria-label="Moontology on GitHub">${githubIcon}<span>GitHub</span></a><span class="project-links__divider" aria-hidden="true"></span><button type="button" class="project-links__book"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/></svg>View design book</button>`;
    this.dialog.className = 'design-book';
    this.dialog.setAttribute('aria-labelledby', 'design-book-title');
    this.dialog.innerHTML = `<header class="design-book__header"><div><span class="design-book__eyebrow">MOONTOLOGY / DESIGN ARCHIVE</span><h1 id="design-book-title">Design provenance</h1></div><div class="design-book__actions"><a href="/docs/moontology-design-provenance.pdf" download>Download PDF <span aria-hidden="true">↗</span></a><button type="button" aria-label="Close design book">✕</button></div></header><div class="design-book__reader"><p role="status">Opening design book…</p></div>`;
    host.append(this.nav, this.dialog);
    this.nav.querySelector('button')!.addEventListener('click', this.open);
    this.dialog.querySelector('button')!.addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('close', this.closed);
    this.dialog.addEventListener('keydown', event => event.stopPropagation());
  }

  private readonly open = async (): Promise<void> => {
    this.dialog.showModal();
    this.onReaderChange(true);
    if (this.reader) return;
    try {
      const { DesignBookReader } = await import('./DesignBookReader');
      if (this.disposed || this.reader || !this.dialog.open) return;
      this.reader = new DesignBookReader(this.dialog.querySelector('.design-book__reader')!);
    } catch {
      this.dialog.querySelector('.design-book__reader')!.innerHTML = '<p role="status">The reader could not open. Use Download PDF above to view the original book.</p>';
    }
  };

  private readonly closed = (): void => {
    this.onReaderChange(false);
    if (MOBILE) { this.reader?.dispose(); this.reader = null; }
    this.nav.querySelector('button')!.focus();
  };

  dispose(): void {
    this.disposed = true;
    this.reader?.dispose();
    this.dialog.removeEventListener('close', this.closed);
    this.nav.remove(); this.dialog.remove();
  }
}
