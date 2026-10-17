import type { BibliographyCache } from "./publication-bibliography-cache";
import {
  TEMPLATE_REGISTRY_ORIGIN,
  resourceDigest,
} from "./publication-registry";

/** Discovery is a convenience cache, never installation or publication authority. */
export async function registryListing<T>(
  cache: BibliographyCache,
  key: string,
  read: (value: unknown) => T,
  fetch: () => Promise<{ value: unknown; parsed: T }>,
): Promise<{ items: T; offline: boolean }> {
  if (!/^(?!.*\.\.)[a-z0-9][a-z0-9._-]{0,159}$/.test(key))
    throw new Error("Invalid registry listing key.");
  const origin = await resourceDigest(
    new TextEncoder().encode(TEMPLATE_REGISTRY_ORIGIN),
  );
  const filename = `${cache.directory}/listing-${origin}-${key}.json`;
  try {
    const { value, parsed } = await fetch();
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    // Failure to cache a listing must not prevent browsing the live registry.
    try {
      let current = cache.directory.startsWith("/") ? "/" : "";
      for (const part of cache.directory.split("/").filter(Boolean)) {
        current =
          current === "/" ? `/${part}` : current ? `${current}/${part}` : part;
        if (!(await cache.adapter.exists(current)))
          await cache.adapter.mkdir(current);
      }
      const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
      try {
        await cache.adapter.writeBinary(temporary, bytes.buffer);
        await cache.adapter.rename(temporary, filename);
      } finally {
        if (await cache.adapter.exists(temporary))
          await cache.adapter.remove(temporary);
      }
    } catch {
      /* A later refresh can retry writing the convenience cache. */
    }
    return { items: parsed, offline: false };
  } catch (error) {
    try {
      const stat = await cache.adapter.stat(filename);
      if (!stat || stat.type !== "file" || stat.size > 4 * 1024 * 1024)
        throw error;
      const raw = await cache.adapter.readBinary(filename);
      if (raw.byteLength > 4 * 1024 * 1024) throw error;
      return {
        items: read(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
        ),
        offline: true,
      };
    } catch {
      throw error;
    }
  }
}
