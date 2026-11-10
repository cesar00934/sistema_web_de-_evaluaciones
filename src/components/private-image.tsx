"use client";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

export function PrivateImage({
  path,
  bucket = "questions",
  thumbnail,
  autoLoad = false,
}: {
  path: string;
  bucket?: string;
  thumbnail?: string | null;
  autoLoad?: boolean;
}) {
  const [url, setUrl] = useState(""),
    [message, setMessage] = useState(""),
    [full, setFull] = useState(false);
  useEffect(() => {
    if (!autoLoad) return;
    let active = true;
    void browserClient()
      .storage.from(bucket)
      .createSignedUrl(thumbnail ?? path, 300)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setMessage(error.message);
        else setUrl(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [autoLoad, path, bucket, thumbnail]);
  return (
    <div>
      {url ? (
        <img
          src={url}
          loading="lazy"
          className="private-image"
          alt="Adjunto académico"
          onError={() => {
            setUrl("");
            setMessage(
              "Imagen no disponible. Las respuestas y notas se conservan.",
            );
          }}
        />
      ) : (
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            const { data, error } = await browserClient()
              .storage.from(bucket)
              .createSignedUrl(thumbnail && !full ? thumbnail : path, 300);
            if (error) setMessage(error.message);
            else setUrl(data.signedUrl);
          }}
        >
          {thumbnail && !full ? "Ver miniatura" : "Ver imagen (5 minutos)"}
        </button>
      )}
      {thumbnail && url && !full && (
        <button
          type="button"
          className="text-button"
          onClick={async () => {
            const { data, error } = await browserClient()
              .storage.from(bucket)
              .createSignedUrl(path, 300);
            if (error) setMessage(error.message);
            else {
              setFull(true);
              setUrl(data.signedUrl);
            }
          }}
        >
          Abrir imagen completa
        </button>
      )}
      {message && <p className="muted">{message}</p>}
    </div>
  );
}
