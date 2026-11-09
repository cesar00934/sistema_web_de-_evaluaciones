"use client";
import { useState } from "react";
import { useRows, Pager, Empty } from "./common";
export function LegacyArchive() {
  const [kind, setKind] = useState("results"),
    [page, setPage] = useState(0);
  const { rows, count, error } = useRows<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
  }>("legacy_archive", "id,kind,payload", kind, "kind", page);
  return (
    <section className="card">
      <h2>Archivo de migración</h2>
      <p className="muted">
        Los registros originales se conservan aquí para cotejo. Las notas de
        este archivo no sustituyen la revisión de resultados migrados.
      </p>
      <label>
        Tipo
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(0);
          }}
        >
          {[
            ["results", "Resultados originales"],
            ["scans", "Escaneos originales"],
            ["manual_grades", "Revisiones originales"],
            ["exams", "Exámenes originales"],
            ["hive", "Preferencias Hive"],
          ].map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="notice">{error}</p>}
      {!rows.length ? (
        <Empty text="No se han importado registros de este tipo." />
      ) : (
        rows.map((r) => (
          <details key={r.id} className="scan-review">
            <summary>{r.id}</summary>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontSize: 11,
              }}
            >
              {JSON.stringify(r.payload, null, 2)}
            </pre>
          </details>
        ))
      )}
      <Pager page={page} count={count} setPage={setPage} />
    </section>
  );
}
