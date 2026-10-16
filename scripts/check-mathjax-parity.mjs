import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mathjaxParityExamples } from "../src/test/fixtures/mathjax-parity.ts";

// Only synthetic equations enter the host. This does not read notes or plugin settings.
const vault = process.argv[2];
assert.ok(
  vault,
  "Pass the test vault name. Open the comparison note in Reading view first.",
);
const code = `(async () => {
  if (typeof MathJax === 'undefined' || !MathJax.startup?.document)
    throw new Error('Open the comparison note in Reading view first.');
  const examples = ${JSON.stringify(mathjaxParityExamples)};
  // A separate input processor prevents test macros, labels, and counters leaking into notes.
  const jax = new MathJax._.input.tex_ts.TeX({packages: MathJax.startup.document.inputJax[0].options.packages});
  const doc = MathJax.startup.mathjax.document(document, {InputJax: jax, OutputJax: MathJax.startup.output});
  const failures = [];
  for (const {name, tex} of examples) {
    const item = new doc.options.MathItem(tex, jax, true);
    const root = await MathJax.startup.mathjax.handleRetriesFor(() => jax.compile(item, doc));
    const mml = MathJax.startup.visitor.visitTree(root);
    if (/<merror|data-mjx-error|<mtext[^>]*mathcolor="red"/.test(mml)) failures.push(name);
  }
  return JSON.stringify({version: MathJax.version, count: examples.length, failures});
})()`;
const output = execFileSync(
  "obsidian",
  [`vault=${vault}`, "eval", `code=${code}`],
  { encoding: "utf8" },
);
const result = JSON.parse(output.slice(output.indexOf("=> ") + 3).trim());
assert.deepEqual(
  result.failures,
  [],
  `MathJax rejected: ${result.failures.join(", ")}`,
);
console.log(
  `PASS: ${result.count} synthetic equations with Obsidian MathJax ${result.version}`,
);
