import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { base64Findings } from "./scorecard-rules.mjs";

export function scorecardBundlePlugin() {
  return {
    name: "scorecard-bundle",
    setup(build) {
      build.onResolve({ filter: /(?:^|[\/])binary\.js$/ }, (args) => {
        if (!/[\/]yaml[\/]browser[\/]dist[\/]schema[\/]/.test(args.importer))
          return;
        return {
          path: fileURLToPath(
            new URL("../src/yaml-binary.ts", import.meta.url),
          ),
        };
      });
      build.onEnd(async (result) => {
        if (result.errors.length) return;
        const outputs = result.outputFiles ?? [
          {
            path: build.initialOptions.outfile,
            text: await readFile(build.initialOptions.outfile, "utf8"),
          },
        ];
        return {
          errors: outputs
            .filter((file) => /\.js$/.test(file.path))
            .flatMap((file) =>
              base64Findings(file.text, file.path).map((finding) => ({
                text: `Runtime base64 call in bundle ${finding.file}:${finding.line}:${finding.column}`,
              })),
            ),
        };
      });
    },
  };
}
