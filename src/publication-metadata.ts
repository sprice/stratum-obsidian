import {
  isMap,
  isSeq,
  isScalar,
  isAlias,
  parseDocument,
  Document,
  visit,
  type Node,
} from "yaml";

export const PUBLICATION_KEY = "stratum_publish";
export interface PublicationAuthor {
  name: string;
  email: string;
  affiliations: string[];
}
export interface PublicationAuthors {
  authors: PublicationAuthor[];
  structured: boolean;
  legacy: string[];
}
const mapping = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const names = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

/** Do not discard malformed structured data in favor of legacy display names. */
export function publicationAuthors(
  properties: Record<string, unknown>,
): PublicationAuthors {
  const legacy = names(properties.authors ?? properties.author);
  const value = properties[PUBLICATION_KEY];
  if (Object.hasOwn(properties, PUBLICATION_KEY) && !mapping(value))
    throw new Error(
      "The stratum_publish property must be an object. Repair it in Source mode.",
    );
  const structured = mapping(value) && Object.hasOwn(value, "authors");
  if (!structured)
    return {
      structured: false,
      legacy,
      authors: legacy.map((name) => ({ name, email: "", affiliations: [] })),
    };
  if (!Array.isArray(value.authors))
    throw new Error(
      "stratum_publish.authors must be a list of author objects.",
    );
  const authors = value.authors.map((author: unknown, index: number) => {
    if (!mapping(author))
      throw new Error(`Author ${index + 1} must be an object.`);
    for (const key of ["name", "email"])
      if (author[key] !== undefined && typeof author[key] !== "string")
        throw new Error(`Author ${index + 1}: ${key} must be text.`);
    if (
      author.affiliations !== undefined &&
      (!Array.isArray(author.affiliations) ||
        author.affiliations.some((item) => typeof item !== "string"))
    )
      throw new Error(
        `Author ${index + 1}: affiliations must be a list of text.`,
      );
    return {
      name: typeof author.name === "string" ? author.name : "",
      email: typeof author.email === "string" ? author.email : "",
      affiliations: (author.affiliations ?? []) as string[],
    };
  });
  return { structured: true, legacy, authors };
}

export function publicationYaml(text: string, validateAuthors = true) {
  const match =
    /^(?:\uFEFF)?---\r?\n((?:[\s\S]*?\r?\n)?)(?:---|\.\.\.)(?:\r?\n|$)/.exec(
      text,
    );
  if (!match && /^(?:\uFEFF)?---(?:\r?\n|$)/.test(text))
    throw new Error(
      "Note frontmatter is not closed. Repair it in Source mode.",
    );
  const yaml = match?.[1] ?? "";
  const offset = match ? match[0].indexOf(yaml, match[0].indexOf("\n") + 1) : 0;
  const document = parseDocument(yaml, {
    uniqueKeys: true,
    keepSourceTokens: true,
  });
  if (document.errors.length)
    throw new Error(
      "Publication properties contain invalid YAML. Repair them in Source mode.",
    );
  if (document.contents && !isMap(document.contents))
    throw new Error("Note properties must be a YAML mapping.");
  const properties = (document.toJS({ maxAliasCount: 100 }) ?? {}) as Record<
    string,
    unknown
  >;
  if (validateAuthors) publicationAuthors(properties);
  return {
    document,
    properties,
    offset,
    end: match?.[0].length ?? 0,
    newline: text.includes("\r\n") ? "\r\n" : "\n",
  };
}

export interface PublicationChange {
  from: number;
  to: number;
  insert: string;
}
export type AuthorOperation =
  | { type: "field"; author: number; key: "name" | "email"; value: string }
  | { type: "affiliation"; author: number; index: number; value: string }
  | { type: "add-affiliation"; author: number }
  | { type: "remove-affiliation"; author: number; index: number }
  | { type: "add" }
  | { type: "remove"; author: number }
  | { type: "move"; author: number; direction: -1 | 1 }
  | { type: "import" };

