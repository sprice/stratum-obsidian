import type { DataAdapter } from "obsidian";

export interface BibliographyCache {
  adapter: Pick<
    DataAdapter,
    | "exists"
    | "stat"
    | "mkdir"
    | "readBinary"
    | "writeBinary"
    | "rename"
    | "remove"
  >;
  directory: string;
}
interface Specification {
  sha256: string;
  maxBytes?: number;
  extension?: "bst" | "zip" | "json" | "bin";
}
const queues = new WeakMap<
  BibliographyCache["adapter"],
  Map<string, Promise<Uint8Array>>
>();
const cancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error("Publishing cancelled.");
};
async function verified(
  bytes: Uint8Array,
  fingerprint: string,
  maxBytes = 1_000_000,
): Promise<boolean> {
  if (bytes.length > maxBytes) return false;
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return (
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("") === fingerprint
  );
}
async function cached(
  cache: BibliographyCache,
  path: string,
  fingerprint: string,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  try {
    const stat = await cache.adapter.stat(path);
    if (!stat || stat.type !== "file" || stat.size > maxBytes) return undefined;
    const bytes = new Uint8Array(await cache.adapter.readBinary(path));
    if (await verified(bytes, fingerprint, maxBytes)) return bytes;
  } catch {
    /* Missing/unreadable entries are cache misses, never trusted. */
  }
  return undefined;
}
async function ensureDirectory(cache: BibliographyCache): Promise<void> {
  let path = cache.directory.startsWith("/") ? "/" : "";
  for (const part of cache.directory.split("/")) {
    if (!part) continue;
    path = path === "/" ? `/${part}` : path ? `${path}/${part}` : part;
    if (!(await cache.adapter.exists(path))) {
      try {
        await cache.adapter.mkdir(path);
      } catch (error) {
        if (!(await cache.adapter.exists(path))) throw error;
      }
    }
  }
}
/** Reverify persistent public style bytes; export scratch cleanup never owns this directory. */
export async function cachedPublicationResource(
  cache: BibliographyCache,
  specification: Specification,
  download: () => Promise<Uint8Array>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  cancelled(signal);
  if (!/^[a-f0-9]{64}$/.test(specification.sha256))
    throw new Error("Invalid resource fingerprint.");
  const maxBytes = specification.maxBytes ?? 1_000_000;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 32 * 1024 * 1024
  )
    throw new Error("Invalid resource size limit.");
  const extension = specification.extension ?? "bst";
  if (!["bst", "zip", "json", "bin"].includes(extension))
    throw new Error("Invalid resource extension.");
  const path = `${cache.directory}/${specification.sha256}.${extension}`;
  let queue = queues.get(cache.adapter);
  if (!queue) {
    queue = new Map();
    queues.set(cache.adapter, queue);
  }
  const previous = queue.get(path) ?? Promise.resolve(undefined);
  const next = previous
    .catch(() => {})
    .then(async () => {
      cancelled(signal);
      const existing = await cached(
        cache,
        path,
        specification.sha256,
        maxBytes,
      );
      cancelled(signal);
      if (existing) return existing;
      // Remove a corrupt entry without touching other version fingerprints.
      if (await cache.adapter.exists(path)) await cache.adapter.remove(path);
      const bytes = await download();
      cancelled(signal);
      if (!(await verified(bytes, specification.sha256, maxBytes)))
        throw new Error(
          "The template resource changed. Update Stratum before installing this template.",
        );
      await ensureDirectory(cache);
      const temporary = `${cache.directory}/${specification.sha256}.${crypto.randomUUID()}.tmp`;
      try {
        await cache.adapter.writeBinary(
          temporary,
          Uint8Array.from(bytes).buffer,
        );
        cancelled(signal);
        await cache.adapter.rename(temporary, path);
        cancelled(signal);
        const persisted = await cached(
          cache,
          path,
          specification.sha256,
          maxBytes,
        );
        if (!persisted) {
          await cache.adapter.remove(path);
          throw new Error(
            "The template cache could not be verified after writing. Check disk space and enable the template again.",
          );
        }
        return persisted;
      } finally {
        if (await cache.adapter.exists(temporary))
          await cache.adapter.remove(temporary);
      }
    });
  queue.set(path, next);
  const clear = () => {
    if (queue?.get(path) === next) queue.delete(path);
  };
  void next.then(clear, clear);
  if (!signal) return next;
  let abort!: () => void;
  const interruption = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Publishing cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([next, interruption]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
