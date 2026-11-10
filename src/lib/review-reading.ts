import type { Answer, Item, Question } from "./domain";
export const readingLabels: Record<string, string> = {
  answered: "Marca detectada",
  blank: "Sin marca",
  multiple: "Varias alternativas marcadas",
  ambiguous: "Lectura dudosa",
  manualReview: "Respuesta escrita: revisar",
  replaced: "Captura sustituida",
  processed: "Revisada",
  pending: "Pendiente",
  synced: "Guardada",
  failed: "Error de lectura",
  missing: "Falta la hoja",
  conflict: "Varias capturas activas: elige una",
};
export function optionLabel(
  item: Item | undefined,
  selected: number | null,
  question?: Question,
) {
  if (selected === null) return "Sin respuesta confirmada";
  if (item?.type === "trueFalse") return selected === 0 ? "Verdadero" : "Falso";
  const letter = String.fromCharCode(65 + selected);
  const value =
    item?.type === "matching"
      ? question?.rightColumn[selected]
      : question?.options[selected];
  return value ? `${letter}) ${value}` : letter;
}
export interface ReadingScan {
  id: string;
  page_number: number;
  status: string;
  created_at: string;
  answers: {
    question_id: string;
    selected: number | null;
    status: Answer["status"];
    confidence: number;
  }[];
}
export function itemReading(item: Item, scans: ReadingScan[]) {
  const candidates = scans
    .filter((s) => s.status !== "replaced" && s.page_number === item.page)
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
  const answer = candidates
    .flatMap((s) => s.answers)
    .find((a) => a.question_id === item.questionId);
  const state =
    candidates.length > 1
      ? "conflict"
      : !candidates.length
        ? "missing"
        : (answer?.status ?? "ambiguous");
  const pending =
    item.type === "openResponse" ||
    ["missing", "conflict", "ambiguous", "multiple", "manualReview"].includes(
      state,
    );
  const score = pending
    ? null
    : answer?.status === "answered" &&
        answer.selected === item.correctOptionIndex
      ? item.score
      : 0;
  return { answer, state, score, pending };
}
export interface WrittenText {
  questionId: string;
  label: string;
  text: string;
  engine: string;
  warning?: string;
}
export function parseWrittenTranscript(value: string): WrittenText[] {
  try {
    const parsed = JSON.parse(value);
    return parsed.format === "cramer-written-v1" &&
      Array.isArray(parsed.answers)
      ? parsed.answers.filter(
          (a: WrittenText) =>
            a &&
            typeof a.questionId === "string" &&
            typeof a.label === "string" &&
            typeof a.text === "string",
        )
      : [];
  } catch {
    return [];
  }
}
