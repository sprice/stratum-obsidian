import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ctan = "https://mirrors.ctan.org/macros/latex/contrib/";
// Fixed sources reviewed against publisher/maintainer download pages. No discovery or mirrors are published here.
export const sources = [
  {
    id: "acm",
    url: `${ctan}acmart.zip`,
    required: ["acmart.cls", "ACM-Reference-Format.bst"],
  },
  {
    id: "ieee",
    url: `${ctan}IEEEtran.zip`,
    required: ["IEEEtran.cls", "IEEEtran.bst"],
  },
  {
    id: "revtex",
    url: "https://cdn.journals.aps.org/test/345f0cd4-cab7-4271-9a46-7331fb57618a/revtex-tds-2023-05-30.zip",
    required: [
      "revtex4-2.cls",
      "aps4-2.rtx",
      "aip4-2.rtx",
      "apsrev4-2.bst",
      "aipnum4-2.bst",
      "aipauth4-2.bst",
    ],
  },
  {
    id: "elsevier",
    url: `${ctan}elsarticle.zip`,
    required: [
      "elsarticle.cls",
      "elsarticle-harv.bst",
      "elsarticle-num-names.bst",
    ],
  },
  {
    id: "cas",
    url: `${ctan}els-cas-templates.zip`,
    required: [
      "cas-sc.cls",
      "cas-dc.cls",
      "cas-common.sty",
      "cas-model2-names.bst",
    ],
  },
  {
    id: "mnras",
    url: `${ctan}mnras.zip`,
    required: ["mnras.cls", "mnras.bst"],
  },
  {
    id: "lncs",
    url: `${ctan}llncs.zip`,
    required: ["llncs.cls", "splncs04.bst"],
  },
  {
    id: "aastex",
    url: "https://journals.aas.org/wp-content/uploads/2026/06/aastex702.zip",
    required: ["aastex702.cls"],
    sha256: "008ed27b62a3b1689a256a53893df05080cd01b754b206f4833f864cb16fc25f",
  },
];
// The canonical CTAN redirect can select an unavailable mirror; this fixed official mirror is independently inventoried.
sources.push({
  id: "elsevier-mit",
  referenceFamily: "elsevier",
  url: "https://mirrors.mit.edu/CTAN/macros/latex/contrib/elsarticle.zip",
  required: [
    "elsarticle.cls",
    "elsarticle-harv.bst",
    "elsarticle-num-names.bst",
  ],
});
// Official TeX Live repository candidates provide generated classes without running docstrip.
for (const [id, directory, name] of [
  ["acm", "acmart", "acmart.cls"],
  ["elsevier", "elsarticle", "elsarticle.cls"],
])
  sources.push({
    id: `${id}-texlive`,
    referenceFamily: id,
    format: "file",
    url: `https://tug.org/svn/texlive/trunk/Master/texmf-dist/tex/latex/${directory}/${name}?view=co`,
    required: [name],
  });
