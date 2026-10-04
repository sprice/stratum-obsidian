import { selectStratumTab } from "./plugin-tabs";
import { nativeFootnoteReference } from "./citation-footnotes";
import {
  Component,
  MarkdownRenderChild,
  TFile,
  type MarkdownPostProcessorContext,
} from "obsidian";
import type { CitationService } from "./citation-service";
import {
  citationDisplayEdits,
  citationScope,
  noteId,
} from "./citation-display";
import { parseSourceOccurrences } from "./source-occurrences";
import { citationFooter, readingFooterLine } from "./citation-footer";
import { renderCsl, renderDocumentNotes } from "./citation-render";
/** Reading view can render blocks out of order. All blocks use a full-document result. */
export function registerCitationReading(service: CitationService): void {
  const children = new WeakMap<HTMLElement, ReadingCitations>();
  service.plugin.registerMarkdownPostProcessor((el, ctx) => {
    if (el.closest(".stratum-reference-output")) return;
    children.get(el)?.unload();
    const child = new ReadingCitations(el, ctx, service);
    children.set(el, child);
    ctx.addChild(child);
    return child.ready;
  });
}
class ReadingCitations extends MarkdownRenderChild {
  ready: Promise<void> = Promise.resolve();
  private generation = 0;
  private active = false;
  private undo: (() => void)[] = [];
  private restore(): void {
    for (const undo of this.undo.reverse()) undo();
    this.undo = [];
    this.containerEl.normalize();
    this.containerEl.removeAttribute("data-stratum-citation-error");
  }
  constructor(
    el: HTMLElement,
    private ctx: MarkdownPostProcessorContext,
    private service: CitationService,
  ) {
    super(el);
  }
  onload(): void {
    this.active = true;
    this.register(
      this.service.subscribe((path) => {
        if (!path || path === this.ctx.sourcePath) void this.render();
      }),
    );
    this.ready = this.render();
  }
  onunload(): void {
    this.active = false;
    this.generation++;
    this.restore();
  }
  private async render(): Promise<void> {
    const generation = ++this.generation;
    // Obsidian also runs Markdown postprocessors for rendered editor blocks
    // (tables, callouts, embeds). Publication output must never enter that view.
    if (this.containerEl.closest(".markdown-source-view, .cm-editor")) {
      this.restore();
      return;
    }
    const info = this.ctx.getSectionInfo(this.containerEl);
    const file = this.service.plugin.app.vault.getAbstractFileByPath(
      this.ctx.sourcePath,
    );
    if (!(file instanceof TFile) || !info) {
      this.restore();
      return;
    }
    const text = info.text;
    const hasCitations =
      (await this.service.hasCitationIntent?.(text)) ??
      parseSourceOccurrences(text).some(
        (occurrence) => occurrence.kind === "citation",
      );
    if (generation !== this.generation || !this.active) return;
    if (!hasCitations) {
      this.restore();
      return;
    }
    try {
      const result = await this.service.format(text, file.path);
      if (generation !== this.generation || !this.active) return;
      // A detached block can be mounted inside the editor while formatting awaits.
      if (this.containerEl.closest(".markdown-source-view, .cm-editor")) {
        this.restore();
        return;
      }
      this.restore();
      if (!result.model.citations.length && !result.model.problems.length)
        return;
      const scope = citationScope(this.containerEl, file.path);
      const lines = text.split("\n");
      const from = lines
        .slice(0, info.lineStart)
        .reduce((sum, line) => sum + line.length + 1, 0);
      const to = lines
        .slice(0, info.lineEnd + 1)
        .reduce((sum, line) => sum + line.length + 1, 0);
      for (const edit of citationDisplayEdits(text, scope, result).filter(
        (edit) => edit.from >= from && edit.to <= to,
      )) {
        const needle = text.slice(edit.from, edit.to);
        const walker = this.containerEl.ownerDocument.createTreeWalker(
          this.containerEl,
          NodeFilter.SHOW_TEXT,
        );
        const nodes: Text[] = [];
        let node;
        while ((node = walker.nextNode()))
          if (
            !node.parentElement?.closest(
              "code,pre,a,.stratum-formatted-citation",
            )
          )
            nodes.push(node as Text);
        for (const textNode of nodes) {
          const index = textNode.data.indexOf(needle);
          if (index < 0) continue;
          const range = this.containerEl.ownerDocument.createRange();
          range.setStart(textNode, index);
          range.setEnd(textNode, index + needle.length);
          const span = createSpan();
          span.className = "stratum-formatted-citation";
          span.title = text.slice(edit.from, edit.to);
          renderCsl(span, edit.html);
          const citation = result.model.citations.find(
            (c) => c.from >= edit.from && c.to <= edit.to,
          );
          if (citation) {
            const button = span.createEl("button", {
              text: "↗",
              cls: "stratum-citation-evidence",
              attr: {
                "aria-label": "Open cited source in reader",
                title: "Open cited source in reader",
              },
            });
            button.type = "button";
            button.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              void import("./citation-evidence").then(
                ({ openCitationEvidence }) =>
                  openCitationEvidence(
                    this.service.plugin,
                    citation.draft.items.map((item) => item.key),
                    file.path,
                    text,
                  ),
              );
            });
          }
          range.deleteContents();
          range.insertNode(span);
          this.undo.push(() => span.replaceWith(needle));
          break;
        }
      }
      if (result.noteStyle)
        for (const ref of Array.from(
          this.containerEl.querySelectorAll<HTMLElement>(".footnote-ref"),
        )) {
          const link = ref.matches("a") ? ref : ref.querySelector("a");
          if (!link) continue;
          const { note, referenceIndex } = nativeFootnoteReference(
            link,
            result.model,
          );
          {
            const children = Array.from(link.childNodes);
            const href = link.getAttribute("href");
            const id = link.getAttribute("id");
            this.undo.push(() => {
              link.replaceChildren(...children);
              if (id === null) link.removeAttribute("id");
              else link.setAttribute("id", id);
              if (href === null) link.removeAttribute("href");
              else link.setAttribute("href", href);
            });
            const refId = `${noteId(scope, note.number)}-ref-${referenceIndex}`;
            const originalTarget = ref.getAttribute("data-footnote-id");
            this.undo.push(() => {
              if (originalTarget === null)
                ref.removeAttribute("data-footnote-id");
              else ref.setAttribute("data-footnote-id", originalTarget);
            });
            ref.setAttribute("data-footnote-id", refId);
            link.id = refId;
            link.textContent = String(note.number);
            link.setAttribute("href", `#${noteId(scope, note.number)}`);
          }
        }
      for (const target of this.bibliographyTargets()) {
        const output = target.createDiv({ cls: "stratum-reference-output" });
        this.undo.push(() => output.remove());
        renderCsl(output, result.bibliography);
      }
      const footnotes = this.containerEl.matches(".footnotes")
        ? this.containerEl
        : this.containerEl.querySelector<HTMLElement>(".footnotes");
      if (footnotes && result.noteStyle) {
        const wasHidden = footnotes.hidden;
        footnotes.hidden = true;
        this.undo.push(() => {
          footnotes.hidden = wasHidden;
        });
      }
      const footer = citationFooter(text, result);
      if (info.lineStart <= footer.line && info.lineEnd >= footer.line) {
        const output = (footnotes?.parentElement ?? this.containerEl).createDiv(
          {
            cls: "stratum-reference-output",
          },
        );
        this.undo.push(() => output.remove());
        const owner = this.addChild(new Component());
        this.undo.push(() => this.removeChild(owner));
        if (result.noteStyle)
          await renderDocumentNotes(
            output,
            text,
            file.path,
            result,
            this.service,
            owner,
            scope,
          );
        if (generation !== this.generation || !this.active) return;
        if (result.model.problems.length)
          output.createEl("p", {
            text: "Some references could not be formatted. Review sources for details.",
          });
        if (footer.bibliography) {
          output.createEl("h2", { text: footer.heading });
          renderCsl(output, footer.bibliography);
        }
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.restore();
      this.containerEl.setAttribute(
        "data-stratum-citation-error",
        error instanceof Error ? error.message : "Citation formatting failed.",
      );
      const targets = this.bibliographyTargets();
      const lastLine = readingFooterLine(text);
      if (
        !targets.length &&
        info.lineStart <= lastLine &&
        info.lineEnd >= lastLine &&
        parseSourceOccurrences(text).some(
          (occurrence) => occurrence.kind === "citation",
        )
      )
        targets.push(this.containerEl);
      for (const target of targets) {
        const error = target.createDiv({
          cls: "stratum-reference-output",
          text: "References unavailable. Refresh citation data or check sources.",
        });
        const button = error.createEl("button", { text: "Review sources" });
        button.type = "button";
        button.addEventListener("click", () => {
          if (!selectStratumTab(this.service.plugin, "sources")) return;
          this.service.plugin.sources.showCurrent();
          void this.service.plugin.activateView();
        });
        this.undo.push(() => error.remove());
      }
    }
  }
  private bibliographyTargets(): HTMLElement[] {
    return this.containerEl.matches('[id="refs"]')
      ? [this.containerEl]
      : Array.from(
          this.containerEl.querySelectorAll<HTMLElement>('[id="refs"]'),
        );
  }
}
