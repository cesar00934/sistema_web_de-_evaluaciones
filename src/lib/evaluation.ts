import { z } from "zod";
import { questionSchema, type Question, type Exam } from "./domain";
export const evaluationSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: z.string().trim().min(1).max(200),
    area: z.string().max(200),
    level: z.string().max(200),
    grade: z.string().max(200),
    section: z.string().max(200),
    bimester: z.string().max(200),
    unit: z.string().max(200),
    teacher_id: z.string().nullable().optional(),
    scale_maximum: z.number().finite().positive().max(10000),
    revision: z.number().int().nonnegative().default(0),
    settings: z.record(z.string(), z.unknown()).and(
      z.object({
        localQuestions: z.array(questionSchema).max(250),
        scoringMode: z.enum(["manual", "automatic20", "customTotal"]),
        total: z.number().finite().positive().max(10000),
        columns: z.union([z.literal(1), z.literal(2)]),
      }),
    ),
    bankIds: z.array(z.string()).max(250).default([]),
  })
  .superRefine((e, c) => {
    const ids = e.settings.localQuestions.map((q) => q.id);
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", message: "Hay preguntas duplicadas" });
    if (e.bankIds.some((id) => !ids.includes(id)))
      c.addIssue({
        code: "custom",
        message: "Pregunta del banco fuera de la evaluación",
      });
  });
export function questionsForEvaluation(
  exam: Pick<Exam, "question_ids" | "settings">,
  bank: { id: string; payload: Question }[],
) {
  const local = (exam.settings.localQuestions ?? []) as Question[];
  return exam.question_ids.map((id) => {
    const q =
      local.find((q) => q.id === id) ?? bank.find((q) => q.id === id)?.payload;
    if (!q) throw Error(`No existe la pregunta ${id}`);
    return questionSchema.parse(q);
  });
}
export function validateOwnedAssets(value: unknown, owner: string) {
  const known = new Set([
    "builtin:1.jpg",
    "builtin:2.jpg",
    "builtin:3.png",
    "builtin:4.png",
    "builtin:5.png",
    "builtin:fc.png",
  ]);
  if (Array.isArray(value)) {
    value.forEach((v) => validateOwnedAssets(v, owner));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, v] of Object.entries(value)) {
    if (
      [
        "imagePath",
        "headerFirst",
        "headerFollowing",
        "centralImage",
        "watermark",
        "logoLeft",
        "logoRight",
      ].includes(key) &&
      typeof v === "string" &&
      v &&
      !known.has(v) &&
      !v.startsWith(owner + "/")
    )
      throw Error("La imagen no pertenece a esta cuenta");
    validateOwnedAssets(v, owner);
  }
}
