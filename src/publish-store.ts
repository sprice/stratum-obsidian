import {
  emptyCatalog,
  readCatalog,
  movePublishedNotes,
  type PublishCatalog,
  type PublishedDocument,
  type PublishedNote,
} from "./publish-model";
export interface PublishAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}
/** Serialize metadata updates. Write completed bytes before adding a catalog entry. */
export class PublishStore {
  readonly directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private adapter: PublishAdapter,
    configDir: string,
  ) {
    this.directory = `${configDir}/stratum/published`;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }
  private async load(): Promise<PublishCatalog> {
    const path = `${this.directory}/catalog.json`;
    return (await this.adapter.exists(path))
      ? readCatalog(await this.adapter.read(path))
      : emptyCatalog();
  }
  private async ensureDirectory(): Promise<void> {
    const parts = this.directory.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      if (!(await this.adapter.exists(path))) await this.adapter.mkdir(path);
    }
  }
  private async save(catalog: PublishCatalog): Promise<void> {
    await this.ensureDirectory();
    const temp = `${this.directory}/catalog-${crypto.randomUUID()}.tmp`;
    try {
      await this.adapter.write(temp, JSON.stringify(catalog, null, 2));
      await this.adapter.rename(temp, `${this.directory}/catalog.json`);
    } finally {
      if (await this.adapter.exists(temp)) await this.adapter.remove(temp);
    }
  }
  list(): Promise<PublishCatalog> {
    return this.serial(() => this.load());
  }
  note(path: string, title: string, ctime: number): Promise<PublishedNote> {
    return this.serial(async () => {
      const catalog = await this.load();
      const existing = catalog.notes.find(
        (n) => n.path === path && n.ctime === ctime,
      );
      if (existing) return existing;
      for (const stale of catalog.notes.filter((n) => n.path === path))
        stale.path = null;
      const note = { id: crypto.randomUUID(), path, title, ctime };
      catalog.notes.push(note);
      await this.save(catalog);
      return note;
    });
  }
  move(oldPath: string, newPath: string | null): Promise<void> {
    return this.serial(async () => {
      const catalog = await this.load();
      if (
        !catalog.notes.some(
          (n) => n.path === oldPath || n.path?.startsWith(`${oldPath}/`),
        )
      )
        return;
      movePublishedNotes(catalog, oldPath, newPath);
      await this.save(catalog);
    });
  }
  add(document: PublishedDocument, bytes: ArrayBuffer): Promise<void> {
    return this.serial(async () => {
      const catalog = await this.load();
      if (!catalog.notes.some((n) => n.id === document.noteId))
        throw new Error("The source note is no longer registered.");
      const path = `${this.directory}/${document.filename}`;
      if (await this.adapter.exists(path))
        throw new Error(
          "A document with this filename already exists. Try publishing again.",
        );
      await this.ensureDirectory();
      const temp = `${path}.tmp`;
      let created = false;
      try {
        await this.adapter.writeBinary(temp, bytes);
        await this.adapter.rename(temp, path);
        created = true;
        catalog.documents.push(document);
        await this.save(catalog);
      } catch (error) {
        if (created && (await this.adapter.exists(path)))
          await this.adapter.remove(path);
        throw error;
      } finally {
        if (await this.adapter.exists(temp)) await this.adapter.remove(temp);
      }
    });
  }
  path(document: PublishedDocument): string {
    return `${this.directory}/${document.filename}`;
  }
  remove(id: string): Promise<void> {
    return this.serial(async () => {
      const catalog = await this.load();
      const doc = catalog.documents.find((d) => d.id === id);
      if (!doc) return;
      const path = this.path(doc),
        temp = `${path}.deleting`;
      const exists = await this.adapter.exists(path);
      if (exists) await this.adapter.rename(path, temp);
      try {
        catalog.documents = catalog.documents.filter((d) => d.id !== id);
        await this.save(catalog);
      } catch (error) {
        if (exists) await this.adapter.rename(temp, path);
        throw error;
      }
      if (exists) await this.adapter.remove(temp);
    });
  }
}
