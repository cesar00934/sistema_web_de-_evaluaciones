import { z } from "zod";

export const questionSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.enum(["multipleChoice", "trueFalse", "matching", "openResponse"]),
    prompt: z.string().trim().min(1).max(12000),
    subtitle: z.string().max(1000).default(""),
    options: z.array(z.string().min(1).max(3000)).max(8).default([]),
    correctOptionIndex: z.number().int().nonnegative().nullable().default(null),
    trueFalseStatements: z.array(z.string().min(1)).max(100).default([]),
    trueFalseAnswers: z.array(z.boolean()).default([]),
    leftColumn: z.array(z.string().min(1)).max(100).default([]),
    rightColumn: z.array(z.string().min(1)).max(8).default([]),
    matchingAnswers: z.array(z.number().int().nonnegative()).default([]),
    referenceAnswer: z.string().max(12000).default(""),
    score: z.number().finite().nonnegative().max(10000).default(1),
    area: z.string().max(200).default(""),
    subarea: z.string().max(200).default(""),
    topic: z.string().max(200).default(""),
    competency: z.string().max(1000).default(""),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    imagePath: z.string().nullable().default(null),
    teacherId: z.string().nullable().default(null),
    archived: z.boolean().default(false),
  })
  .superRefine((q, c) => {
    const bad = (message: string) => c.addIssue({ code: "custom", message });
    if (
      q.type === "multipleChoice" &&
      (q.options.length < 2 ||
        q.correctOptionIndex === null ||
        q.correctOptionIndex >= q.options.length)
    )
      bad("Completa alternativas y clave.");
    if (
      q.type === "trueFalse" &&
      (!q.trueFalseStatements.length ||
        q.trueFalseAnswers.length !== q.trueFalseStatements.length)
    )
      bad("Cada enunciado necesita una clave V/F.");
    if (
      q.type === "matching" &&
      (!q.leftColumn.length ||
        q.rightColumn.length < 2 ||
        q.matchingAnswers.length !== q.leftColumn.length ||
        q.matchingAnswers.some((i) => i >= q.rightColumn.length))
    )
      bad("Completa columnas y claves de relación.");
  });
export type Question = z.infer<typeof questionSchema>;
export interface Item {
  questionId: string;
  label: string;
  optionCount: number;
  correctOptionIndex: number | null;
  score: number;
  type: Question["type"];
  page: number;
  top?: number;
  prompt?: string;
  topic: string;
}
export interface SheetPage {
  pageNumber: number;
  items: Item[];
  written: Item[];
}
export type AnswerStatus =
  "answered" | "blank" | "multiple" | "ambiguous" | "manualReview";
export interface Answer {
  questionId: string;
  selected: number | null;
  status: AnswerStatus;
  confidence: number;
}
export interface Scan {
  id: string;
  page_number: number;
  status: string;
  answers: Answer[];
}
export interface Version {
  id: string;
  exam_id: string;
  label: string;
  questions: Question[];
  items: Item[];
  page_count: number;
}
export interface Exam {
  owner_id?: string;
  revision?: number;
  id: string;
  title: string;
  area: string;
  level: string;
  grade: string;
  section: string;
  bimester: string;
  unit: string;
  scale_maximum: number;
  teacher_id?: string | null;
  question_ids: string[];
  settings: Record<string, unknown>;
}

