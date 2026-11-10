const chunkSize = 64 * 1024;

export function pdfResponse(bytes: Uint8Array, filename?: string) {
  let offset = 0;
  // Stream the serialized PDF so large downloads can pass Vercel's buffered response limit.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      offset += chunk.byteLength;
      if (chunk.byteLength) controller.enqueue(chunk);
      if (offset === bytes.byteLength) controller.close();
    },
  });
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Cache-Control": "private, no-store",
  });
  if (filename)
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  return new Response(body, { headers });
}
