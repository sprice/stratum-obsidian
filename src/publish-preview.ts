import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type { PublishController } from "./publish-controller";
import { VIEW_TYPE_PUBLISH_PREVIEW } from "./publish-model";

/** Restore tabs saved by older versions into Obsidian's native PDF viewer. */
export class PublishPreviewView extends ItemView {
  private documentId = "";
  private restoreRevision = 0;
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
    return "PDF";
  }
  getIcon(): string {
    return "file-text";
  }
  getState(): Record<string, unknown> {
    return { documentId: this.documentId };
  }
  async setState(
    state: { documentId?: string },
    result: ViewStateResult,
  ): Promise<void> {
    const revision = ++this.restoreRevision;
    const isCurrent = () =>
      revision === this.restoreRevision && this.leaf.view === this;
    this.documentId = state.documentId ?? "";
    await super.setState(state, result);
    try {
      const catalog = await this.publish.store.list();
      if (!isCurrent()) return;
      const doc = catalog.documents.find(
        (entry) => entry.id === this.documentId,
      );
      const file = doc ? this.publish.pdfFile(doc) : null;
      if (!file) {
        this.contentEl.setText(
          "This PDF is unavailable. Open the documents list to manage it.",
        );
        return;
      }
      await this.leaf.openFile(file);
    } catch (error) {
      if (!isCurrent()) return;
      this.contentEl.setText(
        "The PDF could not be opened. Open the documents list to try again.",
      );
      this.publish.fail(error);
    }
  }
}
