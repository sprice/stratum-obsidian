import { packageFixture as fixture } from "./publication-package-fixture";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readTemplatePackage,
  packageVariant,
  packageProblems,
  resolvePackageResources,
  type TemplatePackage,
} from "../publication-package";
import { publicationManuscript } from "../publication-manuscript";
import { qualificationCache } from "./qualify-template";
import { loadRuntime } from "./runtime-harness";
import type * as Renderer from "../publication-package-render";

const renderer = loadRuntime<typeof Renderer>(
  "publication-package-render.ts",
  {},
  { TextDecoder, TextEncoder, Uint8Array, crypto: webcrypto },
);
test("unknown family and variants are accepted without a consumer registry", () => {
  const { p } = fixture();
  assert.equal(readTemplatePackage(p), p);
  assert.equal(packageVariant(p).id, "main");
  assert.throws(() => packageVariant(p, "missing"));
});
const mutations: Record<string, (p: TemplatePackage) => void> = {
  "unsupported ABI": (p) => {
    p.spec = "v99" as TemplatePackage["spec"];
  },
  "unsupported capability": (p) => {
    p.capabilities.push("shell" as never);
  },
  "traversal id": (p) => {
    p.id = "../outside";
  },
  "traversal version": (p) => {
    p.version = "..";
  },
  "unknown top-level": (p) => {
    Object.assign(p, { command: "sh" });
  },
  "credential source": (p) => {
    p.sources[0].url = "https://user:secret@example.org/file";
  },
  "http source": (p) => {
    p.sources[0].url = "http://example.org/file";
  },
  "source provenance required": (p) => {
    p.sources = [];
  },
  "empty variants": (p) => {
    p.variants = [];
  },
  "duplicate variants": (p) => {
    p.variants.push(structuredClone(p.variants[0]));
  },
  "missing default": (p) => {
    p.defaultVariant = "unknown";
  },
  "wrong template role": (p) => {
    p.assets[0].role = "source";
  },
  "missing style": (p) => {
    p.variants[0].citations.style = "missing.csl";
  },
  "downloaded filter": (p) => {
    Object.assign(p.variants[0], { filter: "download.lua" });
  },
  "unknown citation engine": (p) => {
    p.variants[0].citations.engine = "biber" as never;
  },
  "javascript resource": (p) => {
    p.assets[0].name = "execute.js";
    p.assets[0].role = "resource";
  },
  "path traversal asset": (p) => {
    p.assets[0].name = "../layout.tex";
  },
  "scratch collision": (p) => {
    p.assets[0].name = "body.md";
  },
  "duplicate case filename": (p) => {
    p.assets.push({ ...p.assets[0], name: "LAYOUT.TEX" });
  },
  "external download": (p) => {
    p.assets[0].download = "https://evil.example/file";
  },
  "different package download": (p) => {
    p.assets[0].download = p.assets[0].download!.replace("unfamiliar", "other");
  },
  "oversize resource": (p) => {
    p.assets[0].bytes = 33 * 1024 * 1024;
  },
  "fractional resource": (p) => {
    p.assets[0].bytes = 1.5;
  },
  "bad digest": (p) => {
    p.assets[0].sha256 = "bad";
  },
  "unknown author requirement": (p) => {
    p.variants[0].requires.authorDetails = ["shell" as never];
  },
  "duplicate author requirement": (p) => {
    p.variants[0].requires.authorDetails = ["email", "email"];
  },
  "prototype field": (p) => {
    p.variants[0].fields = [
      {
        key: "constructor",
        label: "Bad",
        type: "text",
        required: false,
        default: "",
      },
    ];
  },
  "duplicate field": (p) => {
    const f = {
      key: "course",
      label: "Course",
      type: "text" as const,
      required: true,
      default: "",
    };
    p.variants[0].fields = [f, f];
  },
};
for (const [label, mutate] of Object.entries(mutations))
  test(`rejects ${label}`, () => {
    const { p } = fixture();
    mutate(p);
    assert.throws(() => readTemplatePackage(p));
  });
