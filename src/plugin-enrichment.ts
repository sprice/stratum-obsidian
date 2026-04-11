import type { OpenAlexEnrichment } from "./backend-client";
import { getNormalizedDoiLookupKey } from "./doi";
import type StratumPlugin from "./plugin";

export interface LoadEnrichmentForNoteWriteParams {
  doi: string | null;
}

export async function loadEnrichmentForNoteWrite(
  plugin: StratumPlugin,
  params: LoadEnrichmentForNoteWriteParams,
): Promise<OpenAlexEnrichment | null | undefined> {
  const lookupKey = getNormalizedDoiLookupKey(params.doi);
  if (!lookupKey || !params.doi) {
    return null;
  }

  try {
    return await plugin.backend.getOpenAlexEnrichment(params.doi, {
      throwOnFailure: true,
    });
  } catch {
    return undefined;
  }
}
