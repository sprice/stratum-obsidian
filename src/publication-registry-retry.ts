/** Three bounded retries; never shorten a server's requested waiting period. */
export function registryRetryDelay(
  status: number | undefined,
  header: string | undefined,
  attempt: number,
  now = Date.now(),
): number | null {
  if (![429, 503].includes(status ?? 0) || attempt >= 3) return null;
  const milliseconds =
    header === undefined
      ? 1000 * 2 ** attempt
      : /^\d+$/.test(header)
        ? Number(header) * 1000
        : Math.max(0, Date.parse(header) - now);
  return Number.isFinite(milliseconds) &&
    milliseconds >= 0 &&
    milliseconds <= 60_000
    ? milliseconds
    : null;
}
