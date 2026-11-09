"use client";
import { useState } from "react";
import {
  Heading,
  Empty,
  Pager,
  useRows,
  requireUser,
  errorText,
} from "./common";
import { QuestionComposer, blankQuestion } from "./question-composer";
import { useCatalog } from "./catalog";
import { type Question } from "@/lib/domain";
export function QuestionBank() {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [editing, setEditing] = useState<Question | null>(null),
    [message, setMessage] = useState("");
  const { reload, save } = useCatalog();
  const { rows, count, error, loading, load } = useRows<{
    id: string;
    prompt: string;
    payload: Question;
  }>("questions", "id,prompt,payload", search, "prompt", page, "prompt");
  async function persist(q: Question) {
    const { db, user } = await requireUser();
    const { error } = await db.from("questions").upsert({
      owner_id: user.id,
      id: q.id,
      prompt: q.prompt,
      area: q.area,
      topic: q.topic,
      difficulty: q.difficulty,
      archived: q.archived,
      payload: q,
    });
    if (error) throw error;
    for (const kind of ["area", "subarea", "topic", "competency"] as const)
      await save(kind, q[kind]);
    await reload();
    await load();
    setMessage("Pregunta guardada en el banco.");
  }
  return (
    <>
      <Heading
        title="Banco de preguntas"
        description="Preguntas, imágenes y catálogos guardados en tu cuenta."
      >
        <button onClick={() => setEditing(blankQuestion())}>
          + Nueva pregunta
        </button>
      </Heading>
      {(message || error) && (
        <p role="status" className="notice">
          {message || error}
        </p>
      )}
      {editing && (
        <QuestionComposer
          key={editing.id}
          initial={editing}
          bankOnly
          onClose={() => setEditing(null)}
          onSave={persist}
        />
      )}
      <section className="card">
        <div className="section-title">
          <h2>{count} preguntas</h2>
          <input
            aria-label="Buscar preguntas"
            placeholder="Buscar enunciado…"
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
                  <th>Pregunta</th>
                  <th>Área / tema</th>
                  <th>Puntaje</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.prompt}</strong>
                      <small>{r.payload.type}</small>
                    </td>
                    <td>
                      {r.payload.area} · {r.payload.topic}
                    </td>
                    <td>{r.payload.score}</td>
                    <td>{r.payload.archived ? "Archivada" : "Disponible"}</td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => setEditing(r.payload)}
                      >
                        Editar
                      </button>
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await persist({
                              ...r.payload,
                              archived: !r.payload.archived,
                            });
                          } catch (e) {
                            setMessage(errorText(e));
                          }
                        }}
                      >
                        {r.payload.archived ? "Restaurar" : "Archivar"}
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
