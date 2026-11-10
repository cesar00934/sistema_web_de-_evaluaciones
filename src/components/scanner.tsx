"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Upload, ScanLine } from "lucide-react";
import { Heading, useRows, requireUser, errorText } from "./common";
import { browserClient } from "@/lib/supabase/client";
import { sheetLayout, type Version, type Answer } from "@/lib/domain";
import { uploadScan } from "@/lib/uploads";
import { recognize } from "@/lib/worker-client";
import { useWorkspace } from "./workspace-context";
import type { SheetIdentity } from "@/lib/sheet-identity";
interface Job {
  id: string;
  name: string;
  state: string;
  progress: number;
  error?: string;
  scan?: Record<string, unknown>;
  answers?: Answer[];
  stored?: Blob;
  thumbnail?: Blob;
  conflict?: string;
  path?: string;
  disposition?: string;
}
interface PendingImage {
  id: string;
  file: File;
  url: string;
  identity?: SheetIdentity | null;
  detectedVersion?: Version;
  detectionError?: string;
}
export function Scanner() {
  const { id: ownerId } = useWorkspace();
  const [vQuery, setVQuery] = useState(""),
    [sQuery, setSQuery] = useState(""),
    [version, setVersion] = useState<Version | null>(null),
    [student, setStudent] = useState(""),
    [confirmedStudent, setConfirmedStudent] = useState<{
      id: string;
      first_names: string;
      last_names: string;
      grade: string;
      section: string;
    } | null>(null),
    [page, setPage] = useState(1),
    [jobs, setJobs] = useState<Job[]>([]),
    [pending, setPending] = useState<PendingImage[]>([]),
    [preparing, setPreparing] = useState(false),
    [selectedImage, setSelectedImage] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [cameras, setCameras] = useState<MediaDeviceInfo[]>([]),
    [camera, setCamera] = useState(""),
    [streaming, setStreaming] = useState(false),
    [ocr, setOcr] = useState(false),
    [attachment, setAttachment] = useState(true);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    pendingRef = useRef<PendingImage[]>([]),
    staging = useRef(false),
    mounted = useRef(true),
    requestedVersion = useRef(""),
    active = useRef(false);
  const versions = useRows<{ id: string; label: string; exam_id: string }>(
      "versions",
      "id,label,exam_id",
      vQuery,
      "label",
      0,
      "created_at",
    ),
    students = useRows<{
      id: string;
      first_names: string;
      last_names: string;
      grade: string;
      section: string;
    }>(
      "students",
      "id,first_names,last_names,grade,section",
      sQuery,
      "last_names",
      0,
      "last_names",
    );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url));
      pendingRef.current = [];
    };
  }, []);
  const update = (id: string, patch: Partial<Job>) =>
    setJobs((j) => j.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  function replacePending(next: PendingImage[]) {
    pendingRef.current = next;
    setPending(next);
  }
  function removePending(id: string) {
    const item = pendingRef.current.find((p) => p.id === id);
    if (item) URL.revokeObjectURL(item.url);
    replacePending(pendingRef.current.filter((p) => p.id !== id));
  }
  async function stage(files: File[]) {
    if (active.current || staging.current || !files.length) return;
    if (pendingRef.current.length + files.length > 50) {
      setMessage(
        "Puedes preparar hasta 50 imágenes. Quita algunas antes de añadir más.",
      );
      return;
    }
    staging.current = true;
    setPreparing(true);
    setMessage("");
    const errors: string[] = [];
    try {
      for (const file of files) {
        let url = "";
        try {
          if (!file.size || file.size > 20 * 1024 * 1024)
            throw Error("Usa imágenes de hasta 20 MB.");
          if (
            file.type &&
            !["image/jpeg", "image/png", "image/webp"].includes(file.type)
          )
            throw Error("Usa JPG, PNG o WebP.");
          url = URL.createObjectURL(file);
          const img = new Image();
          img.src = url;
          try {
            await img.decode();
          } catch {
            throw Error(
              "No se pudo abrir la imagen. Selecciona otro archivo JPG, PNG o WebP.",
            );
          }
          if (img.naturalWidth * img.naturalHeight > 32_000_000)
            throw Error("La imagen supera 32 megapíxeles.");
          if (!mounted.current) {
            URL.revokeObjectURL(url);
            return;
          }
          const item: PendingImage = { id: crypto.randomUUID(), file, url };
          try {
            const { identifySheet } = await import("@/lib/sheet-identity");
            item.identity = identifySheet(img);
            if (item.identity) {
              const { data, error } = await browserClient()
                .from("versions")
                .select("id,exam_id,label,questions,items,page_count")
                .eq("owner_id", ownerId)
                .eq("id", item.identity.versionId)
                .eq("exam_id", item.identity.examId)
                .single();
              if (error || !data)
                throw Error(
                  "El QR identifica una versión que no está disponible en tu cuenta. Comprueba el examen y vuelve a cargar la hoja.",
                );
              if (item.identity.pageNumber > sheetLayout(data.questions).length)
                throw Error(
                  "El QR indica una página que no pertenece a esta versión.",
                );
              item.detectedVersion = data;
            }
          } catch (e) {
            item.detectionError = errorText(e);
          }
          if (!mounted.current) {
            URL.revokeObjectURL(url);
            return;
          }
          replacePending([...pendingRef.current, item]);
          setSelectedImage(item.id);
        } catch (e) {
          if (url) URL.revokeObjectURL(url);
          errors.push(`${file.name}: ${errorText(e)}`);
        }
      }
      if (mounted.current) setMessage(errors.join(" · "));
    } finally {
      staging.current = false;
      if (mounted.current) setPreparing(false);
    }
  }
  const previewImage =
    pending.find((p) => p.id === selectedImage) ?? pending[0];
  const manualNeeded = pending.some((p) => !p.identity && !p.detectionError);
  const assignmentReady =
    pending.length > 0 &&
    pending.every(
      (p) =>
        !p.detectionError && (p.detectedVersion || (!p.identity && version)),
    );
  useEffect(() => {
    if (!pending.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending.length]);
  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setStreaming(false);
  }
  async function start(deviceId = camera) {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw Error(
          "La cámara requiere HTTPS o localhost. Puedes subir imágenes.",
        );
      stop();
      const s = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
        audio: false,
      });
      stream.current = s;
      setStreaming(true);
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setCameras(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "videoinput",
        ),
      );
      setMessage("");
    } catch (e) {
      setMessage(
        `Cámara: ${errorText(e)}. Usa la carga de archivos o reintenta.`,
      );
    }
  }
  async function persist(job: Job, resolution = "reject") {
    const { db, user } = await requireUser();
    const { data, error } = await db.rpc("commit_scan", {
      p_scan: job.scan,
      p_answers: job.answers,
      p_resolution: resolution,
    });
    if (error) throw error;
    if (data.disposition === "conflict") {
      update(job.id, {
        state: "Conflicto: ya existe esta página del alumno",
        conflict: data.scanId,
      });
      return;
    }
    if (data.disposition === "duplicate") {
      update(job.id, {
        state: "Duplicado: ya estaba registrado",
        disposition: "duplicate",
        stored: undefined,
        thumbnail: undefined,
        answers: undefined,
        scan: undefined,
      });
      return;
    }
    if (!job.stored) {
      update(job.id, {
        state: "Corrección guardada · Sin imagen",
        conflict: undefined,
        disposition: "inserted",
      });
      return;
    }
    const path = job.path ?? `${user.id}/${job.scan!.id}.jpg`;
    update(job.id, {
      state: "Nota guardada · Subiendo copia legible…",
      path,
      conflict: undefined,
      disposition: "inserted",
    });
    await attach({ ...job, path });
  }
  async function attach(job: Job) {
    const { db, user } = await requireUser();
    const path = job.path ?? `${user.id}/${job.scan!.id}.jpg`;
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++)
      try {
        await uploadScan(path, job.stored!, (n) =>
          update(job.id, { progress: n }),
        );
        last = null;
        break;
      } catch (e) {
        last = e;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
      }
    if (last) throw last;
    const thumbnailPath = job.thumbnail
      ? path.replace(/\.jpg$/, "-thumb.jpg")
      : null;
    if (thumbnailPath)
      await uploadScan(thumbnailPath, job.thumbnail!, () => {});
    const { error } = await db.from("attachments").upsert(
      {
        id: String(job.scan!.id),
        owner_id: user.id,
        scan_id: String(job.scan!.id),
        path,
        thumbnail_path: thumbnailPath,
        bytes: job.stored!.size,
        mime: "image/jpeg",
      },
      { onConflict: "owner_id,scan_id" },
    );
    if (error) throw error;
    update(job.id, {
      state: "Corrección e imagen guardadas",
      progress: 100,
      stored: undefined,
      thumbnail: undefined,
      scan: undefined,
      answers: undefined,
      error: undefined,
      conflict: undefined,
    });
  }
  async function process() {
    if (!assignmentReady || !student) {
      setMessage(
        "Confirma al alumno y revisa las imágenes sin versión detectada antes de escanear y guardar.",
      );
      return;
    }
    if (active.current || staging.current) return;
    const batch = [...pendingRef.current];
    if (!batch.length) {
      setMessage("Carga o captura al menos una imagen antes de escanear.");
      return;
    }
    active.current = true;
    setBusy(true);
    setMessage("");
    const initial = batch.map((p) => ({
      id: crypto.randomUUID(),
      name: p.file.name,
      state: "En cola",
      progress: 0,
    }));
    setJobs((j) => [...initial, ...j].slice(0, 100));
    stop();
    for (let i = 0; i < batch.length; i++) {
      const file = batch[i].file,
        job = initial[i];
      try {
        if (
          file.size > 20 * 1024 * 1024 ||
          (file.type &&
            !["image/jpeg", "image/png", "image/webp"].includes(file.type))
        )
          throw Error("Usa JPG, PNG o WebP de hasta 20 MB");
        update(job.id, { state: "Reconociendo imagen original…" });
        const assignedVersion = batch[i].detectedVersion ?? version;
        if (!assignedVersion || batch[i].detectionError)
          throw Error("Revisa la versión de esta imagen antes de procesarla.");
        const result = await recognize(
          file,
          assignedVersion,
          batch[i].identity?.pageNumber ?? page,
          ocr,
        );
        if (!result.ok) throw Error(result.error);
        let transcript = "";
        if (result.writtenWarning) result.warning = result.writtenWarning;
        if (result.written?.length) {
          try {
            const { recognizeHandwriting } =
              await import("@/lib/handwriting-client");
            const answers = await recognizeHandwriting(result.written, (text) =>
              update(job.id, { state: text }),
            );
            transcript = JSON.stringify({
              format: "cramer-written-v1",
              answers,
            });
          } catch (error) {
            result.warning = [
              result.warning,
              `Texto pendiente: ${errorText(error)}`,
            ]
              .filter(Boolean)
              .join(" · ");
          }
        }

        const scan = {
          id: job.id,
          version_id: assignedVersion.id,
          student_id: student,
          page_number: result.page,
          image_hash: result.hash,
          warning: result.warning,
          transcript,
        };
        const full = {
          ...job,
          scan,
          answers: result.answers,
          stored: attachment ? result.stored : undefined,
          thumbnail: attachment ? result.thumbnail : undefined,
        };
        update(job.id, {
          ...full,
          state: result.warning || "Guardando respuestas…",
        });
        await persist(full);
        removePending(batch[i].id);
      } catch (e) {
        update(job.id, { state: "Requiere atención", error: errorText(e) });
      }
    }
    active.current = false;
    setBusy(false);
  }
  async function capture() {
    if (!video.current?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.current.videoWidth;
    canvas.height = video.current.videoHeight;
    canvas.getContext("2d")!.drawImage(video.current, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        void stage([
          new File([blob], `captura-${Date.now()}.png`, { type: "image/png" }),
        ]);
        stop();
      }
    }, "image/png");
  }
  return (
    <>
      <Heading
        eyebrow="CAPTURA Y RECONOCIMIENTO"
        title="Una hoja. Todas las respuestas."
        description="Carga las imágenes: el QR detecta la versión y la página. Confirma al alumno y pulsa Escanear y guardar."
      />
      <div className="scanner-grid">
        <section className="card capture">
          <div className="section-title">
            <h2>1. Carga o captura imágenes</h2>
            <ScanLine />
          </div>
          <div className={streaming ? "camera-view live" : "camera-view"}>
            <video ref={video} autoPlay playsInline muted hidden={!streaming} />
            {!streaming && previewImage && (
              <img
                className="scan-preview"
                src={previewImage.url}
                alt={`Vista previa: ${previewImage.file.name}`}
              />
            )}
            {!streaming && !previewImage && (
              <div>
                <Camera size={48} />
                <h3>Carga o captura la hoja</h3>
                <p>
                  Cámara del celular o computadora.
                  <br />
                  También puedes seleccionar imágenes.
                </p>
              </div>
            )}
          </div>
          <div className="actions">
            <button
              disabled={busy || preparing}
              onClick={() => (streaming ? capture() : start())}
            >
              <Camera size={17} />
              {streaming ? "Capturar hoja" : "Abrir cámara"}
            </button>
            {streaming && (
              <button className="secondary" onClick={stop}>
                Detener
              </button>
            )}
            <label
              className={`button secondary ${busy || preparing ? "disabled" : ""}`}
            >
              <Upload size={17} />
              Cargar imágenes
              <input
                type="file"
                multiple
                hidden
                accept="image/jpeg,image/png,image/webp"
                disabled={busy || preparing}
                onChange={(e) => {
                  if (e.target.files) void stage(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {preparing && (
            <p role="status">
              Preparando imágenes y detectando versión por QR…
            </p>
          )}
          {pending.length > 0 && (
            <section className="scan-pending" aria-label="Imágenes preparadas">
              <h3>Imágenes listas para escanear · {pending.length}</h3>
              <div className="scan-thumbnails">
                {pending.map((p) => (
                  <article key={p.id}>
                    <button
                      className="scan-thumbnail"
                      disabled={busy || preparing}
                      onClick={() => {
                        stop();
                        setSelectedImage(p.id);
                      }}
                      aria-label={`Ver ${p.file.name}`}
                    >
                      <img src={p.url} alt={p.file.name} />
                      <span>{p.file.name}</span>
                    </button>
                    <small className={p.detectionError ? "error" : "muted"}>
                      {p.detectionError ??
                        (p.detectedVersion
                          ? `QR: ${p.detectedVersion.label} · Página ${p.identity!.pageNumber}`
                          : "Sin QR legible: elige una versión manualmente.")}
                    </small>
                    <button
                      className="text-button"
                      disabled={busy || preparing}
                      onClick={() => removePending(p.id)}
                      aria-label={`Quitar ${p.file.name}`}
                    >
                      Quitar
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}
          {cameras.length > 1 && (
            <label>
              Cámara
              <select
                value={camera}
                onChange={(e) => {
                  setCamera(e.target.value);
                  void start(e.target.value);
                }}
              >
                {cameras.map((c) => (
                  <option value={c.deviceId} key={c.deviceId}>
                    {c.label || "Cámara"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <small className="muted">
            Hasta 50 archivos · 20 MB por imagen · Procesamiento secuencial
          </small>
        </section>
        <section className="card">
          <h2>2. Confirma al alumno</h2>
          {previewImage?.detectedVersion && (
            <div className="notice" role="status">
              <strong>
                Versión detectada automáticamente:{" "}
                {previewImage.detectedVersion.label}
              </strong>
              <br />
              Página {previewImage.identity!.pageNumber} · Examen{" "}
              {previewImage.detectedVersion.exam_id.slice(0, 8)}
            </div>
          )}
          {previewImage?.detectionError && (
            <p role="alert" className="error">
              {previewImage.detectionError}
            </p>
          )}
          {(!pending.length || manualNeeded) && (
            <label>
              Versión manual para imágenes sin QR
              <input
                value={vQuery}
                placeholder="ORIGINAL, A, B…"
                onChange={(e) => setVQuery(e.target.value)}
              />
              <select
                aria-label="Versión del examen"
                value={version?.id ?? ""}
                disabled={busy}
                onChange={async (e) => {
                  const id = e.target.value;
                  requestedVersion.current = id;
                  setVersion(null);
                  if (!id) {
                    setVersion(null);
                    return;
                  }
                  const { data, error } = await browserClient()
                    .from("versions")
                    .select("id,exam_id,label,questions,items,page_count")
                    .eq("owner_id", ownerId)
                    .eq("id", id)
                    .single();
                  if (requestedVersion.current !== id) return;
                  if (error) setMessage(error.message);
                  else {
                    setVersion(data);
                    setPage(1);
                  }
                }}
              >
                <option value="">Selecciona la versión</option>
                {version && !versions.rows.some((v) => v.id === version.id) && (
                  <option value={version.id}>{version.label}</option>
                )}
                {versions.rows.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} · {v.exam_id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Buscar alumno por apellido
            <input
              value={sQuery}
              placeholder="Apellido…"
              onChange={(e) => setSQuery(e.target.value)}
            />
            <select
              aria-label="Alumno para este lote"
              value={student}
              disabled={busy}
              onChange={(e) => {
                setStudent(e.target.value);
                setConfirmedStudent(
                  students.rows.find((s) => s.id === e.target.value) ?? null,
                );
              }}
            >
              <option value="">Selecciona y confirma al alumno</option>
              {confirmedStudent &&
                !students.rows.some((s) => s.id === confirmedStudent.id) && (
                  <option value={confirmedStudent.id}>
                    {confirmedStudent.last_names},{" "}
                    {confirmedStudent.first_names} · {confirmedStudent.grade}{" "}
                    {confirmedStudent.section}
                  </option>
                )}
              {students.rows.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.last_names}, {s.first_names} · {s.grade} {s.section}
                </option>
              ))}
            </select>
          </label>
          {(!pending.length || manualNeeded) && (
            <label>
              Página manual para imágenes sin QR
              <input
                type="number"
                min={1}
                max={version?.page_count ?? 1}
                value={page}
                disabled={busy}
                onChange={(e) => setPage(Number(e.target.value))}
              />
            </label>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={attachment}
              disabled={busy}
              onChange={(e) => setAttachment(e.target.checked)}
            />
            Guardar copia comprimida para revisión
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={ocr}
              disabled={busy}
              onChange={(e) => setOcr(e.target.checked)}
            />
            Leer respuestas escritas con el lector local
          </label>
          <p className="muted">
            El lector manuscrito se ejecuta en este dispositivo. La primera vez
            descarga el modelo (aprox. 70 MB más el motor) y después puede
            reutilizar su caché. No envía la imagen a una IA externa. Compara
            siempre el texto con la hoja; el puntaje de respuestas abiertas lo
            confirma el docente.
          </p>
          <div className="notice">
            Las páginas sin marcadores o con lectura dudosa se guardan
            pendientes. Confirma siempre la identidad del alumno.
          </div>
        </section>
      </div>
      <section className="card scan-submit">
        <h2>3. Escanear y guardar</h2>
        {confirmedStudent && (
          <p>
            <strong>Alumno:</strong> {confirmedStudent.last_names},{" "}
            {confirmedStudent.first_names}
          </p>
        )}
        {pending.length > 0 && (
          <small className="muted">
            Todas las imágenes del lote se asignarán al mismo alumno. Para otro
            alumno, procesa un lote aparte.
          </small>
        )}
        <p className="muted">
          {!pending.length
            ? "Puedes cargar imágenes antes de elegir alumno y versión."
            : !assignmentReady || !student
              ? "Confirma al alumno. Si alguna imagen no tiene QR legible, selecciona su versión manualmente; los errores de QR deben corregirse antes de continuar."
              : "Listo. Al pulsar el botón se reconocerán y guardarán las respuestas para el alumno seleccionado."}
        </p>
        <button
          disabled={busy || preparing || !assignmentReady || !student}
          onClick={() => void process()}
        >
          <ScanLine size={18} />
          {busy ? "Escaneando y guardando…" : "Escanear y guardar"}
        </button>
      </section>
      {(message || versions.error || students.error) && (
        <div role="status" className="notice">
          {message || versions.error || students.error}
        </div>
      )}
      {jobs.length > 0 && (
        <section className="card">
          <h2>Actividad de captura</h2>
          {jobs.map((j) => (
            <div className="scan-job" key={j.id}>
              <strong>{j.name}</strong>
              <p>{j.state}</p>
              {j.error && (
                <p className="error">
                  {j.error}. Si la nota ya se guardó, se conserva sin imagen.
                </p>
              )}
              {j.progress > 0 && <progress max={100} value={j.progress} />}
              <div className="actions">
                {j.conflict && (
                  <>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        try {
                          await persist(j, "replace");
                        } catch (e) {
                          update(j.id, { error: errorText(e) });
                        }
                      }}
                    >
                      Reemplazar página anterior
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={async () => {
                        try {
                          await persist(j, "compare");
                        } catch (e) {
                          update(j.id, { error: errorText(e) });
                        }
                      }}
                    >
                      Conservar ambas para comparar
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        update(j.id, {
                          state: "Descartado; se conserva la página anterior",
                          conflict: undefined,
                          stored: undefined,
                          answers: undefined,
                          scan: undefined,
                        })
                      }
                    >
                      Descartar nueva
                    </button>
                  </>
                )}
                {j.error && j.stored && j.scan && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        if (j.disposition === "inserted") await attach(j);
                        else await persist(j);
                      } catch (e) {
                        update(j.id, { error: errorText(e) });
                      }
                    }}
                  >
                    Reintentar guardado
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
