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
  write(path: string, value: string) {
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
    templateId: "general",
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
