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

export async function timed<T>(
  area: string,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  log(area, `${label} started`);
  try {
    const result = await fn();
    log(area, `${label} completed`, {
      ms: Math.round(performance.now() - start),
    });
    return result;
  } catch (error) {
    log(area, `${label} failed`, {
      ms: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
