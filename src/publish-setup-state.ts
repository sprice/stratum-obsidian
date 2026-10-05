import type { PublishReadiness, ToolStatus } from "./publish-desktop";

export function publishingToolState(
  tool: ToolStatus | undefined,
  ready: boolean,
  error: string | undefined,
  checking: boolean,
): { label: string; detail: string; missing: boolean; ready: boolean } {
  const state = { label: "", detail: "", missing: false, ready };
  if (!tool) return { ...state, label: checking ? "Looking…" : "Not checked" };
  if (!tool.path)
    return {
      ...state,
      label: tool.foundPath ? "Couldn't run" : "Not found",
      detail: tool.error || "",
      missing: !tool.foundPath,
    };
  if (error) return { ...state, label: "Check failed", detail: error };
  return {
    ...state,
    label: ready ? "Ready" : "Detected",
    detail: tool.version,
  };
}

export function publishingSetupAction(
  readiness: PublishReadiness | null,
  checking: boolean,
): string {
  if (checking) return "Checking…";
  if (readiness?.word && readiness.pdf) return "Done";
  if (readiness?.wordError || readiness?.pdfError) return "Retry check";
  if (readiness?.word && readiness.tectonic.path) return "Enable PDF";
  return "Check again";
}
