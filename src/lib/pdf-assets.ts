import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { builtInAssets } from "./editor-defaults";
export function pdfAssetLoader(db: SupabaseClient) {
  const cache = new Map<string, Promise<Uint8Array>>();
  let bytes = 0;
  return (asset: string) => {
    if (!cache.has(asset))
      cache.set(
        asset,
        (async () => {
          let buffer: Buffer,
            mime = "";
          const builtin = builtInAssets.find((a) => a.id === asset);
          if (builtin)
            buffer = await readFile(
              path.join(process.cwd(), "public", builtin.url),
            );
          else {
            const { data, error } = await db.storage
              .from("questions")
              .download(asset);
            if (error) throw error;
            buffer = Buffer.from(await data.arrayBuffer());
            mime = data.type;
          }
          bytes += buffer.length;
          if (bytes > 32 * 1024 * 1024)
            throw Error(
              "Las imágenes superan 32 MB. Divide la evaluación o reduce sus imágenes.",
            );
          if (mime === "image/webp") {
            const sharp = (await import("sharp")).default;
            buffer = await sharp(buffer, { limitInputPixels: 32_000_000 })
              .png()
              .toBuffer();
          }
          return new Uint8Array(buffer);
        })(),
      );
    return cache.get(asset)!;
  };
}
