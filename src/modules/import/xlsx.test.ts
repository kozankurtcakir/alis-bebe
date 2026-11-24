import { strToU8, zipSync } from "fflate";
import { expect, test } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { readXlsx, XlsxError } from "./xlsx";

const CONTENT_TYPES = `<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;

/** Sahte çalışma kitabı; `parts` varsayılan dosyaların yerine geçer. */
function book(sheet: string, parts: Record<string, string> = {}) {
  const files = {
    "[Content_Types].xml": CONTENT_TYPES,
    "xl/workbook.xml": `<workbook xmlns:r="x"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheet,
    ...parts,
  };
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, xml]) => [name, strToU8(xml)]),
    ),
  );
}

const sheet = (rows: string) =>
  `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
const inline = (ref: string, text: string) =>
  `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const values = (bytes: Uint8Array) =>
  readXlsx(bytes).map((r) => [
    r.no,
    ...[...r.cells].map(([i, c]) =>
      c.kind === "invalid" ? `${i}!` : `${i}${c.kind[0]}:${c.value}`,
    ),
  ]);

test("kitaplığın ürettiği dosya okunur; baştaki sıfır korunur", async () => {
  const bytes = await writeXlsxFile([
    [{ value: "SKU" }, { value: "Fiyat" }],
    [{ value: "00123", type: String, format: "@" }, { value: 249.9 }],
    [{ type: String, format: "@" }, null],
    [{ value: "Çığ & <b> 'ö'" }, null],
  ]).toBuffer();
  expect(values(bytes)).toEqual([
    [1, "0t:SKU", "1t:Fiyat"],
    [2, "0t:00123", "1n:249.9"],
    [4, "0t:Çığ & <b> 'ö'"],
  ]);
});

test("hücre türleri ve adresleri", () => {
  expect(
    values(
      book(
        sheet(
          `<row r="3">${inline("B3", " a &lt;&#x15F;&#305; ")}<c r="AA3"><v>8.69E+12</v></c></row>` +
            `<row r="5"><c r="A5" t="s"><v>1</v></c><c r="B5" t="b"><v>1</v></c><c r="C5" t="e"><v>#N/A</v></c>` +
            `<c r="D5" t="str"><f>1+1</f><v>2</v></c><c r="E5"><f>A1</f></c></row>`,
        ),
        {
          "xl/sharedStrings.xml": `<sst><si><t>x</t></si><si><r><t>zen</t></r><r><t>gin</t></r><rPh><t>no</t></rPh></si></sst>`,
        },
      ),
    ),
  ).toEqual([
    [3, "1t:a <şı", "26n:8.69E+12"],
    [5, "0t:zengin", "1t:Evet", "2!", "3!", "4!"],
  ]);
});

test("satır sonu ve denetim karakterleri", () => {
  expect(
    values(book(sheet(`<row r="1">${inline("A1", "a_x000D_\nb&#1;c")}</row>`))),
  ).toEqual([[1, "0t:a\nbc"]]);
});

