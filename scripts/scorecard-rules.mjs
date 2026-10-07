import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsers } from "prettier/plugins/postcss";
import ts from "typescript";

export async function cssFindings(text, file = "styles.css") {
  const findings = [];
  const root = await parsers.css.parse(text);
  function visit(node) {
    if (node.type === "css-decl") {
      const location = { file, ...node.source.start };
      if (node.important) findings.push({ ...location, rule: "css-important" });
      if (
        node.prop.toLowerCase() === "display" &&
        node.value.text
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .trim()
          .toLowerCase() === "contents"
      )
        findings.push({ ...location, rule: "css-display-contents" });
    }
    for (const child of node.nodes ?? []) visit(child);
  }
  visit(root);
  return findings;
}

// Recognize direct calls, including literal computed properties and optional calls.
// This is a source regression guard, not a data-flow or obfuscation scanner.
function unwrap(node) {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node))
  )
    node = node.expression;
  return node;
}
function member(node) {
  node = unwrap(node);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression)
  )
    return node.argumentExpression.text;
  return null;
}
export function decodingFindings(text, file = "source.ts") {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const findings = [];
  function visit(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = unwrap(node.expression);
      const name = member(callee);
      const receiver =
        ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee)
          ? member(callee.expression)
          : null;
      const encoding = unwrap(node.arguments?.[1]);
      const bufferDecode =
        ((name === "from" && receiver === "Buffer") ||
          (ts.isNewExpression(node) && name === "Buffer")) &&
        encoding &&
        ts.isStringLiteralLike(encoding) &&
        /^(base64|base64url)$/i.test(encoding.text);
      if (
        name === "atob" ||
        name === "fromBase64" ||
        name === "setFromBase64" ||
        bufferDecode
      ) {
        const position = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        );
        findings.push({
          file,
          line: position.line + 1,
          column: position.character + 1,
          rule: "base64-decoding",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return findings;
}
export async function scorecardFindings(root) {
  const findings = await cssFindings(
    await readFile(join(root, "styles.css"), "utf8"),
  );
  async function visit(directory, relative) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${relative}/${entry.name}`;
      if (file === "src/test") continue;
      if (entry.isDirectory()) await visit(join(directory, entry.name), file);
      else if (entry.isFile() && entry.name.endsWith(".ts"))
        findings.push(
          ...decodingFindings(
            await readFile(join(directory, entry.name), "utf8"),
            file,
          ),
        );
    }
  }
  await visit(join(root, "src"), "src");
  return findings;
}
const messages = {
  "css-important": "Avoid !important; use scoped specificity or CSS variables.",
  "css-display-contents":
    "Avoid display: contents; use a supported layout or change the markup.",
  "base64-decoding":
    "Avoid runtime base64 decoding; store embedded assets as bytes.",
};
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = process.argv[2]
    ? resolve(process.argv[2])
    : fileURLToPath(new URL("../", import.meta.url));
  const findings = await scorecardFindings(root);
  for (const finding of findings)
    console.error(
      `${finding.file}:${finding.line}:${finding.column} ${finding.rule}: ${messages[finding.rule]}`,
    );
  if (findings.length) process.exitCode = 1;
  else console.log("Scorecard CSS and decoding rules passed.");
}
