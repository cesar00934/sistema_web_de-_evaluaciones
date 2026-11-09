import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sheetLayout, geometry as G, type Exam, type Version } from "./domain";
import {
  renderInstitutionalQuestions,
  drawInstitutionalFooters,
} from "./institutional-pdf";
export type PdfMode =
  "original" | "qr" | "sheet" | "qr-sheet" | "answers" | "keys";
const green = rgb(0.03, 0.49, 0.44),
  black = rgb(0, 0, 0);
function lines(text: string, font: PDFFont, size: number, width: number) {
  const result: string[] = [];
  for (const paragraph of text.replaceAll("\r", "").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (font.widthOfTextAtSize(word, size) > width) {
        if (line) {
          result.push(line);
          line = "";
        }
        let part = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(part + ch, size) > width) {
            result.push(part);
            part = "";
          }
          part += ch;
        }
        line = part;
        continue;
      }
      if (line && font.widthOfTextAtSize(line + " " + word, size) > width) {
        result.push(line);
        line = word;
      } else line += (line ? " " : "") + word;
    }
    result.push(line);
  }
  return result;
}
export async function generatePdf(
  exam: Exam,
  version: Version,
  institution = "COLEGIO CRAMER",
  mode: PdfMode = "qr-sheet",
  loadImage?: (path: string) => Promise<Uint8Array>,
  logos?: { left?: string; right?: string },
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(
      await readFile(
        path.join(process.cwd(), "public/fonts/Roboto-Regular.ttf"),
      ),
      { subset: true },
    ),
    bold = await pdf.embedFont(
      await readFile(path.join(process.cwd(), "public/fonts/Roboto-Bold.ttf")),
      { subset: true },
    );
  function text(
    page: PDFPage,
    value: string,
    x: number,
    top: number,
    size = 10,
    font = regular,
  ) {
    page.drawText(value, {
      x,
      y: G.height - top - size,
      font,
      size,
      color: black,
    });
  }
  async function qr(
    page: PDFPage,
    pageNumber: number,
    x = 447,
    top = 75,
    size = 84,
  ) {
    const png = await QRCode.toBuffer(
      `CE1|${exam.id}|${version.id}|${pageNumber}`,
      { errorCorrectionLevel: "M", margin: 2, width: 300 },
    );
    const img = await pdf.embedPng(png);
    page.drawImage(img, {
      x,
      y: G.height - top - size,
      width: size,
      height: size,
    });
  }
  if (logos?.left || logos?.right)
    exam = {
      ...exam,
      settings: {
        ...exam.settings,
        institutional: {
          ...((exam.settings.institutional as Record<string, unknown>) ?? {}),
          ...(logos.left ? { logoLeft: logos.left } : {}),
          ...(logos.right ? { logoRight: logos.right } : {}),
        },
      },
    };
  let institutionalPageCount = 0;
  if (mode !== "answers")
    institutionalPageCount = (
      await renderInstitutionalQuestions(
        pdf,
        exam,
        version,
        regular,
        loadImage,
        mode,
      )
    ).length;
  if (["answers", "sheet", "qr-sheet"].includes(mode))
    for (const layout of sheetLayout(version.questions)) {
      const page = pdf.addPage([G.width, G.height]);
      for (const [x, y] of [
        [32, 32],
        [G.width - 45, 32],
        [G.width - 45, G.height - 45],
        [32, G.height - 45],
      ])
        page.drawRectangle({
          x,
          y: G.height - y - 13,
          width: 13,
          height: 13,
          color: black,
        });
      text(page, `${institution} · HOJA DE RESPUESTAS`, 60, 54, 14, bold);
      const examLines = lines(`Evaluación: ${exam.title}`, regular, 10, 350);
      if (examLines.length > 2)
        throw Error(
          "Título demasiado largo para la hoja OMR (máximo dos líneas).",
        );
      examLines.forEach((l, i) => text(page, l, 65, 88 + i * 12, 10));
      text(page, `Grado: ${exam.grade} · Sección: ${exam.section}`, 65, 116);
      text(page, `Bimestre: ${exam.bimester}`, 65, 131);
      text(page, `Versión: ${version.label}`, 65, 146);
      text(page, "Alumno: _____________________________________", 65, 170);
      await qr(page, layout.pageNumber, 447, 83, 84);
      layout.items.forEach((item, row) => {
        const top = G.firstY + row * G.row;
        text(page, `${item.label}.`, 70, top - 7, 10, bold);
        for (let o = 0; o < item.optionCount; o++) {
          const x = G.firstX + o * G.option;
          text(
            page,
            item.type === "trueFalse"
              ? o === 0
                ? "V"
                : "F"
              : String.fromCharCode(65 + o),
            x - 20,
            top - 7,
            10,
          );
          page.drawCircle({
            x,
            y: G.height - top,
            size: 6.5,
            borderColor: black,
            borderWidth: 0.8,
          });
        }
      });
      layout.written.forEach((item) => {
        const top = item.top!;
        const ls = lines(`${item.label}. ${item.prompt}`, bold, 10, 465);
        if (ls.length > 2)
          throw Error(
            `Enunciado ${item.label}: excede dos líneas en hoja escrita. Reduce el enunciado o su subtítulo.`,
          );
        ls.forEach((l, i) => text(page, l, 65, top + i * 12, 10, bold));
        text(page, "Escribe tu respuesta:", 65, top + 28, 9);
        for (let line = 0; line < 4; line++)
          page.drawLine({
            start: { x: 65, y: G.height - top - 45 - line * 19 },
            end: { x: 530, y: G.height - top - 45 - line * 19 },
            thickness: 0.5,
            color: rgb(0.6, 0.6, 0.6),
          });
      });
    }
  drawInstitutionalFooters(pdf, exam, regular, institutionalPageCount);
  pdf.setTitle(`${institution} - ${exam.title}`);
  pdf.setAuthor(institution);
  return pdf.save();
}
export async function reportPdf(
  rows: Record<string, unknown>[],
  institution: string,
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(path.join(process.cwd(), "public/fonts/Roboto-Regular.ttf")),
    { subset: true },
  );
  let page = pdf.addPage([842, 595]),
    y = 540;
  const header = () => {
    page.drawText(`${institution} · Resultados académicos`, {
      x: 35,
      y: 555,
      font,
      size: 16,
      color: green,
    });
    page.drawText("Alumno / Evaluación / Nota / Pendientes", {
      x: 35,
      y: 530,
      font,
      size: 10,
    });
    y = 505;
  };
  header();
  for (const r of rows) {
    const value = `${r.student} | ${r.exam} | ${Number(r.grade).toFixed(2)} | ${r.pending}`;
    for (const l of lines(value, font, 10, 770)) {
      if (y < 40) {
        page = pdf.addPage([842, 595]);
        header();
      }
      page.drawText(l, { x: 35, y, font, size: 10 });
      y -= 16;
    }
    y -= 6;
  }
  return pdf.save();
}
