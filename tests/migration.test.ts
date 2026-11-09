import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { migrationPlan } from "../scripts/migration-plan";
test("Migration planning is local, preserves version mappings and unknown records", () => {
  const q = {
    id: "q",
    type: "multipleChoice",
    prompt: "Pregunta",
    options: ["Correcta", "Otra"],
    correctOptionIndex: 0,
    score: 1,
  };
  const source = {
    format: "cramer-sqlite-export",
    version: 1,
    sourceHash: "synthetic",
    tables: {
      students: [
        {
          id: "student",
          payload: JSON.stringify({ id: "student", firstNames: "Test" }),
        },
      ],
      questions: [{ payload: JSON.stringify(q) }],
      exams: [{ payload: JSON.stringify({ id: "exam" }) }],
      exam_versions: [
        {
          payload: JSON.stringify({
            id: "version",
            examId: "exam",
            label: "B",
            questions: [
              {
                questionId: "q",
                position: 0,
                optionOrder: [1, 0],
                correctOptionIndex: 1,
              },
            ],
          }),
        },
      ],
      scans: [
        {
          payload: JSON.stringify({
            id: "unassigned",
            examVersionId: "version",
            pageNumber: 1,
          }),
        },
      ],
      results: [{ id: "historic-result", payload: '{"grade":13}' }],
    },
  };
  const plan = migrationPlan(source);
  assert.equal(plan.versions[0].questions[0].options[1], "Correcta");
  assert.equal(plan.students[0].id, "student");
  assert.deepEqual(plan.unassigned, ["unassigned"]);
  assert.equal(plan.issues.length, 0);
  assert.equal(source.tables.results[0].id, "historic-result");
});
test("Actual SQLite verification copy can be planned without a network connection", async (t) => {
  const file = "migration-output/verification-copy/legacy.json";
  let source;
  try {
    source = JSON.parse(await readFile(file, "utf8"));
  } catch {
    t.skip("Optional repository SQLite verification copy not exported");
    return;
  }
  const plan = migrationPlan(source);
  assert.equal(plan.issues.length, 0);
  assert.equal(plan.students.length, 8);
  assert.equal(plan.questions.length, 32);
  assert.equal(plan.versions.length, 1);
  assert.equal(plan.scans.length, 2);
  assert.equal(plan.unassigned.length, 1);
  const audit = JSON.parse(
    await readFile(
      "migration-output/verification-copy/export-audit.json",
      "utf8",
    ),
  );
  assert.equal(audit.originalUnchanged, true);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/migration-local-check.json",
    JSON.stringify(
      {
        networkUsed: false,
        originalUnchanged: true,
        counts: plan.counts,
        issues: plan.issues.length,
        unassigned: plan.unassigned.length,
        invalidPages: plan.invalidPages.length,
      },
      null,
      2,
    ),
  );
});
