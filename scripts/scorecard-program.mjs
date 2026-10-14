import { resolve } from "node:path";
import ts from "typescript";

// Generated publication assets are absent in a source-only scanner checkout.
// Hide them through the compiler host, without deleting local build artifacts.
export function scorecardProgram(root, { generatedAssets = true } = {}) {
  // Reproduce the missing ambient Node types observed in the community scanner.
  // This is a compatibility check, not a replica of every scorecard analysis.
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
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, "\n"),
        )
        .join("\n"),
    );

  const options = { ...parsed.options, types: [], typeRoots: [] };
  const host = ts.createCompilerHost(options);
  if (!generatedAssets) {
    const generated = resolve(
      root,
      "src/publication-templates/aastex/files.json",
    );
    const fileExists = host.fileExists;
    host.fileExists = (file) => resolve(file) !== generated && fileExists(file);
  }
  const program = ts.createProgram(
    parsed.fileNames.filter(
      (file) =>
        !file
          .replaceAll("\\", "/")
          .startsWith(resolve(root, "src/test").replaceAll("\\", "/") + "/"),
    ),
    options,
    host,
  );
  // Explicit dependency references can reintroduce Node declarations despite
  // types/typeRoots. Fail instead of silently testing the wrong environment.
  if (
    program
      .getSourceFiles()
      .some((file) =>
        file.fileName
          .replaceAll("\\", "/")
          .includes("/node_modules/@types/node/"),
      )
  )
    throw new Error(
      "Scorecard compatibility program unexpectedly includes Node declarations.",
    );
  return program;
}
