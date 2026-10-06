import { createStratumButton } from "./ui-controls";
import type { SourceRow } from "./document-sources";

export function sourceNeedsAttention(row: SourceRow): boolean {
  return Boolean(
    row.issue ||
    row.health?.problem ||
    (row.health?.identity && row.health.notes.length !== 1) ||
    row.health?.notes.some((note) => note.sourceUnavailable),
  );
}
/** Source problems are actionable separately from document style/syntax failures. */
export function renderSourceHealth(
  el: HTMLElement,
  row: SourceRow,
  options: {
    busy: boolean;
    error?: string;
    recover: () => void;
    repair: () => void;
    show: () => void;
  },
): void {
  if (!sourceNeedsAttention(row) && !options.error) return;
  const health = row.health;
  const issue = el.createDiv({ cls: "stratum-sources-health" });
  const problem = health?.problem ?? row.issue;
  issue.createDiv({
    cls: "stratum-sources-issue",
    text:
      problem === "unknown-key" || problem === "unresolved"
        ? "Citation key not found"
        : health?.identity && !health.problem && health.notes.length > 1
          ? "Multiple literature notes"
          : problem === "conflicting-key" || problem === "ambiguous"
            ? "Conflicting sources"
            : problem === "missing-data"
              ? "Citation data missing"
              : health?.notes.some((note) => note.sourceUnavailable)
                ? "Source unavailable in Zotero"
                : health?.notes && health.notes.length > 1
                  ? "Multiple literature notes"
                  : "Literature note missing",
  });
  const actions = issue.createDiv({ cls: "stratum-sources-health-actions" });
  const info = issue.createEl("details", {
    cls: "stratum-sources-health-details",
  });
  info.createEl("summary", { text: "Details" });
  const message = (text: string) =>
    info.createEl("p", { cls: "stratum-sources-issue", text });
  const action = (text: string, suffix: string, callback: () => void) => {
    const button = createStratumButton(actions, { text });
    button.type = "button";
    button.dataset.sourceAction = `${row.id}:${suffix}`;
    button.addEventListener("click", callback);
    return button;
  };
  if (health?.problem === "unknown-key")
    message(
      "Citation key not found. Check the key in your paper or import its source.",
    );
  if (health?.problem === "conflicting-key")
    message(
      "This key has conflicting source ownership. Formatting is paused until the conflict is resolved.",
    );
  if (health?.problem === "missing-data") {
    message(
      health.identity?.startsWith("file:")
        ? "This note has no verified Zotero identity. Sync its source before fetching citation data."
        : "Citation data is missing for this source.",
    );
    if (health.identity && /^(user|group)\//.test(health.identity)) {
      const button = action(
        options.busy
          ? "Fetching citation data…"
          : options.error
            ? "Retry fetching citation data"
            : "Fetch citation data",
        "fetch",
        options.recover,
      );
      button.disabled = options.busy;
    }
  }
  if (health?.identity && !health.notes.length)
    message(
      health.reference
        ? "Literature note missing. Cached data still formats this citation. Sync its library to restore the note."
        : "Literature note missing. Sync its library to restore the note.",
    );
  if (health?.identity && health.notes.length > 1)
    message(
      "Multiple literature notes refer to this source. Citation ownership is known; choose the intended note after reviewing the duplicates.",
    );
  if (health?.notes.some((note) => note.sourceUnavailable))
    message(
      "Sync previously marked this source unavailable in Zotero. Any cached citation data is retained.",
    );
  if (
    health &&
    (health.problem === "conflicting-key" || health.notes.length > 1)
  ) {
    const details = info.createEl("details");
    details.createEl("summary", { text: "Review matching sources" });
    const list = details.createEl("ul");
    for (const identity of health.candidates) {
      const notes = health.notes.filter(
        (note) => (note.identity || `file:${note.file.path}`) === identity,
      );
      if (identity.startsWith("ambiguous:")) {
        list.createEl("li", {
          text: "Duplicate definitions in stratum.bib. Review this file; no ownership changes have been made.",
        });
      } else if (notes.length) {
        for (const note of notes)
          list.createEl("li", {
            text: `${note.title} — ${note.file.path} (${identity})`,
          });
      } else
        list.createEl("li", { text: `${identity} — no literature note found` });
    }
    details.createEl("p", {
      text: "This review does not change citation keys or assign ownership.",
    });
  }
  if (!health && row.issue)
    message(
      {
        unresolved:
          "Citation key not found. Check the key or import its source.",
        ambiguous:
          "Multiple sources or notes match. Review the duplicate before opening it.",
        "missing-note":
          "Source recognized, but its literature note is missing. Sync its library to restore it.",
      }[row.issue],
    );
  if (
    health?.problem === "unknown-key" ||
    health?.problem === "conflicting-key"
  )
    action("Repair citation", "repair", options.repair);
  if (options.error) {
    message(options.error);
    info.open = true;
  }
  if (sourceNeedsAttention(row)) {
    action("Show citation in paper", "show-problem", options.show);
  }
}