test("yalnızca ilk sayfa okunur; ön ekli adlar tanınır", () => {
  const bytes = book("", {
    "xl/workbook.xml": `<x:workbook xmlns:r="x"><x:sheets><x:sheet r:id="b"/><x:sheet r:id="a"/></x:sheets></x:workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="a" Target="worksheets/sheet1.xml"/><Relationship Id="b" Target="/xl/iki.xml"/></Relationships>`,
    "xl/iki.xml": `<x:worksheet><x:sheetData><x:row><x:c t="str"><x:v>iki</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
  });
  expect(values(bytes)).toEqual([[1, "0t:iki"]]);
});

const row = (cells: string) => book(sheet(`<row r="1">${cells}</row>`));
const ok = inline("A1", "x");

const rejected: [string, () => Uint8Array, RegExp][] = [
  ["boş", () => new Uint8Array(), /boş/],
  ["2 MB üstü", () => new Uint8Array(2 * 1024 * 1024 + 1), /2 MB/],
  ["düz metin", () => strToU8("SKU;Fiyat\n".repeat(10)), /Yalnızca .xlsx/],
  ["görsel", () => new Uint8Array(100).fill(0x89), /Yalnızca .xlsx/],
  ["eski .xls", () => new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), /Eski/],
  ["başka zip", () => zipSync({ "a.txt": strToU8("x") }), /bozuk/],
  ["yarım dosya", () => row(ok).slice(0, -30), /bozuk/],
  [
    "makro içeriği",
    () => book(sheet(""), { "xl/vbaProject.bin": "x" }),
    /Makro/,
  ],
  [
    "makro türü",
    () =>
      book(sheet(""), {
        "[Content_Types].xml": CONTENT_TYPES.replace(
          "sheet.main",
          "sheet.macroEnabled.main",
        ),
      }),
    /Makro/,
  ],
  [
    "dış bağlantılı sayfa",
    () =>
      book(sheet(""), {
        "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" TargetMode="External" Target="worksheets/sheet1.xml"/></Relationships>`,
      }),
    /bozuk/,
  ],
  [
    "arşiv dışını gösteren sayfa",
    () =>
      book(sheet(""), {
        "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="../../etc/passwd"/></Relationships>`,
      }),
    /bozuk/,
  ],
  [
    "DOCTYPE (varlık bombası)",
    () =>
      book(`<!DOCTYPE a [<!ENTITY b "b">]>${sheet(`<row r="1">${ok}</row>`)}`),
    /bozuk/,
  ],
  ["bilinmeyen varlık", () => row(inline("A1", "&b;")), /bozuk/],
  ["toString varlığı", () => row(inline("A1", "&toString;")), /bozuk/],
  ["yarım Unicode", () => row(inline("A1", "&#xD800;")), /bozuk/],
  ["CDATA", () => row(`<c r="A1" t="str"><v><![CDATA[x]]></v></c>`), /bozuk/],
  ["kapanmayan etiket", () => book(`<worksheet><sheetData>`), /bozuk/],
  ["yanlış kapanış", () => book(`<worksheet></sheet>`), /bozuk/],
  [
    "geçersiz UTF-8",
    () =>
      zipSync({
        "[Content_Types].xml": new Uint8Array([0xff, 0xfe]),
      }),
    /bozuk/,
  ],
  ["olmayan ortak metin", () => row(`<c r="A1" t="s"><v>5</v></c>`), /bozuk/],
  ["tekrarlanan hücre", () => row(ok + ok), /bozuk/],
  ["çok sütun", () => row(inline("BI1", "x")), /sütun/],
  [
    "çok satır",
    () =>
      book(
        sheet(
          Array.from(
            { length: 1002 },
            (_, i) => `<row r="${i + 1}">${inline(`A${i + 1}`, "x")}</row>`,
          ).join(""),
        ),
      ),
    /1000 satır/,
  ],
  [
    "çok dosya",
    () =>
      zipSync(
        Object.fromEntries(
          Array.from({ length: 201 }, (_, i) => [`${i}`, strToU8("x")]),
        ),
      ),
    /çok büyük/,
  ],
];

test.each(rejected)("%s reddedilir", (_, make, message) => {
  const bytes = make();
  expect(() => readXlsx(bytes)).toThrow(XlsxError);
  expect(() => readXlsx(bytes)).toThrow(message);
});

test("1.000 satır ve başlık kabul edilir", () => {
  const rows = Array.from(
    { length: 1001 },
    (_, i) => `<row r="${i + 1}">${inline(`A${i + 1}`, "x")}</row>`,
  );
  expect(readXlsx(book(sheet(rows.join(""))))).toHaveLength(1001);
});

/** Arşivdeki boyut bilgisini değiştirir. */
function lieAboutSize(bytes: Uint8Array, size: number) {
  const file = Buffer.from(bytes);
  for (let i = 0; i < file.length - 30; i++) {
    const mark = file.readUInt32LE(i);
    if (mark === 0x04034b50) file.writeUInt32LE(size, i + 22);
    if (mark === 0x02014b50) file.writeUInt32LE(size, i + 24);
  }
  return file;
}

test("zip bombası boyutu doğru da yalan da söylese açılmaz", () => {
  // Açılınca 200 MB olur; gönderilen dosya 2 MB'ın altındadır.
  const bomb = book(sheet(" ".repeat(200 * 1024 * 1024)));
  expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
  for (const bytes of [bomb, lieAboutSize(bomb, 1000)]) {
    const start = performance.now();
    expect(() => readXlsx(bytes)).toThrow(/çok büyük/);
    expect(performance.now() - start).toBeLessThan(1000);
  }
});

test("kötü niyetli uzun etiketler okuyucuyu yavaşlatmaz", () => {
  for (const xml of [
    `<worksheet ${"a".repeat(5_000_000)}>`,
    `<worksheet ${" ".repeat(5_000_000)}`,
    `<${"a".repeat(5_000_000)}`,
    `<worksheet>${"&".repeat(5_000_000)}</worksheet>`,
    `<worksheet a="${"x".repeat(5_000_000)}`,
  ]) {
    const bytes = book(xml);
    const start = performance.now();
    expect(() => readXlsx(bytes)).toThrow(XlsxError);
    expect(performance.now() - start).toBeLessThan(1000);
  }
});
