import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";

// Reproduce the missing ambient Node types observed in the community scanner.
// This is a compatibility check, not a replica of every scorecard analysis.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = ts.readConfigFile(
  resolve(root, "tsconfig.json"),
  ts.sys.readFile,
);
if (config.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
  );
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
if (parsed.errors.length)
  throw new Error(
    parsed.errors
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
      .join("\n"),
  );

const program = ts.createProgram(
  parsed.fileNames.filter(
    (file) => !file.startsWith(resolve(root, "src/test") + "/"),
  ),
  { ...parsed.options, types: [], typeRoots: [] },
);
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [
    { ignores: ["src/test/**"] },
    {
      files: ["src/**/*.ts"],
      languageOptions: {
        parserOptions: {
          projectService: false,
          project: false,
          programs: [program],
        },
      },
      rules: {
        "@typescript-eslint/no-unsafe-assignment": "error",
        "@typescript-eslint/no-unsafe-call": "error",
        "@typescript-eslint/no-unsafe-member-access": "error",
        "@typescript-eslint/no-unsafe-argument": "error",
        "@typescript-eslint/no-unsafe-return": "error",
      },
    },
  ],
});
const results = await eslint.lintFiles(["src/**/*.ts"]);
const formatter = await eslint.loadFormatter("stylish");
const output = formatter.format(results);
if (output) process.stdout.write(output);
const failed = results.some(
  (result) =>
    result.errorCount || result.warningCount || result.fatalErrorCount,
);
if (failed) {
  console.error(
    "Scorecard compatibility lint failed. Resolve unsafe types without relying on ambient @types/node.",
  );
  process.exitCode = 1;
} else {
  console.log(
    "Scorecard compatibility lint passed without ambient Node types.",
  );
}