const publisherPages = [
  "https://authors.acm.org/proceedings/production-information/preparing-your-article-with-latex",
  "https://www.acm.org/publications/proceedings-template",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Only public HTTPS sources are allowed.");
  return url.href;
}
export async function downloadArchive(url, fetcher = fetch) {
  const signal = AbortSignal.timeout(20_000);
  for (let redirects = 0; ; redirects++) {
    url = httpsUrl(url);
    const response = await fetcher(url, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "Stratum-Obsidian source verification" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (redirects === 3 || !location)
        throw new Error("Invalid or excessive source redirects.");
      url = new URL(location, url).href;
      continue;
    }
    if (response.status !== 200 || !response.body)
      throw new Error(`Source returned HTTP ${response.status}.`);
    if (Number(response.headers.get("content-length")) > 25_000_000) {
      await response.body.cancel();
      throw new Error("Source archive exceeds the byte limit.");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 25_000_000)
        throw new Error("Source archive exceeds the byte limit.");
      chunks.push(chunk);
    }
    return { bytes: Buffer.concat(chunks), finalUrl: url };
  }
}
export function reviewedClassPrefix(family, reference) {
  const anchor = family === "acm" ? "%% \\CharacterTable" : "%%\n%%\n%%\n";
  const start = reference.indexOf(anchor);
  if (start < 0) throw new Error("Missing reviewed class preamble anchor.");
  return reference.slice(0, start);
}
/** Bounded data filtering only: no TeX, installers, evaluation, or downloaded program is invoked. */
export function extractClassData(bytes, name, prefix) {
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
          enabled: stack.at(-1).enabled && tag === "class",
        });
        continue;
      }
      if (kind === "/") {
        if (stack.length === 1 || stack.pop().name !== tag)
          throw new Error("Unbalanced source guard.");
        continue;
      }
      if (stack.at(-1).enabled && (tag === "class" || tag === "class&!tagged"))
        output.push(tail);
    } else if (
      stack.at(-1).enabled &&
      (!line.startsWith("%") || line.startsWith("%%"))
    )
      output.push(line);
  }
  if (stack.length !== 1) throw new Error("Unbalanced source guard.");
  while (output[0] === "") output.shift();
  while (output.at(-1) === "") output.pop();
  return Buffer.from(
    prefix + output.join("\n") + "\n%%\n%% End of file `" + name + "'.\n",
  );
}
/** Read metadata only; neither archive paths nor downloaded code are written/executed. */
export async function inventorySource(
  source,
  referenceFiles,
  readArchive,
  download = downloadArchive,
) {
  const result = { id: source.id, requestedUrl: source.url };
  try {
    const { bytes, finalUrl } = await download(source.url);
    Object.assign(result, {
      finalUrl,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
    if (source.sha256 && result.sha256 !== source.sha256)
      throw new Error("Previously pinned archive fingerprint differs.");
    if (
      source.format === "file" &&
      !new TextDecoder()
        .decode(bytes.subarray(0, 16000))
        .includes("\\ProvidesClass")
    )
      throw new Error("Official file did not contain a class declaration.");
    const files =
      source.format === "file"
        ? { [source.required[0]]: bytes }
        : readArchive(bytes, (data, maxOutputLength) =>
            inflateRawSync(data, { maxOutputLength }),
          );
    const inventory = Object.entries(files).map(([path, data]) => ({
      path,
      bytes: data.length,
      sha256: sha256(data),
    }));
    const required = source.required.map((name) => {
      const matches = inventory.filter(
        (file) => file.path.split("/").at(-1) === name,
      );
      const reference =
        referenceFiles[`${source.referenceFamily ?? source.id}/${name}`];
      return {
        name,
        matches: matches.map((file) => file.path),
        present: matches.length === 1,
        referenceSha256: reference ?? null,
        matchesReference:
          reference && matches.length === 1
            ? matches[0].sha256 === reference
            : null,
      };
    });
    const versionDeclarations = [];
    for (const file of inventory.filter((file) =>
      /\.(cls|sty|rtx)$/.test(file.path),
    )) {
      const header = new TextDecoder().decode(
        files[file.path].subarray(0, 16_000),
      );
      const declarations = header
        .split(/\r?\n/)
        .filter((line) =>
          /\\Provides(Class|Package)|\\def\\RCS(version|date)/.test(line),
        )
        .slice(0, 6)
        .map((line) => line.slice(0, 300));
      if (declarations.length)
        versionDeclarations.push({ path: file.path, declarations });
    }
    let dataExtractionProof;
    if (source.proof) {
      const paths = Object.keys(files).filter(
        (path) => path.split("/").at(-1) === source.proof.source,
      );
      if (paths.length !== 1)
        throw new Error("No unique source for data extraction proof.");
      const extracted = extractClassData(
        files[paths[0]],
        source.proof.name,
        source.proof.prefix,
      );
      dataExtractionProof = {
        sourcePath: paths[0],
        sourceSha256: sha256(files[paths[0]]),
        expectedClassSha256: source.proof.sha256,
        extractedClassSha256: sha256(extracted),
        matchesExpected: sha256(extracted) === source.proof.sha256,
      };
    }
    return {
      ...result,
      dataExtractionProof,
      status: required.every((file) => file.present)
        ? "runtime-present"
        : "missing-runtime",
      required,
      files: inventory,
      versionDeclarations,
      licenseAndSourcePaths: inventory
        .filter((file) =>
          /(readme|licen[cs]e|copying|notice|manifest|\.dtx$)/i.test(file.path),
        )
        .map((file) => file.path),
    };
  } catch (error) {
    return {
      ...result,
      status: "error",
      error:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Source inventory failed.",
    };
  }
}
export async function inventoryPublisherPage(url, download = downloadArchive) {
  try {
    const { bytes, finalUrl } = await download(url);
    const html = new TextDecoder().decode(bytes);
    const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
      .map((match) => {
        try {
          return httpsUrl(
            new URL(match[1].replaceAll("&amp;", "&"), finalUrl).href,
          );
        } catch {
          return null;
        }
      })
      .filter((link) => link && /\.(zip|cls)(?:[?#]|$)/i.test(link));
    return {
      requestedUrl: url,
      finalUrl,
      status: "page-read",
      sha256: sha256(bytes),
      candidateDownloads: [...new Set(links)].slice(0, 30),
    };
  } catch (error) {
    return {
      requestedUrl: url,
      status: "error",
      error:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Publisher page failed.",
    };
  }
}
async function main() {
  const { publicationArchive } =
    await import("../src/publication-resource-archive.ts");
  const provenance = JSON.parse(
    await readFile(
      new URL(
        "../src/publication-templates/journals/provenance.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const results = [];
  for (const source of sources) {
    const family = source.referenceFamily ?? source.id;
    let candidate = source;
    if (source.format !== "file" && ["acm", "elsevier"].includes(family)) {
      const name = family === "acm" ? "acmart" : "elsarticle";
      const reference = await readFile(
        new URL(
          `../src/publication-templates/journals/${family}/${name}.cls`,
          import.meta.url,
        ),
        "utf8",
      );
      const prefix = reviewedClassPrefix(family, reference);
      candidate = {
        ...source,
        proof: {
          name: `${name}.cls`,
          source: `${name}.dtx`,
          sha256: provenance.files[`${family}/${name}.cls`],
          prefix,
        },
      };
    }
    const result = await inventorySource(
      candidate,
      provenance.files,
      publicationArchive,
    );
    results.push(result);
    console.log(
      `${source.id}: ${result.status}${result.error ? ` (${result.error})` : ""}`,
    );
    // Log factual runtime metadata too: reviewers can inspect it without downloading archive payloads.
    console.log(
      `TEMPLATE_SOURCE ${JSON.stringify({
        ...result,
        files: result.files
          ?.filter((file) => /\.(cls|sty|rtx|bst|dtx)$/.test(file.path))
          .slice(0, 100),
      })}`,
    );
  }
  const publisherPageResults = [];
  for (const url of publisherPages) {
    const result = await inventoryPublisherPage(url);
    publisherPageResults.push(result);
    console.log(`TEMPLATE_SOURCE_PAGE ${JSON.stringify(result)}`);
  }
  const report = {
    formatVersion: 1,
    headSha: process.env.SOURCE_HEAD_SHA ?? null,
    generatedAt: new Date().toISOString(),
    purpose:
      "Source inventory only; hashes require review before catalog adoption. No archive contents were executed or published.",
    results,
    publisherPageResults,
  };
  const target = new URL(
    "../.test-artifacts/publishing/template-sources.json",
    import.meta.url,
  );
  await mkdir(dirname(fileURLToPath(target)), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
