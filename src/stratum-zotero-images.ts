import { Platform } from "obsidian";
import type { ZoteroItemDetail } from "./backend-types";
import type { AnnotationHttp } from "./annotation-node-api";

export class StratumAnnotationError extends Error {}
export class StratumAnnotationItemError extends StratumAnnotationError {}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * MAX_IMAGE_BYTES + 4096;
type ImageRequest = (url: string) => Promise<{ status: number; json: unknown }>;

export async function requestStratumImage(
  url: string,
): Promise<{ status: number; json: unknown }> {
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.pathname !== "/stratum/v1/annotation-image" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  )
    throw new StratumAnnotationError("Invalid Stratum Zotero endpoint.");
  if (!Platform.isDesktop)
    throw new StratumAnnotationError(
      "Annotation images require desktop Zotero.",
    );
  const http: unknown = Platform.isDesktop ? await import("node:http") : null;
  if (!http)
    throw new StratumAnnotationError(
      "Annotation images require desktop Zotero.",
    );
  const { request } = http as unknown as AnnotationHttp;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "GET", headers: { Accept: "application/json" } },
      (response) => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        response.on("data", (chunk: unknown) => {
          if (
            !ArrayBuffer.isView(chunk) ||
            Object.prototype.toString.call(chunk) !== "[object Uint8Array]"
          ) {
            req.destroy(
              new StratumAnnotationError(
                "Unexpected Stratum Zotero response chunk.",
              ),
            );
            return;
          }
          const bytes = new Uint8Array(
            chunk.buffer,
            chunk.byteOffset,
            chunk.byteLength,
          );
          size += bytes.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(
              new StratumAnnotationError(
                "Stratum Zotero response is too large.",
              ),
            );
            return;
          }
          chunks.push(bytes);
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            resolve({
              status: response.statusCode ?? 0,
              json: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
            });
          } catch {
            reject(
              new StratumAnnotationError(
                `Stratum Zotero returned HTTP ${response.statusCode ?? 0} without a valid JSON response.`,
              ),
            );
          }
        });
      },
    );
    const timeout = window.setTimeout(
      () =>
        req.destroy(
          new StratumAnnotationError("Stratum Zotero image request timed out."),
        ),
      10_000,
    );
    req.on("close", () => window.clearTimeout(timeout));
    req.setTimeout(10_000, () =>
      req.destroy(
        new StratumAnnotationError("Stratum Zotero image request timed out."),
      ),
    );
    req.on("error", reject);
    req.end();
  });
}

export async function loadStratumAnnotationImage(
  detail: ZoteroItemDetail,
  annotation: ZoteroItemDetail["annotations"][number],
  port: number,
  request: ImageRequest = requestStratumImage,
): Promise<ArrayBuffer> {
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[A-Z0-9]{8}$/.test(annotation.key) ||
    !/^\d+$/.test(detail.library.id) ||
    !detail.attachments.some(
      (attachment) => attachment.key === annotation.attachmentKey,
    )
  ) {
    throw new StratumAnnotationError("Invalid annotation image identity.");
  }
  const query = new URLSearchParams({
    libraryType: detail.library.type,
    libraryId: detail.library.id,
    annotationKey: annotation.key,
    format: "bytes",
  });
  const result = await request(
    `http://127.0.0.1:${port}/stratum/v1/annotation-image?${query}`,
  ).catch((error: unknown) => {
    if (error instanceof StratumAnnotationError) throw error;
    const code =
      error && typeof error === "object" && "code" in error ? error.code : null;
    const connection =
      code === "ECONNREFUSED"
        ? "Connection refused by Zotero."
        : code === "ECONNRESET"
          ? "Zotero closed the image connection."
          : "Could not send the image request to Zotero.";
    throw new StratumAnnotationError(connection);
  });
  const value = result.json as {
    apiVersion?: unknown;
    library?: { type?: unknown; id?: unknown };
    annotationKey?: unknown;
    attachmentKey?: unknown;
    contentType?: unknown;
    bytes?: unknown;
    error?: { code?: unknown };
  } | null;
  if (result.status !== 200) {
    const code = value?.error?.code;
    if (
      typeof code === "string" &&
      [
        "annotation_not_found",
        "pdf_not_found",
        "unsupported_annotation",
        "image_unavailable",
        "image_too_large",
        "image_request_failed",
        "image_source_failed",
        "image_cache_failed",
        "image_render_failed",
        "image_data_failed",
        "image_conversion_failed",
      ].includes(code)
    ) {
      throw new StratumAnnotationItemError(
        `Zotero image API: ${code} (HTTP ${result.status}).`,
      );
    }
    throw new StratumAnnotationError(
      `Stratum Zotero image endpoint returned HTTP ${result.status}.`,
    );
  }
  if (
    !value ||
    value.apiVersion !== 1 ||
    value.library?.type !== detail.library.type ||
    value.library.id !== detail.library.id ||
    value.annotationKey !== annotation.key ||
    value.attachmentKey !== annotation.attachmentKey ||
    value.contentType !== "image/png"
  ) {
    throw new StratumAnnotationError(
      "Stratum Zotero returned a different annotation identity.",
    );
  }
  if (
    !Array.isArray(value.bytes) ||
    value.bytes.length < 24 ||
    value.bytes.length > MAX_IMAGE_BYTES ||
    !value.bytes.every(
      (byte: unknown) =>
        typeof byte === "number" &&
        Number.isInteger(byte) &&
        byte >= 0 &&
        byte <= 255,
    )
  ) {
    throw new StratumAnnotationError(
      "Invalid Stratum Zotero image bytes. Update the Stratum Zotero plugin.",
    );
  }
  const bytes = Uint8Array.from(value.bytes as number[]);
  if (
    ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    ) ||
    ![73, 72, 68, 82].every((byte, index) => bytes[index + 12] === byte)
  ) {
    throw new StratumAnnotationError("Invalid annotation PNG.");
  }
  return bytes.buffer;
}
