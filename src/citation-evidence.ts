import { selectStratumTab } from "./plugin-tabs";
import {
  MarkdownView,
  Notice,
  SuggestModal,
  type WorkspaceLeaf,
  type Editor,
} from "obsidian";
import type StratumPlugin from "./plugin";
import type { LiteratureNoteEntry } from "./library-search-modal";

interface WritingPosition {
  leaf: WorkspaceLeaf;
  view: MarkdownView;
  text: string;
  state: Record<string, unknown>;
  mode: string;
  selections?: ReturnType<Editor["listSelections"]>;
  scroll?: ReturnType<Editor["getScrollInfo"]>;
}
const positions = new WeakMap<StratumPlugin, WritingPosition>();
const registered = new WeakSet<StratumPlugin>();
const requests = new WeakMap<StratumPlugin, object>();
const pickers = new WeakMap<StratumPlugin, Set<{ close(): void }>>();
function registerEvidence(plugin: StratumPlugin): Set<{ close(): void }> {
  let active = pickers.get(plugin);
  if (!active) {
    active = new Set();
    pickers.set(plugin, active);
  }
  if (!registered.has(plugin)) {
    registered.add(plugin);
    const tracked = active;
    plugin.register(() => {
      positions.delete(plugin);
      requests.delete(plugin);
      for (const picker of tracked) picker.close();
      tracked.clear();
    });
  }
  return active;
}
export function hasWritingPosition(plugin: StratumPlugin): boolean {
  return positions.has(plugin);
}
export async function returnToWriting(plugin: StratumPlugin): Promise<void> {
  const saved = positions.get(plugin);
  if (!saved) return;
  const workspace = plugin.app.workspace;
  if (
    !workspace.getLeavesOfType("markdown").includes(saved.leaf) ||
    saved.leaf.view !== saved.view ||
    saved.view.file?.path !== saved.state.file
  ) {
    positions.delete(plugin);
    new Notice(
      "The writing tab was closed or changed. Open your paper to continue.",
    );
    plugin.refreshViews();
    return;
  }
  await workspace.revealLeaf(saved.leaf);
  if (
    plugin.isUnloaded ||
    saved.leaf.view !== saved.view ||
    saved.view.file?.path !== saved.state.file ||
    !workspace.getLeavesOfType("markdown").includes(saved.leaf)
  )
    return;
  if (saved.view.getMode() === "source") {
    const editor = saved.view.editor;
    if (
      saved.mode === "source" &&
      editor.getValue() === saved.text &&
      saved.selections
    ) {
      editor.setSelections(saved.selections);
      if (saved.scroll) editor.scrollTo(saved.scroll.left, saved.scroll.top);
    }
    editor.focus();
  } else if (
    saved.mode === "preview" &&
    (await plugin.app.vault.cachedRead(saved.view.file!)) === saved.text &&
    !plugin.isUnloaded &&
    workspace.getLeavesOfType("markdown").includes(saved.leaf) &&
    saved.leaf.view === saved.view &&
    saved.view.file?.path === saved.state.file &&
    saved.view.getMode() === "preview"
  )
    saved.view.setEphemeralState(saved.state);
}

/** Keep navigation separate from formatting and never guess between identities. */
export async function openCitationEvidence(
  plugin: StratumPlugin,
  keys: string[],
  path: string,
  text: string,
): Promise<void> {
  try {
    if (plugin.isUnloaded) return;
    const request = {};
    requests.set(plugin, request);
    const activePickers = registerEvidence(plugin);
    for (const picker of activePickers) picker.close();
    activePickers.clear();
    const workspace = plugin.app.workspace;
    const leaf = workspace.getMostRecentLeaf(workspace.rootSplit);
    if (
      !(leaf?.view instanceof MarkdownView) ||
      leaf.view.file?.path !== path
    ) {
      new Notice("Open the cited paper in a main tab to inspect its sources.");
      return;
    }
    const view = leaf.view;
    const current = async () => {
      const value =
        view.getMode() === "source"
          ? view.editor.getValue()
          : view.file
            ? await plugin.app.vault.cachedRead(view.file)
            : null;
      return (
        !plugin.isUnloaded &&
        requests.get(plugin) === request &&
        workspace.getMostRecentLeaf(workspace.rootSplit) === leaf &&
        workspace.getLeavesOfType("markdown").includes(leaf) &&
        leaf.view === view &&
        view.file?.path === path &&
        value === text
      );
    };
    if (!(await current())) {
      new Notice("The paper changed. Select the citation again.");
      return;
    }
    const saved: WritingPosition = {
      leaf,
      view,
      text,
      state: { ...view.getEphemeralState(), file: path },
      mode: view.getMode(),
      ...(view.getMode() === "source"
        ? {
            selections: view.editor.listSelections(),
            scroll: view.editor.getScrollInfo(),
          }
        : {}),
    };
    const resolutions = await plugin.citations.diagnose([...new Set(keys)]);
    type Choice = { key: string; entry?: LiteratureNoteEntry; label: string };
    const choices = resolutions.flatMap<Choice>((resolution) => {
      if (!resolution.identity || !resolution.notes.length)
        return [
          {
            key: resolution.key,
            entry: undefined,
            label: `@${resolution.key} — review in Citations`,
          },
        ];
      return resolution.notes.map((entry) => ({
        key: resolution.key,
        entry,
        label: `${entry.title} — ${entry.authors.join(", ") || "Unknown author"} — @${resolution.key}${resolution.notes.length > 1 ? ` — ${entry.file.path}` : ""}`,
      }));
    });
    const open = async (choice: Choice) => {
      if (!(await current())) {
        new Notice("The paper changed. Select the citation again.");
        return;
      }
      const [latest] = await plugin.citations.diagnose([choice.key]);
      if (!(await current())) return;
      if (
        !choice.entry ||
        latest.identity !== choice.entry.identity ||
        !latest.notes.some((note) => note.file === choice.entry!.file)
      ) {
        if (!selectStratumTab(plugin, "sources")) return;
        plugin.sources.showCurrent();
        await plugin.activateView();
        return;
      }
      if (!selectStratumTab(plugin, "reader")) return;
      positions.set(plugin, saved);
      registerEvidence(plugin);
      plugin.readerNoteFile = choice.entry.file;
      await plugin.activateView();
      plugin.refreshViews();
    };
    if (choices.length === 1) await open(choices[0]);
    else if (choices.length) {
      class SourceChoice extends SuggestModal<Choice> {
        onClose(): void {
          pickers.get(plugin)?.delete(this);
        }
        getSuggestions(query: string): Choice[] {
          return choices.filter((choice) =>
            choice.label
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
          );
        }
        renderSuggestion(choice: Choice, el: HTMLElement): void {
          el.setText(choice.label);
        }
        onChooseSuggestion(choice: Choice): void {
          void open(choice).catch(
            () => new Notice("Could not open citation evidence. Try again."),
          );
        }
      }
      const picker = new SourceChoice(plugin.app);
      picker.modalEl.addClass("stratum-modal");
      picker.setPlaceholder("Choose a cited source to open in reader");
      registerEvidence(plugin).add(picker);
      if (await current()) picker.open();
      else pickers.get(plugin)?.delete(picker);
    }
  } catch {
    new Notice(
      "Could not read citation evidence. Open the citations tab to review reference data.",
    );
  }
}
