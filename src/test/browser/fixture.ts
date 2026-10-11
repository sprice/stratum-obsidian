import { TFile } from "obsidian";
import { PublishController } from "../../publish-controller";
import { PublishPanel } from "../../view-publish";
import { readNotePreferences } from "../../publish-options";
import { PublishFontError } from "../../publish-desktop";
import type { PublishAdapter } from "../../publish-store";
import type StratumPlugin from "../../plugin";

class MemoryVault implements PublishAdapter {
  private files = new Map<string, string>();
  private directories = new Set<string>();
  failSave = false;
  private saveGate?: Promise<void>;
  private releaseSave?: () => void;
  holdSaves(hold: boolean) {
    if (hold && !this.saveGate)
      this.saveGate = new Promise<void>((resolve) => {
        this.releaseSave = resolve;
      });
    if (!hold) {
      this.releaseSave?.();
      this.saveGate = undefined;
      this.releaseSave = undefined;
    }
  }
  exists(path: string) {
    return Promise.resolve(this.files.has(path) || this.directories.has(path));
  }
  mkdir(path: string) {
    this.directories.add(path);
    return Promise.resolve();
  }
  read(path: string) {
    return Promise.resolve(this.files.get(path) ?? "");
  }
  async write(path: string, value: string) {
    await this.saveGate;
    if (this.failSave)
      return Promise.reject(new Error("Synthetic preference save failed"));
    this.files.set(path, value);
    return Promise.resolve();
  }
  rename(from: string, to: string) {
    this.files.set(to, this.files.get(from) ?? "");
    this.files.delete(from);
    return Promise.resolve();
  }
  remove(path: string) {
    this.files.delete(path);
    return Promise.resolve();
  }
  readBinary() {
    return Promise.resolve(new ArrayBuffer(0));
  }
  writeBinary() {
    return Promise.resolve();
  }
}
let controller: PublishController;
let panel: PublishPanel;
let adapter: MemoryVault;
export interface FixtureOptions {
  bodyFont?: string;
  titleFont?: string;
  theme?: "light" | "dark";
  aastex?: boolean;
}
const root = document.querySelector<HTMLElement>("#publish")!;
const properties = { title: "Synthetic paper", authors: ["Example Author"] };
const source = `---\n${JSON.stringify(properties)}\n---\n\nA synthetic paper for publishing tests.`;
async function reset(options: FixtureOptions = {}) {
  panel?.unload();
  controller?.onunload();
  root.empty();
  document.body.className = `theme-${options.theme ?? "dark"}`;
  adapter = new MemoryVault();
  const plugin = {
    settings: {
      publishPdfSetupComplete: true,
      pandocPath: "pandoc",
      tectonicPath: "tectonic",
    },
    manifest: { id: "stratum" },
    app: {
      vault: {
        adapter,
        configDir: ".synthetic",
        read: () => Promise.resolve(source),
        getAbstractFileByPath(path: string) {
          if (!path.startsWith("Papers/Synthetic")) return null;
          const file = new TFile();
          file.path = path;
          return file;
        },
      },
      metadataCache: { getFileCache: () => ({ frontmatter: properties }) },
      workspace: { getMostRecentLeaf: () => null },
    },
    citations: {
      preferences: () => ({ style: "apa", language: "en-US" }),
      formatForPublication: () => Promise.resolve(undefined),
    },
  } as unknown as StratumPlugin;
  controller = new PublishController(plugin);
  controller.document = new TFile();
  // Citation style resources belong to Obsidian's host, not this recovery scenario.
  controller.citationStyleChoices = () => Promise.resolve(null);
  const note = await controller.store.note(
    controller.document.path,
    "Synthetic paper",
    1,
  );
  const preferences = readNotePreferences({
    templateId: options.aastex ? "package:aastex" : "general",
    format: "pdf",
  });
  preferences.pdf.bodyFont = options.bodyFont ?? "Missing Body Serif";
  preferences.pdf.titleFont = options.titleFont ?? "";
  await controller.store.setPreferences(note.id, preferences);
  await controller.reload();
  panel = new PublishPanel(root, controller);
  panel.onload();
}
export const publicationFixture = {
  reset,
  switchNote() {
    const file = new TFile();
    file.path = "Papers/Synthetic second paper.md";
    file.basename = "Synthetic second paper";
    controller.document = file;
    controller.emit();
  },
  savedOptions(path: string) {
    return controller.catalog?.notes.find((note) => note.path === path)
      ?.preferences?.aastex?.options;
  },
  selectFormat(format: "pdf" | "docx") {
    return controller.selectFormat(format);
  },
  async addDocuments(count = 1) {
    const note = await controller.store.note(
      controller.document!.path,
      "Synthetic paper",
      1,
    );
    for (let index = 0; index < count; index++)
      for (const format of ["pdf", "docx"] as const)
        await controller.store.create(
          {
            id: crypto.randomUUID(),
            noteId: note.id,
            format,
            createdAt: "2026-10-11T12:00:00Z",
            citationStyle: "apa",
            citationLanguage: "en-US",
          },
          "Synthetic paper",
          new ArrayBuffer(0),
        );
    await controller.reload();
  },
  holdSaves(value: boolean) {
    adapter.holdSaves(value);
  },
  failSave(value: boolean) {
    adapter.failSave = value;
  },
  unrelatedError() {
    controller.fail(new Error("Synthetic unrelated publishing error"));
  },
  state() {
    return {
      error: controller.error,
      saving: controller.preferencesSaving,
      busy: controller.busy,
      bodyFont: controller.layout.bodyFont,
      titleFont: controller.layout.titleFont,
      fonts: controller.fontError?.fonts ?? [],
      aastexOptions: controller.aastexPdfOptions,
      selectedFormat: controller.selectedFormat,
    };
  },
  injectEngineError(font: string) {
    controller.fail(new PublishFontError(font));
  },
};
declare global {
  interface Window {
    publicationFixture: typeof publicationFixture;
  }
}
window.publicationFixture = publicationFixture;
await reset();
document.body.dataset.ready = "true";
