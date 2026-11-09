import { test } from "node:test";
import assert from "node:assert/strict";
import {
  questionSchema,
  sheetLayout,
  calculate,
  classify,
  questionScore,
  createVersion,
  parseIdentity,
  csvCell,
} from "../src/lib/domain";
import { homography, processOmr, type Raster } from "../src/lib/omr";
import { studentPreview } from "../src/lib/imports";
const q = questionSchema.parse({
  id: "q1",
  type: "multipleChoice",
  prompt: "¿Cuánto es 2+2?",
  options: ["3", "4", "5"],
  correctOptionIndex: 1,
  score: 2,
});
test("Scoring keeps precision and blank counts zero without pending", () => {
  const items = sheetLayout([q]).flatMap((p) => p.items);
  assert.equal(
    calculate(
      items,
      [
        {
          id: "s",
          page_number: 1,
          status: "processed",
          answers: [
            {
              questionId: q.id,
              status: "blank",
              selected: null,
              confidence: 0.9,
            },
          ],
        },
      ],
      {},
    ).pending,
    0,
  );
  assert.equal(questionScore("automatic20", 1, 3), 20 / 3);
  assert.equal(questionScore("customTotal", 1, 3, 40), 40 / 3);
  assert.equal(questionScore("manual", 7, 3), 7);
});
test("Missing pages, double pages, teacher grades survive replacement", () => {
  const open = questionSchema.parse({
      id: "open",
      type: "openResponse",
      prompt: "Explica",
      score: 3,
    }),
    items = sheetLayout([q, open]).flatMap((p) => [...p.items, ...p.written]),
    scan = {
      id: "scan",
      page_number: 1,
      status: "ambiguous",
      answers: [
        {
          questionId: q.id,
          status: "answered" as const,
          selected: 1,
          confidence: 0.9,
        },
      ],
    };
  const a = calculate(items, [scan], {});
  assert.equal(a.grade, 8);
  assert.equal(a.pending, 1);
  const b = calculate(items, [scan, { ...scan, id: "other" }], { open: 3 });
  assert.equal(b.pending, 1);
  assert.equal(b.grade, 20);
  const c = calculate(
    items,
    [
      { ...scan, status: "replaced" },
      { ...scan, id: "new" },
    ],
    { open: 3, q1: 1 },
  );
  assert.equal(c.pending, 0);
  assert.equal(c.grade, 16);
  assert.throws(() => calculate(items, [scan], { open: 4 }));
});
test("True/false and matching spread question score and preserve original numbering", () => {
  const tf = questionSchema.parse({
      id: "tf",
      type: "trueFalse",
      prompt: "V/F",
      trueFalseStatements: ["a", "b"],
      trueFalseAnswers: [true, false],
      score: 4,
    }),
    matching = questionSchema.parse({
      id: "m",
      type: "matching",
      prompt: "Relaciona",
      leftColumn: ["a", "b"],
      rightColumn: ["A", "B"],
      matchingAnswers: [1, 0],
      score: 6,
    });
  const items = sheetLayout([q, tf, matching])[0].items;
  assert.equal(items[2].label, "2.2");
  assert.equal(items[2].correctOptionIndex, 1);
  assert.equal(items[3].score, 3);
  assert.equal(items[4].correctOptionIndex, 0);
});
test("Version remaps answer keys consistently", () => {
  for (let i = 0; i < 100; i++) {
    const [v] = createVersion([q]);
    assert.equal(v.options[v.correctOptionIndex!], "4");
  }
  assert.deepEqual(createVersion([q], false, false), [q]);
});
test("OMR classification matches legacy thresholds", () => {
  assert.equal(classify([0.1, 0.1]).status, "blank");
  assert.equal(classify([0.8, 0.7]).status, "multiple");
  assert.equal(classify([0.3, 0.23]).status, "ambiguous");
  assert.equal(classify([0.1, 0.85]).selected, 1);
  assert.throws(() => classify([NaN, 0]));
});
test("QR CE1 and JSON protocol, rejects invalid pages", () => {
  assert.deepEqual(parseIdentity("CE1|e|v|2"), {
    examId: "e",
    versionId: "v",
    pageNumber: 2,
  });
  assert.deepEqual(
    parseIdentity(
      '{"protocol":"cramer-exam","version":1,"examId":"e","examVersionId":"v","pageNumber":3}',
    ),
    { examId: "e", versionId: "v", pageNumber: 3 },
  );
  assert.equal(parseIdentity("CE1|e|v|0"), null);
  assert.equal(parseIdentity("CE1|e|v|1001"), null);
  assert.equal(parseIdentity("https://example.com"), null);
});
test("Pagination objective 24 rows, written 4, separate pages", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ ...q, id: `q${i}` })),
    open = Array.from({ length: 5 }, (_, i) =>
      questionSchema.parse({
        id: `o${i}`,
        type: "openResponse",
        prompt: "Explica",
      }),
    );
  const pages = sheetLayout([...many, ...open]);
  assert.equal(pages.length, 4);
  assert.equal(pages[0].items.length, 24);
  assert.equal(pages[1].items.length, 1);
  assert.equal(pages[2].written[0].label, "26");
  assert.equal(pages[3].written[0].page, 4);
});
test("Import without code has deterministic SHA256 and duplicate preview", async () => {
  const rows = [
    ["Nombres", "Apellidos", "Nivel", "Grado", "Sección"],
    ["Ana", "Pérez", "PRIMARIA", "3", "A"],
    ["Ana", "Pérez", "PRIMARIA", "3", "A"],
  ];
  const a = await studentPreview(rows),
    b = await studentPreview(rows);
  assert.equal(a.students.length, 1);
  assert.equal(a.errors.length, 1);
  assert.equal(a.students[0].code, b.students[0].code);
  assert.equal(a.students[0].code.length, 64);
  assert.ok(csvCell("=1+1").startsWith("\"'"));
});
test("Projective transform respects four correspondences", () => {
  const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    target = [
      { x: 20, y: 10 },
      { x: 100, y: 15 },
      { x: 110, y: 120 },
      { x: 10, y: 115 },
    ],
    map = homography(points, target);
  points.forEach((p, i) => {
    const t = map(p.x, p.y);
    assert.ok(Math.abs(t.x - target[i].x) < 1e-8);
    assert.ok(Math.abs(t.y - target[i].y) < 1e-8);
  });
});
function synthetic(): Raster {
  const width = 1000,
    height = 1414,
    data = new Uint8ClampedArray(width * height * 4).fill(255);
  const rect = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const i = (yy * width + xx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
  };
  const sx = width / 595.28,
    sy = height / 841.89;
  for (const [x, y] of [
    [32, 32],
    [550.28, 32],
    [550.28, 796.89],
    [32, 796.89],
  ])
    rect(
      Math.round(x * sx),
      Math.round(y * sy),
      Math.round(13 * sx),
      Math.round(13 * sy),
    );
  for (let o = 0; o < 3; o++) {
    const cx = Math.round((145 + o * 55) * sx),
      cy = Math.round(205 * sy);
    for (let y = -12; y <= 12; y++)
      for (let x = -12; x <= 12; x++) {
        const d = Math.hypot(x, y);
        if ((d > 9.8 && d < 11.6) || (o === 1 && d < 6.5))
          rect(cx + x, cy + y, 1, 1);
      }
  }
  return { width, height, data };
}
test("Real OMR reads marked pixels; missing markers refuse invented answers", () => {
  const image = synthetic(),
    page = sheetLayout([q])[0],
    r = processOmr(image, page);
  assert.equal(r.printedRows, 1);
  assert.equal(r.answers[0].status, "answered");
  assert.equal(r.answers[0].selected, 1);
  const white = {
    ...image,
    data: new Uint8ClampedArray(image.data.length).fill(255),
  };
  assert.throws(() => processOmr(white, page), /marcadores/);
});
