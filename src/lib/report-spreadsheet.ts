import type { Cell, Row } from "write-excel-file/node";

export async function reportSpreadsheet(
  headers: string[],
  values: unknown[][],
) {
  const { default: writeXlsxFile } = await import("write-excel-file/node");
  const data: Row[] = [
    headers.map((value) => ({ value, type: String, fontWeight: "bold" })),
    ...values.map((row) =>
      row.map((value): Cell =>
        typeof value === "number" && Number.isFinite(value)
          ? { value, type: Number }
          : { value: String(value ?? ""), type: String },
      ),
    ),
  ];
  return writeXlsxFile(data, {
    sheet: "Resultados",
    columns: headers.map(() => ({ width: 24 })),
  }).toBuffer();
}