export const geometry = {
  width: 595.28,
  height: 841.89,
  marker: 38.5,
  firstY: 205,
  row: 24,
  firstX: 145,
  option: 55,
  rows: 24,
};
export function sheetLayout(questions: Question[]): SheetPage[] {
  const objective: Item[] = [],
    written: Item[] = [];
  questions.forEach((q, i) => {
    const common = { score: q.score, type: q.type, topic: q.topic, page: 0 };
    if (q.type === "multipleChoice")
      objective.push({
        ...common,
        questionId: q.id,
        label: `${i + 1}`,
        optionCount: q.options.length,
        correctOptionIndex: q.correctOptionIndex,
      });
    if (q.type === "trueFalse")
      q.trueFalseStatements.forEach((_, j) =>
        objective.push({
          ...common,
          score: q.score / q.trueFalseStatements.length,
          questionId: `${q.id}#${j}`,
          label: `${i + 1}.${j + 1}`,
          optionCount: 2,
          correctOptionIndex: q.trueFalseAnswers[j] ? 0 : 1,
        }),
      );
    if (q.type === "matching")
      q.leftColumn.forEach((_, j) =>
        objective.push({
          ...common,
          score: q.score / q.leftColumn.length,
          questionId: `${q.id}#${j}`,
          label: `${i + 1}.${j + 1}`,
          optionCount: q.rightColumn.length,
          correctOptionIndex: q.matchingAnswers[j] ?? null,
        }),
      );
    if (q.type === "openResponse")
      written.push({
        ...common,
        questionId: q.id,
        label: `${i + 1}`,
        optionCount: 0,
        correctOptionIndex: null,
        prompt: q.prompt,
        top: 205 + (written.length % 4) * 130,
      });
  });
  const pages: SheetPage[] = [];
  for (let i = 0; i < objective.length; i += 24) {
    const n = pages.length + 1;
    pages.push({
      pageNumber: n,
      items: objective.slice(i, i + 24).map((v) => ({ ...v, page: n })),
      written: [],
    });
  }
  for (let i = 0; i < written.length; i += 4) {
    const n = pages.length + 1;
    pages.push({
      pageNumber: n,
      items: [],
      written: written.slice(i, i + 4).map((v) => ({ ...v, page: n })),
    });
  }
  return pages.length ? pages : [{ pageNumber: 1, items: [], written: [] }];
}
export function classify(
  d: number[],
  threshold = 0.28,
  margin = 0.12,
): Omit<Answer, "questionId"> {
  if (d.length < 2 || d.some((v) => !Number.isFinite(v) || v < 0 || v > 1))
    throw Error("Marcas inválidas");
  const ranked = d.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v),
    [a, b] = ranked,
    gap = a.v - b.v;
  if (a.v < threshold)
    return { status: "blank", selected: null, confidence: 1 - a.v };
  if (b.v >= threshold)
    return { status: "multiple", selected: null, confidence: gap };
  if (gap < margin)
    return { status: "ambiguous", selected: null, confidence: gap };
  return {
    status: "answered",
    selected: a.i,
    confidence: a.v * (0.5 + gap / 2),
  };
}
export function calculate(
  items: Item[],
  scans: Scan[],
  manual: Record<string, number>,
  scale = 20,
) {
  const active = scans.filter((s) => s.status !== "replaced"),
    answers = new Map<string, Answer>();
  active.forEach((s) =>
    s.answers.forEach((a) => {
      if (!answers.has(a.questionId)) answers.set(a.questionId, a);
    }),
  );
  let automatic = 0,
    manualScore = 0,
    pending = active.length - new Set(active.map((s) => s.page_number)).size;
  items.forEach((i) => {
    const a = answers.get(i.questionId),
      m = manual[i.questionId];
    if (m !== undefined) {
      if (!Number.isFinite(m) || m < 0 || m > i.score)
        throw Error("Puntaje manual fuera de rango");
      manualScore += m;
    } else if (
      i.type === "openResponse" ||
      !a ||
      ["ambiguous", "multiple", "manualReview"].includes(a.status)
    )
      pending++;
    else if (a.status === "answered" && a.selected === i.correctOptionIndex)
      automatic += i.score;
  });
  const maximum = items.reduce((n, i) => n + i.score, 0);
  if (maximum <= 0 || scale <= 0)
    throw Error("Escala y puntaje máximo deben ser positivos");
  return {
    automatic_score: automatic,
    manual_score: manualScore,
    maximum_score: maximum,
    grade: (Math.min(maximum, automatic + manualScore) / maximum) * scale,
    pending,
  };
}
export function questionScore(
  mode: "manual" | "customTotal" | "automatic20",
  manual: number,
  count: number,
  total = 40,
) {
  return mode === "manual"
    ? manual
    : count <= 0
      ? 0
      : (mode === "automatic20" ? 20 : total) / count;
}
export function shuffled<T>(
  source: T[],
  random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
): T[] {
  const a = [...source];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function createVersion(
  questions: Question[],
  shuffleQuestions = true,
  shuffleOptions = true,
) {
  return (shuffleQuestions ? shuffled(questions) : questions).map((q) => {
    if (!shuffleOptions || q.type !== "multipleChoice") return { ...q };
    const order = shuffled(q.options.map((_, i) => i));
    return {
      ...q,
      options: order.map((i) => q.options[i]),
      correctOptionIndex: order.indexOf(q.correctOptionIndex!),
    };
  });
}
export function parseIdentity(
  text: string,
): { examId: string; versionId: string; pageNumber: number } | null {
  try {
    let examId, versionId, pageNumber;
    if (text.startsWith("CE1|")) {
      const parts = text.split("|");
      if (parts.length !== 4) return null;
      [, examId, versionId] = parts;
      pageNumber = Number(parts[3]);
    } else {
      const d = JSON.parse(text);
      if (d.protocol !== "cramer-exam" || d.version !== 1) return null;
      ({ examId, examVersionId: versionId, pageNumber } = d);
    }
    return typeof examId === "string" &&
      !!examId &&
      typeof versionId === "string" &&
      !!versionId &&
      Number.isInteger(pageNumber) &&
      pageNumber > 0 &&
      pageNumber <= 1000
      ? { examId, versionId, pageNumber }
      : null;
  } catch {
    return null;
  }
}
export function csvCell(value: unknown) {
  const s = String(value ?? "");
  return `"${(/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
}
