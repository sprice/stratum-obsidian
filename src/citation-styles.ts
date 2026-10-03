import { saveCitationResources } from "./citation-resources";

import { requestUrl } from "obsidian";
import assets from "./csl/assets.json";
import type StratumPlugin from "./plugin";
export interface CitationStyle {
  id: string;
  title: string;
}
export const bundledStyles: CitationStyle[] = [
  { id: "apa", title: "American Psychological Association 7th edition" },
  { id: "ieee", title: "IEEE" },
  {
    id: "chicago-notes-bibliography",
    title: "Chicago Manual of Style 18th edition (notes and bibliography)",
  },
];
export const languages: Record<string, string> = {
  "en-US": "English (US)",
  "en-GB": "English (UK)",
  "fr-FR": "French",
  "de-DE": "German",
  "es-ES": "Spanish",
  "it-IT": "Italian",
  "pt-BR": "Portuguese (Brazil)",
  "nl-NL": "Dutch",
  "zh-CN": "Chinese (simplified)",
  "ja-JP": "Japanese",
};
const initial = assets as Record<string, string>;
export function readStyle(xml: string): {
  title: string;
  parent: string | null;
  locale: string | null;
} {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("This citation style is not supported.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "style" ||
    doc.documentElement.namespaceURI !== "http://purl.org/net/xbiblio/csl"
  )
    throw new Error("Invalid CSL style file.");
  const parent =
    Array.from(doc.getElementsByTagName("link"))
      .find((link) => link.getAttribute("rel") === "independent-parent")
      ?.getAttribute("href") ?? null;
  return {
    title: doc.getElementsByTagName("title")[0]?.textContent || "Custom style",
    parent,
    locale: doc.documentElement.getAttribute("default-locale"),
  };
}
async function download(url: string): Promise<string> {
  const result = await requestUrl({ url, throw: false });
  if (result.status !== 200)
    throw new Error(
      "Could not download citation resources. Your previous style is unchanged.",
    );
  if (result.text.length > 8_000_000)
    throw new Error("Citation resource is too large.");
  return result.text;
}
let catalog: Promise<CitationStyle[]> | undefined;
export function styleCatalog(): Promise<CitationStyle[]> {
  return (catalog ??= fetchStyleCatalog().catch((error: unknown) => {
    catalog = undefined;
    throw error;
  }));
}
async function fetchStyleCatalog(): Promise<CitationStyle[]> {
  const data: unknown = JSON.parse(
    await download("https://www.zotero.org/styles-files/styles.json"),
  );
  if (!Array.isArray(data))
    throw new Error("Could not read the citation style catalog.");
  return data.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    return typeof value.name === "string" &&
      /^[a-z0-9-]+$/.test(value.name) &&
      typeof value.title === "string"
      ? [{ id: value.name, title: value.title }]
      : [];
  });
}
export function cachedStyle(
  plugin: StratumPlugin,
  id: string,
): string | undefined {
  if (Object.hasOwn(initial, id)) return initial[id];
  if (Object.hasOwn(plugin.settings.citationStyles, id))
    return plugin.settings.citationStyles[id];
  return Object.hasOwn(initial, id) ? initial[id] : undefined;
}
export function cachedLocales(plugin: StratumPlugin): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(initial).filter(
        ([key]) => key.includes("-") && key.length === 5,
      ),
    ),
    ...Object.fromEntries(
      Object.entries(plugin.settings.citationLocales).filter(
        ([key]) => !Object.hasOwn(initial, key),
      ),
    ),
  };
}
/** Resolve dependencies before persisting a selection; no partial switch on network failure. */
export async function prepareStyle(
  plugin: StratumPlugin,
  id: string,
  language: string,
  customXml?: string,
): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(id))
    throw new Error("Invalid citation style identifier.");
  const styles: Record<string, string> = {};
  let chosenTitle: string | undefined;
  let chosenLocale: string | null = null;
  const visited = new Set<string>();
  let current = id,
    xml = customXml ?? cachedStyle(plugin, id);
  for (let depth = 0; depth < 6; depth++) {
    if (visited.has(current))
      throw new Error("Circular citation style dependency.");
    visited.add(current);
    xml ??= await download(`https://www.zotero.org/styles/${current}`);
    const info = readStyle(xml);
    if (depth === 0) {
      chosenTitle = plugin.settings.citationStyleTitles?.[id] ?? info.title;
      chosenLocale = info.locale;
    }
    if (!info.parent) break;
    const url = new URL(info.parent);
    if (
      !["www.zotero.org", "zotero.org"].includes(url.hostname) ||
      !/^\/styles\/[a-z0-9-]+$/.test(url.pathname)
    )
      throw new Error(
        "Unsupported parent style. Import its independent CSL file instead.",
      );
    current = url.pathname.split("/").pop()!;
    xml = cachedStyle(plugin, current);
    if (depth === 5) throw new Error("Too many parent citation styles.");
  }
  if (!xml) throw new Error("Missing citation style.");
  if (chosenLocale) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    doc.documentElement.setAttribute("default-locale", chosenLocale);
    xml = new XMLSerializer().serializeToString(doc);
  }
  const info = readStyle(xml);
  const locales = cachedLocales(plugin);
  const CSL = (await import("citeproc")).default;
  for (const lang of new Set([
    language,
    info.locale?.split(" ")[0] || "en-US",
    "en-US",
  ])) {
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(lang))
      throw new Error("Unsupported formatting language.");
    if (!locales[lang]) {
      // Use the same base-language mapping as the formatter (e.g. it → it-IT).
      const requested = lang.includes("-")
        ? lang
        : (CSL.LANG_BASES[lang]?.replace(/_/g, "-") ?? lang);
      const resource =
        locales[requested] ??
        (await download(
          `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${requested}.xml`,
        ));
      if (!resource.includes("<locale") || /<!DOCTYPE|<!ENTITY/i.test(resource))
        throw new Error("Invalid formatting language file.");
      locales[lang] = resource;
      locales[requested] = resource;
    }
  }
  if (!Object.hasOwn(initial, id) || customXml) styles[id] = xml;
  if (plugin.isUnloaded) throw new Error("Stratum has been unloaded.");
  const previousStyles = plugin.settings.citationStyles;
  const previousLocales = plugin.settings.citationLocales;
  const previousTitles = plugin.settings.citationStyleTitles;
  plugin.settings.citationStyleTitles = {
    ...previousTitles,
    [id]: chosenTitle ?? info.title,
  };
  plugin.settings.citationStyles = {
    ...Object.fromEntries(
      Object.entries(plugin.settings.citationStyles).filter(
        ([key]) => !Object.hasOwn(initial, key),
      ),
    ),
    ...styles,
  };
  plugin.settings.citationLocales = Object.fromEntries(
    Object.entries(locales).filter(([key, value]) => initial[key] !== value),
  );
  try {
    await saveCitationResources(plugin);
    await plugin.saveSettings();
  } catch (error) {
    plugin.settings.citationStyles = previousStyles;
    plugin.settings.citationLocales = previousLocales;
    plugin.settings.citationStyleTitles = previousTitles;
    throw error;
  }
}

export function styleTitle(plugin: StratumPlugin, id: string): string {
  const bundled = bundledStyles.find((style) => style.id === id);
  if (bundled) return bundled.title;
  const xml = cachedStyle(plugin, id);
  try {
    return (
      plugin.settings.citationStyleTitles?.[id] ??
      (xml ? readStyle(xml).title : id)
    );
  } catch {
    return id;
  }
}
