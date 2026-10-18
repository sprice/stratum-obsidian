import {
  emptyCatalog,
  publicationFolder,
  validPublicationPath,
  publishFilename,
  readCatalog,
  movePublishedNotes,
  type PublishCatalog,
  type PublishedDocument,
  type PublishedNote,
} from "./publish-model";
import type { NotePublishPreferences } from "./publish-options";
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
export interface PublishedFiles {
  folder(): string;
  create(path: string, bytes: ArrayBuffer): Promise<void>;
  trash(path: string): Promise<void>;
}
class PublicationCollisionError extends Error {}

/** Serialize metadata updates. Write completed bytes before adding a catalog entry. */
export class PublishStore {
  readonly directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private adapter: PublishAdapter,
    pluginDirectory: string,
    private files?: PublishedFiles,
  ) {
    this.directory = `${pluginDirectory}/published`;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }
  private async load(migrate = true): Promise<PublishCatalog> {
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
      if (document.path) continue;
      const original = this.path(document);
      const pendingDelete = `${original}.deleting`;
      if (
        !(await this.adapter.exists(original)) &&
        (await this.adapter.exists(pendingDelete))
      )
        await this.adapter.rename(pendingDelete, original);
    }
    if (migrate && this.files) await this.migrate(catalog);
    return catalog;
  }
  private async availablePath(
    catalog: PublishCatalog,
    title: string,
  ): Promise<string> {
    const folder = publicationFolder(this.files!.folder());
    for (let number = 1; ; number++) {
      const path = `${folder}/${publishFilename(title, "pdf", number)}`;
      if (
        !catalog.documents.some((d) =>
          [d.path, d.migrationPath].some(
            (p) => p?.toLowerCase() === path.toLowerCase(),
          ),
        ) &&
        !(await this.adapter.exists(path))
      )
        return path;
    }
  }
  /** Persist the destination before copying, so a restart resumes the same copy. */
  private async migrate(catalog: PublishCatalog): Promise<void> {
    for (const doc of catalog.documents) {
      if (!doc.path) {
        const source = `${this.directory}/${doc.filename}`;
        if (!(await this.adapter.exists(source))) continue;
        const bytes = await this.adapter.readBinary(source);
        if (!doc.migrationPath) {
          doc.migrationPath = await this.availablePath(
            catalog,
            doc.filename.slice(0, -4),
          );
          await this.save(catalog);
        }
        let target = doc.migrationPath;
        // A different file may have occupied a reserved path while Obsidian was closed.
        if (await this.adapter.exists(target)) {
          if (!this.sameBytes(bytes, await this.adapter.readBinary(target))) {
            doc.migrationPath = await this.availablePath(
              catalog,
              doc.filename.slice(0, -4),
            );
            await this.save(catalog);
            target = doc.migrationPath;
          }
        }
        if (!(await this.adapter.exists(target)))
          await this.files!.create(target, bytes);
        if (!this.sameBytes(bytes, await this.adapter.readBinary(target)))
          throw new Error(
            "The migrated PDF could not be verified. The original has been kept.",
          );
        doc.legacyFilename = doc.filename;
        doc.path = target;
        doc.filename = target.split("/").at(-1)!;
        delete doc.migrationPath;
        await this.save(catalog);
      }
      if (doc.legacyFilename) {
        const source = `${this.directory}/${doc.legacyFilename}`;
        // Never retire the old copy if the destination has disappeared or changed.
        if (await this.adapter.exists(source)) {
          if (
            !(await this.adapter.exists(doc.path)) ||
            !this.sameBytes(
              await this.adapter.readBinary(source),
              await this.adapter.readBinary(doc.path),
            )
          )
            continue;
          await this.adapter.remove(source);
        }
        delete doc.legacyFilename;
        await this.save(catalog);
      }
    }
  }
  private sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
    const other = new Uint8Array(b);
    return (
      a.byteLength === b.byteLength &&
      new Uint8Array(a).every((byte, i) => byte === other[i])
    );
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
      // Record vault events even when an unrelated legacy PDF cannot migrate.
      const catalog = await this.load(false);
      const matches = (path: string | undefined) =>
        path === oldPath || path?.startsWith(`${oldPath}/`);
      const affected = catalog.documents.filter((d) => matches(d.path));
      if (
        !affected.length &&
        !catalog.notes.some(
          (n) => n.path === oldPath || n.path?.startsWith(`${oldPath}/`),
        )
      )
        return;
      movePublishedNotes(catalog, oldPath, newPath);
      if (newPath === null)
        catalog.documents = catalog.documents.filter((d) => !matches(d.path));
      else
        for (const doc of affected) {
          doc.path = newPath + doc.path!.slice(oldPath.length);
          doc.filename = doc.path.split("/").at(-1)!;
        }
      catalog.documents = catalog.documents.filter(
        (d) =>
          !d.path ||
          (validPublicationPath(d.path) &&
            d.filename.toLowerCase().endsWith(".pdf")),
      );
      await this.save(catalog);
    });
  }
  setPreferences(
    id: string,
    preferences: NotePublishPreferences,
  ): Promise<void> {
    return this.serial(async () => {
      const catalog = await this.load();
      const note = catalog.notes.find((entry) => entry.id === id);
      if (!note)
        throw new Error("The publication source is no longer registered.");
      note.preferences = preferences;
      await this.save(catalog);
    });
  }
  create(
    document: Omit<
      PublishedDocument,
      "filename" | "path" | "migrationPath" | "legacyFilename"
    >,
    title: string,
    bytes: ArrayBuffer,
  ): Promise<PublishedDocument> {
    return this.serial(async () => {
      const catalog = await this.load();
      const occupied = new Set(
        catalog.documents.map((entry) => this.path(entry).toLowerCase()),
      );
      for (let number = 1; ; number++) {
        const filename = publishFilename(title, document.format, number);
        const path = `${this.files ? publicationFolder(this.files.folder()) : this.directory}/${filename}`;
        if (
          occupied.has(path.toLowerCase()) ||
          (await this.adapter.exists(path)) ||
          (await this.adapter.exists(`${path}.deleting`))
        )
          continue;
        const entry = {
          ...document,
          filename,
          ...(this.files ? { path } : {}),
        };
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
    const path = this.path(document);
    if (
      catalog.documents.some(
        (entry) => this.path(entry).toLowerCase() === path.toLowerCase(),
      ) ||
      (await this.adapter.exists(path))
    )
      throw new PublicationCollisionError(
        "A document with this filename already exists. Try publishing again.",
      );
    if (document.path && this.files) {
      await this.files.create(path, bytes);
      catalog.documents.push(document);
      try {
        await this.save(catalog);
      } catch (error) {
        // Clean up the unrecorded PDF using the configured deletion preference.
        await this.files.trash(path);
        throw error;
      }
      return;
    }
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
    return document.path ?? `${this.directory}/${document.filename}`;
  }
  remove(id: string): Promise<void> {
    return this.serial(async () => {
      const catalog = await this.load();
      const doc = catalog.documents.find((d) => d.id === id);
      if (!doc) return;
      if (doc.path && this.files) {
        if (await this.adapter.exists(doc.path))
          await this.files.trash(doc.path);
        catalog.documents = catalog.documents.filter((d) => d.id !== id);
        await this.save(catalog);
        return;
      }
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
