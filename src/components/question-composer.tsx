"use client";
import { useEffect, useRef, useState } from "react";
import { questionSchema, type Question } from "@/lib/domain";
import { CatalogInput } from "./catalog";
import { PrivateImage } from "./private-image";
import { errorText } from "./common";
import { useWorkspace } from "./workspace-context";
import {
  imageAccept,
  prepareQuestionImage,
  uploadQuestionImage,
} from "@/lib/question-image";
export function blankQuestion() {
  return questionSchema.parse({
    id: crypto.randomUUID(),
    type: "multipleChoice",
    prompt: "Nueva pregunta",
    options: [
      "Alternativa A",
      "Alternativa B",
      "Alternativa C",
      "Alternativa D",
      "Alternativa E",
    ],
    correctOptionIndex: 0,
    score: 1,
  });
}
export function QuestionComposer({
  initial,
  onSave,
  onClose,
  bankOnly = false,
  initialBank = false,
}: {
  initial: Question;
  onSave: (q: Question, bank: boolean) => Promise<void> | void;
  onClose: () => void;
  bankOnly?: boolean;
  initialBank?: boolean;
}) {
  const [q, setQ] = useState<Question>(initial),
    [vfKeys, setVfKeys] = useState<(boolean | undefined)[]>(
      initial.trueFalseStatements.map((_, i) => initial.trueFalseAnswers[i]),
    ),
    [matchingKeys, setMatchingKeys] = useState<(number | undefined)[]>(
      initial.leftColumn.map((_, i) => initial.matchingAnswers[i]),
    ),
    [imagePreview, setImagePreview] = useState(""),
    [imageMessage, setImageMessage] = useState(""),
    [toBank, setToBank] = useState(bankOnly || initialBank),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const { id: ownerId } = useWorkspace();
  const uploadPending = useRef(false);
  useEffect(
    () => () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    },
    [imagePreview],
  );
  const set = (key: keyof Question, value: unknown) =>
    setQ((p) => ({ ...p, [key]: value }));
  function resizeMatching(count: number) {
    setQ((p) => ({
      ...p,
      leftColumn: Array.from(
        { length: count },
        (_, i) => p.leftColumn[i] ?? "",
      ),
      rightColumn: Array.from(
        { length: count },
        (_, i) => p.rightColumn[i] ?? "",
      ),
    }));
    setMatchingKeys((keys) =>
      Array.from({ length: count }, (_, i) =>
        keys[i] !== undefined && keys[i]! < count ? keys[i] : undefined,
      ),
    );
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      if (
        q.type === "trueFalse" &&
        (vfKeys.length !== q.trueFalseStatements.length ||
          vfKeys.some((v) => v === undefined))
      )
        throw Error("Selecciona Verdadero o Falso para cada enunciado.");
      if (
        q.type === "matching" &&
        (matchingKeys.length !== q.leftColumn.length ||
          matchingKeys.some(
            (k) => k === undefined || k >= q.rightColumn.length,
          ))
      )
        throw Error(
          "Selecciona la letra correcta para cada elemento de la columna A.",
        );
      const parsed = questionSchema.parse({
        ...q,
        options: q.type === "multipleChoice" ? q.options : [],
        correctOptionIndex:
          q.type === "multipleChoice" ? q.correctOptionIndex : null,
        trueFalseStatements:
          q.type === "trueFalse" ? q.trueFalseStatements : [],
        trueFalseAnswers:
          q.type === "trueFalse" ? vfKeys.map((v) => v === true) : [],
        leftColumn: q.type === "matching" ? q.leftColumn : [],
        rightColumn: q.type === "matching" ? q.rightColumn : [],
        matchingAnswers:
          q.type === "matching" ? matchingKeys.map((k) => k!) : [],
        referenceAnswer: q.type === "openResponse" ? q.referenceAnswer : "",
      });
      await onSave(parsed, toBank);
      onClose();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (uploadPending.current) return;
    uploadPending.current = true;
    setBusy(true);
    setImageMessage("Preparando y guardando imagen…");
    try {
      const blob = await prepareQuestionImage(file);
      setImagePreview(URL.createObjectURL(blob));
      const path = await uploadQuestionImage(blob, ownerId);
      set("imagePath", path);
      setImageMessage(
        `Imagen guardada: ${file.name}. Usa «${bankOnly ? "Guardar en el banco" : "Usar en esta evaluación"}» para conservarla con la pregunta.`,
      );
    } catch (e) {
      setImagePreview("");
      setImageMessage(errorText(e));
    } finally {
      uploadPending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="card question-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Editor de pregunta"
      >
        <div className="section-title">
          <h2>Editar pregunta</h2>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
        {message && (
          <p role="alert" className="notice">
            {message}
          </p>
        )}
        <form id="question-composer-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Tipo de pregunta
              <select
                value={q.type}
                onChange={(e) => {
                  const type = e.target.value as Question["type"];
                  set("type", type);
                  if (type === "trueFalse" && !q.trueFalseStatements.length) {
                    set("trueFalseStatements", [""]);
                    setVfKeys([undefined]);
                  }
                  if (type === "matching" && !q.leftColumn.length)
                    resizeMatching(3);
                }}
              >
                <option value="multipleChoice">Alternativas</option>
                <option value="trueFalse">Verdadero / falso</option>
                <option value="matching">Relacionar</option>
                <option value="openResponse">Responder</option>
              </select>
            </label>
            <label>
              Puntaje
              <input
                type="number"
                min={0}
                max={10000}
                step="any"
                value={q.score}
                required
                onChange={(e) => set("score", Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            Subtítulo / bloque
            <input
              value={q.subtitle}
              onChange={(e) => set("subtitle", e.target.value)}
            />
          </label>
          <label>
            Enunciado
            <textarea
              rows={3}
              value={q.prompt}
              required
              onChange={(e) => set("prompt", e.target.value)}
            />
          </label>
          {q.type === "multipleChoice" && (
            <div>
              <div className="section-title">
                <h3>Alternativas y clave</h3>
                <button
                  type="button"
                  className="secondary"
                  disabled={q.options.length >= 8}
                  onClick={() => set("options", [...q.options, ""])}
                >
                  + Alternativa
                </button>
              </div>
              {q.options.map((v, i) => (
                <div className="option-row" key={i}>
                  <label className="check">
                    <input
                      type="radio"
                      name="correct"
                      checked={q.correctOptionIndex === i}
                      onChange={() => set("correctOptionIndex", i)}
                    />
                    {String.fromCharCode(97 + i)})
                  </label>
                  <input
                    aria-label={`Alternativa ${i + 1}`}
                    required
                    value={v}
                    onChange={(e) =>
                      set(
                        "options",
                        q.options.map((s, j) => (j === i ? e.target.value : s)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="text-button"
                    disabled={q.options.length <= 2}
                    onClick={() => {
                      setQ((p) => ({
                        ...p,
                        options: p.options.filter((_, j) => j !== i),
                        correctOptionIndex:
                          p.correctOptionIndex === i
                            ? 0
                            : (p.correctOptionIndex ?? 0) > i
                              ? (p.correctOptionIndex ?? 0) - 1
                              : p.correctOptionIndex,
                      }));
                    }}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
          {q.type === "trueFalse" && (
            <div>
              <div className="section-title">
                <h3>Enunciados V/F</h3>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setVfKeys((keys) => [...keys, undefined]);
                    setQ((p) => ({
                      ...p,
                      trueFalseStatements: [...p.trueFalseStatements, ""],
                      trueFalseAnswers: [...p.trueFalseAnswers, true],
                    }));
                  }}
                >
                  + Enunciado
                </button>
              </div>
              <p className="muted">
                Selecciona la respuesta correcta de cada enunciado. La clave se
                guarda para corregir y solo aparece en el PDF de claves.
              </p>
              {q.trueFalseStatements.map((v, i) => (
                <div className="option-row vf-row" key={i}>
                  <input
                    aria-label={`Enunciado ${i + 1}`}
                    value={v}
                    required
                    onChange={(e) =>
                      set(
                        "trueFalseStatements",
                        q.trueFalseStatements.map((x, j) =>
                          j === i ? e.target.value : x,
                        ),
                      )
                    }
                  />
                  <label className="vf-key">
                    Respuesta correcta {i + 1}
                    <select
                      aria-label={`Respuesta correcta ${i + 1}`}
                      required
                      value={
                        vfKeys[i] === undefined ? "" : vfKeys[i] ? "V" : "F"
                      }
                      onChange={(e) =>
                        setVfKeys((keys) =>
                          q.trueFalseStatements.map((_, j) =>
                            j === i ? e.target.value === "V" : keys[j],
                          ),
                        )
                      }
                    >
                      <option value="" disabled>
                        Elegir clave…
                      </option>
                      <option value="V">Verdadero (V)</option>
                      <option value="F">Falso (F)</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setVfKeys((keys) => keys.filter((_, j) => j !== i));
                      setQ((p) => ({
                        ...p,
                        trueFalseStatements: p.trueFalseStatements.filter(
                          (_, j) => j !== i,
                        ),
                        trueFalseAnswers: p.trueFalseAnswers.filter(
                          (_, j) => j !== i,
                        ),
                      }));
                    }}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
          {q.type === "matching" && (
            <section className="matching-editor">
              <label>
                Cantidad de elementos a relacionar
                <select
                  value={q.leftColumn.length}
                  onChange={(e) => resizeMatching(Number(e.target.value))}
                >
                  {q.leftColumn.length > 8 && (
                    <option value={q.leftColumn.length}>
                      {q.leftColumn.length} elementos guardados
                    </option>
                  )}
                  {Array.from({ length: 7 }, (_, i) => i + 2).map((n) => (
                    <option key={n} value={n}>
                      {n} elementos (a – {String.fromCharCode(96 + n)})
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                Escribe los elementos de ambas columnas. Después elige qué letra
                de la columna B corresponde a cada número de la columna A.
              </p>
              <div className="form-grid matching-columns">
                <div>
                  <h3>Columna A</h3>
                  {q.leftColumn.map((text, i) => (
                    <label key={i}>
                      {i + 1}.
                      <input
                        aria-label={`Columna A, elemento ${i + 1}`}
                        required
                        value={text}
                        placeholder={`Elemento ${i + 1}`}
                        onChange={(e) =>
                          set(
                            "leftColumn",
                            q.leftColumn.map((s, j) =>
                              i === j ? e.target.value : s,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
                <div>
                  <h3>Columna B</h3>
                  {q.rightColumn.map((text, i) => (
                    <label key={i}>
                      {String.fromCharCode(97 + i)})
                      <input
                        aria-label={`Columna B, elemento ${String.fromCharCode(97 + i)}`}
                        required
                        value={text}
                        placeholder={`Respuesta ${String.fromCharCode(97 + i)}`}
                        onChange={(e) =>
                          set(
                            "rightColumn",
                            q.rightColumn.map((s, j) =>
                              i === j ? e.target.value : s,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
              <h3>Relaciones correctas</h3>
              <div className="matching-keys">
                {q.leftColumn.map((text, i) => (
                  <label key={i}>
                    <span>
                      {i + 1}. {text || `Elemento ${i + 1}`} →
                    </span>
                    <select
                      aria-label={`Relación correcta ${i + 1}`}
                      required
                      value={matchingKeys[i] ?? ""}
                      onChange={(e) =>
                        setMatchingKeys((keys) =>
                          q.leftColumn.map((_, j) =>
                            j === i ? Number(e.target.value) : keys[j],
                          ),
                        )
                      }
                    >
                      <option value="" disabled>
                        Selecciona la letra…
                      </option>
                      {q.rightColumn.map((answer, j) => (
                        <option key={j} value={j}>
                          {String.fromCharCode(97 + j)}){" "}
                          {answer || `Respuesta ${String.fromCharCode(97 + j)}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="matching-summary">
                Claves:{" "}
                {q.leftColumn
                  .map(
                    (_, i) =>
                      `${i + 1} → ${matchingKeys[i] === undefined ? "pendiente" : String.fromCharCode(97 + matchingKeys[i]!)}`,
                  )
                  .join(" · ")}
              </p>
            </section>
          )}
          {q.type === "openResponse" && (
            <label>
              Respuesta de referencia / rúbrica
              <textarea
                rows={3}
                value={q.referenceAnswer}
                onChange={(e) => set("referenceAnswer", e.target.value)}
              />
            </label>
          )}
          <div className="form-grid">
            {[
              ["area", "Área"],
              ["subarea", "Subárea"],
              ["topic", "Tema"],
              ["competency", "Competencia"],
            ].map(([key, label]) => (
              <CatalogInput
                key={key}
                kind={key}
                name={key}
                label={label}
                value={String(q[key as keyof Question] ?? "")}
                onChange={(v) => set(key as keyof Question, v)}
              />
            ))}
            <label>
              Dificultad
              <select
                value={q.difficulty}
                onChange={(e) => set("difficulty", e.target.value)}
              >
                <option value="easy">Fácil</option>
                <option value="medium">Media</option>
                <option value="hard">Difícil</option>
              </select>
            </label>
            <label>
              Imagen de la pregunta
              <input
                type="file"
                accept={imageAccept}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {imagePreview && (
            <img
              className="question-image-preview"
              src={imagePreview}
              alt="Vista previa de la imagen seleccionada"
            />
          )}
          {q.imagePath && (
            <>
              {!imagePreview && (
                <PrivateImage key={q.imagePath} path={q.imagePath} autoLoad />
              )}
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  set("imagePath", null);
                  setImagePreview("");
                  setImageMessage("");
                }}
              >
                Quitar imagen de esta pregunta
              </button>
            </>
          )}
          {!bankOnly && (
            <label className="check bank-toggle">
              <input
                type="checkbox"
                checked={toBank}
                onChange={(e) => setToBank(e.target.checked)}
              />
              Guardar también esta pregunta en mi banco al guardar la evaluación
            </label>
          )}
        </form>
        {imageMessage && (
          <p className="notice" role="status">
            {imageMessage}
          </p>
        )}
        <div className="actions">
          <button form="question-composer-form" type="submit" disabled={busy}>
            {busy
              ? "Guardando…"
              : bankOnly
                ? "Guardar en el banco"
                : "Usar en esta evaluación"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
        </div>
        {!bankOnly && (
          <small className="muted">
            Después de usar la pregunta, pulsa «Guardar evaluación» para
            conservar todos los cambios.
          </small>
        )}
      </section>
    </div>
  );
}
