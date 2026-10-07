import { DEFAULT_WORD_FONT, type PublishOptions } from "./publish-options";
type Inflate = (data: Uint8Array) => Uint8Array;
const xml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Read Pandoc's ZIP and write a standard stored ZIP, without a platform-specific archiver. */
export function configureDocx(
  bytes: Uint8Array,
  options: PublishOptions,
  inflate: Inflate,
): Uint8Array {
  options = { ...options, bodyFont: options.bodyFont || DEFAULT_WORD_FONT };
  const encoder = new TextEncoder(),
    decoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    view.getUint32(end, true) !== 0x06054b50
  )
    end--;
  if (end < 0) throw new Error("The Word document archive could not be read.");
  const files = new Map<string, Uint8Array>();
  let position = view.getUint32(end + 16, true);
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    if (view.getUint32(position, true) !== 0x02014b50)
      throw new Error("Invalid Word document archive.");
    const method = view.getUint16(position + 10, true),
      size = view.getUint32(position + 20, true);
    const nameLength = view.getUint16(position + 28, true),
      extra = view.getUint16(position + 30, true),
      comment = view.getUint16(position + 32, true);
    const name = decoder.decode(
      bytes.subarray(position + 46, position + 46 + nameLength),
    );
    const local = view.getUint32(position + 42, true);
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method !== 0 && method !== 8)
      throw new Error("Unsupported Word document compression.");
    files.set(name, method === 8 ? inflate(data) : data);
    position += 46 + nameLength + extra + comment;
  }
  const edit = (name: string, transform: (text: string) => string) => {
    const data = files.get(name);
    if (!data) throw new Error("Word document styles could not be prepared.");
    files.set(name, encoder.encode(transform(decoder.decode(data))));
  };
  const fonts = (name: string) =>
    `<w:rFonts w:ascii="${xml(name)}" w:hAnsi="${xml(name)}" w:eastAsia="${xml(name)}" w:cs="${xml(name)}"/>`;
  // WordprocessingML requires rFonts, then bold, then sizes.
  const run = (font: string, size: number, bold = false) =>
    `${fonts(font)}${bold ? "<w:b/>" : ""}<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>`;
  const spacing = `<w:spacing w:line="${Math.round(options.lineSpacing * 240)}" w:lineRule="auto"/>`;
  edit("word/styles.xml", (source) => {
    // Replace only default typography; keep the document language.
    source = source.replace(
      /(<w:rPrDefault>\s*<w:rPr>)([\s\S]*?)(<\/w:rPr>)/,
      (_match, open: string, content: string, close: string) =>
        open +
        run(options.bodyFont, options.bodySize) +
        content.replace(/<w:(?:rFonts|sz|szCs)\b[^>]*\/>/g, "") +
        close,
    );
    return source.replace(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g, (style) => {
      const id = /w:styleId="([^"]+)"/.exec(style)?.[1];
      // Code keeps Pandoc's monospace font.
      if (id === "VerbatimChar" || id === "SourceCode") return style;
      style = style.replace(/<w:rFonts\b[^>]*\/>/g, fonts(options.bodyFont));
      if (
        ![
          "Title",
          "Author",
          "Subtitle",
          "Date",
          "Normal",
          "BodyText",
          "FirstParagraph",
          "Abstract",
          "Heading1",
          "Heading2",
          "Heading3",
          "Bibliography",
        ].includes(id ?? "")
      )
        return style;
      const title = id === "Title";
      const opening =
        title || ["Author", "Subtitle", "Date"].includes(id ?? "");
      const size = title
        ? options.titleSize
        : id === "Heading1"
          ? options.bodySize * 1.35
          : id === "Heading2"
            ? options.bodySize * 1.15
            : options.bodySize;
      const typography = run(
        title ? options.titleFont || options.bodyFont : options.bodyFont,
        size,
        !!id?.startsWith("Heading"),
      );
      let updated = style.replace(
        /<w:rPr>[\s\S]*?<\/w:rPr>/,
        `<w:rPr>${typography}</w:rPr>`,
      );
      if (!updated.includes("<w:rPr>"))
        updated = updated.replace(
          "</w:style>",
          `<w:rPr>${typography}</w:rPr></w:style>`,
        );
      if (
        opening ||
        ["Normal", "BodyText", "FirstParagraph", "Abstract"].includes(id ?? "")
      ) {
        const paragraph = `<w:pPr>${spacing}${opening ? `<w:jc w:val="${options.openingAlignment}"/>` : ""}${id === "Abstract" ? `<w:ind w:left="${options.abstractWidth === "inset" ? 360 : 0}" w:right="${options.abstractWidth === "inset" ? 360 : 0}"/>` : ""}</w:pPr>`;
        updated = updated.includes("<w:pPr>")
          ? updated.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, paragraph)
          : updated.replace("<w:rPr>", paragraph + "<w:rPr>");
      }
      return updated;
    });
  });
  edit("word/document.xml", (source) => {
    const pageSize =
      options.paperSize === "a4"
        ? '<w:pgSz w:w="11906" w:h="16838"/>'
        : '<w:pgSz w:w="12240" w:h="15840"/>';
    const margin = Math.round(options.margin * 1440);
    const margins = `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="720" w:footer="720" w:gutter="0"/>`;
    // Section children have a fixed order: references, notes and type, then page size and margins.
    const later =
      /<w:(?:paperSrc|pgBorders|lnNumType|pgNumType|cols|formProt|vAlign|noEndnote|titlePg|textDirection|bidi|rtlGutter|docGrid|printerSettings|sectPrChange)\b/;
    let sections = 0;
    source = source.replace(
      /<w:sectPr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/w:sectPr>)/g,
      (_match, attributes: string, original: string | undefined) => {
        sections++;
        const content = (original ?? "")
          .replace(/<w:pg(?:Sz|Mar)\b[^>]*\/>/g, "")
          .replace(/<w:footerReference\b[^>]*\/>/g, "");
        const index = content.search(later);
        const at = index < 0 ? content.length : index;
        return `<w:sectPr${attributes}><w:footerReference w:type="default" r:id="rIdStratumFooter"/>${content.slice(0, at)}${pageSize}${margins}${content.slice(at)}</w:sectPr>`;
      },
    );
    if (!sections)
      throw new Error("Word document page layout could not be prepared.");
    return source;
  });
  files.set(
    "word/stratum-footer.xml",
    encoder.encode(
      `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr>${run(options.bodyFont, options.bodySize)}</w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`,
    ),
  );
  edit("word/_rels/document.xml.rels", (source) =>
    source.replace(
      "</Relationships>",
      '<Relationship Id="rIdStratumFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="stratum-footer.xml"/></Relationships>',
    ),
  );
  edit("[Content_Types].xml", (source) =>
    source.replace(
      "</Types>",
      '<Override PartName="/word/stratum-footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
    ),
  );
  const chunks: Uint8Array[] = [],
    directory: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const encoded = encoder.encode(name),
      crc = crc32(data);
    const local = new Uint8Array(30 + encoded.length),
      localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x800, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, encoded.length, true);
    local.set(encoded, 30);
    const central = new Uint8Array(46 + encoded.length),
      centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x800, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, encoded.length, true);
    centralView.setUint32(42, offset, true);
    central.set(encoded, 46);
    chunks.push(local, data);
    directory.push(central);
    offset += local.length + data.length;
  }
  const directorySize = directory.reduce((sum, chunk) => sum + chunk.length, 0);
  const trailer = new Uint8Array(22),
    trailerView = new DataView(trailer.buffer);
  trailerView.setUint32(0, 0x06054b50, true);
  trailerView.setUint16(8, files.size, true);
  trailerView.setUint16(10, files.size, true);
  trailerView.setUint32(12, directorySize, true);
  trailerView.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directorySize + 22);
  let cursor = 0;
  for (const chunk of [...chunks, ...directory, trailer]) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}
