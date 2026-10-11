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
): Promise<boolean> {
  if (bytes.length > 1_000_000) return false;
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
): Promise<Uint8Array | undefined> {
  try {
    const stat = await cache.adapter.stat(path);
    if (!stat || stat.type !== "file" || stat.size > 1_000_000)
      return undefined;
    const bytes = new Uint8Array(await cache.adapter.readBinary(path));
    if (await verified(bytes, fingerprint)) return bytes;
  } catch {
    /* Missing/unreadable entries are cache misses, never trusted. */
  }
  return undefined;
}
async function ensureDirectory(cache: BibliographyCache): Promise<void> {
  let path = "";
  for (const part of cache.directory.split("/")) {
    path = path ? `${path}/${part}` : part;
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
export async function cachedAastexBibliography(
  cache: BibliographyCache,
  specification: Specification,
  download: () => Promise<Uint8Array>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  cancelled(signal);
  if (!/^[a-f0-9]{64}$/.test(specification.sha256))
    throw new Error("Invalid bibliography fingerprint.");
  const path = `${cache.directory}/${specification.sha256}.bst`;
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
      const existing = await cached(cache, path, specification.sha256);
      cancelled(signal);
      if (existing) return existing;
      // Remove a corrupt entry without touching other version fingerprints.
      if (await cache.adapter.exists(path)) await cache.adapter.remove(path);
      const bytes = await download();
      cancelled(signal);
      if (!(await verified(bytes, specification.sha256)))
        throw new Error(
          "The AAS bibliography style changed. Update Stratum before publishing this PDF.",
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
        return bytes;
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
