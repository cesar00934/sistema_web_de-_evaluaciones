import { test } from "node:test";
import assert from "node:assert/strict";
import { questionSchema } from "../src/lib/domain";
import {
  questionsForEvaluation,
  validateOwnedAssets,
  evaluationSchema,
} from "../src/lib/evaluation";
test("Local exam questions override bank without altering the source", () => {
  const bank = questionSchema.parse({
    id: "q",
    prompt: "Original",
    type: "multipleChoice",
    options: ["A", "B"],
    correctOptionIndex: 0,
  });
  const local = {
    ...bank,
    prompt: "Cambio solo para el examen",
    correctOptionIndex: 1,
  };
  const questions = questionsForEvaluation(
    { question_ids: ["q"], settings: { localQuestions: [local] } },
    [{ id: "q", payload: bank }],
  );
  assert.equal(questions[0].prompt, local.prompt);
  assert.equal(bank.prompt, "Original");
  assert.equal(questions[0].correctOptionIndex, 1);
});
test("Assets belong to the current user or to the explicit built-in collection", () => {
  validateOwnedAssets(
    {
      headerFirst: "builtin:1.jpg",
      localQuestions: [{ imagePath: "owner-a/file.png" }],
    },
    "owner-a",
  );
  assert.throws(() =>
    validateOwnedAssets(
      { institutional: { headerFollowing: "owner-b/header.png" } },
      "owner-a",
    ),
  );
  assert.throws(() =>
    validateOwnedAssets({ headerFirst: "builtin:../../private" }, "owner-a"),
  );
});
test("Bank save is explicit and evaluation payload validates question keys", () => {
  const q = questionSchema.parse({
    id: "q",
    prompt: "Pregunta",
    type: "multipleChoice",
    options: ["A", "B"],
    correctOptionIndex: 0,
  });
  const e = {
    id: "e",
    title: "Examen",
    area: "MATEMÁTICA",
    level: "PRIMARIA",
    grade: "2",
    section: "A",
    bimester: "II",
    unit: "2",
    scale_maximum: 20,
    settings: {
      localQuestions: [q],
      scoringMode: "manual",
      total: 40,
      columns: 2,
    },
  };
  assert.deepEqual(evaluationSchema.parse(e).bankIds, []);
  assert.equal(
    evaluationSchema.parse({ ...e, bankIds: ["q"] }).bankIds.length,
    1,
  );
  assert.throws(() => evaluationSchema.parse({ ...e, bankIds: ["other"] }));
  assert.throws(() =>
    evaluationSchema.parse({
      ...e,
      settings: { ...e.settings, localQuestions: [q, q] },
    }),
  );
});
