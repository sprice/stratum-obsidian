import { Platform } from "obsidian";
import type { ZoteroItemDetail } from "./backend-types";
import type { AnnotationHttp } from "./annotation-node-api";

export class BetterBibtexItemError extends Error {}

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export type BbtRequest = (url: string, body: string) => Promise<unknown>;

export async function requestBetterBibtex(
  url: string,
  body: string,
): Promise<unknown> {
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.pathname !== "/better-bibtex/json-rpc" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Invalid Better BibTeX endpoint.");
  if (Platform.isDesktop) {
    const { request } =
      (await import("node:http")) as unknown as AnnotationHttp;
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        { method: "POST", headers: { "Content-Type": "application/json" } },
        (response) => {
          const chunks: Uint8Array[] = [];
          let size = 0;
          response.on("data", (chunk: unknown) => {
            if (!(chunk instanceof Uint8Array)) {
              req.destroy(
                new Error("Unexpected Better BibTeX response chunk."),
              );
              return;
            }
            size += chunk.byteLength;
            if (size > MAX_RESPONSE_BYTES) {
              req.destroy(new Error("Better BibTeX response is too large."));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            try {
              if (response.statusCode !== 200)
                throw new Error("Better BibTeX is unavailable.");
              const bytes = new Uint8Array(size);
              let offset = 0;
              for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
              }
              resolve(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
            } catch {
              reject(new Error("Better BibTeX is unavailable."));
            }
          });
        },
      );
      const timeout = window.setTimeout(
        () => req.destroy(new Error("Better BibTeX request timed out.")),
        10_000,
      );
      req.on("close", () => window.clearTimeout(timeout));
      req.setTimeout(10_000, () =>
        req.destroy(new Error("Better BibTeX request timed out.")),
      );
      req.on("error", reject);
      req.end(body);
    });
  }
  throw new Error("Annotation images require desktop Zotero.");
}

export async function loadBetterBibtexImagePaths(
  detail: ZoteroItemDetail,
  port: number,
  request: BbtRequest = requestBetterBibtex,
): Promise<Map<string, string>> {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid Zotero port.");
  // Never send Stratum's generated fallback key; BBT resolves its own keys.
  const citekey = detail.item.citationKey;
  if (typeof citekey !== "string" || !citekey.trim()) return new Map();
  const response = await request(
    `http://127.0.0.1:${port}/better-bibtex/json-rpc`,
    JSON.stringify({
      jsonrpc: "2.0",
      id: "stratum-images",
      method: "item.attachments",
      params:
        detail.library.type === "group"
          ? [citekey, detail.library.id]
          : [citekey],
    }),
  );
  if (!response || typeof response !== "object")
    throw new Error("Invalid Better BibTeX response.");
  const envelope = response as {
    result?: unknown;
    error?: unknown;
    id?: unknown;
  };
  if (
    envelope.error &&
    typeof envelope.error === "object" &&
    [-32602, -32603].includes((envelope.error as { code?: number }).code ?? 0)
  )
    throw new BetterBibtexItemError(
      "This item has no available Better BibTeX image data.",
    );
  if (
    envelope.error ||
    envelope.id !== "stratum-images" ||
    !Array.isArray(envelope.result)
  )
    throw new Error("Better BibTeX images are unavailable.");
  const paths = new Map<string, string>();
  for (const attachment of envelope.result as unknown[]) {
    if (!attachment || typeof attachment !== "object") continue;
    const row = attachment as { open?: unknown; annotations?: unknown };
    const segment =
      detail.library.type === "group"
        ? `groups/${detail.library.id}`
        : "library";
    const expected = detail.attachments.find(
      (a) => row.open === `zotero://open-pdf/${segment}/items/${a.key}`,
    );
    if (!expected || !Array.isArray(row.annotations)) continue;
    for (const raw of row.annotations as unknown[]) {
      if (!raw || typeof raw !== "object") continue;
      const annotation = raw as {
        key?: unknown;
        parentItem?: unknown;
        annotationType?: unknown;
        annotationImagePath?: unknown;
      };
      if (
        annotation.parentItem !== expected.key ||
        annotation.annotationType !== "image" ||
        typeof annotation.key !== "string" ||
        typeof annotation.annotationImagePath !== "string"
      )
        continue;
      if (
        detail.annotations.some(
          (a) =>
            a.type === "image" &&
            a.key === annotation.key &&
            a.attachmentKey === expected.key,
        )
      )
        paths.set(annotation.key, annotation.annotationImagePath);
    }
  }
  return paths;
}
