import { test } from "node:test";
import assert from "node:assert/strict";
import { sheetLayout, questionSchema } from "../src/lib/domain";
import {
  itemReading,
  optionLabel,
  parseWrittenTranscript,
} from "../src/lib/review-reading";
import { writtenLines } from "../src/lib/written-crops";
const q = questionSchema.parse({
  id: "q",
  type: "trueFalse",
  prompt: "Evalua",
  trueFalseStatements: ["Primero", "Segundo"],
  trueFalseAnswers: [true, false],
  score: 2,
});
const item = sheetLayout([q])[0].items[0];
const scan = {
  id: "scan",
  page_number: 1,
  status: "processed",
  created_at: "2026-11-09",
  answers: [
    {
      question_id: item.questionId,
      selected: 0,
      status: "answered" as const,
      confidence: 0.9,
    },
  ],
};
test("Review explains missing, replaced, double, blank and ambiguous readings without inventing grades", () => {
  assert.equal(itemReading(item, [scan]).score, 1);
  assert.equal(
    itemReading(item, [{ ...scan, status: "replaced" }]).state,
    "missing",
  );
  assert.equal(
    itemReading(item, [scan, { ...scan, id: "duplicate" }]).score,
    null,
  );
  assert.equal(
    itemReading(item, [
      {
        ...scan,
        answers: [{ ...scan.answers[0], selected: null, status: "ambiguous" }],
      },
    ]).score,
    null,
  );
  assert.equal(
    itemReading(item, [
      {
        ...scan,
        answers: [{ ...scan.answers[0], selected: null, status: "blank" }],
      },
    ]).score,
    0,
  );
  assert.equal(optionLabel(item, 0, q), "Verdadero");
  assert.equal(optionLabel(item, 1, q), "Falso");
});
test("Per-question transcription keeps text separate from answer reference and preserves legacy text", () => {
  const value = JSON.stringify({
    format: "cramer-written-v1",
    answers: [
      { questionId: "q", label: "1", text: "Mi respuesta", engine: "local" },
    ],
  });
  assert.equal(parseWrittenTranscript(value)[0].text, "Mi respuesta");
  assert.deepEqual(parseWrittenTranscript("Texto antiguo"), []);
  assert.deepEqual(
    parseWrittenTranscript('{"format":"cramer-written-v1","answers":[null]}'),
    [],
  );
  assert.deepEqual(parseWrittenTranscript("invalid"), []);
});
test("Written response segmentation removes printed rules and detects separate nonempty text lines", () => {
  const width = 595,
    height = 842,
    data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  };
  for (const y of [250, 269, 288, 307])
    for (let x = 65; x < 530; x++) ink(x, y);
  assert.equal(writtenLines({ width, height, data }, 205).lines.length, 0);
  for (let y = 254; y <= 261; y++) for (let x = 100; x < 150; x += 3) ink(x, y);
  for (let y = 274; y <= 281; y++) for (let x = 100; x < 160; x += 3) ink(x, y);
  const result = writtenLines({ width, height, data }, 205);
  assert.equal(result.lines.length, 2);
  assert.ok(result.lines.every((l) => l.width < 120 && l.height < 25));
});
