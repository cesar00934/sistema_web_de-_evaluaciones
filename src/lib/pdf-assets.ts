import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { builtInAssets } from "./editor-defaults";
import { optimizePdfImage } from "./pdf-image";
export function pdfAssetLoader(db: SupabaseClient) {
  const cache = new Map<string, Promise<Uint8Array>>();
  let bytes = 0;
  return (asset: string) => {
    if (!cache.has(asset))
      cache.set(
        asset,
        (async () => {
          let buffer: Buffer;
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
            buffer = await optimizePdfImage(
              Buffer.from(await data.arrayBuffer()),
            );
          }
          bytes += buffer.length;
          if (bytes > 32 * 1024 * 1024)
            throw Error(
              "Las imágenes superan 32 MB. Divide la evaluación o reduce sus imágenes.",
            );
          return new Uint8Array(buffer);
        })(),
      );
    return cache.get(asset)!;
  };
}
