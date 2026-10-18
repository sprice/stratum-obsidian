import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { scorecardProgram } from "./scorecard-program.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
{
  const program = scorecardProgram(root);
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
}
