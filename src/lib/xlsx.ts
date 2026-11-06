// A small Excel (.xlsx) writer for the reports: one sheet per table, a
// bold title and header row, amounts as real numbers with two decimals,
// dates as real dates, a bold total row. Zipped with fflate; nothing else
// is needed, and nothing leaves the device.

import { strToU8, zipSync } from "fflate";

export type XKind = "text" | "money" | "int" | "date";
/** Money in cents, dates as "YYYY-MM-DD". */
export type XCell = string | number | null;

export interface XSheet {
  name: string;
  title: string;
  subtitle?: string;
  columns: { label: string; kind: XKind; width?: number }[];
  rows: XCell[][];
  total?: XCell[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** Column letters: 0 → A, 26 → AA. */
export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel's day number for an ISO date (days since 1899-12-30). */
export function excelDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 864e5);
}

/** A sheet name Excel accepts: at most 31 characters, none of []:*?/\ . */
export function sheetName(name: string, taken: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let out = base;
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${base.slice(0, 28)} ${i}`;
  taken.add(out.toLowerCase());
  return out;
}

// Styles: 0 plain, 1 bold, 2 money, 3 bold money, 4 date, 5 whole number, 6 bold whole number, 7 big bold title.
const STYLE: Record<XKind, [number, number]> = { text: [0, 1], money: [2, 3], int: [5, 6], date: [4, 1] };

function cell(ref: string, v: XCell, kind: XKind, bold: boolean): string {
  if (v === null || v === "") return "";
  const s = STYLE[kind][bold ? 1 : 0];
  if (kind === "money" && typeof v === "number") return `<c r="${ref}" s="${s}"><v>${v / 100}</v></c>`;
  if (kind === "int" && typeof v === "number") return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  if (kind === "date" && typeof v === "string") {
    const d = excelDay(v);
    if (d !== null) return `<c r="${ref}" s="${s}"><v>${d}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr" s="${bold ? 1 : 0}"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sh: XSheet): string {
  const rows: string[] = [];
  let r = 1;
  const text = (v: string, style: number) => `<row r="${r}"><c r="A${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(v)}</t></is></c></row>`;
  rows.push(text(sh.title, 7));
  r++;
  if (sh.subtitle) {
    rows.push(text(sh.subtitle, 0));
    r++;
  }
  r++;
  const head = r;
  rows.push(`<row r="${r}">${sh.columns.map((c, i) => cell(`${colName(i)}${r}`, c.label, "text", true)).join("")}</row>`);
  r++;
  for (const row of sh.rows) {
    rows.push(`<row r="${r}">${sh.columns.map((c, i) => cell(`${colName(i)}${r}`, row[i] ?? null, c.kind, false)).join("")}</row>`);
    r++;
  }
  if (sh.total) rows.push(`<row r="${r}">${sh.columns.map((c, i) => cell(`${colName(i)}${r}`, sh.total![i] ?? null, c.kind, true)).join("")}</row>`);
  const cols = sh.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? (c.kind === "text" ? 24 : c.kind === "date" ? 12 : 15)}" customWidth="1"/>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${head}" topLeftCell="A${head + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${rows.join("")}</sheetData></worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts>` +
  `<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="8">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="1" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** The workbook's bytes. */
export function xlsx(sheets: XSheet[]): Uint8Array {
  const taken = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, taken));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        `</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        `</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(STYLES),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
  return zipSync(files, { level: 6 });
}
