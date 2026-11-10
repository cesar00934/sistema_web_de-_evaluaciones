import { useState } from "react";
import type { Item, Question } from "@/lib/domain";
import {
  itemReading,
  optionLabel,
  readingLabels,
  type ReadingScan,
  type WrittenText,
} from "@/lib/review-reading";
export interface ManualReview {
  score: number;
  rubric: { text?: string; transcription?: string; selected?: string };
}
export function AnswerReview({
  item,
  question,
  scans,
  existing,
  transcript,
  evidenceId,
  busy,
  onSave,
}: {
  item: Item;
  question?: Question;
  scans: ReadingScan[];
  existing?: ManualReview;
  transcript?: WrittenText;
  evidenceId?: string;
  busy: boolean;
  onSave: (e: React.FormEvent<HTMLFormElement>, item: Item) => void;
}) {
  const reading = itemReading(item, scans);
  const [score, setScore] = useState(
    String(existing?.score ?? reading.score ?? ""),
  );
  const [selected, setSelected] = useState(existing?.rubric.selected ?? "");
  const confirmed = existing?.rubric.selected;
  const reviewedText = existing?.rubric.transcription;
  const [main, sub] = item.label.split(".");
  const subIndex = Number(item.questionId.split("#")[1]);
  const detail =
    item.type === "trueFalse"
      ? question?.trueFalseStatements[subIndex]
      : item.type === "matching"
        ? question?.leftColumn[subIndex]
        : undefined;
  return (
    <article
      className="answer-review"
      aria-label={`Revisar pregunta ${item.label}`}
    >
      <div className="section-title">
        <h4>
          Pregunta {main}
          {sub
            ? ` · ${item.type === "matching" ? "Relación" : "Enunciado"} ${sub}`
            : ""}
        </h4>
        <span
          className={`badge ${existing ? "success" : reading.pending ? "warning" : ""}`}
        >
          {existing ? "Confirmado por docente" : readingLabels[reading.state]}
        </span>
      </div>
      <p>
        <strong>{question?.prompt}</strong>
      </p>
      {detail && <p>{detail}</p>}
      {evidenceId && (
        <a
          className="evidence-link"
          href={`#${evidenceId}`}
          onClick={() => {
            const sheet = document.getElementById(evidenceId);
            if (sheet instanceof HTMLDetailsElement) sheet.open = true;
          }}
        >
          Ver evidencia de la hoja {item.page}
        </a>
      )}
      <div className="answer-comparison">
        <div>
          <small>Respuesta detectada · Hoja {item.page}</small>
          <strong>
            {item.type === "openResponse"
              ? "Texto escrito (requiere revisión)"
              : reading.state === "conflict"
                ? "Capturas en conflicto"
                : reading.answer?.status === "answered"
                  ? optionLabel(item, reading.answer.selected, question)
                  : readingLabels[reading.state]}
          </strong>
        </div>
        <div>
          <small>
            {item.type === "openResponse"
              ? "Respuesta de referencia"
              : "Respuesta correcta"}
          </small>
          <strong>
            {item.type === "openResponse"
              ? question?.referenceAnswer || "Sin referencia"
              : optionLabel(item, item.correctOptionIndex, question)}
          </strong>
        </div>
        <div>
          <small>Puntaje automático</small>
          <strong>
            {reading.score ?? "Pendiente"} / {item.score}
          </strong>
        </div>
      </div>
      {existing && (
        <p>
          <strong>
            Puntaje docente {existing.score} / {item.score}
          </strong>
          {confirmed &&
            ` · ${confirmed === "blank" ? "Sin respuesta" : optionLabel(item, Number(confirmed), question)}`}
          {existing.rubric.text && <> · {existing.rubric.text}</>}
        </p>
      )}
      {item.type === "openResponse" && (
        <div className="notice">
          <strong>
            {reviewedText
              ? "Transcripción revisada"
              : "Texto propuesto por el lector"}
          </strong>
          <p className="written-text">
            {reviewedText ||
              transcript?.text ||
              transcript?.warning ||
              "Sin transcripción. Puedes leer el manuscrito desde la hoja del alumno."}
          </p>
          <small>
            Compara el texto con la imagen. La transcripción no asigna puntaje
            automáticamente.
          </small>
        </div>
      )}
      {reading.pending && !existing && (
        <p className="notice">
          {reading.state === "missing"
            ? `Carga la hoja ${item.page} o revisa la evidencia antes de confirmar.`
            : reading.state === "conflict"
              ? "Elige la captura correcta en las hojas del alumno antes de continuar."
              : "Revisa la imagen y confirma la respuesta o el puntaje. Esta lectura no cuenta como nota definitiva."}
        </p>
      )}
      <details className="grade-editor">
        <summary>
          {existing
            ? "Rectificar revisión docente"
            : reading.pending
              ? "Revisar y confirmar puntaje"
              : "Rectificar respuesta o puntaje"}
        </summary>
        <form onSubmit={(e) => onSave(e, item)}>
          {item.type !== "openResponse" && (
            <label>
              Respuesta confirmada al revisar la imagen
              <select
                name="selected"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  if (e.target.value !== "")
                    setScore(
                      Number(e.target.value) === item.correctOptionIndex
                        ? String(item.score)
                        : "0",
                    );
                }}
              >
                <option value="">Asignar puntaje manualmente</option>
                {Array.from({ length: item.optionCount }, (_, i) => (
                  <option key={i} value={i}>
                    {optionLabel(item, i, question)}
                  </option>
                ))}
                <option value="blank">Sin respuesta</option>
              </select>
            </label>
          )}
          {item.type === "openResponse" && (
            <label>
              Transcripción revisada
              <textarea
                name="transcription"
                rows={4}
                defaultValue={
                  existing?.rubric.transcription ?? transcript?.text ?? ""
                }
              />
            </label>
          )}
          <div className="form-grid">
            <label>
              Puntaje a guardar (0 a {item.score})
              <input
                name="score"
                type="number"
                min={0}
                max={item.score}
                step="any"
                required
                value={score}
                onChange={(e) => setScore(e.target.value)}
              />
            </label>
            <label>
              Motivo u observación
              <input name="rubric" defaultValue={existing?.rubric.text} />
            </label>
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setScore(String(item.score))}
            >
              Puntaje completo: {item.score}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setScore("0")}
            >
              Sin puntaje: 0
            </button>
            <button disabled={busy}>
              {busy ? "Guardando…" : "Guardar revisión y recalcular nota"}
            </button>
          </div>
          <small>
            La revisión docente se conserva si vuelves a procesar la imagen.
          </small>
        </form>
      </details>
    </article>
  );
}
