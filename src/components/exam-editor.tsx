"use client";
import { useEffect, useRef, useState } from "react";
import { Heading, Empty, Pager, useRows, errorText } from "./common";
import { CatalogInput, AssetSelect, useCatalog } from "./catalog";
import { QuestionComposer, blankQuestion } from "./question-composer";
import { useWorkspace } from "./workspace-context";
import {
  defaultExamSettings,
  institutionalDefaults,
} from "@/lib/editor-defaults";
import {
  questionSchema,
  type Exam,
  type Version,
  type Question,
} from "@/lib/domain";
import { browserClient } from "@/lib/supabase/client";
export function ExamEditor() {
  const { id: ownerId } = useWorkspace(),
    catalog = useCatalog();
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [editing, setEditing] = useState<Exam | null>(null),
    [dirty, setDirty] = useState(false),
    [savedAt, setSavedAt] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [question, setQuestion] = useState<Question | null>(null),
    [bankIds, setBankIds] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [bankPage, setBankPage] = useState(0),
    [active, setActive] = useState<Exam | null>(null),
    [versions, setVersions] = useState<Version[]>([]),
    [pdfMode, setPdfMode] = useState("original"),
    [preview, setPreview] = useState("");
  const defaults = useRef<Record<string, unknown>>(defaultExamSettings());
  const { rows, count, error, loading, load } = useRows<Exam>(
    "exams",
    "owner_id,id,title,area,level,grade,section,bimester,unit,teacher_id,scale_maximum,question_ids,settings,revision",
    search,
    "title",
    page,
    "created_at",
  );
  const bank = useRows<{ id: string; prompt: string; payload: Question }>(
    "questions",
    "id,prompt,payload",
    query,
    "prompt",
    bankPage,
    "prompt",
  );
  useEffect(() => {
    void browserClient()
      .from("settings")
      .select("institution,preferences")
      .eq("owner_id", ownerId)
      .maybeSingle()
      .then(({ data }) => {
        if (data)
          defaults.current = {
            ...defaultExamSettings(),
            institution: data.institution,
            institutional: { ...institutionalDefaults, ...data.preferences },
          };
      });
  }, [ownerId]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const questions = (editing?.settings.localQuestions ?? []) as Question[];
  const design = {
    ...institutionalDefaults,
    ...((editing?.settings.institutional as Record<string, unknown>) ?? {}),
  };
  function change(key: keyof Exam, value: unknown) {
    setEditing((e) => (e ? { ...e, [key]: value } : e));
    setDirty(true);
  }
  function setting(key: string, value: unknown) {
    setEditing((e) =>
      e ? { ...e, settings: { ...e.settings, [key]: value } } : e,
    );
    setDirty(true);
  }
  function decoration(key: string, value: unknown) {
    setting("institutional", { ...design, [key]: value });
  }
  function updateQuestions(next: Question[]) {
    setEditing((e) =>
      e
        ? {
            ...e,
            question_ids: next.map((q) => q.id),
            settings: { ...e.settings, localQuestions: next },
          }
        : e,
    );
    setDirty(true);
  }
  function start() {
    setEditing({
      id: crypto.randomUUID(),
      owner_id: ownerId,
      revision: 0,
      title: "",
      area: "MATEMÁTICA",
      level: "PRIMARIA",
      grade: "1",
      section: "",
      bimester: "BIMESTRE I",
      unit: "UNIDAD 1",
      scale_maximum: 20,
      question_ids: [],
      settings: structuredClone(defaults.current),
    });
    setDirty(false);
    setSavedAt("");
    setBankIds([]);
  }
  async function edit(exam: Exam) {
    if (
      busy ||
      (dirty &&
        !window.confirm("Hay cambios sin guardar. ¿Abrir otra evaluación?"))
    )
      return;
    setBusy(true);
    try {
      let local = exam.settings.localQuestions as Question[] | undefined;
      if (!local) {
        const { data, error } = await browserClient()
          .from("questions")
          .select("id,payload")
          .eq("owner_id", ownerId)
          .in("id", exam.question_ids);
        if (error) throw error;
        local = exam.question_ids.map((id) => {
          const q = data.find((q) => q.id === id);
          if (!q)
            throw Error("No se encontró una pregunta del examen anterior.");
          return questionSchema.parse(q.payload);
        });
      }
      setEditing({
        ...exam,
        settings: {
          ...defaults.current,
          ...exam.settings,
          institutional: {
            ...institutionalDefaults,
            ...((defaults.current.institutional as object) ?? {}),
            ...((exam.settings.institutional as object) ?? {}),
          },
          localQuestions: local,
        },
      });
      setBankIds([]);
      setDirty(false);
      setSavedAt("Guardado en la base de datos");
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function payload() {
    if (!editing) throw Error("Abre una evaluación");
    return {
      ...editing,
      settings: {
        ...editing.settings,
        localQuestions: questions,
        scoringMode: editing.settings.scoringMode ?? "manual",
        total: Number(editing.settings.total ?? 40),
        columns: Number(editing.settings.columns ?? 2),
      },
      revision: editing.revision ?? 0,
      bankIds,
    };
  }
  async function save() {
    setBusy(true);
    try {
      const data = payload();
      if (!data.title.trim()) throw Error("Escribe el título para guardar");
      const encoded = JSON.stringify(data);
      if (new TextEncoder().encode(encoded).length > 3_500_000)
        throw Error("La evaluación es demasiado grande. Divide sus preguntas.");
      const response = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: encoded,
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setEditing((e) => (e ? { ...e, revision: result.revision } : e));
      setDirty(false);
      setSavedAt(`Guardado ${new Date().toLocaleTimeString("es-PE")}`);
      setMessage(
        `Evaluación guardada. ${bankIds.length} preguntas marcadas para el banco.`,
      );
      await Promise.all([load(), bank.load(), catalog.reload()]);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function showVersions(exam: Exam) {
    if (busy) return;
    if (editing?.id === exam.id && dirty) {
      setMessage(
        "Guarda los cambios de la evaluación antes de crear una versión.",
      );
      return;
    }
    setActive(exam);
    const { data, error } = await browserClient()
      .from("versions")
      .select("id,exam_id,label,page_count,created_at")
      .eq("owner_id", ownerId)
      .eq("exam_id", exam.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) setMessage(error.message);
    else setVersions(data as unknown as Version[]);
  }
  async function generate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!active) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const response = await fetch("/api/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examId: active.id,
          label: String(f.get("label")),
          shuffleQuestions: f.get("shuffleQuestions") === "on",
          shuffleOptions: f.get("shuffleOptions") === "on",
        }),
      });
      const d = await response.json();
      if (!response.ok) throw Error(d.error);
      await showVersions(active);
      setMessage(
        "Versión creada con preguntas, claves y formato institucional fijados.",
      );
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function previewPdf() {
    setBusy(true);
    try {
      const response = await fetch("/api/pdf/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload(), mode: pdfMode }),
      });
      if (!response.ok) throw Error((await response.json()).error);
      setPreview(URL.createObjectURL(await response.blob()));
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Evaluaciones"
        description="Crea preguntas aquí, guarda tus opciones y conserva el formato institucional."
      >
        <button
          disabled={busy}
          onClick={() => {
            if (
              !dirty ||
              window.confirm("Hay cambios sin guardar. ¿Crear otra evaluación?")
            )
              start();
          }}
        >
          + Nueva evaluación
        </button>
      </Heading>
      {(message || error || bank.error) && (
        <p className="notice" role="status">
          {message || error || bank.error}
        </p>
      )}
      {question && (
        <QuestionComposer
          key={question.id}
          initial={question}
          initialBank={bankIds.includes(question.id)}
          onClose={() => setQuestion(null)}
          onSave={(q, copy) => {
            updateQuestions(
              questions.some((p) => p.id === q.id)
                ? questions.map((p) => (p.id === q.id ? q : p))
                : [...questions, q],
            );
            setBankIds((ids) =>
              copy
                ? [...new Set([...ids, q.id])]
                : ids.filter((id) => id !== q.id),
            );
          }}
        />
      )}
      {preview && (
        <div className="modal-backdrop">
          <section
            className="card pdf-dialog"
            role="dialog"
            aria-label="Vista previa PDF"
          >
            <div className="section-title">
              <h2>Vista previa del PDF</h2>
              <div className="actions">
                <a
                  className="button secondary"
                  href={preview}
                  download="evaluacion-cramer.pdf"
                >
                  Descargar PDF
                </a>
                <a className="button secondary" href={preview} target="_blank">
                  Abrir aparte
                </a>
                <button type="button" onClick={() => setPreview("")}>
                  Cerrar
                </button>
              </div>
            </div>
            <iframe title="Evaluación institucional" src={preview} />
          </section>
        </div>
      )}
      {editing && (
        <section className="card editor institutional-editor">
          <div className="editor-toolbar">
            <div>
              <h2>{editing.title || "Nueva evaluación"}</h2>
              <span className={`badge ${dirty ? "warning" : ""}`}>
                {busy
                  ? "Guardando / procesando…"
                  : dirty
                    ? "Cambios sin guardar"
                    : savedAt || "Borrador nuevo"}
              </span>
            </div>
            <div className="actions">
              <button type="button" disabled={busy} onClick={save}>
                Guardar evaluación
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || !questions.length}
                onClick={previewPdf}
              >
                Vista previa PDF
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm(
                      "Hay cambios sin guardar. ¿Cerrar el editor?",
                    )
                  )
                    setEditing(null);
                }}
              >
                Cerrar editor
              </button>
            </div>
          </div>
          <fieldset disabled={busy}>
            <legend>Datos y formato del examen</legend>
            <label>
              Título de la evaluación
              <input
                value={editing.title}
                onChange={(e) => change("title", e.target.value)}
                placeholder="Nombre para identificar la evaluación"
                required
                maxLength={200}
              />
            </label>
            <CatalogInput
              kind="institution"
              name="institution"
              label="Institución"
              value={String(editing.settings.institution ?? "COLEGIO CRAMER")}
              onChange={(v) => setting("institution", v)}
            />
            <div className="form-grid">
              <AssetSelect
                kind="headerFirst"
                label="Encabezado de la primera página"
                value={String(design.headerFirst ?? "")}
                onChange={(v) => decoration("headerFirst", v)}
              />
              <AssetSelect
                kind="headerFollowing"
                label="Encabezado desde la segunda página"
                value={String(design.headerFollowing ?? "")}
                onChange={(v) => decoration("headerFollowing", v)}
              />
            </div>
            <label>
              INDICACIONES (opcional)
              <textarea
                rows={3}
                value={String(editing.settings.instructions ?? "")}
                onChange={(e) => setting("instructions", e.target.value)}
              />
            </label>
            <div className="form-grid">
              <AssetSelect
                kind="centralImage"
                label="Imagen central de fondo"
                value={String(design.centralImage ?? "")}
                onChange={(v) => decoration("centralImage", v)}
              />
              <AssetSelect
                kind="watermark"
                label="Marca de agua al pie"
                value={String(design.watermark ?? "")}
                onChange={(v) => decoration("watermark", v)}
              />
            </div>
            <div className="form-grid">
              {[
                ["level", "Nivel"],
                ["grade", "Grado"],
                ["section", "Sección"],
                ["area", "Área"],
                ["bimester", "Bimestre"],
                ["unit", "Unidad"],
              ].map(([key, label]) => (
                <CatalogInput
                  key={key}
                  kind={key}
                  name={key}
                  label={label}
                  value={String(editing[key as keyof Exam] ?? "")}
                  onChange={(v) => change(key as keyof Exam, v)}
                />
              ))}
              <CatalogInput
                kind="subarea"
                name="subarea"
                label="Subárea"
                value={String(editing.settings.subarea ?? "")}
                onChange={(v) => setting("subarea", v)}
              />
              <CatalogInput
                kind="teacher"
                name="teacherName"
                label="Docente"
                value={String(editing.settings.teacherName ?? "")}
                onChange={(v) => setting("teacherName", v)}
              />
              <label>
                Fecha
                <input
                  type="date"
                  value={String(editing.settings.date ?? "")}
                  onChange={(e) => setting("date", e.target.value)}
                />
              </label>
              <label>
                Tipo de marco
                <select
                  value={String(design.frame)}
                  onChange={(e) => decoration("frame", e.target.value)}
                >
                  <option value="curved">Curvo</option>
                  <option value="straight">Lineal</option>
                  <option value="dotted">Punteado</option>
                  <option value="none">Sin marco</option>
                </select>
              </label>
            </div>
            <details>
              <summary>Datos del alumno y pie de página editables</summary>
              <div className="form-grid">
                <label>
                  Etiqueta del alumno
                  <input
                    value={String(design.studentLabel)}
                    onChange={(e) => decoration("studentLabel", e.target.value)}
                  />
                </label>
                <label>
                  Nombre del alumno (vacío para dejar línea)
                  <input
                    value={String(editing.settings.studentName ?? "")}
                    onChange={(e) => setting("studentName", e.target.value)}
                  />
                </label>
                {[
                  ["email", "Correo"],
                  ["phone", "Teléfono"],
                  ["facebook", "Facebook o página web"],
                  ["footerPageLabel", "Numeración: {pagina} y {total}"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      maxLength={200}
                      value={String(design[key as keyof typeof design] ?? "")}
                      onChange={(e) => decoration(key, e.target.value)}
                    />
                  </label>
                ))}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={design.showFooter !== false}
                    onChange={(e) => decoration("showFooter", e.target.checked)}
                  />
                  Mostrar pie de página institucional
                </label>
              </div>
            </details>
            <div className="form-grid">
              <label>
                Modo de puntaje
                <select
                  value={String(editing.settings.scoringMode ?? "manual")}
                  onChange={(e) => setting("scoringMode", e.target.value)}
                >
                  <option value="manual">Puntaje por pregunta</option>
                  <option value="automatic20">Distribuir 20 puntos</option>
                  <option value="customTotal">
                    Distribuir total personalizado
                  </option>
                </select>
              </label>
              <label>
                Total personalizado
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={Number(editing.settings.total ?? 40)}
                  onChange={(e) => setting("total", Number(e.target.value))}
                />
              </label>
              <label>
                Escala de la nota
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={editing.scale_maximum}
                  onChange={(e) =>
                    change("scale_maximum", Number(e.target.value))
                  }
                />
              </label>
              <label>
                Distribución de preguntas
                <select
                  value={Number(editing.settings.columns ?? 2)}
                  onChange={(e) => setting("columns", Number(e.target.value))}
                >
                  <option value={2}>Dos columnas (como la app)</option>
                  <option value={1}>Una columna</option>
                </select>
              </label>
              <label>
                Formato PDF
                <select
                  value={pdfMode}
                  onChange={(e) => setPdfMode(e.target.value)}
                >
                  <option value="original">Original</option>
                  <option value="qr">Original con QR</option>
                  <option value="sheet">Original con hoja añadida</option>
                  <option value="qr-sheet">
                    Original con QR y hoja añadida
                  </option>
                </select>
              </label>
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <div className="section-title">
              <h2>Preguntas de esta evaluación · {questions.length} / 250</h2>
              <button
                disabled={busy || questions.length >= 250}
                onClick={() =>
                  setQuestion({
                    ...blankQuestion(),
                    prompt: "",
                    area: editing.area,
                    subarea: String(editing.settings.subarea ?? ""),
                  })
                }
              >
                + Crear pregunta aquí
              </button>
            </div>
            <p className="muted">
              Las preguntas se guardan con la evaluación. Marca «Guardar también
              en el banco» solo para las que quieras reutilizar allí.
            </p>
            {questions.map((q, i) => (
              <article className="exam-question" key={q.id}>
                <div>
                  <strong>
                    {i + 1}. {q.prompt}
                  </strong>
                  <small>
                    {q.area} · {q.topic} · {q.score} puntos
                  </small>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={bankIds.includes(q.id)}
                      onChange={(e) => {
                        setBankIds((ids) =>
                          e.target.checked
                            ? [...ids, q.id]
                            : ids.filter((id) => id !== q.id),
                        );
                        setDirty(true);
                      }}
                    />
                    Guardar también en mi banco
                  </label>
                </div>
                <div className="actions">
                  <button className="secondary" onClick={() => setQuestion(q)}>
                    Editar
                  </button>
                  <button
                    className="text-button"
                    disabled={!i}
                    onClick={() => {
                      const a = [...questions];
                      [a[i - 1], a[i]] = [a[i], a[i - 1]];
                      updateQuestions(a);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="text-button"
                    disabled={i === questions.length - 1}
                    onClick={() => {
                      const a = [...questions];
                      [a[i + 1], a[i]] = [a[i], a[i + 1]];
                      updateQuestions(a);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      updateQuestions(questions.filter((p) => p.id !== q.id));
                      setBankIds((ids) => ids.filter((id) => id !== q.id));
                    }}
                  >
                    Quitar
                  </button>
                </div>
              </article>
            ))}
            <details className="card">
              <summary>Agregar preguntas de mi banco</summary>
              <input
                placeholder="Buscar en el banco…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setBankPage(0);
                }}
              />
              {bank.rows
                .filter((r) => !r.payload.archived)
                .map((r) => (
                  <div className="version-row" key={r.id}>
                    <span>
                      {r.prompt}
                      <small>
                        {r.payload.area} · {r.payload.topic}
                      </small>
                    </span>
                    <button
                      className="secondary"
                      disabled={
                        questions.some((q) => q.id === r.id) ||
                        questions.length >= 250
                      }
                      onClick={() =>
                        updateQuestions([
                          ...questions,
                          structuredClone(r.payload),
                        ])
                      }
                    >
                      {questions.some((q) => q.id === r.id)
                        ? "Agregada"
                        : "Agregar"}
                    </button>
                  </div>
                ))}
              <Pager page={bankPage} count={bank.count} setPage={setBankPage} />
              <div className="inline-form">
                <label>
                  Cantidad para selección automática
                  <input
                    id="automatic-count"
                    type="number"
                    min={1}
                    max={250}
                    defaultValue={10}
                  />
                </label>
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      const n = Number(
                        (
                          document.getElementById(
                            "automatic-count",
                          ) as HTMLInputElement
                        ).value,
                      );
                      const db = browserClient(),
                        { data, error } = await db.rpc("select_question_ids", {
                          p_count: n,
                          p_area: editing.area,
                          p_topic: "",
                        });
                      if (error) throw error;
                      const { data: rows, error: qe } = await db
                        .from("questions")
                        .select("id,payload")
                        .eq("owner_id", ownerId)
                        .in("id", data);
                      if (qe) throw qe;
                      updateQuestions(
                        data.map(
                          (id: string) =>
                            rows.find((q) => q.id === id)!.payload,
                        ),
                      );
                    } catch (e) {
                      setMessage(errorText(e));
                    }
                  }}
                >
                  Reemplazar con selección 30/50/20
                </button>
              </div>
            </details>
          </fieldset>
          <button disabled={busy} onClick={save}>
            Guardar evaluación y preguntas
          </button>
        </section>
      )}
      {active && (
        <section className="card">
          <div className="section-title">
            <h2>Versiones · {active.title}</h2>
            <button className="text-button" onClick={() => setActive(null)}>
              Cerrar
            </button>
          </div>
          <form className="inline-form" onSubmit={generate}>
            <label>
              Nombre de versión
              <input
                name="label"
                placeholder="ORIGINAL / A / B"
                required
                maxLength={80}
              />
            </label>
            <label className="check">
              <input type="checkbox" name="shuffleQuestions" />
              Reordenar preguntas
            </label>
            <label className="check">
              <input type="checkbox" name="shuffleOptions" />
              Reordenar alternativas
            </label>
            <button disabled={busy}>Crear versión</button>
          </form>
          <label>
            Formato PDF
            <select
              value={pdfMode}
              onChange={(e) => setPdfMode(e.target.value)}
            >
              <option value="original">Original</option>
              <option value="qr">Original con QR</option>
              <option value="sheet">Original con hoja añadida</option>
              <option value="qr-sheet">Original con QR y hoja añadida</option>
            </select>
          </label>
          {versions.map((v) => (
            <div className="version-row" key={v.id}>
              <strong>{v.label}</strong>
              <div className="actions">
                <a
                  className="button secondary"
                  target="_blank"
                  href={`/api/pdf/${v.id}?mode=${pdfMode}`}
                >
                  Examen PDF
                </a>
                <a
                  className="button secondary"
                  target="_blank"
                  href={`/api/pdf/${v.id}?mode=answers`}
                >
                  Hoja OMR
                </a>
                <a
                  className="button secondary"
                  target="_blank"
                  href={`/api/pdf/${v.id}?mode=keys`}
                >
                  Claves PDF
                </a>
              </div>
            </div>
          ))}
        </section>
      )}
      <section className="card">
        <div className="section-title">
          <h2>Evaluaciones guardadas</h2>
          <input
            className="search"
            placeholder="Buscar evaluación…"
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
                  <th>Evaluación</th>
                  <th>Grupo</th>
                  <th>Periodo</th>
                  <th>Preguntas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.title}</strong>
                      <small>{r.area}</small>
                    </td>
                    <td>
                      {r.grade} · {r.section}
                    </td>
                    <td>{r.bimester}</td>
                    <td>{r.question_ids.length}</td>
                    <td>
                      <div className="actions">
                        <button className="secondary" onClick={() => edit(r)}>
                          Editar
                        </button>
                        <button
                          className="text-button"
                          onClick={() => showVersions(r)}
                        >
                          Versiones y PDF
                        </button>
                      </div>
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
