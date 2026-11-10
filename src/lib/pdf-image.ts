import sharp from "sharp";

const maxEdge = 1600;

export async function optimizePdfImage(bytes: Buffer) {
  const source = sharp(bytes, { limitInputPixels: 32_000_000 });
  const { format, width, height, orientation, hasAlpha } =
    await source.metadata();
  const needsResize = Math.max(width, height) > maxEdge;
  const needsRotation = orientation !== undefined && orientation !== 1;
  const image = source.autoOrient().resize(maxEdge, maxEdge, {
    fit: "inside",
    withoutEnlargement: true,
  });
  // Keep transparency on logos and watermarks. Use JPEG for opaque photos.
  const optimized = await (
    hasAlpha
      ? image.png()
      : image.jpeg({ quality: 85, chromaSubsampling: "4:4:4" })
  ).toBuffer();
  const canKeepOriginal =
    (format === "png" || format === "jpeg") && !needsResize && !needsRotation;
  return canKeepOriginal && bytes.length <= optimized.length
    ? bytes
    : optimized;
}
