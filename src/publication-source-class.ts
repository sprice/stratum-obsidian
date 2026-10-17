/** Data-only docstrip subset; unknown guards fail closed. Output must match a bundled SHA-256 pin. */
export function extractPublicationClass(
  bytes: Uint8Array,
  name: string,
  prefix: string,
): Uint8Array {
  const lines = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .split(/\r?\n/);
  const stack = [{ name: "", enabled: true }],
    output = [];
  const known = new Set([
    "class",
    "class&!tagged",
    "tagged",
    "gobble",
    "driver",
  ]);
  for (let line of lines) {
    line = line.trimEnd();
    const match = /^%<([^>]+)>(.*)$/.exec(line);
    if (match) {
      const [guard, tail] = [match[1], match[2]];
      const kind = guard[0],
        tag = kind === "*" || kind === "/" ? guard.slice(1) : guard;
      if (!known.has(tag)) throw new Error("Unsupported source guard.");
      if (kind === "*") {
        stack.push({
          name: tag,
          enabled: stack.at(-1)!.enabled && tag === "class",
        });
        continue;
      }
      if (kind === "/") {
        if (stack.length === 1 || stack.pop()!.name !== tag)
          throw new Error("Unbalanced source guard.");
        continue;
      }
      if (stack.at(-1)!.enabled && (tag === "class" || tag === "class&!tagged"))
        output.push(tail);
    } else if (
      stack.at(-1)!.enabled &&
      (!line.startsWith("%") || line.startsWith("%%"))
    )
      output.push(line);
  }
  if (stack.length !== 1) throw new Error("Unbalanced source guard.");
  while (output[0] === "") output.shift();
  while (output.at(-1) === "") output.pop();
  return new TextEncoder().encode(
    prefix + output.join("\n") + "\n%%\n%% End of file `" + name + "'.\n",
  );
}
