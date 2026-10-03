import { Platform } from "obsidian";
import type {
  AnnotationFileSystem,
  AnnotationPath,
} from "./annotation-node-api";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Read only the exact annotation cache PNG inside the configured Zotero directory. */
export async function readAnnotationPng(params: {
  dataDir: string;
  sourcePath: string;
  libraryType: "user" | "group";
  libraryId: string;
  key: string;
}): Promise<ArrayBuffer> {
  if (!/^[A-Z0-9]{8}$/.test(params.key) || !/^\d+$/.test(params.libraryId))
    throw new Error("Invalid annotation identity.");
  if (Platform.isDesktop) {
    // Node is supplied by desktop Obsidian; the scanner may lack its declarations.
    const fs =
      (await import("node:fs/promises")) as unknown as AnnotationFileSystem;
    const path = (await import("node:path")) as unknown as AnnotationPath;
    const folder =
      params.libraryType === "user"
        ? ["library"]
        : ["groups", params.libraryId];
    const root = await fs.realpath(params.dataDir);
    const expected = path.join(root, "cache", ...folder, `${params.key}.png`);
    const source = await fs.realpath(params.sourcePath);
    if (source !== expected)
      throw new Error("Unexpected annotation image path.");
    const handle = await fs.open(
      source,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 24 || stat.size > MAX_IMAGE_BYTES)
        throw new Error("Invalid annotation image size.");
      const bytes = new Uint8Array(stat.size + 1);
      let count = 0;
      while (count < bytes.length) {
        const { bytesRead } = await handle.read(
          bytes,
          count,
          bytes.length - count,
          null,
        );
        if (!bytesRead) break;
        count += bytesRead;
      }
      if (count !== stat.size)
        throw new Error("Annotation image changed during import.");
      if (
        count > MAX_IMAGE_BYTES ||
        ![137, 80, 78, 71, 13, 10, 26, 10].every(
          (byte, index) => bytes[index] === byte,
        ) ||
        ![73, 72, 68, 82].every((byte, index) => bytes[index + 12] === byte)
      )
        throw new Error("Invalid annotation PNG.");
      return Uint8Array.from(bytes.subarray(0, count)).buffer;
    } finally {
      await handle.close();
    }
  }
  throw new Error("Annotation images require desktop Zotero.");
}
