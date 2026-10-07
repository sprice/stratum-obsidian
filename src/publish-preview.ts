import {
  createStratumIconButton,
  createStratumInput,
  createStratumSelectElement,
} from "./ui-controls";
import {
  ItemView,
  loadPdfJs,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import type { PublishController } from "./publish-controller";
import { VIEW_TYPE_PUBLISH_PREVIEW } from "./publish-model";

interface Viewport {
  width: number;
  height: number;
  scale: number;
  userUnit?: number;
}
interface RenderTask {
  promise: Promise<void>;
  cancel(): void;
}
interface PdfPage {
  getViewport(options: { scale: number }): Viewport;
  getTextContent(): Promise<unknown>;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: Viewport;
    transform: number[];
  }): RenderTask;
}
interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
}
interface LoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}
interface TextLayer {
  render(): Promise<void>;
  cancel(): void;
}
interface PdfLibrary {
  getDocument(options: {
    data: Uint8Array;
    isEvalSupported: boolean;
  }): LoadingTask;
  TextLayer: new (options: {
    textContentSource: unknown;
    container: HTMLElement;
    viewport: Viewport;
  }) => TextLayer;
}

/** A normal workspace tab backed by publication bytes, not a synthetic TFile. */
export class PublishPreviewView extends ItemView {
  private documentId = "";
  private filename = "PDF preview";
  private page = 1;
  private zoom = "fit";
  private ready = false;
  private currentId: string | null = null;
  private loadRevision = 0;
  private renderRevision = 0;
  private task: LoadingTask | null = null;
  private pdf: PdfDocument | null = null;
  private library: PdfLibrary | null = null;
  private rendering: RenderTask | null = null;
  private textLayer: TextLayer | null = null;
  private unsubscribe: (() => void) | null = null;
  private observer: ResizeObserver | null = null;
  private resizeTimer: number | null = null;
  private scroller!: HTMLElement;
  private status!: HTMLElement;
  private pageInput!: HTMLInputElement;
  private pageCount!: HTMLElement;
  private previous!: HTMLButtonElement;
  private next!: HTMLButtonElement;
  private zoomSelect!: HTMLSelectElement;
  constructor(
    leaf: WorkspaceLeaf,
    private publish: PublishController,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_TYPE_PUBLISH_PREVIEW;
  }
  getDisplayText(): string {
    return this.filename;
  }
  getIcon(): string {
    return "file-text";
  }
  getState(): Record<string, unknown> {
    return { documentId: this.documentId, page: this.page, zoom: this.zoom };
  }
  async setState(
    state: Record<string, unknown>,
    result: ViewStateResult,
  ): Promise<void> {
    this.documentId =
      typeof state.documentId === "string" ? state.documentId : "";
    this.page =
      typeof state.page === "number" && Number.isFinite(state.page)
        ? Math.max(1, Math.floor(state.page))
        : 1;
    this.zoom = ["fit", "1", "1.25", "1.5", "2"].includes(String(state.zoom))
      ? String(state.zoom)
      : "fit";
    if (this.ready) {
      this.zoomSelect.value = this.zoom;
      this.syncDocument();
      if (this.pdf) void this.renderPage();
    }
    await super.setState(state, result);
  }
  onOpen(): Promise<void> {
    this.ready = true;
    this.contentEl.addClass("stratum-pdf-preview");
    const toolbar = this.contentEl.createDiv({
      cls: "stratum-pdf-toolbar",
      attr: { "aria-label": "PDF controls" },
    });
    const button = (icon: string, label: string, action: () => void) => {
      const element = createStratumIconButton(toolbar, {
        icon,
        ariaLabel: label,
      });
      element.addEventListener("click", action);
      return element;
    };
    this.previous = button("chevron-left", "Previous page", () =>
      this.changePage(this.page - 1),
    );
    this.pageInput = createStratumInput(toolbar, {
      type: "number",
      attr: { min: "1", "aria-label": "Page number" },
    });
    this.pageInput.addEventListener("change", () =>
      this.changePage(Number(this.pageInput.value)),
    );
    this.pageCount = toolbar.createSpan();
    this.next = button("chevron-right", "Next page", () =>
      this.changePage(this.page + 1),
    );
    this.zoomSelect = createStratumSelectElement(toolbar, {
      attr: { "aria-label": "Zoom" },
    });
    for (const [value, text] of [
      ["fit", "Fit width"],
      ["1", "100%"],
      ["1.25", "125%"],
      ["1.5", "150%"],
      ["2", "200%"],
    ])
      this.zoomSelect.createEl("option", { value, text });
    this.zoomSelect.value = this.zoom;
    this.zoomSelect.addEventListener("change", () => {
      this.zoom = this.zoomSelect.value;
      this.saveState();
      void this.renderPage();
    });
    this.status = this.contentEl.createDiv({
      cls: "stratum-pdf-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.scroller = this.contentEl.createDiv({ cls: "stratum-pdf-pages" });
    let width = 0;
    this.observer = new ResizeObserver(() => {
      if (width === this.scroller.clientWidth) return;
      width = this.scroller.clientWidth;
      if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        this.resizeTimer = null;
        if (this.zoom === "fit") void this.renderPage();
      }, 100);
    });
    this.observer.observe(this.scroller);
    this.unsubscribe = this.publish.subscribe(() => this.syncDocument());
    this.syncDocument();
    return Promise.resolve();
  }
  private syncDocument(): void {
    if (!this.ready || !this.publish.catalog) return;
    const document = this.publish.catalog.documents.find(
      (entry) => entry.id === this.documentId && entry.format === "pdf",
    );
    if (!document) {
      this.currentId = null;
      this.release();
      this.scroller.empty();
      this.status.setText("This published document is no longer available.");
      this.updateControls();
      return;
    }
    if (this.currentId === document.id) return;
    this.currentId = document.id;
    this.filename = document.filename;
    this.app.workspace.requestSaveLayout();
    this.release();
    const revision = this.loadRevision;
    this.scroller.empty();
    this.status.setText("Loading PDF…");
    this.updateControls();
    void (async () => {
      const bytes = await this.app.vault.adapter.readBinary(
        this.publish.store.path(document),
      );
      const library = (await loadPdfJs()) as PdfLibrary;
      if (!this.ready || revision !== this.loadRevision) return;
      this.library = library;
      const task = (this.task = library.getDocument({
        data: new Uint8Array(bytes),
        isEvalSupported: false,
      }));
      const pdf = await task.promise;
      if (!this.ready || revision !== this.loadRevision) return;
      this.pdf = pdf;
      this.page = Math.min(this.page, pdf.numPages);
      await this.renderPage();
    })().catch(() => {
      if (this.ready && revision === this.loadRevision)
        this.status.setText(
          "Could not load this PDF. The file may be missing or damaged. Close this tab and try again.",
        );
    });
  }
  private saveState(): void {
    this.app.workspace.requestSaveLayout();
  }
  private changePage(page: number): void {
    if (!this.pdf) return;
    this.page = Number.isFinite(page)
      ? Math.max(1, Math.min(this.pdf.numPages, Math.floor(page)))
      : this.page;
    this.saveState();
    this.scroller.scrollTop = 0;
    void this.renderPage();
  }
  private updateControls(): void {
    this.pageInput.value = String(this.page);
    this.pageInput.max = String(this.pdf?.numPages ?? 1);
    this.pageCount.setText(this.pdf ? `of ${this.pdf.numPages}` : "");
    this.pageInput.disabled = this.zoomSelect.disabled = !this.pdf;
    this.previous.disabled = !this.pdf || this.page <= 1;
    this.next.disabled = !this.pdf || this.page >= this.pdf.numPages;
  }
  private async renderPage(): Promise<void> {
    if (!this.ready || !this.pdf || !this.library) return;
    const revision = ++this.renderRevision;
    this.rendering?.cancel();
    this.textLayer?.cancel();
    this.rendering = null;
    this.textLayer = null;
    this.updateControls();
    this.status.setText(`Page ${this.page} of ${this.pdf.numPages}`);
    try {
      const page = await this.pdf.getPage(this.page);
      if (revision !== this.renderRevision) return;
      const natural = page.getViewport({ scale: 1 });
      const scale =
        this.zoom === "fit"
          ? Math.max(150, this.scroller.clientWidth - 32) / natural.width
          : (Number(this.zoom) * 96) / 72;
      const viewport = page.getViewport({ scale });
      const sheet = createDiv({ cls: "stratum-pdf-page" });
      sheet.setCssProps({
        "--pdf-width": `${viewport.width}px`,
        "--pdf-height": `${viewport.height}px`,
        "--scale-factor": String(scale),
        "--total-scale-factor": String(scale * (viewport.userUnit ?? 1)),
        "--scale-round-x": "1px",
        "--scale-round-y": "1px",
      });
      const canvas = sheet.createEl("canvas", {
        attr: { "aria-label": `Page ${this.page}` },
      });
      const ratio = Math.min(this.contentEl.win.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      this.scroller.replaceChildren(sheet);
      const task = (this.rendering = page.render({
        canvasContext: context,
        viewport,
        transform: [ratio, 0, 0, ratio, 0, 0],
      }));
      await task.promise;
      if (revision !== this.renderRevision) return;
      const text = await page.getTextContent();
      if (revision !== this.renderRevision) return;
      const layer = (this.textLayer = new this.library.TextLayer({
        textContentSource: text,
        viewport,
        container: sheet.createDiv({ cls: "textLayer" }),
      }));
      await layer.render();
    } catch {
      if (revision === this.renderRevision)
        this.status.setText(
          "Could not display this page. Try another page or reopen the preview.",
        );
    }
  }
  private release(): void {
    this.loadRevision++;
    this.renderRevision++;
    this.rendering?.cancel();
    this.textLayer?.cancel();
    this.rendering = null;
    this.textLayer = null;
    if (this.task) void this.task.destroy().catch(() => {});
    this.task = null;
    this.pdf = null;
  }
  onClose(): Promise<void> {
    this.ready = false;
    this.currentId = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.observer?.disconnect();
    if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
    this.release();
    this.contentEl.empty();
    return Promise.resolve();
  }
}
