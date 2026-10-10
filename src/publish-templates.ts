import {
  publicationProperties,
  type PublishingProperty,
} from "./publish-properties";
import {
  DEFAULT_ACADEMIC_OPTIONS,
  readPublishOptions,
  readAcademicDefaults,
  type AcademicDefaults,
  type DocumentType,
  type PublishOptions,
} from "./publish-options";

export interface PublishingTemplate {
  id: string;
  name: string;
  documentType: DocumentType;
  layout: PublishOptions;
  properties: PublishingProperty[];
  prefill: AcademicDefaults;
  renderer?: "aastex";
}
export interface PublishingTemplates {
  templates: PublishingTemplate[];
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function isBuiltInTemplate(id: string): boolean {
  return id === "general" || id === "academic";
}
/** Always retain the two editable built-in templates. */
export function readPublishingTemplates(value: unknown): PublishingTemplates {
  const stored = record(value);
  const templates: PublishingTemplate[] = [
    {
      id: "general",
      name: "General documents",
      documentType: "general",
      layout: readPublishOptions(undefined),
      properties: [],
      prefill: readAcademicDefaults(undefined),
    },
    {
      id: "academic",
      name: "Academic papers",
      documentType: "academic",
      layout: readPublishOptions(undefined, DEFAULT_ACADEMIC_OPTIONS),
      properties: publicationProperties(DEFAULT_ACADEMIC_OPTIONS),
      prefill: readAcademicDefaults(undefined),
    },
  ];
  const seen = new Set<string>();
  for (const item of Array.isArray(stored.templates) ? stored.templates : []) {
    const v = record(item);
    if (
      typeof v.id !== "string" ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(v.id) ||
      seen.has(v.id)
    )
      continue;
    seen.add(v.id);
    const builtIn = templates.find((t) => t.id === v.id);
    const documentType =
      builtIn?.documentType ??
      (v.documentType === "academic" ? "academic" : "general");
    const layout = readPublishOptions(
      v.layout,
      builtIn?.layout ??
        (documentType === "academic" ? DEFAULT_ACADEMIC_OPTIONS : undefined),
    );
    const prefill = readAcademicDefaults(v.prefill);
    const template: PublishingTemplate = {
      id: v.id,
      name:
        typeof v.name === "string" && v.name.trim()
          ? v.name.trim().slice(0, 120)
          : (builtIn?.name ?? "Untitled template"),
      documentType,
      layout,
      prefill,
      properties: publicationProperties(layout, prefill),
    };
    if (builtIn) Object.assign(builtIn, template);
    else templates.push(template);
  }
  return { templates };
}
export function selectedPublishingTemplate(
  state: PublishingTemplates,
  id?: string,
): PublishingTemplate | undefined {
  return state.templates.find((template) => template.id === id);
}
export function removePublishingTemplate(
  state: PublishingTemplates,
  id: string,
): PublishingTemplates {
  if (isBuiltInTemplate(id)) return state;
  return readPublishingTemplates({
    ...state,
    templates: state.templates.filter((t) => t.id !== id),
  });
}
