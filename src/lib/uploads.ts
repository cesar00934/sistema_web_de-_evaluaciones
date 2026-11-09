import { browserClient } from "./supabase/client";
export async function uploadScan(
  path: string,
  blob: Blob,
  onProgress: (n: number) => void,
) {
  const db = browserClient(),
    {
      data: { session },
      error,
    } = await db.auth.getSession();
  if (error || !session) throw Error("Sesión requerida para cargar");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/scans/${path.split("/").map(encodeURIComponent).join("/")}`,
    );
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader(
      "apikey",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    xhr.setRequestHeader("Content-Type", blob.type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.timeout = 90000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(Error("Error de red al subir imagen"));
    xhr.ontimeout = () => reject(Error("La carga excedió 90 segundos"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 409) resolve();
      else
        reject(
          Error(`Storage ${xhr.status}: ${xhr.responseText.slice(0, 300)}`),
        );
    };
    xhr.send(blob);
  });
}
