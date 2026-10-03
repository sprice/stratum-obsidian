import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

test("short style locales download and cache the formatter's regional locale", async () => {
  for (const [locale, expected] of [
    ["it", "it-IT"],
    ["pt", "pt-PT"],
    ["ja", "ja-JP"],
    ["nl", "nl-NL"],
    ["fr", "fr-FR"],
  ]) {
    const urls: string[] = [];
    const runtime = loadRuntime<typeof import("../citation-styles")>(
      "citation-styles.ts",
      {
        requestUrl: ({ url }: { url: string }) => {
          urls.push(url);
          return Promise.resolve({
            status: 200,
            text: `<locale xml:lang="${expected}"/>`,
          });
        },
      },
      {
        DOMParser: class {
          parseFromString() {
            return {
              querySelector: () => null,
              documentElement: {
                localName: "style",
                namespaceURI: "http://purl.org/net/xbiblio/csl",
                getAttribute: () => locale,
                setAttribute() {},
              },
              getElementsByTagName: () => [],
            };
          }
        },
        XMLSerializer: class {
          serializeToString() {
            return "<style/>";
          }
        },
      },
    );
    const plugin = {
      isUnloaded: false,
      settings: {
        citationStyles: {},
        citationLocales: {} as Record<string, string>,
      },
      saveSettings: () => Promise.resolve(),
    };
    await runtime.prepareStyle(
      plugin as never,
      "custom-example",
      "en-US",
      "<style/>",
    );
    assert.deepEqual(
      urls,
      locale === "fr"
        ? []
        : [
            `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${expected}.xml`,
          ],
    );
    assert.equal(
      plugin.settings.citationLocales[locale],
      runtime.cachedLocales(plugin as never)[expected],
    );
    assert.ok(runtime.cachedLocales(plugin as never)[expected]);
    if (locale === "fr")
      assert.equal(plugin.settings.citationLocales[expected], undefined);
  }
});
