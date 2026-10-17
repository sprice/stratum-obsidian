import { publicationAssetPath } from "./publication-asset-map";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value;
});
export function publicationCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
/** Read bounded ZIP data without extracting paths or running installation scripts. */
export function publicationArchive(
  bytes: Uint8Array,
  inflate: (bytes: Uint8Array, limit: number) => Uint8Array,
): Record<string, Uint8Array> {
  if (bytes.length < 22) throw new Error("Invalid template archive.");
  if (bytes.length > 32 * 1024 * 1024)
    throw new Error("Template archive is too large.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--)
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length
    )
      break;
  if (end < Math.max(0, bytes.length - 65557))
    throw new Error("Invalid template archive.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count !== view.getUint16(end + 8, true) ||
    !count ||
    count > 5000 ||
    offset + view.getUint32(end + 12, true) !== end
  )
    throw new Error("Unsupported template archive.");
  const directoryStart = offset;
  const spans: [number, number][] = [];
  const result: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;
  const seen = new Set<string>();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("Invalid template archive entry.");
    const flags = view.getUint16(offset + 8, true),
      method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true),
      size = view.getUint32(offset + 24, true);
    const length = view.getUint16(offset + 28, true);
    const entryEnd =
      offset +
      46 +
      length +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    if (entryEnd > end)
      throw new Error("Invalid template archive entry bounds.");
    const crc = view.getUint32(offset + 16, true);
    const mode = view.getUint32(offset + 38, true) >>> 16;
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + length),
    );
    const path = name.endsWith("/") ? name.slice(0, -1) : name;
    const local = view.getUint32(offset + 42, true);
    if (
      !publicationAssetPath(path) ||
      seen.has(path.toLowerCase()) ||
      ((mode & 0xf000) !== 0 && ![0x8000, 0x4000].includes(mode & 0xf000)) ||
      flags & 0x41 ||
      ![0, 8].includes(method) ||
      size > 100 * 1024 * 1024 ||
      (total += size) > 100 * 1024 * 1024 ||
      local + 30 > directoryStart ||
      view.getUint32(local, true) !== 0x04034b50
    )
      throw new Error("Unsafe template archive entry.");
    seen.add(path.toLowerCase());
    const localLength = view.getUint16(local + 26, true);
    const localName = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(local + 30, local + 30 + localLength),
    );
    const start = local + 30 + localLength + view.getUint16(local + 28, true);
    if (
      localName !== name ||
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== method ||
      start + compressed > directoryStart ||
      (!(flags & 8) &&
        (view.getUint32(local + 14, true) !== crc ||
          view.getUint32(local + 18, true) !== compressed ||
          view.getUint32(local + 22, true) !== size)) ||
      spans.some(([a, b]) => local < b && start + compressed > a)
    )
      throw new Error("Invalid template archive offsets.");
    spans.push([local, start + compressed]);
    if (!name.endsWith("/")) {
      const data = bytes.subarray(start, start + compressed);
      const content =
        method === 0
          ? Uint8Array.from(data)
          : inflate(data, Math.min(100 * 1024 * 1024, size + 1));
      if (content.length !== size || publicationCrc32(content) !== crc)
        throw new Error("Invalid template archive size or CRC checksum.");
      result[path] = content;
    }
    offset = entryEnd;
  }
  if (offset !== end) throw new Error("Invalid template archive directory.");
  return result;
}
