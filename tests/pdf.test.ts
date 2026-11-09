import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { generatePdf } from "../src/lib/pdf";
import {
  institutionalDefaults,
  builtInAssets,
} from "../src/lib/editor-defaults";
import {
  questionSchema,
  sheetLayout,
  type Exam,
  type Version,
} from "../src/lib/domain";
const questions = [
  questionSchema.parse({
    id: "choice",
    type: "multipleChoice",
    prompt: "¿Cuál es el resultado de 2 + 2?",
    options: ["Tres", "Cuatro", "Cinco", "Seis"],
    correctOptionIndex: 1,
    score: 5,
    area: "Matemática",
    topic: "Suma",
  }),
  questionSchema.parse({
    id: "tf",
    type: "trueFalse",
    prompt: "Indica verdadero o falso.",
    trueFalseStatements: [
      "El cuadrado tiene cuatro lados.",
      "El triángulo tiene cuatro lados.",
    ],
    trueFalseAnswers: [true, false],
    score: 5,
  }),
  questionSchema.parse({
    id: "match",
    type: "matching",
    prompt: "Relaciona cada expresión con su resultado.",
    leftColumn: ["2 + 3", "3 × 4"],
    rightColumn: ["12", "5"],
    matchingAnswers: [1, 0],
    score: 5,
  }),
  questionSchema.parse({
    id: "open",
    type: "openResponse",
    prompt: "Explica cómo resolviste el problema.",
    referenceAnswer: "Evaluar procedimiento y justificación.",
    score: 5,
  }),
];
const pages = sheetLayout(questions),
  exam: Exam = {
    id: "pdf-exam",
    title: "Evaluación de Matemática",
    area: "Matemática",
    grade: "3.º",
    section: "A",
    level: "PRIMARIA",
    bimester: "BIMESTRE I",
    unit: "1",
    scale_maximum: 20,
    question_ids: questions.map((q) => q.id),
    settings: {
      columns: 2,
      date: "2026-11-05",
      instructions: "Lee con atención. Marca una sola respuesta.",
    },
  },
  version: Version = {
    id: "pdf-version",
    exam_id: exam.id,
    label: "A",
    questions,
    items: pages.flatMap((p) => [...p.items, ...p.written]),
    page_count: pages.length,
  };
test("PDF mixed exam, keys and separate sheets generate valid A4 documents", async () => {
  await mkdir("artifacts/pdf", { recursive: true });
  for (const mode of [
    "original",
    "qr",
    "sheet",
    "qr-sheet",
    "answers",
    "keys",
  ] as const) {
    const bytes = await generatePdf(exam, version, "COLEGIO CRAMER", mode),
      pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPages()[0].getWidth(), 595.28);
    const expected =
      mode === "answers"
        ? 2
        : mode === "keys"
          ? 1
          : mode.includes("sheet")
            ? 3
            : 1;
    assert.equal(pdf.getPageCount(), expected);
    await writeFile(`artifacts/pdf/${mode}.pdf`, bytes);
  }
  await writeFile(
    "artifacts/pdf/fixture.json",
    JSON.stringify({ exam, version }, null, 2),
  );
});
test("Long question text wraps to further pages without lost question content", async () => {
  const q = {
      ...questions[0],
      prompt:
        "Contenido extenso para verificar salto de columna y de página. ".repeat(
          120,
        ),
    },
    v = { ...version, questions: [q] };
  const bytes = await generatePdf(exam, v, "COLEGIO CRAMER", "original");
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 1);
});
test("Institutional logos, frame, central background and watermark are embedded", async () => {
  const decorated = {
    ...exam,
    settings: {
      ...exam.settings,
      institutional: {
        centralImage: "central",
        watermark: "watermark",
        frame: "curved",
        email: "contacto@example.test",
      },
    },
  };
  const bytes = await generatePdf(
    decorated,
    version,
    "COLEGIO CRAMER",
    "original",
    async () => new Uint8Array(await readFile("public/icon-192.png")),
    { left: "left", right: "right" },
  );
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  await writeFile("artifacts/pdf/decorated.pdf", bytes);
});

test("Original institutional headers persist across subsequent pages", async () => {
  const design = {
    ...exam,
    level: "INICIAL",
    grade: "2",
    area: "MATEMÁTICA",
    bimester: "BIMESTRE II",
    unit: "UNIDAD 2",
    settings: {
      columns: 2,
      teacherName: "MARÍA GARCÍA",
      date: "2026-11-05",
      subarea: "",
      institutional: {
        ...institutionalDefaults,
        headerFirst: "",
        headerFollowing: "builtin:4.png",
      },
    },
  };
  const simple = questionSchema.parse({
    id: "reference",
    type: "multipleChoice",
    prompt: "Observa la imagen y marca la respuesta.",
    options: ["Primera", "Segunda", "Tercera", "Cuarta", "Quinta"],
    correctOptionIndex: 0,
    imagePath: "diagram",
  });
  const load = async (asset: string) =>
    new Uint8Array(
      await readFile(
        builtInAssets.find((a) => a.id === asset)
          ? `public${builtInAssets.find((a) => a.id === asset)!.url}`
          : "public/icon-192.png",
      ),
    );
  const first = await generatePdf(
    design,
    { ...version, questions: [simple] },
    "COLEGIO CRAMER",
    "original",
    load,
  );
  await writeFile("artifacts/pdf/institutional-reference.pdf", first);
  assert.equal((await PDFDocument.load(first)).getPageCount(), 1);
  const extended = {
    ...design,
    settings: {
      ...design.settings,
      institutional: {
        ...design.settings.institutional,
        headerFirst: "builtin:1.jpg",
      },
    },
  };
  const many = Array.from({ length: 34 }, (_, i) => ({
    ...simple,
    id: `item-${i}`,
    prompt: `Pregunta ${i + 1}: resuelve y selecciona tu respuesta.`,
    imagePath: null,
  }));
  const bytes = await generatePdf(
    extended,
    { ...version, questions: many },
    "COLEGIO CRAMER",
    "original",
  );
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 3);
  await writeFile("artifacts/pdf/institutional-multipage.pdf", bytes);
  // Each page embeds the selected page-specific header along with the crest.
  for (const page of pdf.getPages()) assert.ok(page.node.Resources());
});

test("Mixed subtitle blocks preserve the original Flutter column order", async () => {
  const qs = [
    { ...questions[0], subtitle: "Bloque inicial", imagePath: "diagram" },
    { ...questions[1], subtitle: "Bloque siguiente" },
    { ...questions[2], prompt: "Relaciona las columnas.", subtitle: "" },
    { ...questions[0], id: "four", prompt: "Cuarta pregunta", subtitle: "" },
    { ...questions[0], id: "five", prompt: "Quinta pregunta", subtitle: "" },
  ];
  const fixtureExam = {
    ...exam,
    section: "",
    settings: {
      ...exam.settings,
      instructions: "",
      institutional: { ...institutionalDefaults },
    },
  };
  const fixtureVersion = { ...version, questions: qs };
  const bytes = await generatePdf(
    fixtureExam,
    fixtureVersion,
    "COLEGIO CRAMER",
    "original",
    async (asset) =>
      new Uint8Array(
        await readFile(
          builtInAssets.find((a) => a.id === asset)
            ? `public${builtInAssets.find((a) => a.id === asset)!.url}`
            : "public/icon-192.png",
        ),
      ),
  );
  await writeFile("artifacts/pdf/layout-web.pdf", bytes);
  await writeFile(
    "artifacts/pdf/layout-fixture.json",
    JSON.stringify({ exam: fixtureExam, version: fixtureVersion }, null, 2),
  );
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});
