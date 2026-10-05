import type { PublishReadiness } from "./publish-desktop";

export interface PublishReadinessCache {
  version: 1;
  pandocPath: string;
  tectonicPath: string;
  readiness: PublishReadiness;
}

/** Only tool identity and verified support belong in persistent settings. */
export function readPublishReadinessCache(
  value: unknown,
): PublishReadinessCache | null {
  if (!value || typeof value !== "object") return null;
  const cache = value as PublishReadinessCache;
  const path = (value: unknown): value is string =>
    typeof value === "string" && !value.includes("\0");
  if (
    cache.version !== 1 ||
    !path(cache.pandocPath) ||
    !path(cache.tectonicPath)
  )
    return null;
  const ready = cache.readiness;
  if (
    !ready ||
    typeof ready.word !== "boolean" ||
    typeof ready.pdf !== "boolean"
  )
    return null;
  for (const tool of [ready.pandoc, ready.tectonic])
    if (!tool || !path(tool.path) || typeof tool.version !== "string")
      return null;
  if ((ready.word || ready.pdf) && !ready.pandoc.path) return null;
  if (ready.pdf && !ready.tectonic.path) return null;
  return {
    version: 1,
    pandocPath: cache.pandocPath,
    tectonicPath: cache.tectonicPath,
    readiness: {
      word: ready.word,
      pdf: ready.pdf,
      pandoc: { path: ready.pandoc.path, version: ready.pandoc.version },
      tectonic: { path: ready.tectonic.path, version: ready.tectonic.version },
    },
  };
}
