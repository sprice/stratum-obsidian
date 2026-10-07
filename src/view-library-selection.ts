import {
  createStratumDisclosure,
  createStratumSummary,
  createStratumButton,
} from "./ui-controls";
import type StratumPlugin from "./plugin";
import { getSelectedSearchLibrary } from "./plugin-libraries";
import { normalizeDoi } from "./doi";

function itemTypeLabel(value: string | null): string {
  if (!value) return "";
  const words = value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function renderSelectedLibraryPaper(
  plugin: StratumPlugin,
  container: HTMLElement,
  changeSelection: () => void,
): void {
  const selected = plugin.selectedLibraryResult;
  if (!selected) return;
  const library = getSelectedSearchLibrary(plugin);
  const existing = plugin.selectedLibraryNoteFile;
  const busy = Boolean(plugin.activeNoteActionKey);
  const syncing = plugin.isBulkLibrarySyncRunning();
  const section = container.createDiv({ cls: "stratum-selected-paper" });
  section.createEl("h3", {
    cls: "stratum-selected-title",
    text: selected.title,
  });
  section.createEl("p", {
    cls: "stratum-meta",
    text: [
      selected.creators.join(", "),
      selected.year,
      itemTypeLabel(selected.itemType),
    ]
      .filter(Boolean)
      .join(" · "),
  });
  const actions = section.createDiv({ cls: "stratum-actions" });
  const create = createStratumButton(actions, {
    primary: true,
    text: busy
      ? existing
        ? "Updating note…"
        : "Creating note…"
      : syncing
        ? "Sync in progress…"
        : existing
          ? "Update literature note"
          : "Create literature note",
  });
  create.disabled = busy || syncing;
  create.addEventListener("click", () => {
    void plugin.library.createNote(selected);
  });
  if (existing) {
    const open = createStratumButton(actions, {
      text: "Open note",
      className: "stratum-selected-open-note",
    });
    open.disabled = busy;
    open.addEventListener("click", () => {
      // Resolve again so renamed/deleted files cannot leave a stale navigation target.
      const file =
        library &&
        plugin.findExistingLiteratureNoteFile({
          libraryType: library.type,
          libraryId: library.id,
          itemKey: selected.key,
        });
      if (file && library)
        void plugin.app.workspace
          .getLeaf("tab")
          .openFile(file)
          .catch(() => {
            plugin.libraryNoteActionError = {
              key: selected.key,
              libraryIdentity: library.identity,
              message: "Could not open the literature note. Please try again.",
            };
            plugin.refreshViews();
          });
      else {
        plugin.selectedLibraryNoteFile = null;
        plugin.refreshViews();
      }
    });
    section.createEl("p", {
      cls: "stratum-meta stratum-selected-note",
      text: "Your own writing is preserved.",
    });
  }
  const error = plugin.libraryNoteActionError;
  if (
    error?.key === selected.key &&
    error.libraryIdentity === library?.identity
  ) {
    const feedback = section.createEl("p", {
      cls: "stratum-error",
      text: error.message,
    });
    feedback.setAttribute("role", "alert");
  }
  const change = createStratumButton(section, {
    text: "Change selection",
    className: "stratum-inline-action",
  });
  change.disabled = busy;
  change.addEventListener("click", changeSelection);
  if (selected.abstract) {
    const details = createStratumDisclosure(section, {
      cls: "stratum-selected-abstract",
    });
    details.open = plugin.isSelectedLibraryAbstractExpanded;
    createStratumSummary(details, { text: "Abstract" });
    details.createEl("p", { cls: "stratum-meta", text: selected.abstract });
    details.addEventListener("toggle", () => {
      if (
        details.isConnected &&
        plugin.selectedLibraryResult?.key === selected.key
      ) {
        plugin.isSelectedLibraryAbstractExpanded = details.open;
      }
    });
  }
  const doi = selected.doi && normalizeDoi(selected.doi);
  if (doi) {
    const metadata = section.createEl("p", {
      cls: "stratum-meta stratum-selected-doi",
    });
    metadata.createEl("a", {
      text: `DOI: ${doi}`,
      href: `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`,
    });
  }
}
