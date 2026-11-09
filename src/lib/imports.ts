import Papa from "papaparse";
export interface StudentRow {
  id: string;
  code: string;
  first_names: string;
  last_names: string;
  level: string;
  grade: string;
  section: string;
  active: boolean;
}
export async function studentPreview(rows: unknown[][]) {
  const normalize = (v: unknown) =>
      String(v ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, ""),
    headers = (rows[0] ?? []).map(normalize),
    required = ["nombres", "apellidos", "nivel", "grado", "seccion"],
    errors: string[] = [],
    students: StudentRow[] = [],
    seen = new Set<string>();
  if (required.some((h) => !headers.includes(h)))
    return {
      students,
      errors: [
        `Faltan columnas: ${required.filter((h) => !headers.includes(h)).join(", ")}`,
      ],
    };
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((v) => !String(v ?? "").trim())) continue;
    const val = (h: string) => String(r[headers.indexOf(h)] ?? "").trim(),
      names = val("nombres"),
      last = val("apellidos");
    if (!names || !last) {
      errors.push(`Fila ${i + 1}: nombres y apellidos obligatorios`);
      continue;
    }
    const raw =
        `${names}|${last}|${val("nivel")}|${val("grado")}|${val("seccion")}`.toLowerCase(),
      hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
      code = val("codigo") || hash;
    if (seen.has(code)) {
      errors.push(`Fila ${i + 1}: alumno duplicado`);
      continue;
    }
    seen.add(code);
    students.push({
      id: crypto.randomUUID(),
      code,
      first_names: names,
      last_names: last,
      level: val("nivel"),
      grade: val("grado"),
      section: val("seccion"),
      active: !["inactivo", "0", "false", "no"].includes(
        val("estado").toLowerCase(),
      ),
    });
  }
  return { students, errors };
}
export async function parseStudentFile(file: File) {
  if (file.size > 8 * 1024 * 1024) throw Error("Máximo 8 MB");
  if (file.name.toLowerCase().endsWith(".csv")) {
    const result = Papa.parse<unknown[]>(
      (await file.text()).replace(/^\uFEFF/, ""),
      { skipEmptyLines: true },
    );
    if (result.errors.length) throw Error(result.errors[0].message);
    return studentPreview(result.data);
  }
  if (!file.name.toLowerCase().endsWith(".xlsx"))
    throw Error("Usa CSV UTF-8 o XLSX");
  const { Workbook } = await import("exceljs"),
    book = new Workbook();
  await book.xlsx.load(await file.arrayBuffer());
  const sheet = book.worksheets[0];
  if (!sheet) throw Error("Libro sin hojas");
  const rows: unknown[][] = [];
  sheet.eachRow((r) =>
    rows.push(
      (r.values as unknown[])
        .slice(1)
        .map((v) =>
          typeof v === "object" && v && "text" in v ? String(v.text) : v,
        ),
    ),
  );
  return studentPreview(rows);
}
