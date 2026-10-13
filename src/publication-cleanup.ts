import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  visit,
  type Node,
  type YAMLMap,
} from "yaml";
import {
  publicationYaml,
  type PublicationChange,
} from "./publication-metadata";
import { publicationProperties } from "./publish-properties";
import type { PublishOptions } from "./publish-options";
import { aastexPackage } from "./publication-package";

function empty(node: unknown): boolean {
  return (
    node == null ||
    (isScalar(node) &&
      (node.value == null ||
        (typeof node.value === "string" && !node.value.trim()))) ||
    ((isMap(node) || isSeq(node)) && node.items.length === 0)
  );
}
function protectedNode(node: unknown): boolean {
  let protectedValue = false;
  visit(node as Node, (_key, value) => {
    if (
      isAlias(value) ||
      (value && typeof value === "object" && "anchor" in value && value.anchor)
    )
      protectedValue = true;
  });
  return protectedValue;
}
function legacyNames(value: unknown): boolean {
  return (Array.isArray(value) ? value : [value]).some(
    (item) => typeof item === "string" && !!item.trim(),
  );
}

/** Remove only empty fields in the selected renderer's current mappings. */
export function cleanupPublicationProperties(
  text: string,
  layout: PublishOptions,
  aastex: boolean,
): PublicationChange {
  // Cleanup can repair empty structured values that the author form rejects.
  const parsed = publicationYaml(text, false);
  const root = parsed.document.contents;
  if (!isMap(root) || root.flow || root.anchor)
    return { from: 0, to: 0, insert: "" };
  const edits: PublicationChange[] = [];
  const comments: { offset: number; source: string }[] = [];
  function tokens(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const token = value as Record<string, unknown>;
    if (token.type === "comment")
      comments.push({
        offset: Number(token.offset),
        source: String(token.source),
      });
    else
      for (const child of Object.values(token))
        if (Array.isArray(child)) child.forEach(tokens);
        else tokens(child);
  }
  tokens(root.srcToken);
  function remove(map: YAMLMap, key: string, rowEmpty = false): boolean {
    if (map.flow || map.anchor) return false;
    const pair = map.items.find(
      (item) => isScalar(item.key) && item.key.value === key,
    );
    if (
      !pair ||
      !isScalar(pair.key) ||
      !pair.key.range ||
      protectedNode(pair.key) ||
      protectedNode(pair.value)
    )
      return false;
    const value = pair.value as Node | null;
    const end = value?.range?.[2];
    if (end === undefined) return false;
    const start = parsed.offset + pair.key.range[0];
    const line = text.lastIndexOf("\n", start - 1) + 1;
    const prefix = text.slice(line, start);
    if (!/^\s*(?:- )?$/.test(prefix)) return false;
    const dash = prefix.trim() === "-";
    const from = dash ? start : line;
    let to = parsed.offset + end;
    if (end === value?.range?.[0]) {
      if (text.slice(to, to + 2) === "\r\n") to += 2;
      else if (text[to] === "\n") to++;
    }
    const retained = comments.filter(
      (comment) =>
        parsed.offset + comment.offset >= from &&
        parsed.offset + comment.offset < to,
    );
    const indent = " ".repeat(prefix.length);
    let insert = dash ? (rowEmpty ? "{}" : "") + parsed.newline : "";
    insert += retained
      .map((comment) => indent + comment.source + parsed.newline)
      .join("");
    edits.push({ from, to, insert });
    return true;
  }
  const removedRoot = new Set<string>();
  const mapped = new Set(
    publicationProperties(layout).map((field) => field.key),
  );
  for (const key of aastex
    ? layout.titleSource === "properties"
      ? ["title"]
      : []
    : mapped) {
    if (!root.has(key) || !empty(root.get(key, true))) continue;
    if (
      key === "authors" &&
      parsed.properties.authors != null &&
      legacyNames(parsed.properties.author) &&
      !Object.hasOwn(
        (parsed.properties.stratum_publish as object) ?? {},
        "authors",
      )
    )
      continue;
    if (remove(root, key)) removedRoot.add(key);
  }
  const namespace = root.get("stratum_publish", true);
  const structured =
    aastex || mapped.has("authors") || mapped.has("affiliations");
  if (structured && root.has("stratum_publish") && !protectedNode(namespace)) {
    if (empty(namespace)) remove(root, "stratum_publish");
    else if (isMap(namespace) && !namespace.flow) {
      const authors = namespace.get("authors", true);
      if (
        namespace.has("authors") &&
        empty(authors) &&
        (aastex ||
          !mapped.has("affiliations") ||
          !legacyNames(parsed.properties.affiliations)) &&
        !legacyNames(
          (removedRoot.has("authors")
            ? undefined
            : parsed.properties.authors) ?? parsed.properties.author,
        )
      ) {
        if (namespace.items.length === 1) remove(root, "stratum_publish");
        else remove(namespace, "authors");
      } else if (isSeq(authors)) {
        const fields = aastex
          ? aastexPackage.schema.fields.map((field) =>
              field.path.split(".").at(-1)!,
            )
          : [
              ...(mapped.has("authors") ? ["name"] : []),
              ...(mapped.has("affiliations") ? ["affiliations"] : []),
            ];
        for (const author of authors.items) {
          if (!isMap(author) || author.flow || author.anchor) continue;
          const keys = fields.filter(
            (key) => author.has(key) && empty(author.get(key, true)),
          );
          const rowEmpty = keys.length === author.items.length;
          for (const key of keys) remove(author, key, rowEmpty);
        }
      }
    }
  }
  if (!edits.length) return { from: 0, to: 0, insert: "" };
  edits.sort((a, b) => a.from - b.from);
  const from = edits[0].from,
    to = edits.at(-1)!.to;
  let insert = "",
    cursor = from;
  for (const edit of edits) {
    insert += text.slice(cursor, edit.from) + edit.insert;
    cursor = edit.to;
  }
  insert += text.slice(cursor, to);
  publicationYaml(text.slice(0, from) + insert + text.slice(to));
  return { from, to, insert };
}
