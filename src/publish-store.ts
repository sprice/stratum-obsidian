import {
  emptyCatalog,
  publishFilename,
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
class PublicationCollisionError extends Error {}

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
    const backup = `${this.directory}/catalog.backup.json`;
    // A crash between the two renames must not turn existing history into an empty catalog.
    if (
      !(await this.adapter.exists(path)) &&
      (await this.adapter.exists(backup))
    )
      await this.adapter.rename(backup, path);
    const catalog = (await this.adapter.exists(path))
      ? readCatalog(await this.adapter.read(path))
      : emptyCatalog();
    // A referenced tombstone means deletion stopped before the catalog commit.
    for (const document of catalog.documents) {
      const original = this.path(document);
      const pendingDelete = `${original}.deleting`;
      if (
        !(await this.adapter.exists(original)) &&
        (await this.adapter.exists(pendingDelete))
      )
        await this.adapter.rename(pendingDelete, original);
    }
    return catalog;
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
    const path = `${this.directory}/catalog.json`;
    const backup = `${this.directory}/catalog.backup.json`;
    const temp = `${this.directory}/catalog-${crypto.randomUUID()}.tmp`;
    let backedUp = false;
    try {
      await this.adapter.write(temp, JSON.stringify(catalog, null, 2));
      // Obsidian's adapter refuses to rename over an existing destination.
      if (await this.adapter.exists(path)) {
        if (await this.adapter.exists(backup))
          await this.adapter.remove(backup);
        await this.adapter.rename(path, backup);
        backedUp = true;
      }
      try {
        await this.adapter.rename(temp, path);
      } catch (error) {
        if (backedUp) await this.adapter.rename(backup, path);
        throw error;
      }
      // The new catalog is committed. Cleanup failures must not make add() delete
      // a document that the committed catalog now references.
      if (backedUp) await this.adapter.remove(backup).catch(() => {});
    } finally {
      await this.adapter.remove(temp).catch(() => {});
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
  create(
    document: Omit<PublishedDocument, "filename">,
    title: string,
    bytes: ArrayBuffer,
  ): Promise<PublishedDocument> {
    return this.serial(async () => {
      const catalog = await this.load();
      const occupied = new Set(
        catalog.documents.map((entry) => entry.filename.toLowerCase()),
      );
      for (let number = 1; ; number++) {
        const filename = publishFilename(title, document.format, number);
        const path = `${this.directory}/${filename}`;
        if (
          occupied.has(filename.toLowerCase()) ||
          (await this.adapter.exists(path)) ||
          (await this.adapter.exists(`${path}.deleting`))
        )
          continue;
        const entry = { ...document, filename };
        try {
          await this.writeDocument(catalog, entry, bytes);
          return entry;
        } catch (error) {
          if (!(error instanceof PublicationCollisionError)) throw error;
        }
      }
    });
  }
  add(document: PublishedDocument, bytes: ArrayBuffer): Promise<void> {
    return this.serial(async () =>
      this.writeDocument(await this.load(), document, bytes),
    );
  }
  private async writeDocument(
    catalog: PublishCatalog,
    document: PublishedDocument,
    bytes: ArrayBuffer,
  ): Promise<void> {
    if (!catalog.notes.some((n) => n.id === document.noteId))
      throw new Error("The source note is no longer registered.");
    if (catalog.documents.some((entry) => entry.id === document.id))
      throw new Error("A document with this identity already exists.");
    const path = `${this.directory}/${document.filename}`;
    if (
      catalog.documents.some(
        (entry) =>
          entry.filename.toLowerCase() === document.filename.toLowerCase(),
      ) ||
      (await this.adapter.exists(path))
    )
      throw new PublicationCollisionError(
        "A document with this filename already exists. Try publishing again.",
      );
    await this.ensureDirectory();
    const temp = `${this.directory}/publication-${crypto.randomUUID()}.tmp`;
    let created = false;
    try {
      await this.adapter.writeBinary(temp, bytes);
      try {
        await this.adapter.rename(temp, path);
      } catch (error) {
        if (await this.adapter.exists(path))
          throw new PublicationCollisionError(
            "A document with this filename already exists.",
          );
        throw error;
      }
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
