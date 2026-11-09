"use client";
import { useCallback, useEffect, useState } from "react";
import { Heading, Empty, Pager, errorText, download } from "./common";
import { PrivateImage } from "./records";
import { browserClient } from "@/lib/supabase/client";
import {
  emptyFilters,
  resultQuery,
  type Filters,
  type ResultRow,
} from "@/lib/result-query";
import type { Answer, Item, Version } from "@/lib/domain";
import { recognize } from "@/lib/worker-client";
import { useWorkspace } from "./workspace-context";
interface ReviewScan {
  id: string;
  page_number: number;
  status: string;
  transcript: string;
  warning: string;
  created_at: string;
  answers: {
    question_id: string;
    selected: number | null;
    status: Answer["status"];
    confidence: number;
  }[];
  attachments: { id: string; path: string; thumbnail_path: string | null }[];
}
interface Review {
  version: Version;
  scans: ReviewScan[];
  manual: { question_id: string; score: number; rubric: { text?: string } }[];
  result: ResultRow;
}
interface Summary {
  total: number;
  pending: number;
  average: number | null;
  maximum: number | null;
  minimum: number | null;
  passed: number;
  courses: { area: string; count: number; average: number }[];
  topics: {
    topic: string;
    percentage: number;
    obtained: number;
    maximum: number;
  }[];
  distribution: { label: number; count: number }[] | null;
}
export function Results({ mode }: { mode: string }) {
  const { id: ownerId } = useWorkspace();
  const [filters, setFilters] = useState<Filters>({
      ...emptyFilters,
      owner: ownerId,
      pending: mode === "correccion",
    }),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<ResultRow[]>([]),
    [count, setCount] = useState(0),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [summary, setSummary] = useState<Summary | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const load = useCallback(async () => {
    try {
      const db = browserClient();
      const { data, error, count } = await resultQuery(db, filters).range(
        page * 25,
        page * 25 + 24,
      );
      if (error) throw error;
      setRows(data as unknown as ResultRow[]);
      setCount(count ?? 0);
      const { data: summary, error: se } = await db.rpc("academic_summary", {
        p_area: filters.area,
        p_bimester: filters.bimester,
        p_grade: filters.grade,
        p_section: filters.section,
        p_student: filters.student,
        p_version: filters.version,
        p_pending: filters.pending,
        p_from: filters.from ? `${filters.from}T00:00:00-05:00` : null,
        p_until: filters.until ? `${filters.until}T23:59:59-05:00` : null,
      });
      if (se) throw se;
      setSummary(summary);
    } catch (e) {
      setMessage(errorText(e));
    }
  }, [filters, page]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);
  async function open(result: ResultRow) {
    try {
      const db = browserClient(),
        [v, s, m] = await Promise.all([
          db
            .from("versions")
            .select("id,exam_id,label,questions,items,page_count")
            .eq("id", result.version_id)
            .eq("owner_id", result.owner_id)
            .single(),
          db
            .from("scans")
            .select(
              "id,page_number,status,transcript,warning,created_at,answers(question_id,selected,status,confidence),attachments(id,path,thumbnail_path)",
            )
            .eq("version_id", result.version_id)
            .eq("owner_id", result.owner_id)
            .eq("student_id", result.student_id)
            .order("created_at"),
          db
            .from("manual_grades")
            .select("question_id,score,rubric")
            .eq("version_id", result.version_id)
            .eq("owner_id", result.owner_id)
            .eq("student_id", result.student_id),
        ]);
      for (const r of [v, s, m]) if (r.error) throw r.error;
      setReview({ version: v.data!, scans: s.data!, manual: m.data!, result });
      setSelected([]);
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  async function manual(e: React.FormEvent<HTMLFormElement>, item: Item) {
    e.preventDefault();
    if (!review) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const { error } = await browserClient().rpc("review_answer", {
        p_version: review.version.id,
        p_student: review.result.student_id,
        p_question: item.questionId,
        p_score: Number(f.get("score")),
        p_rubric: { text: String(f.get("rubric") ?? "") },
      });
      if (error) throw error;
      setMessage("Revisión guardada. Se conserva al reprocesar.");
      await open(review.result);
      await load();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeImages() {
    if (!review || !selected.length) return;
    setBusy(true);
    try {
      const db = browserClient(),
        images = review.scans
          .flatMap((s) => s.attachments)
          .filter((a) => selected.includes(a.id));
      for (const a of images) {
        const { error } = await db.storage
          .from("scans")
          .remove([a.path, ...(a.thumbnail_path ? [a.thumbnail_path] : [])]);
        if (error) throw error;
        const { error: de } = await db
          .from("attachments")
          .delete()
          .eq("id", a.id);
        if (de) throw de;
      }
      await open(review.result);
      setMessage(
        "Imágenes eliminadas. Respuestas, notas y resultados conservados.",
      );
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportReport(format: string) {
    setBusy(true);
    try {
      const params = new URLSearchParams({
        ...Object.fromEntries(
          Object.entries(filters).map(([k, v]) => [k, String(v)]),
        ),
        format,
      });
      const response = await fetch(`/api/reports?${params}`);
      if (!response.ok) throw Error((await response.json()).error);
      download(await response.blob(), `resultados.${format}`);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const filter = (key: keyof Filters, value: string | boolean) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  };
  return (
    <>
      <Heading
        title={
          mode === "correccion"
            ? "Revisión y corrección"
            : mode === "reportes"
              ? "Lo que nos dicen los resultados"
              : "Resultados académicos"
        }
        description={
          mode === "correccion"
            ? "Confirma respuestas y asigna puntajes con criterio docente."
            : "Notas guardadas y evidencia para acompañar el aprendizaje."
        }
      >
        <div className="actions">
          {["csv", "xlsx", "pdf"].map((f) => (
            <button
              className="secondary"
              key={f}
              disabled={busy}
              onClick={() => exportReport(f)}
            >
              Descargar {f.toUpperCase()}
            </button>
          ))}
        </div>
      </Heading>
      {message && (
        <div role="status" className="notice">
          {message}
        </div>
      )}
      <section className="card filters">
        <div className="form-grid">
          {[
            ["area", "Área exacta"],
            ["bimester", "Bimestre exacto"],
            ["grade", "Grado exacto"],
            ["section", "Sección exacta"],
            ["student", "ID de alumno (perfil)"],
            ["version", "ID de versión"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={String(filters[key as keyof Filters])}
                onChange={(e) => filter(key as keyof Filters, e.target.value)}
              />
            </label>
          ))}
          <label>
            Escaneado desde
            <input
              type="date"
              value={filters.from}
              onChange={(e) => filter("from", e.target.value)}
            />
          </label>
          <label>
            Escaneado hasta
            <input
              type="date"
              value={filters.until}
              onChange={(e) => filter("until", e.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={filters.pending}
              onChange={(e) => filter("pending", e.target.checked)}
            />
            Solo pendientes
          </label>
        </div>
      </section>
      {mode === "reportes" && summary && (
        <>
          <section className="stat-grid">
            {[
              ["Promedio", summary.average?.toFixed(2) ?? "—"],
              [
                "Máxima / mínima",
                `${summary.maximum?.toFixed(2) ?? "—"} / ${summary.minimum?.toFixed(2) ?? "—"}`,
              ],
              ["Aprobados (≥ 11)", summary.passed],
              ["Pendientes", summary.pending],
            ].map(([l, v]) => (
              <article className="stat-card" key={l}>
                <span>{l}</span>
                <strong>{v}</strong>
              </article>
            ))}
          </section>
          <div className="dashboard-grid">
            <section className="card">
              <h2>Áreas por reforzar</h2>
              <p className="muted">
                Promedios de resultados confirmados, de menor a mayor.
              </p>
              {summary.courses.map((c) => (
                <div className="metric-row" key={c.area}>
                  <strong>{c.area || "Sin área"}</strong>
                  <span>
                    {Number(c.average).toFixed(2)} · {c.count} resultados
                  </span>
                </div>
              ))}
            </section>
            <section className="card">
              <h2>Avance por tema</h2>
              <p className="muted">
                Porcentaje del puntaje revisado. Se excluyen lecturas ambiguas
                sin revisión.
              </p>
              {[...summary.topics]
                .sort((a, b) => a.percentage - b.percentage)
                .map((t) => (
                  <div className="topic" key={t.topic}>
                    <div>
                      <strong>{t.topic}</strong>
                      <span>{Number(t.percentage).toFixed(1)} %</span>
                    </div>
                    <progress value={Number(t.percentage)} max={100} />
                  </div>
                ))}
            </section>
          </div>
          <section className="card">
            <h2>Distribución de notas confirmadas</h2>
            {summary.distribution?.map((d) => (
              <div className="metric-row" key={d.label}>
                <span>
                  {d.label === 4
                    ? "100 %"
                    : `${d.label * 25}–${(d.label + 1) * 25} % de la escala`}
                </span>
                <strong>{d.count}</strong>
              </div>
            )) ?? <p>Aún no hay notas confirmadas.</p>}
            <small>
              Los filtros de esta página también se aplican a las exportaciones.
            </small>
          </section>
        </>
      )}
      {review && (
        <section className="card review">
          <div className="section-title">
            <div>
              <h2>
                {review.result.students.last_names},{" "}
                {review.result.students.first_names}
              </h2>
              <p>
                {review.result.versions.exams.title} · {review.version.label}
              </p>
            </div>
            <button className="secondary" onClick={() => setReview(null)}>
              Cerrar revisión
            </button>
          </div>
          <h3>Evidencia y páginas</h3>
          <p className="muted">
            Elegir una página sustituye todas las otras capturas activas de esa
            misma página. Las revisiones docentes se conservan.
          </p>
          {review.scans.map((scan) => (
            <details key={scan.id} className="scan-review">
              <summary>
                Página {scan.page_number} · {scan.status} ·{" "}
                {new Date(scan.created_at).toLocaleString("es-PE")}
              </summary>
              {scan.warning && <p className="notice">{scan.warning}</p>}
              {scan.attachments.length ? (
                scan.attachments.map((a) => (
                  <div key={a.id}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={selected.includes(a.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, a.id]
                              : selected.filter((v) => v !== a.id),
                          )
                        }
                      />
                      Seleccionar imagen para eliminar
                    </label>
                    <PrivateImage
                      bucket="scans"
                      path={a.path}
                      thumbnail={a.thumbnail_path}
                    />
                  </div>
                ))
              ) : (
                <p className="muted">
                  Imagen no disponible. La información académica está
                  conservada.
                </p>
              )}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const text = String(
                    new FormData(e.currentTarget).get("transcript") ?? "",
                  );
                  const { error } = await browserClient().rpc(
                    "update_transcript",
                    { p_scan: scan.id, p_text: text },
                  );
                  setMessage(error ? error.message : "Transcripción guardada.");
                }}
              >
                <label>
                  Transcripción editable
                  <textarea
                    name="transcript"
                    rows={5}
                    defaultValue={scan.transcript}
                  />
                </label>
                <button className="secondary">Guardar transcripción</button>
              </form>
              {scan.attachments.length > 0 && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const { data, error } = await browserClient()
                        .storage.from("scans")
                        .download(scan.attachments[0].path);
                      if (error) throw error;
                      const result = await recognize(
                        new File([data], "revision.jpg", {
                          type: "image/jpeg",
                        }),
                        review.version,
                        scan.page_number,
                      );
                      if (!result.ok) throw Error(result.error);
                      if (result.page !== scan.page_number)
                        throw Error(
                          "El QR indica otra página. Revisa la asignación.",
                        );
                      const { error: re } = await browserClient().rpc(
                        "reprocess_scan",
                        {
                          p_scan: scan.id,
                          p_answers: result.answers,
                          p_warning: result.warning,
                        },
                      );
                      if (re) throw re;
                      await open(review.result);
                      await load();
                      setMessage(
                        "Reprocesado desde copia guardada; revisiones docentes conservadas.",
                      );
                    } catch (e) {
                      setMessage(errorText(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Reprocesar copia guardada
                </button>
              )}
              <h4>Lecturas de esta captura</h4>
              {scan.answers.map((a) => (
                <div className="metric-row" key={a.question_id}>
                  <span>
                    {review.version.items.find(
                      (i) => i.questionId === a.question_id,
                    )?.label ?? a.question_id}
                  </span>
                  <span>
                    {a.selected === null
                      ? "Sin selección"
                      : String.fromCharCode(65 + a.selected)}{" "}
                    · {a.status} · {Number(a.confidence).toFixed(2)}
                  </span>
                </div>
              ))}
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  try {
                    const { error } = await browserClient().rpc(
                      "resolve_scan",
                      { p_scan: scan.id },
                    );
                    if (error) throw error;
                    await open(review.result);
                    await load();
                  } catch (e) {
                    setMessage(errorText(e));
                  }
                }}
              >
                Usar esta captura para la página {scan.page_number}
              </button>
            </details>
          ))}
          <button
            className="danger"
            disabled={busy || !selected.length}
            onClick={removeImages}
          >
            Eliminar {selected.length} imágenes seleccionadas
          </button>
          <h3>Revisión por pregunta</h3>
          {review.version.items.map((item) => {
            const existing = review.manual.find(
                (m) => m.question_id === item.questionId,
              ),
              q = review.version.questions.find(
                (q) => q.id === item.questionId.split("#")[0],
              );
            return (
              <form
                className="manual-grade"
                key={`${item.questionId}-${existing?.score ?? "new"}`}
                onSubmit={(e) => manual(e, item)}
              >
                <div>
                  <strong>
                    {item.label}. {q?.prompt}
                  </strong>
                  <p className="muted">
                    Máximo: {item.score} · Clave:{" "}
                    {item.correctOptionIndex === null
                      ? "Revisión docente"
                      : item.type === "trueFalse"
                        ? item.correctOptionIndex === 0
                          ? "V"
                          : "F"
                        : String.fromCharCode(65 + item.correctOptionIndex)}
                  </p>
                  {q?.referenceAnswer && <p>Referencia: {q.referenceAnswer}</p>}
                </div>
                <div className="form-grid">
                  <label>
                    Puntaje confirmado
                    <input
                      name="score"
                      type="number"
                      min={0}
                      max={item.score}
                      step="any"
                      required
                      defaultValue={existing?.score}
                    />
                  </label>
                  <label>
                    Rúbrica / observación
                    <input name="rubric" defaultValue={existing?.rubric.text} />
                  </label>
                </div>
                <button disabled={busy}>Confirmar puntaje</button>
              </form>
            );
          })}
        </section>
      )}
      <section className="card">
        <div className="section-title">
          <h2>{count} resultados</h2>
          <button className="text-button" onClick={() => load()}>
            Actualizar
          </button>
        </div>
        {!rows.length ? (
          <Empty text="Los resultados aparecerán después de guardar el primer escaneo." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Evaluación</th>
                  <th>Puntaje</th>
                  <th>Nota</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>
                        {r.students.last_names}, {r.students.first_names}
                      </strong>
                      <small>
                        {r.students.grade} · {r.students.section}
                      </small>
                      <button
                        className="text-button"
                        onClick={() => filter("student", r.student_id)}
                      >
                        Ver perfil
                      </button>
                    </td>
                    <td>
                      {r.versions.exams.title}
                      <small>
                        {r.versions.label} · {r.versions.exams.area}
                      </small>
                    </td>
                    <td>
                      {(
                        Number(r.automatic_score) + Number(r.manual_score)
                      ).toFixed(2)}{" "}
                      / {Number(r.maximum_score).toFixed(2)}
                    </td>
                    <td>
                      <strong className="grade">
                        {Number(r.grade).toFixed(2)}
                      </strong>
                    </td>
                    <td>
                      <span className={`badge ${r.pending ? "warning" : ""}`}>
                        {r.pending ? `${r.pending} pendientes` : "Confirmado"}
                      </span>
                    </td>
                    <td>
                      <button className="secondary" onClick={() => open(r)}>
                        Revisar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} count={count} setPage={setPage} />
        <p className="muted">
          Las notas pendientes son provisionales y se excluyen de los promedios
          confirmados.
        </p>
      </section>
    </>
  );
}
