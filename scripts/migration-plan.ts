import {
  questionSchema,
  sheetLayout,
  type Question,
  type Version,
} from "../src/lib/domain";
type LegacyRow = Record<string, unknown>;
export interface LegacyExport {
  format: string;
  version: number;
  sourceHash: string;
  tables: Record<string, LegacyRow[]>;
}
export function payload(row: LegacyRow) {
  return typeof row.payload === "string" ? JSON.parse(row.payload) : row;
}
export function migrationPlan(source: LegacyExport) {
  if (source.format !== "cramer-sqlite-export" || source.version !== 1)
    throw Error("Formato no compatible");
  const issues: string[] = [],
    table = (name: string) => source.tables[name] ?? [],
    rawQ = table("questions").map(payload),
    questions: Question[] = [];
  for (const raw of rawQ) {
    try {
      questions.push(
        questionSchema.parse({
          ...raw,
          subtitle: raw.subtitle ?? "",
          referenceAnswer: raw.referenceAnswer ?? "",
          imagePath: raw.imagePath ?? null,
          teacherId: raw.teacherId ?? null,
        }),
      );
    } catch (e) {
      issues.push(`Pregunta ${raw.id}: ${String(e)}`);
    }
  }
  const students = table("students").map(payload),
    exams = table("exams").map(payload),
    versions: Version[] = [];
  for (const row of table("exam_versions")) {
    const v = payload(row);
    try {
      const ordered = [...v.questions]
        .sort((a, b) => a.position - b.position)
        .map((m) => {
          const q = questions.find((q) => q.id === m.questionId);
          if (!q) throw Error(`No existe pregunta ${m.questionId}`);
          if (q.type !== "multipleChoice" || !m.optionOrder?.length)
            return { ...q };
          return questionSchema.parse({
            ...q,
            options: m.optionOrder.map((i: number) => q.options[i]),
            correctOptionIndex: m.correctOptionIndex,
          });
        });
      const pages = sheetLayout(ordered);
      versions.push({
        id: v.id,
        exam_id: v.examId,
        label: v.label,
        questions: ordered,
        items: pages.flatMap((p) => [...p.items, ...p.written]),
        page_count: pages.length,
      });
    } catch (e) {
      issues.push(`Versión ${v.id}: ${String(e)}`);
    }
  }
  const scans = table("scans").map(payload),
    unassigned = scans.filter((s) => !s.studentId),
    invalidPages = scans.filter((s) => {
      const v = versions.find((v) => v.id === s.examVersionId);
      return !v || s.pageNumber < 1 || s.pageNumber > v.page_count;
    });
  return {
    sourceHash: source.sourceHash,
    students,
    questions,
    exams,
    versions,
    scans,
    issues,
    unassigned: unassigned.map((s) => s.id),
    invalidPages: invalidPages.map((s) => s.id),
    counts: Object.fromEntries(
      Object.entries(source.tables).map(([k, v]) => [k, v.length]),
    ),
  };
}
