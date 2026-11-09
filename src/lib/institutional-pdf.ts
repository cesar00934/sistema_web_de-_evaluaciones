import {
  PDFDocument,
  rgb,
  type PDFPage,
  type PDFFont,
  type PDFImage,
} from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import {
  geometry as G,
  type Exam,
  type Version,
  type Question,
} from "./domain";
import { institutionalDefaults, builtInAssets } from "./editor-defaults";
const border = rgb(56 / 255, 142 / 255, 60 / 255),
  gray = rgb(0.46, 0.46, 0.46),
  black = rgb(0, 0, 0);
const ascentRatios = new WeakMap<PDFFont, number>();
function ttfAscent(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let head = 0,
    hhea = 0;
  for (let i = 0; i < view.getUint16(4); i++) {
    const pos = 12 + i * 16,
      tag = String.fromCharCode(...bytes.subarray(pos, pos + 4));
    if (tag === "head") head = view.getUint32(pos + 8);
    if (tag === "hhea") hhea = view.getUint32(pos + 8);
  }
  return view.getInt16(hhea + 4) / view.getUint16(head + 18);
}
function textAscent(font: PDFFont, size: number) {
  // Match Dart PDF's hhea ascent; pdf-lib's descender:false uses unscaled font units.
  return ascentRatios.has(font)
    ? ascentRatios.get(font)! * size
    : (font.heightAtSize(size) * 1900) / 2400;
}
export function wrapText(
  value: string,
  font: PDFFont,
  size: number,
  width: number,
) {
  const lines: string[] = [];
  for (const p of value.replaceAll("\r", "").split("\n")) {
    let line = "";
    for (const word of p.split(/\s+/)) {
      const chars =
        font.widthOfTextAtSize(word, size) > width ? [...word] : [word];
      for (const part of chars) {
        const sep = chars.length > 1 ? "" : line ? " " : "";
        if (line && font.widthOfTextAtSize(line + sep + part, size) > width) {
          lines.push(line);
          line = part;
        } else line += sep + part;
      }
    }
    lines.push(line);
  }
  return lines;
}
function frame(
  page: PDFPage,
  x: number,
  top: number,
  width: number,
  height: number,
  style: string,
) {
  if (style === "none") return;
  const common = {
    borderColor: border,
    borderWidth: 1.2,
    ...(style === "dotted" ? { borderDashArray: [2, 2] } : {}),
  };
  if (style === "curved") {
    const r = 8;
    page.drawSvgPath(
      `M ${r} 0 H ${width - r} Q ${width} 0 ${width} ${r} V ${height - r} Q ${width} ${height} ${width - r} ${height} H ${r} Q 0 ${height} 0 ${height - r} V ${r} Q 0 0 ${r} 0 Z`,
      { x, y: G.height - top, ...common },
    );
  } else
    page.drawRectangle({
      x,
      y: G.height - top - height,
      width,
      height,
      ...common,
    });
}
type TextOp = {
  kind: "text";
  x: number;
  top: number;
  height: number;
  text: string;
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
};
type ImageOp = {
  kind: "image";
  x: number;
  top: number;
  height: number;
  width: number;
  image: PDFImage;
};
type LineOp = {
  kind: "line";
  x: number;
  top: number;
  height: number;
  width: number;
};
type Op = TextOp | ImageOp | LineOp;
export async function renderInstitutionalQuestions(
  pdf: PDFDocument,
  exam: Exam,
  version: Version,
  regular: PDFFont,
  loadImage: ((p: string) => Promise<Uint8Array>) | undefined,
  mode: string,
) {
  const decoration: Record<string, unknown> = {
    ...institutionalDefaults,
    ...((exam.settings.institutional as Record<string, unknown>) ?? {}),
  };
  const style = String(decoration.frame),
    columns = exam.settings.columns === 1 ? 1 : 2,
    margin = 25,
    outerWidth = G.width - 50,
    innerWidth = outerWidth - 16,
    cellWidth = (innerWidth - (columns - 1) * 10) / columns;
  const [cambriaBytes, italicBytes, robotoBytes] = await Promise.all(
    ["CAMBRIAB.TTF", "CAMBRIAI.TTF", "Roboto-Regular.ttf"].map((name) =>
      readFile(path.join(process.cwd(), "public/fonts", name)),
    ),
  );
  const bold = await pdf.embedFont(cambriaBytes, { subset: true }),
    italic = await pdf.embedFont(italicBytes, { subset: true });
  ascentRatios.set(bold, ttfAscent(cambriaBytes));
  ascentRatios.set(italic, ttfAscent(italicBytes));
  ascentRatios.set(regular, ttfAscent(robotoBytes));
  const images = new Map<string, PDFImage>();
  async function image(asset: unknown) {
    if (typeof asset !== "string" || !asset) return null;
    if (images.has(asset)) return images.get(asset)!;
    const builtin = builtInAssets.find((a) => a.id === asset);
    if (!loadImage && !builtin)
      throw Error("No se pudo cargar una imagen institucional");
    const bytes = loadImage
      ? await loadImage(asset)
      : new Uint8Array(
          await readFile(path.join(process.cwd(), "public", builtin!.url)),
        );
    let embedded: PDFImage;
    try {
      embedded = await pdf.embedPng(bytes);
    } catch {
      embedded = await pdf.embedJpg(bytes);
    }
    images.set(asset, embedded);
    return embedded;
  }
  const first = await image(decoration.headerFirst || decoration.logoLeft),
    following = await image(decoration.headerFollowing || decoration.logoRight),
    central = await image(decoration.centralImage),
    watermark = await image(decoration.watermark);
  const text = (
    page: PDFPage,
    value: string,
    x: number,
    top: number,
    size = 10,
    font = regular,
    color = black,
  ) =>
    page.drawText(value, {
      x,
      y: G.height - top - textAscent(font, size),
      font,
      size,
      color,
    });
  function fitText(
    page: PDFPage,
    value: string,
    x: number,
    top: number,
    width: number,
    size = 10,
    font = regular,
  ) {
    let s = size;
    while (s > 7 && font.widthOfTextAtSize(value, s) > width) s -= 0.25;
    if (font.widthOfTextAtSize(value, s) > width)
      throw Error(
        "Un dato del encabezado es demasiado largo. Reduce su texto.",
      );
    text(page, value, x, top, s, font);
  }
  function drawContained(
    page: PDFPage,
    img: PDFImage,
    x: number,
    top: number,
    width: number,
    height: number,
  ) {
    const scale = Math.min(width / img.width, height / img.height);
    page.drawImage(img, {
      x: x + (width - img.width * scale) / 2,
      y: G.height - top - (height + img.height * scale) / 2,
      width: img.width * scale,
      height: img.height * scale,
    });
  }
  function backgrounds(page: PDFPage) {
    if (central) {
      const width = 400,
        height = (central.height / central.width) * width;
      page.drawImage(central, {
        x: (G.width - width) / 2,
        y: G.height - 275 - height,
        width,
        height,
        opacity: 0.13,
      });
    }
    if (watermark) {
      const width = 200,
        height = (watermark.height / watermark.width) * width;
      page.drawImage(watermark, {
        x: G.width - 35 - width,
        y: 42,
        width,
        height,
        opacity: 0.4,
      });
    }
  }
  function metadata(page: PDFPage, top: number) {
    const rows = [
      [
        ["Nivel: ", exam.level],
        ["Área: ", exam.area],
        ["Bimestre: ", exam.bimester],
      ],
      [
        [
          "Grado: ",
          exam.grade + (exam.section ? ` · Sección: ${exam.section}` : ""),
        ],
        ["Sub-área: ", String(exam.settings.subarea ?? "")],
        ["Fecha: ", formatDate(String(exam.settings.date ?? ""))],
      ],
      [
        ["Docente: ", String(exam.settings.teacherName ?? "")],
        ["Unidad: ", exam.unit],
        ["", ""],
      ],
    ];
    const rowHeight = bold.heightAtSize(10);
    const height = 28 + 3 * rowHeight;
    frame(page, margin, top, outerWidth, height, style);
    rows.forEach((row, r) =>
      row.forEach(([label, value], c) => {
        const x = margin + 12 + (c * (outerWidth - 16)) / 3,
          y = top + 8 + r * (rowHeight + 4);
        fitText(page, label, x, y, (outerWidth - 16) / 3 - 8, 10, bold);
        const labelWidth = bold.widthOfTextAtSize(label, 10);
        fitText(
          page,
          value,
          x + labelWidth,
          y,
          (outerWidth - 16) / 3 - labelWidth - 8,
          10,
          italic,
        );
      }),
    );
    return top + height;
  }
  const questionPages: PDFPage[] = [];
  let page: PDFPage,
    bodyTop = 0,
    cursor = 0,
    bodyBottom = 0;
  async function newPage() {
    if (page) finishFrame();
    page = pdf.addPage([G.width, G.height]);
    questionPages.push(page);
    backgrounds(page);
    const n = questionPages.length;
    let y = 25;
    if (n === 1 && first) {
      drawContained(page, first, margin, y, outerWidth, 150);
      y += 150;
    }
    y += 10;
    if (n === 1) y = metadata(page, y);
    y += 10;
    if (n === 1) {
      const student = String(exam.settings.studentName ?? ""),
        label = String(decoration.studentLabel ?? "Apellidos y nombres");
      const studentHeight = 16 + bold.heightAtSize(10);
      frame(page, margin, y, outerWidth, studentHeight, style);
      const lw = bold.widthOfTextAtSize(label + ": ", 10);
      text(page, label + ": ", margin + 8, y + 8, 10, bold);
      if (student)
        fitText(
          page,
          student,
          margin + 8 + lw,
          y + 8,
          outerWidth - lw - 20,
          10,
          italic,
        );
      else
        page.drawLine({
          start: { x: margin + 8 + lw, y: G.height - y - 18 },
          end: { x: G.width - margin - 8, y: G.height - y - 18 },
          thickness: 0.5,
          color: black,
        });
      y += studentHeight;
      const instructions = String(exam.settings.instructions ?? "").trim();
      if (instructions) {
        const wrapped = wrapText(instructions, regular, 10, outerWidth - 16),
          height =
            16 +
            bold.heightAtSize(10) +
            4 +
            wrapped.length * regular.heightAtSize(10);
        y += 10;
        if (y + height > 720)
          throw Error(
            "Las indicaciones son demasiado largas para la primera página.",
          );
        frame(page, margin, y, outerWidth, height, style);
        text(page, "INDICACIONES:", margin + 8, y + 8, 10, bold);
        wrapped.forEach((l, i) =>
          text(
            page,
            l,
            margin + 8,
            y + 8 + bold.heightAtSize(10) + 4 + i * regular.heightAtSize(10),
            10,
          ),
        );
        y += height;
      }
    }
    if (n > 1 && following) {
      drawContained(page, following, margin, y, outerWidth, 150);
      y += 150;
    }
    y += 10;
    if (mode === "qr" || mode === "qr-sheet") {
      const qr = await pdf.embedPng(
        await QRCode.toBuffer(`CE1|${exam.id}|${version.id}|${n}`, {
          margin: 2,
          errorCorrectionLevel: "M",
          width: 250,
        }),
      );
      drawContained(page, qr, G.width - margin - 60, y, 60, 60);
      y += 65;
    }
    bodyTop = y;
    cursor = y + 8;
    bodyBottom = cursor;
  }
  function finishFrame() {
    if (bodyBottom > bodyTop + 8)
      frame(page, margin, bodyTop, outerWidth, bodyBottom - bodyTop + 8, style);
  }
  const answers = mode === "keys";
  async function questionOps(
    q: Question,
    index: number,
    x: number,
  ): Promise<{ ops: Op[]; height: number }> {
    let y = 8;
    const ops: Op[] = [];
    const put = (value: string, size = 10, font = regular, color = black) => {
      for (const line of wrapText(value, font, size, cellWidth - 16)) {
        ops.push({
          kind: "text",
          x: x + 8,
          top: y,
          height: font.heightAtSize(size),
          text: line,
          font,
          size,
          color,
        });
        y += font.heightAtSize(size);
      }
    };
    put(`${index + 1}. ${q.prompt}`, 12);
    y += 4;
    if (q.imagePath) {
      const img = await image(q.imagePath);
      if (img) {
        y += 6;
        const scale = Math.min((cellWidth - 16) / img.width, 80 / img.height),
          w = img.width * scale,
          h = img.height * scale;
        ops.push({
          kind: "image",
          x: x + (cellWidth - w) / 2,
          top: y + (80 - h) / 2,
          width: w,
          height: h,
          image: img,
        });
        y += 86;
      }
    }
    if (q.type === "multipleChoice") {
      q.options.forEach((o, i) => {
        const label = `${String.fromCharCode(97 + i)}) `,
          labelWidth = regular.widthOfTextAtSize(label, 10),
          lineHeight = regular.heightAtSize(10);
        ops.push({
          kind: "text",
          x: x + 8,
          top: y,
          height: lineHeight,
          text: label,
          font: regular,
          size: 10,
        });
        for (const line of wrapText(
          o,
          regular,
          10,
          cellWidth - 16 - labelWidth,
        )) {
          ops.push({
            kind: "text",
            x: x + 8 + labelWidth,
            top: y,
            height: lineHeight,
            text: line,
            font: regular,
            size: 10,
          });
          y += lineHeight;
        }
        y += 2;
      });
      if (answers) {
        y += 4;
        put(
          `Respuesta: ${String.fromCharCode(97 + (q.correctOptionIndex ?? 0))}`,
          9,
          bold,
          border,
        );
      }
    }
    if (q.type === "trueFalse") {
      q.trueFalseStatements.forEach((s, i) => {
        const label = `${i + 1}. `,
          labelWidth = regular.widthOfTextAtSize(label, 10),
          lineHeight = regular.heightAtSize(10);
        const answer = answers
          ? `(${q.trueFalseAnswers[i] ? "V" : "F"})`
          : "(   )";
        y += 2;
        ops.push({
          kind: "text",
          x: x + 8,
          top: y,
          height: lineHeight,
          text: label,
          font: regular,
          size: 10,
        });
        ops.push({
          kind: "text",
          x: x + cellWidth - 8 - regular.widthOfTextAtSize(answer, 10),
          top: y,
          height: lineHeight,
          text: answer,
          font: regular,
          size: 10,
          color: answers ? border : black,
        });
        for (const line of wrapText(
          s,
          regular,
          10,
          cellWidth - 16 - labelWidth - 60,
        )) {
          ops.push({
            kind: "text",
            x: x + 8 + labelWidth,
            top: y,
            height: lineHeight,
            text: line,
            font: regular,
            size: 10,
          });
          y += lineHeight;
        }
        y += 2;
      });
    }
    if (q.type === "matching") {
      const col = (cellWidth - 26) / 2,
        start = y;
      const rightOps: Op[] = [];
      for (const [i, s] of ["Columna B:", ...q.rightColumn].entries()) {
        for (const l of wrapText(
          i === 0 ? s : `${String.fromCharCode(96 + i)}) ${s}`,
          regular,
          i === 0 ? 10 : 9,
          col,
        )) {
          rightOps.push({
            kind: "text",
            x: x + 18 + col,
            top: y,
            height: regular.heightAtSize(i === 0 ? 10 : 9),
            text: l,
            font: regular,
            size: i === 0 ? 10 : 9,
          });
          y += regular.heightAtSize(i === 0 ? 10 : 9);
        }
        if (i > 0) y += 2;
      }
      y = start;
      for (const [i, s] of ["Columna A:", ...q.leftColumn].entries()) {
        for (const l of wrapText(
          i === 0 ? s : `${i}. ${s}`,
          regular,
          i === 0 ? 10 : 9,
          col,
        )) {
          ops.push({
            kind: "text",
            x: x + 8,
            top: y,
            height: regular.heightAtSize(i === 0 ? 10 : 9),
            text: l,
            font: regular,
            size: i === 0 ? 10 : 9,
          });
          y += regular.heightAtSize(i === 0 ? 10 : 9);
        }
        if (i > 0) y += 2;
      }
      const leftHeight = y;
      ops.push(...rightOps);
      y = Math.max(leftHeight, ...rightOps.map((o) => o.top + o.height), start);
      if (answers) {
        y += 4;
        put(
          "Relaciones: " +
            q.matchingAnswers
              .map((v, i) => `${i + 1}-${String.fromCharCode(97 + v)}`)
              .join(", "),
          9,
          bold,
          border,
        );
      }
    }
    if (q.type === "openResponse") {
      y += 40;
      put(
        answers ? `Respuesta: ${q.referenceAnswer}` : "Respuesta:",
        9,
        bold,
        answers ? border : black,
      );
      if (!answers)
        ops.push({
          kind: "line",
          x: x + 65,
          top: y - 3,
          height: 1,
          width: cellWidth - 80,
        });
    }
    return { ops, height: y + 8 };
  }
  const groups: {
    subtitle: string;
    questions: { q: Question; index: number }[];
  }[] = [];
  let subtitle = "";
  for (const [i, q] of version.questions.entries()) {
    const next = q.subtitle.trim();
    if (next && next !== subtitle) {
      subtitle = next;
      groups.push({ subtitle, questions: [] });
    }
    if (!groups.length) groups.push({ subtitle: "", questions: [] });
    groups[groups.length - 1].questions.push({ q, index: i });
  }
  await newPage();
  async function writeRow(ops: Op[], height: number) {
    let offset = 0;
    while (offset < height) {
      const contentBottom =
        G.height - 5 - 8 - 12 - regular.heightAtSize(8) - 10 - 8;
      let available = contentBottom - cursor;
      if (
        height - offset > available &&
        cursor > bodyTop + 8 &&
        height - offset <= contentBottom - bodyTop - 8
      ) {
        await newPage();
        available = contentBottom - cursor;
      }
      let take = Math.min(height - offset, available);
      let previous = -1;
      while (previous !== take) {
        previous = take;
        for (const op of ops)
          if (
            op.top >= offset &&
            op.top < offset + take &&
            op.top + op.height > offset + take
          )
            take = Math.min(take, op.top - offset);
      }
      if (take < 12) {
        await newPage();
        continue;
      }
      for (const op of ops) {
        if (op.top < offset || op.top + op.height > offset + take + 0.01)
          continue;
        const top = cursor + op.top - offset;
        if (op.kind === "text")
          text(
            page,
            op.text,
            margin + 8 + op.x,
            top,
            op.size,
            op.font,
            op.color,
          );
        else if (op.kind === "image")
          page.drawImage(op.image, {
            x: margin + 8 + op.x,
            y: G.height - top - op.height,
            width: op.width,
            height: op.height,
          });
        else
          page.drawLine({
            start: { x: margin + 8 + op.x, y: G.height - top },
            end: { x: margin + 8 + op.x + op.width, y: G.height - top },
            thickness: 0.5,
            color: black,
          });
      }
      cursor += take;
      bodyBottom = cursor;
      offset += take;
      if (offset < height) await newPage();
    }
  }
  const contentBottom =
    G.height - 5 - 8 - 12 - regular.heightAtSize(8) - 10 - 8;
  for (const group of groups) {
    const ls = group.subtitle
      ? wrapText(group.subtitle, bold, 11, innerWidth - 16)
      : [];
    const titleHeight = ls.length ? 27 + ls.length * bold.heightAtSize(11) : 0;
    // Measure once, then paginate consecutive prefixes before splitting columns.
    // Splitting the entire block first can put question 4 on a page before 3.
    const measured: { ops: Op[]; height: number }[] = [];
    for (const { q, index } of group.questions) {
      measured.push(await questionOps(q, index, 0));
    }
    let start = 0;
    let titlePending = titleHeight > 0;
    while (start < measured.length) {
      const heading = titlePending ? titleHeight : 0;
      const remaining = measured.slice(start);
      const plan = planQuestionPage(
        remaining.map((item) => item.height),
        columns,
        contentBottom - cursor - heading,
      );
      if (!plan.count && cursor > bodyTop + 8) {
        await newPage();
        continue;
      }
      if (titlePending) {
        await writeRow(
          ls.map((l, i) => ({
            kind: "text",
            x: 8,
            top: 16 + i * bold.heightAtSize(11),
            height: bold.heightAtSize(11),
            text: l,
            font: bold,
            size: 11,
          })),
          titleHeight,
        );
        titlePending = false;
      }
      if (!plan.count) {
        // A question taller than a whole page continues alone. Never place a
        // later question beside its first fragment, ahead of its continuation.
        await writeRow(remaining[0].ops, remaining[0].height + 10);
        start++;
        continue;
      }
      const half = columns === 2 ? Math.ceil(plan.count / 2) : plan.count;
      for (let i = 0; i < half; i++) {
        const left = remaining[i];
        const right =
          columns === 2 && i + half < plan.count
            ? remaining[i + half]
            : undefined;
        const rightOps = right
          ? right.ops.map((op) => ({ ...op, x: op.x + cellWidth + 10 }))
          : [];
        await writeRow(
          [...left.ops, ...rightOps],
          Math.max(left.height, right?.height ?? 0) + 10,
        );
      }
      start += plan.count;
      if (start < measured.length) await newPage();
    }
  }
  finishFrame();
  return questionPages;
}
function formatDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split("-").reverse().join("-")
    : value;
}
export function drawInstitutionalFooters(
  pdf: PDFDocument,
  exam: Exam,
  font: PDFFont,
  institutionalPageCount = pdf.getPageCount(),
) {
  const d = {
    ...institutionalDefaults,
    ...((exam.settings.institutional as Record<string, unknown>) ?? {}),
  };
  if (d.showFooter === false) return;
  const pages = pdf.getPages();
  for (const [i, p] of pages.entries()) {
    // OMR bottom markers extend to y=810; their footer must remain below them.
    const footerTop =
      i < institutionalPageCount
        ? G.height - 5 - 8 - 12 - font.heightAtSize(8)
        : 818;
    p.drawLine({
      start: { x: 25, y: G.height - footerTop },
      end: { x: G.width - 25, y: G.height - footerTop },
      color: border,
      thickness: 1,
    });
    const label = String(d.footerPageLabel ?? "Página {pagina} de {total}")
      .replaceAll("{pagina}", String(i + 1))
      .replaceAll("{total}", String(pages.length));
    let size = 8;
    const values = [
      `Correo: ${String(d.email ?? "")}`,
      `Teléfono: ${String(d.phone ?? "")}`,
      `Facebook: ${String(d.facebook ?? "")}`,
    ];
    while (
      size > 5 &&
      values.reduce((n, v) => n + font.widthOfTextAtSize(v, size), 0) +
        40 +
        font.widthOfTextAtSize(label, size) >
        G.width - 74
    )
      size -= 0.25;
    let x = 37;
    for (const value of values) {
      p.drawText(value, {
        x,
        y: G.height - footerTop - 6 - textAscent(font, size),
        font,
        size,
        color: gray,
      });
      x += font.widthOfTextAtSize(value, size) + 20;
    }
    p.drawText(label, {
      x: G.width - 37 - font.widthOfTextAtSize(label, size),
      y: G.height - footerTop - 6 - textAscent(font, size),
      font,
      size,
      color: gray,
    });
  }
}

/** Largest consecutive prefix that fits in Flutter-style paired column rows. */
export function planQuestionPage(
  heights: readonly number[],
  columns: number,
  available: number,
) {
  let count = 0;
  for (let size = 1; size <= heights.length; size++) {
    const half = columns === 2 ? Math.ceil(size / 2) : size;
    let height = 0;
    for (let i = 0; i < half; i++) {
      const right = columns === 2 && i + half < size ? heights[i + half] : 0;
      height += Math.max(heights[i], right) + 10;
    }
    if (height <= available) count = size;
  }
  return { count };
}
