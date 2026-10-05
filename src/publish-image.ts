/** Rasterize browser-supported formats that would otherwise require extra PDF converters. */
export async function publishImage(
  bytes: ArrayBuffer,
  extension: string,
  signal: AbortSignal,
): Promise<{ bytes: ArrayBuffer; extension: string }> {
  if (/^(png|jpe?g)$/i.test(extension)) return { bytes, extension };
  if (signal.aborted) throw new Error("Publishing cancelled.");
  const type = extension === "svg" ? "image/svg+xml" : `image/${extension}`;
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const image = createEl("img");
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        image.onload = image.onerror = null;
      };
      const abort = () => {
        cleanup();
        reject(new Error("Publishing cancelled."));
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("An embedded image could not be decoded."));
      }, 15_000);
      signal.addEventListener("abort", abort, { once: true });
      image.onload = () => {
        cleanup();
        resolve();
      };
      image.onerror = () => {
        cleanup();
        reject(new Error("An embedded image could not be decoded."));
      };
      image.src = url;
    });
    const canvas = createEl("canvas");
    const scale = Math.min(
      1,
      4096 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("An embedded image could not be converted.")),
        "image/png",
      ),
    );
    if (signal.aborted) throw new Error("Publishing cancelled.");
    return { bytes: await png.arrayBuffer(), extension: "png" };
  } finally {
    image.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}
