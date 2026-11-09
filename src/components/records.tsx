"use client";
import { useEffect, useState } from "react";
import {
  Heading,
  Empty,
  Pager,
  useRows,
  requireUser,
  errorText,
} from "./common";
import { questionSchema, type Question } from "@/lib/domain";
import { parseStudentFile, type StudentRow } from "@/lib/imports";
import { browserClient } from "@/lib/supabase/client";
type Row = {
  id: string;
  first_names?: string;
  last_names?: string;
  level?: string;
  grade?: string;
  section?: string;
  active?: boolean;
  code?: string;
  name?: string;
  email?: string;
  teacher_id?: string;
  subarea?: string;
  prompt?: string;
  area?: string;
  topic?: string;
  payload?: Question;
  archived?: boolean;
};
const columns = {
  students: "id,code,first_names,last_names,level,grade,section,active",
  teachers: "id,name,email",
  courses: "id,name,area,subarea,teacher_id",
  questions: "id,prompt,area,topic,archived,payload",
};
export function Records({ module }: { module: string }) {
  const [tab, setTab] = useState<"teachers" | "courses">("teachers"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [editing, setEditing] = useState<Row | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{
      students: StudentRow[];
      errors: string[];
    } | null>(null),
    [type, setType] = useState<Question["type"]>("multipleChoice");
  const table =
    module === "alumnos"
      ? "students"
      : module === "preguntas"
        ? "questions"
        : tab;
  const { rows, count, error, loading, load } = useRows<Row>(
    table,
    columns[table],
    search,
    table === "students"
      ? "last_names"
      : table === "questions"
        ? "prompt"
        : "name",
    page,
    table === "students"
      ? "last_names"
      : table === "questions"
        ? "prompt"
        : "name",
  );
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      const { db, user } = await requireUser(),
        id = editing?.id || crypto.randomUUID(),
        str = (k: string) => String(data.get(k) ?? "").trim(),
        lines = (k: string) =>
          str(k)
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
      let row: Record<string, unknown> = { id, owner_id: user.id };
      if (table === "students") {
        if (!str("first_names") || !str("last_names"))
          throw Error("Completa nombres y apellidos");
        const raw =
          `${str("first_names")}|${str("last_names")}|${str("level")}|${str("grade")}|${str("section")}`.toLowerCase();
        const code =
          editing?.code ||
          Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(raw),
              ),
            ),
          )
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("");
        row = {
          ...row,
          code,
          ...Object.fromEntries(
            ["first_names", "last_names", "level", "grade", "section"].map(
              (k) => [k, str(k)],
            ),
          ),
          active: data.get("active") === "on",
        };
      } else if (table === "teachers")
        row = { ...row, name: str("name"), email: str("email") };
      else if (table === "courses")
        row = {
          ...row,
          name: str("name"),
          area: str("area"),
          subarea: str("subarea"),
          teacher_id: str("teacher_id") || null,
        };
      else {
        let imagePath = editing?.payload?.imagePath ?? null;
        const image = data.get("image") as File;
        if (image?.size) {
          if (
            image.size > 8 * 1024 * 1024 ||
            !["image/jpeg", "image/png", "image/webp"].includes(image.type)
          )
            throw Error("Imagen JPG/PNG/WebP, máximo 8 MB");
          const bitmap = await createImageBitmap(image);
          if (bitmap.width * bitmap.height > 32_000_000)
            throw Error("Imagen demasiado grande");
          bitmap.close();
          const extension =
              image.type === "image/png"
                ? "png"
                : image.type === "image/webp"
                  ? "webp"
                  : "jpg",
            path = `${user.id}/${crypto.randomUUID()}.${extension}`;
          const { error } = await db.storage
            .from("questions")
            .upload(path, image, { contentType: image.type, upsert: false });
          if (error) throw error;
          imagePath = path;
        }
        const q = questionSchema.parse({
          id,
          type,
          prompt: str("prompt"),
          subtitle: str("subtitle"),
          area: str("area"),
          subarea: str("subarea"),
          topic: str("topic"),
          competency: str("competency"),
          difficulty: str("difficulty"),
          score: Number(str("score")),
          options: type === "multipleChoice" ? lines("options") : [],
          correctOptionIndex:
            type === "multipleChoice" ? Number(str("correct")) - 1 : null,
          trueFalseStatements: type === "trueFalse" ? lines("statements") : [],
          trueFalseAnswers:
            type === "trueFalse"
              ? lines("keys").map((v) => v.toUpperCase() === "V")
              : [],
          leftColumn: type === "matching" ? lines("left") : [],
          rightColumn: type === "matching" ? lines("right") : [],
          matchingAnswers:
            type === "matching" ? lines("keys").map((v) => Number(v) - 1) : [],
          referenceAnswer: str("reference"),
          imagePath,
          archived: data.get("archived") === "on",
        });
        if (
          type === "trueFalse" &&
          lines("keys").some((v) => !["V", "F"].includes(v.toUpperCase()))
        )
          throw Error("Claves deben ser V o F");
        row = {
          ...row,
          prompt: q.prompt,
          area: q.area,
          topic: q.topic,
          difficulty: q.difficulty,
          archived: q.archived,
          payload: q,
        };
      }
      const { error } = await db
        .from(table)
        .upsert(row, { onConflict: "owner_id,id" });
      if (error) throw error;
      setEditing(null);
      setMessage("Registro guardado.");
      await load();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function importStudents() {
    if (!preview) return;
    setBusy(true);
    try {
      const { db, user } = await requireUser();
      let inserted = 0;
      for (let i = 0; i < preview.students.length; i += 100) {
        const batch = preview.students
          .slice(i, i + 100)
          .map((s) => ({ ...s, owner_id: user.id }));
        const { data, error } = await db
          .from("students")
          .upsert(batch, {
            onConflict: "owner_id,code",
            ignoreDuplicates: true,
          })
          .select("id");
        if (error) throw error;
        inserted += data.length;
      }
      setMessage(
        `${inserted} alumnos nuevos; ${preview.students.length - inserted} existentes conservados.`,
      );
      setPreview(null);
      await load();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const title =
      table === "students"
        ? "Alumnos"
        : table === "questions"
          ? "Banco de preguntas"
          : "Docentes y cursos",
    q = editing?.payload;
  return (
    <>
      <Heading
        title={title}
        description={
          table === "students"
            ? "Tu comunidad educativa, organizada y siempre a mano."
            : table === "questions"
              ? "Construye un banco que crece con cada evaluación."
              : "Organiza las personas y áreas de tus evaluaciones."
        }
      >
        <button
          onClick={() => {
            setEditing({ id: "" });
            setType("multipleChoice");
          }}
        >
          +{" "}
          {table === "students"
            ? "Nuevo alumno"
            : table === "questions"
              ? "Nueva pregunta"
              : "Nuevo registro"}
        </button>
      </Heading>
      {module === "docentes" && (
        <div className="tabs">
          <button
            className={tab === "teachers" ? "selected" : ""}
            onClick={() => {
              setTab("teachers");
              setEditing(null);
              setPage(0);
            }}
          >
            Docentes
          </button>
          <button
            className={tab === "courses" ? "selected" : ""}
            onClick={() => {
              setTab("courses");
              setEditing(null);
              setPage(0);
            }}
          >
            Cursos
          </button>
        </div>
      )}
      {table === "students" && (
        <div className="import-bar">
          <div>
            <strong>Importar lista de alumnos</strong>
            <p className="muted">
              CSV o XLSX · Con vista previa · Los existentes se conservan
            </p>
          </div>
          <a
            href="/alumnos_plantilla.csv"
            download
            className="button secondary"
          >
            Plantilla CSV
          </a>
          <label className="button secondary">
            Seleccionar archivo
            <input
              type="file"
              accept=".csv,.xlsx"
              hidden
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file)
                  try {
                    setPreview(await parseStudentFile(file));
                  } catch (error) {
                    setMessage(errorText(error));
                  }
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}
      {(message || error) && (
        <div role="status" className="notice">
          {message || error}
        </div>
      )}
      {preview && (
        <section className="card">
          <h2>Vista previa de importación</h2>
          <p>
            {preview.students.length} filas válidas. Se ignorarán alumnos cuyo
            código ya exista.
          </p>
          {preview.errors.map((v, i) => (
            <p key={i} className="error">
              {v}
            </p>
          ))}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Grado / sección</th>
                </tr>
              </thead>
              <tbody>
                {preview.students.slice(0, 20).map((s) => (
                  <tr key={s.code}>
                    <td>
                      {s.last_names}, {s.first_names}
                    </td>
                    <td>
                      {s.grade} {s.section}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>Se muestran hasta 20 filas.</p>
          <button
            disabled={busy || !preview.students.length}
            onClick={importStudents}
          >
            Importar filas válidas
          </button>{" "}
          <button className="secondary" onClick={() => setPreview(null)}>
            Cancelar
          </button>
        </section>
      )}
      {editing && (
        <section className="card editor">
          <div className="section-title">
            <h2>{editing.id ? "Editar registro" : "Nuevo registro"}</h2>
            <button className="text-button" onClick={() => setEditing(null)}>
              Cerrar
            </button>
          </div>
          <form key={`${table}-${editing.id}`} onSubmit={save}>
            {table === "students" ? (
              <div className="form-grid">
                {[
                  ["first_names", "Nombres"],
                  ["last_names", "Apellidos"],
                  ["level", "Nivel"],
                  ["grade", "Grado"],
                  ["section", "Sección"],
                ].map(([name, label]) => (
                  <label key={name}>
                    {label}
                    <input
                      name={name}
                      defaultValue={String(editing[name as keyof Row] ?? "")}
                      required
                    />
                  </label>
                ))}
                <label className="check">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={editing.active ?? true}
                  />
                  Alumno activo
                </label>
              </div>
            ) : table === "teachers" || table === "courses" ? (
              <div className="form-grid">
                <label>
                  Nombre
                  <input name="name" required defaultValue={editing.name} />
                </label>
                {table === "teachers" ? (
                  <label>
                    Correo
                    <input
                      type="email"
                      name="email"
                      defaultValue={editing.email}
                    />
                  </label>
                ) : (
                  <>
                    <TeacherSelect defaultValue={editing.teacher_id} />
                    <label>
                      Área
                      <input name="area" defaultValue={editing.area} />
                    </label>
                    <label>
                      Subárea
                      <input name="subarea" defaultValue={editing.subarea} />
                    </label>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="form-grid">
                  <label>
                    Tipo
                    <select
                      value={type}
                      onChange={(e) =>
                        setType(e.target.value as Question["type"])
                      }
                    >
                      <option value="multipleChoice">Opción múltiple</option>
                      <option value="trueFalse">Verdadero / falso</option>
                      <option value="matching">Relacionar</option>
                      <option value="openResponse">Respuesta abierta</option>
                    </select>
                  </label>
                  <label>
                    Puntaje
                    <input
                      type="number"
                      name="score"
                      min="0"
                      step="any"
                      max="10000"
                      required
                      defaultValue={q?.score ?? 1}
                    />
                  </label>
                </div>
                <label>
                  Enunciado
                  <textarea
                    name="prompt"
                    required
                    rows={3}
                    defaultValue={q?.prompt}
                  />
                </label>
                <label>
                  Subtítulo
                  <input name="subtitle" defaultValue={q?.subtitle} />
                </label>
                {type === "multipleChoice" && (
                  <div className="form-grid">
                    <label>
                      Alternativas (una por línea, máximo 8)
                      <textarea
                        name="options"
                        rows={5}
                        defaultValue={q?.options.join("\n")}
                        required
                      />
                    </label>
                    <label>
                      Número de alternativa correcta
                      <input
                        name="correct"
                        type="number"
                        min={1}
                        max={8}
                        required
                        defaultValue={(q?.correctOptionIndex ?? 0) + 1}
                      />
                    </label>
                  </div>
                )}
                {type === "trueFalse" && (
                  <div className="form-grid">
                    <label>
                      Enunciados (uno por línea)
                      <textarea
                        name="statements"
                        rows={5}
                        required
                        defaultValue={q?.trueFalseStatements.join("\n")}
                      />
                    </label>
                    <label>
                      Claves (V o F, una por línea)
                      <textarea
                        name="keys"
                        rows={5}
                        required
                        defaultValue={q?.trueFalseAnswers
                          .map((v) => (v ? "V" : "F"))
                          .join("\n")}
                      />
                    </label>
                  </div>
                )}
                {type === "matching" && (
                  <div className="form-grid">
                    <label>
                      Columna izquierda
                      <textarea
                        name="left"
                        required
                        rows={5}
                        defaultValue={q?.leftColumn.join("\n")}
                      />
                    </label>
                    <label>
                      Columna derecha (máximo 8)
                      <textarea
                        name="right"
                        required
                        rows={5}
                        defaultValue={q?.rightColumn.join("\n")}
                      />
                    </label>
                    <label>
                      Claves: número de la derecha por cada fila izquierda
                      <textarea
                        name="keys"
                        required
                        rows={5}
                        defaultValue={q?.matchingAnswers
                          .map((v) => v + 1)
                          .join("\n")}
                      />
                    </label>
                  </div>
                )}
                {type === "openResponse" && (
                  <label>
                    Respuesta de referencia / rúbrica
                    <textarea
                      name="reference"
                      rows={3}
                      defaultValue={q?.referenceAnswer}
                    />
                  </label>
                )}
                <div className="form-grid">
                  {[
                    ["area", "Área / curso"],
                    ["subarea", "Subárea"],
                    ["topic", "Tema"],
                    ["competency", "Competencia"],
                  ].map(([name, label]) => (
                    <label key={name}>
                      {label}
                      <input
                        name={name}
                        defaultValue={String(q?.[name as keyof Question] ?? "")}
                      />
                    </label>
                  ))}
                  <label>
                    Dificultad
                    <select
                      name="difficulty"
                      defaultValue={q?.difficulty ?? "medium"}
                    >
                      <option value="easy">Fácil</option>
                      <option value="medium">Media</option>
                      <option value="hard">Difícil</option>
                    </select>
                  </label>
                  <label>
                    Imagen (JPG, PNG, WebP; 8 MB)
                    <input
                      name="image"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                    />
                    {q?.imagePath && (
                      <small>
                        Imagen conservada. Elegir otra crea un archivo nuevo.
                      </small>
                    )}
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="archived"
                      defaultChecked={q?.archived}
                    />
                    Archivar pregunta
                  </label>
                </div>
                {q?.imagePath && (
                  <PrivateImage key={q.imagePath} path={q.imagePath} />
                )}
              </>
            )}
            <button disabled={busy}>
              {busy ? "Guardando…" : "Guardar registro"}
            </button>
          </form>
        </section>
      )}
      <section className="card">
        <div className="section-title">
          <h2>
            {count}{" "}
            {table === "students"
              ? "alumnos"
              : table === "questions"
                ? "preguntas"
                : "registros"}
          </h2>
          <input
            aria-label="Buscar registros"
            className="search"
            placeholder={
              table === "students" ? "Buscar por apellido…" : "Buscar…"
            }
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        {loading ? (
          <p>Cargando…</p>
        ) : !rows.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    {table === "students"
                      ? "Alumno"
                      : table === "questions"
                        ? "Pregunta"
                        : "Nombre"}
                  </th>
                  <th>
                    {table === "students"
                      ? "Grado / sección"
                      : table === "questions"
                        ? "Área / tema"
                        : "Información"}
                  </th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>
                        {table === "students"
                          ? `${r.last_names}, ${r.first_names}`
                          : table === "questions"
                            ? r.prompt
                            : r.name}
                      </strong>
                      <small>
                        {table === "students"
                          ? r.level
                          : table === "questions"
                            ? r.payload?.type
                            : r.id}
                      </small>
                    </td>
                    <td>
                      {table === "students"
                        ? `${r.grade} · ${r.section}`
                        : table === "questions"
                          ? `${r.area} · ${r.topic}`
                          : r.email || r.teacher_id || "—"}
                    </td>
                    <td>
                      <span className="badge">
                        {table === "students"
                          ? r.active
                            ? "Activo"
                            : "Inactivo"
                          : r.archived
                            ? "Archivada"
                            : "Disponible"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => {
                          setEditing(r);
                          setType(r.payload?.type ?? "multipleChoice");
                        }}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} count={count} setPage={setPage} />
      </section>
    </>
  );
}
export function TeacherSelect({
  defaultValue,
}: {
  defaultValue?: string | null;
}) {
  const [query, setQuery] = useState("");
  const { rows, error } = useRows<{ id: string; name: string }>(
    "teachers",
    "id,name",
    query,
    "name",
    0,
    "name",
  );
  return (
    <label>
      Docente (opcional)
      <input
        placeholder="Filtrar docentes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select name="teacher_id" defaultValue={defaultValue ?? ""}>
        <option value="">Sin asignar</option>
        {defaultValue && !rows.some((r) => r.id === defaultValue) && (
          <option value={defaultValue}>{defaultValue}</option>
        )}
        {rows.map((r) => (
          <option value={r.id} key={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      {error && <small>{error}</small>}
    </label>
  );
}
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
