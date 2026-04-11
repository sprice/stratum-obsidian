declare const __STRATUM_DEBUG__: boolean;

const PREFIX = "stratum";
const DEBUG = typeof __STRATUM_DEBUG__ !== "undefined" && __STRATUM_DEBUG__;

export function log(
  area: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!DEBUG) return;
  const suffix = data
    ? " " +
      Object.entries(data)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ")
    : "";
  console.debug(`${PREFIX}: [${area}] ${message}${suffix}`);
}