function writable(node: unknown): void {
  let unsupported = false;
  visit(node as Parameters<typeof visit>[0], (_key, item) => {
    if (
      isAlias(item) ||
      (item && typeof item === "object" && "anchor" in item && item.anchor)
    )
      unsupported = true;
  });
  if (unsupported)
    throw new Error("Edit anchored or aliased author data in Source mode.");
}

/** Replace only the edited YAML node; unrelated frontmatter and body bytes stay intact. */
export function changePublicationAuthors(
  text: string,
  operation: AuthorOperation,
): PublicationChange {
  const parsed = publicationYaml(text);
  const { document, properties, offset, newline } = parsed;
  const model = publicationAuthors(properties);
  if (operation.type === "import" && model.structured)
    throw new Error(
      "Structured authors already exist. Existing names were not imported.",
    );
  let namespace = document.get(PUBLICATION_KEY, true) as Node | undefined;
  const existingNamespace = namespace;
  if (!namespace) {
    namespace = document.createNode({});
    document.set(PUBLICATION_KEY, namespace);
  }
  if (!isMap(namespace))
    throw new Error("The stratum_publish property must be an object.");
  if (namespace.anchor)
    throw new Error("Edit anchored or aliased author data in Source mode.");
  let authors = namespace.get("authors", true) as Node | undefined;
  const existingAuthors = authors;
  if (!authors) {
    authors = document.createNode([]);
    namespace.set("authors", authors);
  }
  if (!isSeq(authors)) throw new Error("Structured authors must be a list.");
  writable(authors);
  let target = existingAuthors ?? existingNamespace;
  let changed: Node = authors;
  if (operation.type === "add")
    authors.add(document.createNode({ name: "", email: "", affiliations: [] }));
  else if (operation.type === "import") {
    for (const name of model.legacy)
      authors.add(document.createNode({ name, email: "", affiliations: [] }));
  } else {
    const author = authors.items[operation.author];
    if (!isMap(author))
      throw new Error("This author no longer exists. Review the current list.");
    if (operation.type === "remove") authors.items.splice(operation.author, 1);
    else if (operation.type === "move") {
      const to = operation.author + operation.direction;
      if (to < 0 || to >= authors.items.length)
        throw new Error("This author cannot move further.");
      [authors.items[to], authors.items[operation.author]] = [
        authors.items[operation.author],
        authors.items[to],
      ];
    } else if (operation.type === "field") {
      const original = author.get(operation.key, true);
      if (
        isScalar(original) &&
        original.range &&
        !original.anchor &&
        original.type !== "BLOCK_LITERAL" &&
        original.type !== "BLOCK_FOLDED"
      ) {
        const scalar = document.createNode(operation.value);
        let insert =
          author.flow || /[\r\n]/.test(operation.value)
            ? JSON.stringify(operation.value)
            : new Document(scalar).toString({ lineWidth: 0 }).trimEnd();
        const from = offset + original.range[0];
        if (/\S/.test(text[from - 1] ?? "")) insert = " " + insert;
        if (from === offset + original.range[1] && text[from] === "#")
          insert += " ";
        return {
          from,
          to: offset + original.range[1],
          insert,
        };
      }
      target = author;
      author.set(operation.key, operation.value);
      changed = author;
    } else {
      let affiliations = author.get("affiliations", true) as Node | undefined;
      if (!affiliations) {
        affiliations = document.createNode([]);
        author.set("affiliations", affiliations);
      }
      if (!isSeq(affiliations)) throw new Error("Affiliations must be a list.");
      if (operation.type === "add-affiliation") affiliations.add("");
      else if (operation.type === "remove-affiliation")
        affiliations.items.splice(operation.index ?? -1, 1);
      else {
        if (operation.index < 0 || operation.index >= affiliations.items.length)
          throw new Error("This affiliation no longer exists.");
        affiliations.set(operation.index, operation.value);
      }
      target = author;
      changed = author;
    }
  }
  if (!existingAuthors) {
    target = existingNamespace;
    changed = namespace;
  }
  if (!existingNamespace) {
    const addition = new Document({ [PUBLICATION_KEY]: namespace });
    const root = document.contents;
    if (isMap(root) && root.flow && root.range && isMap(addition.contents)) {
      addition.contents.flow = true;
      const property = addition.toString({ lineWidth: 0 }).trim().slice(1, -1);
      const from = offset + root.range[1] - 1;
      const last =
        root.srcToken?.type === "flow-collection"
          ? root.srcToken.items.at(-1)
          : undefined;
      const trailingComma =
        last &&
        !last.key &&
        !last.value &&
        last.start.some((token) => token.type === "comma");
      return {
        from,
        to: from,
        insert: `${Object.keys(properties).length && !trailingComma ? "," : ""}${property}`,
      };
    }
    const insert = addition
      .toString({ lineWidth: 0 })
      .replaceAll("\n", newline);
    if (!parsed.end)
      return {
        from: text.startsWith("\uFEFF") ? 1 : 0,
        to: text.startsWith("\uFEFF") ? 1 : 0,
        insert: `---${newline}${insert}---${newline}`,
      };
    const closing = /(?:---|\.\.\.)(?:\r?\n|$)$/.exec(
      text.slice(0, parsed.end),
    )!;
    const from = parsed.end - closing[0].length;
    return { from, to: from, insert };
  }
  if (!target || !target.range)
    throw new Error("This YAML structure needs to be edited in Source mode.");
  const from = offset + target.range[0],
    to = offset + target.range[1];
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const before = text.slice(lineStart, from);
  // A map inside a sequence starts after '- '; continuation lines need that width.
  const indent = /^\s*(?:- )?$/.test(before) ? " ".repeat(before.length) : "";
  let insert = new Document(changed).toString({ lineWidth: 0 }).trimEnd();
  insert = insert
    .split("\n")
    .map((line, i) => (i ? indent + line : line))
    .join(newline);
  if (text.slice(from, to).endsWith("\n")) insert += newline;
  return { from, to, insert };
}

