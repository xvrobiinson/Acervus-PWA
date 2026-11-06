import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { colName, excelDay, sheetName, xlsx } from "./xlsx";

describe("xlsx", () => {
  it("names columns, dates and sheets the way Excel does", () => {
    expect([colName(0), colName(25), colName(26), colName(701)]).toEqual(["A", "Z", "AA", "ZZ"]);
    expect(excelDay("1900-03-01")).toBe(61);
    expect(excelDay("2026-11-05")).toBe(46331);
    const taken = new Set<string>();
    expect(sheetName("Payments: Oct/Nov", taken)).toBe("Payments  Oct Nov");
    expect(sheetName("Payments: Oct/Nov", taken)).toBe("Payments  Oct Nov 2");
    expect(sheetName("x".repeat(40), new Set()).length).toBe(31);
  });

  it("writes a workbook with numbers, dates, escaped text and a total", () => {
    const bytes = xlsx([
      {
        name: "Collections",
        title: "Collections <report>",
        columns: [
          { label: "Date", kind: "date" },
          { label: "Client", kind: "text" },
          { label: "Amount", kind: "money" },
        ],
        rows: [["2026-11-05", "Ana & Co", 125050]],
        total: ["Total", null, 125050],
      },
    ]);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain("xl/worksheets/sheet1.xml");
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("<v>1250.5</v>");
    expect(sheet).toContain("<v>46331</v>");
    expect(sheet).toContain("Ana &amp; Co");
    expect(sheet).toContain("Collections &lt;report&gt;");
    expect(strFromU8(files["xl/workbook.xml"])).toContain('name="Collections"');
  });
});
