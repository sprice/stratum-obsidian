import type { ZoteroItemDetail } from "./backend-client";

export function toCalloutBlock(
  type: string,
  title: string,
  bodyLines: string[]
): string {
  return [`> [!${type}] ${title}`, ...bodyLines.map((line) => `> ${line}`)].join(
    "\n"
  );
}

export function toFoldableCalloutBlock(
  type: string,
  title: string,
  bodyLines: string[],
  collapsed = true
): string {
  const marker = collapsed ? "-" : "+";
  return [`> [!${type}]${marker} ${title}`, ...bodyLines.map((line) => `> ${line}`)].join(
    "\n"
  );
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function stripMarkdownFormatting(value: string): string {
  return value
    .replace(/^\s{0,3}>+\s*/, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .trim();
}

function getNoteSnippet(markdown: string): string | null {
  for (const rawLine of markdown.split("\n")) {
    const line = stripMarkdownFormatting(rawLine);
    if (line.length > 0) {
      return truncateText(line, 72);
    }
  }

  return null;
}

export function getZoteroNoteCalloutTitle(
  markdown: string,
  index: number
): string {
  const snippet = getNoteSnippet(markdown);
  if (!snippet) {
    return `Zotero note ${index + 1}`;
  }

  return `Zotero note ${index + 1} · ${snippet}`;
}

export function getHighlightGroupCalloutTitle(
  label: string,
  annotations: ZoteroItemDetail["annotations"]
): string {
  const suffix = annotations.length === 1 ? "highlight" : "highlights";
  return `${label} · ${annotations.length} ${suffix}`;
}

export function getHighlightCalloutType(colorCategory: string): string {
  const map: Record<string, string> = {
    Yellow: "stratum-yellow",
    Red: "stratum-red",
    Green: "stratum-green",
    Blue: "stratum-blue",
    Purple: "stratum-purple",
    Magenta: "stratum-magenta",
    Orange: "stratum-orange",
    Cyan: "stratum-cyan",
    Gray: "stratum-gray",
    Black: "stratum-gray",
    White: "stratum-gray",
    Uncolored: "quote",
  };
  return map[colorCategory] ?? "quote";
}

export function getColorCategory(hex: string | null): string {
  if (!hex) {
    return "Uncolored";
  }

  let r = 0;
  let g = 0;
  let b = 0;

  if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16) / 255;
    g = parseInt(hex.slice(3, 5), 16) / 255;
    b = parseInt(hex.slice(5, 7), 16) / 255;
  }

  const cmin = Math.min(r, g, b);
  const cmax = Math.max(r, g, b);
  const delta = cmax - cmin;
  let hue = 0;
  let saturation = 0;
  let lightness = 0;

  if (delta !== 0) {
    if (cmax === r) {
      hue = ((g - b) / delta) % 6;
    } else if (cmax === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
  }

  hue = Math.round(hue * 60);
  if (hue < 0) {
    hue += 360;
  }

  lightness = (cmax + cmin) / 2;
  saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const saturationPercent = +(saturation * 100).toFixed(1);
  const lightnessPercent = +(lightness * 100).toFixed(1);

  if (lightnessPercent < 12) {
    return "Black";
  }
  if (lightnessPercent > 98) {
    return "White";
  }
  if (saturationPercent < 2) {
    return "Gray";
  }
  if (hue < 15) {
    return "Red";
  }
  if (hue < 45) {
    return "Orange";
  }
  if (hue < 65) {
    return "Yellow";
  }
  if (hue < 170) {
    return "Green";
  }
  if (hue < 190) {
    return "Cyan";
  }
  if (hue < 255) {
    return "Blue";
  }
  if (hue < 280) {
    return "Purple";
  }
  if (hue < 335) {
    return "Magenta";
  }

  return "Red";
}