export const authorRevision = (properties: Record<string, unknown>): string =>
  JSON.stringify(
    properties[PUBLICATION_KEY] && mapping(properties[PUBLICATION_KEY])
      ? (properties[PUBLICATION_KEY].authors ?? null)
      : null,
  );

export const PUBLICATION_PROPERTIES = {
  title: "Title",
  authors: "Authors",
  affiliations: "Affiliations",
  date: "Date",
  keywords: "Keywords",
} as const;
export type PublicationPropertyKey = keyof typeof PUBLICATION_PROPERTIES;
export interface PublicationPropertyOperation {
  key: PublicationPropertyKey;
  value: string | string[];
  remove?: boolean;
}
export function publicationPropertyRevision(
  properties: Record<string, unknown>,
  key: PublicationPropertyKey,
): string {
  return JSON.stringify([Object.hasOwn(properties, key), properties[key]]);
}
/** Edit only a supported root property; retain all other YAML and manuscript bytes. */
export function changePublicationProperty(
  text: string,
  operation: PublicationPropertyOperation,
): PublicationChange {
  if (!Object.hasOwn(PUBLICATION_PROPERTIES, operation.key))
    throw new Error("This property is not a publishing field.");
  const parsed = publicationYaml(text);
  const root = parsed.document.contents;
  const old = parsed.document.get(operation.key, true) as Node | undefined;
  if (old) writable(old);
  if (operation.remove) {
    if (!old) return { from: 0, to: 0, insert: "" };
    if (!isMap(root) || root.flow)
      throw new Error("Remove properties from a flow mapping in Source mode.");
    const pair = root.items.find(
      (pair) => isScalar(pair.key) && pair.key.value === operation.key,
    );
    if (!pair || !isScalar(pair.key) || !pair.key.range || !old.range)
      throw new Error("Edit this property in Source mode.");
    const from = parsed.offset + pair.key.range[0];
    const line = text.lastIndexOf("\n", from - 1) + 1;
    return {
      from: /^\s*$/.test(text.slice(line, from)) ? line : from,
      to: parsed.offset + old.range[2],
      insert: "",
    };
  }
  const node = parsed.document.createNode(operation.value);
  if (old?.range) {
    const flowRoot = isMap(root) && root.flow;
    if (
      isSeq(node) &&
      (flowRoot ||
        (isSeq(old) && old.flow && old.items.length) ||
        !node.items.length)
    )
      node.flow = true;
    const blockList = isSeq(node) && !node.flow;
    const { newline } = parsed;
    const lines = (
      typeof operation.value === "string" &&
      (flowRoot || /[\r\n]/.test(operation.value))
        ? JSON.stringify(operation.value)
        : new Document(node).toString({ lineWidth: 0 }).trimEnd()
    ).split("\n");
    const from = parsed.offset + old.range[0];
    let to = parsed.offset + old.range[1];
    const ending = text.slice(from, to).endsWith("\n") ? newline : "";
    // A replaced block scalar's header comment sits inside its range.
    const blockScalar =
      isScalar(old) && old.srcToken?.type === "block-scalar"
        ? old.srcToken
        : undefined;
    const token = blockScalar?.props.find((token) => token.type === "comment");
    const comment = token?.type === "comment" ? " " + token.source : "";
    const indent = text.slice(text.lastIndexOf("\n", from - 1) + 1, from);
    const ownLine = /^[ \t]*$/.test(indent);
    if (flowRoot || (blockList ? ownLine : !ownLine || isScalar(old))) {
      // A block list keeps the existing list's column; an empty value sits right after its colon.
      let insert = [lines[0] + comment, ...lines.slice(1)]
        .map((line, i) => (i && blockList ? indent + line : line))
        .join(newline);
      if (/\S/.test(text[from - 1] ?? "")) insert = " " + insert;
      if (from === to && text[to] === "#") insert += " ";
      return { from, to, insert: insert + ending };
    }
    const pair = isMap(root)
      ? root.items.find(
          (pair) => isScalar(pair.key) && pair.key.value === operation.key,
        )
      : undefined;
    const colon =
      pair && isScalar(pair.key) && pair.key.range
        ? text.indexOf(":", parsed.offset + pair.key.range[1]) + 1
        : 0;
    if (!colon || colon > from)
      throw new Error("Edit this property in Source mode.");
    if (!blockList) {
      // A scalar or flow value replacing a block collection moves to the key line; comments stay.
      // The replaced collection's tag would corrupt the new value, so it is dropped.
      const sep = pair?.srcToken?.sep ?? [];
      const gap = sep.slice(
        sep.findIndex((token) => token.type === "map-value-ind") + 1,
      );
      const prop = (type?: string) => type === "tag" || type === "anchor";
      const between = gap
        .filter(
          (token, i) =>
            !prop(token.type) &&
            !(token.type === "space" && prop(gap[i + 1]?.type)),
        )
        .map((token) => token.source)
        .join("")
        .replace(/\r?\n[ \t]*(?=\r?\n|$)/g, "")
        .trimEnd();
      return {
        from: colon,
        to,
        insert: ` ${lines.join(newline)}${comment}${between}${ending}`,
      };
    }
    // A block list replacing a value on the key line starts on the next line.
    let trailing = comment;
    if (!blockScalar) {
      const lineEnd = text.indexOf("\n", to);
      const end = Math.max(
        to,
        lineEnd < 0
          ? text.length
          : lineEnd - (text[lineEnd - 1] === "\r" ? 1 : 0),
      );
      trailing = text.slice(to, end).trimEnd();
      if (trailing && !/^\s/.test(trailing)) trailing = " " + trailing;
      to = end;
    }
    return {
      from: colon,
      to,
      insert:
        trailing + lines.map((line) => newline + "  " + line).join("") + ending,
    };
  }
  if (isMap(root) && root.flow)
    throw new Error("Add properties to a flow mapping in Source mode.");
  const insert = new Document({ [operation.key]: operation.value })
    .toString({ lineWidth: 0 })
    .replaceAll("\n", parsed.newline);
  if (!parsed.end) {
    const from = text.startsWith("\uFEFF") ? 1 : 0;
    return {
      from,
      to: from,
      insert: `---${parsed.newline}${insert}---${parsed.newline}`,
    };
  }
  const closing = /(?:---|\.\.\.)(?:\r?\n|$)$/.exec(text.slice(0, parsed.end))!;
  const from = parsed.end - closing[0].length;
  return { from, to: from, insert };
}
