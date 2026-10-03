/** An optional local integration must not hold up literature-note text sync. */
export async function withAnnotationImageTimeout<T>(
  operation: Promise<T>,
): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error("Local annotation image request timed out.")),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