test("manifest-defined fields validate values, defaults, dates and anonymity", () => {
  const { p } = fixture(),
    v = p.variants[0],
    m = publicationManuscript("# Title", "body");
  assert.equal(packageProblems(v, m).length, 2);
  v.anonymous = true;
  v.requires.abstract = false;
  v.fields = [
    {
      key: "deadline",
      label: "Deadline",
      type: "date",
      required: true,
      default: "2026-02-30",
    },
    {
      key: "topics",
      label: "Topics",
      type: "list",
      required: true,
      default: "",
    },
  ];
  assert.equal(packageProblems(v, m).length, 2);
  m.properties.deadline = "2026-02-28";
  m.properties.topics = ["new field"];
  assert.deepEqual(packageProblems(v, m), []);
  m.properties.topics = "not a list";
  assert.match(packageProblems(v, m)[0], /Topics/);
});
test("metadata uses escaped Pandoc text nodes and hides anonymous identities", () => {
  const { p } = fixture(),
    v = p.variants[0];
  v.requires.affiliations = false;
  v.requires.abstract = false;
  const manuscript = publicationManuscript(
    "---\nauthors: [Synthetic Person]\n---\n# \\input{secret} & 50%",
    "body",
  );
  const input = { package: p, manuscript, references: [], resources: {} };
  assert.ok(
    JSON.stringify(renderer.packageMetadata(input)).includes('"t":"Str"'),
  );
  assert.ok(
    !JSON.stringify(renderer.packageMetadata(input)).includes("RawInline"),
  );
  v.anonymous = true;
  assert.ok(
    !JSON.stringify(renderer.packageMetadata(input)).includes(
      "Synthetic Person",
    ),
  );
});
test("wrapper partials cannot read host files", () => {
  for (const partial of [
    "$../../secret()$",
    '$partial("/secret")$',
    "$fonts.latex()$",
  ])
    assert.throws(() => renderer.validatePackageWrapper(partial));
  renderer.validatePackageWrapper(
    "$if(title)$$title$$endif$ $for(authors)$$authors.name$$sep$, $endfor$",
  );
});
test("fresh install verifies every asset, offline reuse needs no download, corrupt cache fails closed", async () => {
  const { p, bytes } = fixture();
  // Distinct content-addressed assets can share bytes; one fetch is sufficient.
  const directory = await mkdtemp(join(tmpdir(), "package-test-")),
    cache = qualificationCache(directory);
  let calls = 0;
  try {
    const resources = await resolvePackageResources(
      cache,
      p,
      () => {
        calls++;
        return Promise.resolve(bytes);
      },
      "https://example.org",
    );
    assert.equal(calls, 1);
    assert.deepEqual(Object.keys(resources), ["layout.tex", "style.csl"]);
    await resolvePackageResources(
      cache,
      p,
      () => Promise.reject(new Error("offline network")),
      "https://example.org",
      true,
    );
    await writeFile(join(directory, `${p.assets[0].sha256}.bin`), "corrupt");
    await assert.rejects(
      resolvePackageResources(
        cache,
        p,
        () => Promise.reject(new Error("offline network")),
        "https://example.org",
        true,
      ),
    );
    await assert.rejects(
      resolvePackageResources(
        cache,
        p,
        () => Promise.resolve(new Uint8Array([1])),
        "https://example.org",
      ),
    );
    await assert.rejects(
      resolvePackageResources(
        cache,
        p,
        () => Promise.resolve(bytes),
        "https://example.org/subpath",
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("cancelled installation never downloads", async () => {
  const { p } = fixture(),
    directory = await mkdtemp(join(tmpdir(), "package-test-")),
    controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      resolvePackageResources(
        qualificationCache(directory),
        p,
        () => {
          throw new Error("download unexpectedly called");
        },
        "https://example.org",
        false,
        controller.signal,
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("renderer rejects unsafe content and unresolved citations and always removes scratch", async (t) => {
  const { testPublishingWorkspace } = await import("./publishing-workspace");
  const { readFile, access } = await import("node:fs/promises");
  const cases: [string, unknown[], Record<string, unknown>[], RegExp][] = [
    [
      "raw TeX",
      [{ t: "RawInline", c: ["latex", "\\input{secret}"] }],
      [],
      /Raw markup/,
    ],
    ["external image", [{ t: "Image", c: [] }], [], /vault images/],
    [
      "math file read",
      [{ t: "Math", c: [{ t: "InlineMath" }, "\\input{secret}"] }],
      [],
      /math command/,
    ],
    [
      "constructed math command",
      [{ t: "Math", c: [{ t: "InlineMath" }, "\\csname input\\endcsname"] }],
      [],
      /math command/,
    ],
    [
      "unknown reference",
      [{ t: "Cite", c: [[{ citationId: "unknown" }], []] }],
      [],
      /no reference/,
    ],
    [
      "unsafe citation id",
      [{ t: "Cite", c: [[{ citationId: "a}\\input{secret}" }], []] }],
      [],
      /citation identifier/,
    ],
    [
      "duplicate references",
      [],
      [{ id: "alpha" }, { id: "alpha" }],
      /duplicate reference/,
    ],
  ];
  for (const [label, blocks, references, message] of cases)
    await t.test(label, async () => {
      const { p, bytes } = fixture();
      p.variants[0].requires = {
        title: false,
        authors: false,
        affiliations: false,
        abstract: false,
        authorDetails: [],
      };
      let created = "",
        compilerCalls = 0;
      const instance = loadRuntime<typeof Renderer>(
        "publication-package-render.ts",
        {},
        { TextDecoder, TextEncoder, Uint8Array, crypto: webcrypto },
        "browser",
        {
          "./publish-desktop": {
            async runPublishTool(
              _tool: string,
              args: string[],
              options: { cwd: string },
            ) {
              if (args.includes("--to=json"))
                await writeFile(
                  join(options.cwd, args[args.indexOf("-o") + 1]),
                  JSON.stringify({
                    "pandoc-api-version": [1, 23, 1],
                    meta: {},
                    blocks: args.includes("body.md") ? blocks : [],
                  }),
                );
              else compilerCalls++;
              return "";
            },
          },
        },
      );
      await assert.rejects(
        instance.renderTemplatePackage(
          {
            package: p,
            manuscript: publicationManuscript("# Synthetic", "body"),
            resources: { "layout.tex": bytes, "style.csl": bytes },
            references,
          },
          {
            workspace: testPublishingWorkspace((d) => {
              created = d;
            }),
            pandoc: "pandoc",
            tectonic: "tectonic",
          },
        ),
        message,
      );
      assert.equal(compilerCalls, 0);
      assert.ok(created);
      await assert.rejects(access(created));
      // The helper's cleanup has removed the surrounding temporary root too.
      await assert.rejects(readFile(join(created, "input.json")));
    });
});

test("package dialog finishes publishing without assimilating Obsidian's thenable button", async () => {
  const { p } = fixture();
  class Element {
    text = "";
    setText(value: string) {
      this.text = value;
    }
    createEl() {
      return new Element();
    }
    createDiv() {
      return new Element();
    }
    querySelectorAll() {
      return [];
    }
    empty() {}
  }
  const buttons: Button[] = [];
  let assimilations = 0,
    created = "";
  class Button {
    label = "";
    disabled = false;
    callback?: () => void;
    then(resolve: (value: unknown) => void) {
      assimilations++;
      resolve(undefined);
    }
    setButtonText(value: string) {
      this.label = value;
      return this;
    }
    setDisabled(value: boolean) {
      this.disabled = value;
      return this;
    }
    setCta() {
      return this;
    }
    onClick(callback: () => void) {
      this.callback = callback;
      return this;
    }
  }
  class Setting {
    setName() {
      return this;
    }
    setDesc() {
      return this;
    }
    addText() {
      return this;
    }
    addDropdown(callback: (value: unknown) => void) {
      const d = { addOption: () => d, setValue: () => d, onChange: () => d };
      callback(d);
      return this;
    }
    addButton(callback: (button: Button) => void) {
      const b = new Button();
      buttons.push(b);
      callback(b);
      return this;
    }
  }
  class File {
    path = "package/manifest.json";
    extension = "json";
  }
  const manifest = new File();
  const app = {
    vault: {
      getAbstractFileByPath: () => manifest,
      read: () => Promise.resolve(JSON.stringify(p)),
      createBinary: (path: string) => {
        created = path;
        return Promise.resolve();
      },
      adapter: { exists: () => Promise.resolve(false) },
    },
  };
  const { PublicationPackageModal } = loadRuntime<{
    PublicationPackageModal: new (
      plugin: unknown,
      note: unknown,
    ) => {
      onOpen(): void;
      load(): Promise<void>;
      manifestPath: string;
    };
  }>(
    "publication-package-modal.ts",
    {
      Modal: class {
        app = app;
        contentEl = new Element();
        titleEl = new Element();
      },
      Component: class {
        register() {}
      },
      Setting,
      TFile: File,
      normalizePath: (s: string) => s,
    },
    { AbortController },
    "node",
    {
      "./publication-package": {
        readTemplatePackage,
        packageVariant,
        resolvePackageResources: () => Promise.resolve({}),
      },
      "./publication-package-render": {
        renderTemplatePackage: () =>
          Promise.resolve({ pdf: new Uint8Array([1]) }),
      },
      "./publication-manuscript": {
        publicationManuscript: () => ({
          properties: {},
          title: "Synthetic",
          authors: [],
          body: "Synthetic",
          abstract: "",
        }),
      },
      "./publish-desktop": {
        detectPublishTool: () => Promise.resolve({ path: "/synthetic/tool" }),
      },
      "./publish-workspace": { publishingWorkspace: () => ({}) },
    },
  );
  const dialog = new PublicationPackageModal(
    { app, settings: {}, addChild() {} },
    { path: "Papers/Synthetic.md" },
  );
  dialog.onOpen();
  dialog.manifestPath = manifest.path;
  await dialog.load();
  const publish = buttons.find((b) => b.label === "Publish PDF")!;
  assert.ok(publish.callback);
  publish.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(created, "Papers/Synthetic.package.pdf");
  assert.equal(publish.disabled, false);
  assert.equal(assimilations, 0);
});

test("portable packages accept safe folders, reject ambiguous scratch names and contain no transport configuration", () => {
  const { p } = fixture();
  p.spec = "pandoc-latex-package-v2";
  for (const asset of p.assets) {
    delete asset.download;
    asset.name = `resources/${asset.name}`;
  }
  p.variants[0].template = "resources/layout.tex";
  p.variants[0].citations.style = "resources/style.csl";
  assert.equal(readTemplatePackage(p), p);
  for (const name of [
    "../layout.tex",
    "resources/../layout.tex",
    "/layout.tex",
    "resources\\layout.tex",
    "resources/body.md",
    "resources/manifest.json",
  ]) {
    const bad = structuredClone(p);
    bad.assets[0].name = name;
    assert.throws(() => readTemplatePackage(bad));
  }
  const duplicate = structuredClone(p);
  duplicate.assets.push({ ...p.assets[0], name: "templates/layout.tex" });
  assert.throws(() => readTemplatePackage(duplicate));
  const transport = structuredClone(p);
  transport.assets[0].download = "https://unexpected.example/resource";
  assert.throws(() => readTemplatePackage(transport));
});

test("installation pins manifests, verifies every resource, repairs cache and preserves versioned choices", async () => {
  const {
    installTemplatePackage,
    verifyPackageInstallation,
    installedPackageChoices,
    readPackageLink,
  } = await import("../publication-package-installation");
  const { readPublishingTemplates } = await import("../publish-templates");
  const { p, bytes } = fixture();
  const sha256 = createHash("sha256").update(JSON.stringify(p)).digest("hex");
  const request = readPackageLink({ id: p.id, version: p.version, sha256 });
  assert.throws(() => readPackageLink({ ...request, id: "../outside" }));
  const directory = await mkdtemp(join(tmpdir(), "stratum-package-install-"));
  try {
    const cache = qualificationCache(directory);
    let count = 0;
    const download = (spec: { url: string }) => {
      assert.equal(
        new URL(spec.url).origin,
        "https://templates.stratumnotes.com",
      );
      count++;
      return Promise.resolve(
        new URL(spec.url).pathname.endsWith(`/unfamiliar/1.0`)
          ? new TextEncoder().encode(JSON.stringify(p))
          : bytes,
      );
    };
    const installed = await installTemplatePackage(request, cache, download);
    await verifyPackageInstallation(installed);
    assert.equal(count, 2); // Identical content-addressed assets share a download.
    const choices = installedPackageChoices(installed);
    assert.equal(choices[0].renderer, "package");
    assert.equal(choices[0].id, "download:unfamiliar:1.0:main");
    const next = structuredClone(installed);
    next.manifest.version = "2.0";
    for (const asset of next.manifest.assets)
      asset.download = asset.download?.replace("/1.0/", "/2.0/");
    const state = readPublishingTemplates({
      packageInstallations: [installed, next],
    });
    assert.equal(state.packageInstallations?.length, 2);
    const modified = structuredClone(installed);
    modified.manifest.name = "Changed";
    await assert.rejects(verifyPackageInstallation(modified), /integrity/);
    await assert.rejects(
      installTemplatePackage(
        { ...request, sha256: "f".repeat(64) },
        cache,
        download,
      ),
      /does not match/,
    );
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      installTemplatePackage(
        request,
        cache,
        () => {
          throw new Error("network reached");
        },
        cancelled.signal,
      ),
      /cancelled/,
    );
    await writeFile(join(directory, `${p.assets[0].sha256}.bin`), "damaged");
    await installTemplatePackage(request, cache, download);
    assert.equal(count, 5);
    await resolvePackageResources(
      cache,
      p,
      () => {
        throw new Error("offline network reached");
      },
      "https://templates.stratumnotes.com",
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("renderer rejects image collisions and excessive image collections before creating scratch", async () => {
  const { p } = fixture();
  p.variants[0].requires = {
    title: false,
    authors: false,
    affiliations: false,
    abstract: false,
    authorDetails: [],
  };
  p.assets.push({ ...p.assets[0], name: "asset-0.png", role: "resource" });
  const image = new Uint8Array(1);
  const tools = {
    workspace: {
      create: () => {
        throw new Error("Scratch must not be created");
      },
    },
    pandoc: "pandoc",
    tectonic: "tectonic",
  };
  for (const [images, message] of [
    [{ "asset-0.png": image }, /collision/],
    [
      Object.fromEntries(
        Array.from({ length: 101 }, (_, i) => [`asset-${i + 1}.png`, image]),
      ),
      /image limit/,
    ],
    [
      Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [
          `asset-${i + 1}.png`,
          new Uint8Array(20 * 1024 * 1024),
        ]),
      ),
      /image limit/,
    ],
    [{ "asset-1.png": new Uint8Array(21 * 1024 * 1024) }, /image limit/],
  ] as const) {
    await assert.rejects(
      renderer.renderTemplatePackage(
        {
          package: p,
          manuscript: publicationManuscript("# Synthetic", "body"),
          resources: {},
          references: [],
          images,
        },
        tools,
      ),
      message,
    );
  }
});
