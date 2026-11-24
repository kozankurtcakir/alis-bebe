import { inflateRawSync } from "node:zlib";

/**
 * Sınırlı .xlsx okuyucu. Bir .xlsx, XML dosyaları içeren bir zip arşividir.
 * Yalnızca ilk sayfanın değerleri okunur; formül çalıştırılmaz, dış bağlantı açılmaz.
 */

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 1000;
const MAX_ENTRIES = 200;
const MAX_PART_BYTES = 10 * 1024 * 1024;
const MAX_COLUMNS = 60;
const MAX_CELL_LENGTH = 12_000;

export class XlsxError extends Error {}

export type Cell =
  | { kind: "text"; value: string }
  | { kind: "number"; value: string }
  // Formül, Excel hatası (#N/A) ve benzeri: değeri kullanılamaz.
  | { kind: "invalid"; reason: string };

export type SheetRow = { no: number; cells: Map<number, Cell> };

const BROKEN = "Dosya bozuk veya geçerli bir .xlsx değil.";
const TOO_BIG = "Dosyanın içeriği çok büyük.";

// ---------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------

type Entry = { method: number; size: number; offset: number };

function readDirectory(file: Buffer) {
  // Dizin kaydı dosyanın sonundadır; ardından en fazla 65.535 baytlık not gelebilir.
  let end = file.length - 22;
  const limit = Math.max(0, end - 65_535);
  while (end >= limit && file.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < limit) throw new XlsxError(BROKEN);

  const count = file.readUInt16LE(end + 10);
  if (count > MAX_ENTRIES) throw new XlsxError(TOO_BIG);
  const entries = new Map<string, Entry>();
  let at = file.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (file.readUInt32LE(at) !== 0x02014b50) throw new XlsxError(BROKEN);
    const flags = file.readUInt16LE(at + 8);
    if (flags & 1) throw new XlsxError("Şifreli dosya yüklenemez.");
    const nameEnd = at + 46 + file.readUInt16LE(at + 28);
    const name = file.toString("utf8", at + 46, nameEnd);
    if (entries.has(name)) throw new XlsxError(BROKEN);
    entries.set(name, {
      method: file.readUInt16LE(at + 10),
      size: file.readUInt32LE(at + 20),
      offset: file.readUInt32LE(at + 42),
    });
    at = nameEnd + file.readUInt16LE(at + 30) + file.readUInt16LE(at + 32);
  }
  return entries;
}

/** Bildirilen boyuta güvenilmez: açma işlemi sınıra ulaşınca durur. */
function extract(file: Buffer, entry: Entry) {
  const { method, size, offset } = entry;
  if (file.readUInt32LE(offset) !== 0x04034b50) throw new XlsxError(BROKEN);
  const start =
    offset +
    30 +
    file.readUInt16LE(offset + 26) +
    file.readUInt16LE(offset + 28);
  if (start + size > file.length) throw new XlsxError(BROKEN);
  const data = file.subarray(start, start + size);
  let content: Buffer;
  if (method === 0) content = data;
  else if (method === 8) {
    try {
      content = inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new XlsxError(code === "ERR_BUFFER_TOO_LARGE" ? TOO_BIG : BROKEN);
    }
  } else throw new XlsxError(BROKEN);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new XlsxError(BROKEN);
  }
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const entities: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

function decode(text: string) {
  // İlk bozuk "&" işaretinde durur; replace bütün eşleşmeleri önce toplardı.
  if (/&(?![^;&]{0,10};)/.test(text)) throw new XlsxError(BROKEN);
  return text.replace(/&([^;&]{0,10});/g, (_, body: string) => {
    if (Object.hasOwn(entities, body)) return entities[body];
    const code = /^#(?:x([0-9a-fA-F]{1,6})|(\d{1,7}))$/.exec(body);
    const point = code
      ? code[1]
        ? parseInt(code[1], 16)
        : Number(code[2])
      : -1;
    if (point < 1 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
      throw new XlsxError(BROKEN);
    }
    return String.fromCodePoint(point);
  });
}

type Handler = {
  open?: (name: string, attributes: Record<string, string>) => void;
  text?: (text: string) => void;
  close?: (name: string) => void;
};

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

/** DOCTYPE, varlık tanımı ve CDATA desteklenmez; görülürse dosya reddedilir. */
function parseXml(xml: string, handler: Handler) {
  const stack: string[] = [];
  let at = xml.startsWith("﻿") ? 1 : 0;
  while (at < xml.length) {
    const start = xml.indexOf("<", at);
    const text = xml.slice(at, start < 0 ? undefined : start);
    if (stack.length > 0) {
      if (text) handler.text?.(decode(text));
    } else if (text.trim()) throw new XlsxError(BROKEN);
    if (start < 0) break;

    if (xml.startsWith("<!--", start) || xml.startsWith("<?", start)) {
      const mark = xml[start + 1] === "?" ? "?>" : "-->";
      const close = xml.indexOf(mark, start);
      if (close < 0) throw new XlsxError(BROKEN);
      at = close + mark.length;
      continue;
    }

    const tag = /<(\/?)([\w:.-]{1,100})/y;
    tag.lastIndex = start;
    const head = tag.exec(xml);
    if (!head) throw new XlsxError(BROKEN);
    at = tag.lastIndex;
    const attributes: Record<string, string> = Object.create(null);
    const attribute = /\s+([\w:.-]{1,100})\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
    for (;;) {
      attribute.lastIndex = at;
      const found = attribute.exec(xml);
      if (!found) break;
      attributes[found[1]] = decode(found[2] ?? found[3]);
      at = attribute.lastIndex;
    }
    const tail = /\s*(\/?)>/y;
    tail.lastIndex = at;
    const end = tail.exec(xml);
    if (!end) throw new XlsxError(BROKEN);
    at = tail.lastIndex;

    const name = localName(head[2]);
    if (head[1]) {
      if (end[1] || stack.pop() !== head[2]) throw new XlsxError(BROKEN);
      handler.close?.(name);
    } else {
      handler.open?.(name, attributes);
      if (end[1]) handler.close?.(name);
      else if (stack.push(head[2]) > 50) throw new XlsxError(BROKEN);
    }
  }
  if (stack.length > 0) throw new XlsxError(BROKEN);
}

// ---------------------------------------------------------------------------
// Çalışma kitabı
// ---------------------------------------------------------------------------

/** "AB12" → 27 (sıfırdan başlar) */
function columnIndex(reference: string) {
  const letters = /^([A-Z]{1,3})\d{1,7}$/.exec(reference)?.[1];
  if (!letters) throw new XlsxError(BROKEN);
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

function readSharedStrings(xml: string) {
  const strings: string[] = [];
  let value = "";
  let inText = false;
  let phonetic = false;
  parseXml(xml, {
    open(name) {
      if (name === "si") value = "";
      else if (name === "rPh") phonetic = true;
      else if (name === "t") inText = true;
    },
    text(text) {
      if (inText && !phonetic) value += text;
    },
    close(name) {
      if (name === "si") strings.push(value);
      else if (name === "rPh") phonetic = false;
      else if (name === "t") inText = false;
    },
  });
  return strings;
}

function toCell(
  type: string,
  hasFormula: boolean,
  value: string,
  strings: string[],
): Cell | null {
  if (hasFormula) {
    return { kind: "invalid", reason: "Formül kullanılamaz; değeri yazın." };
  }
  if (type === "e")
    return { kind: "invalid", reason: "Hücrede Excel hatası var." };
  if (type === "s") {
    const text = /^\d{1,7}$/.test(value) ? strings[Number(value)] : undefined;
    if (text === undefined) {
      if (value === "") return null;
      throw new XlsxError(BROKEN);
    }
    value = text;
  }
  if (type === "n") {
    return value.trim() ? { kind: "number", value: value.trim() } : null;
  }
  if (type === "b") value = value === "1" ? "Evet" : "Hayır";
  // Excel satır sonunu bu kodla saklar; diğer denetim karakterleri silinir.
  const text = value
    .replaceAll("_x000D_", "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim();
  if (!text) return null;
  if (text.length > MAX_CELL_LENGTH) {
    return { kind: "invalid", reason: "Hücre çok uzun." };
  }
  return { kind: "text", value: text };
}

function readSheet(xml: string, strings: string[]) {
  const rows: SheetRow[] = [];
  let row: SheetRow = { no: 0, cells: new Map() };
  let column = -1;
  let type = "n";
  let value = "";
  let hasFormula = false;
  let reading = false;
  let phonetic = false;
  let inCell = false;

  parseXml(xml, {
    open(name, attributes) {
      if (name === "row") {
        const no = attributes.r ? Number(attributes.r) : row.no + 1;
        if (!Number.isInteger(no) || no <= row.no || no > 1_048_576) {
          throw new XlsxError(BROKEN);
        }
        row = { no, cells: new Map() };
        column = -1;
      } else if (name === "c") {
        const next = attributes.r ? columnIndex(attributes.r) : column + 1;
        if (next <= column) throw new XlsxError(BROKEN);
        column = next;
        type = attributes.t ?? "n";
        value = "";
        hasFormula = false;
        inCell = true;
      } else if (inCell) {
        if (name === "f") hasFormula = true;
        else if (name === "rPh") phonetic = true;
        else if (name === "v" || name === "t") reading = true;
      }
    },
    text(text) {
      if (reading && !phonetic) value += text;
    },
    close(name) {
      if (name === "v" || name === "t") reading = false;
      else if (name === "rPh") phonetic = false;
      else if (name === "c") {
        inCell = false;
        const cell = toCell(type, hasFormula, value, strings);
        if (!cell) return;
        if (column >= MAX_COLUMNS) {
          throw new XlsxError("Dosyada çok fazla sütun var.");
        }
        row.cells.set(column, cell);
      } else if (name === "row" && row.cells.size > 0) {
        // Başlık satırı da sayılır.
        if (rows.push(row) > MAX_ROWS + 1) {
          throw new XlsxError(
            `Dosyada en fazla ${MAX_ROWS} satır olabilir; bölerek yükleyin.`,
          );
        }
      }
    },
  });
  return rows;
}

/** İlk sayfanın dolu satırlarını döndürür. */
export function readXlsx(bytes: Uint8Array): SheetRow[] {
  if (bytes.byteLength === 0) throw new XlsxError("Dosya boş.");
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new XlsxError("Dosya en fazla 2 MB olabilir.");
  }
  const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (file.length >= 4 && file.readUInt32LE(0) === 0xe011cfd0) {
    throw new XlsxError(
      "Eski (.xls) veya şifreli dosya yüklenemez; .xlsx olarak kaydedin.",
    );
  }
  if (file.length < 22 || file.readUInt32LE(0) !== 0x04034b50) {
    throw new XlsxError("Yalnızca .xlsx dosyası yükleyin.");
  }
  try {
    return readWorkbook(file);
  } catch (error) {
    if (error instanceof XlsxError) throw error;
    // Dosya dışını okumaya çalışan bozuk adresler.
    if (error instanceof RangeError) throw new XlsxError(BROKEN);
    throw error;
  }
}

function readWorkbook(file: Buffer) {
  const entries = readDirectory(file);
  const part = (name: string) => {
    const entry = entries.get(name);
    if (!entry) throw new XlsxError(BROKEN);
    return extract(file, entry);
  };

  let hasMacro = [...entries.keys()].some((n) => /vbaProject/i.test(n));
  parseXml(part("[Content_Types].xml"), {
    open(_, attributes) {
      if (/macroEnabled/i.test(attributes.ContentType ?? "")) hasMacro = true;
    },
  });
  if (hasMacro) throw new XlsxError("Makro içeren dosya yüklenemez.");

  let sheetId = "";
  parseXml(part("xl/workbook.xml"), {
    open(name, attributes) {
      if (name !== "sheet" || sheetId) return;
      const key = Object.keys(attributes).find(
        (k) => localName(k) === "id" && k !== "id",
      );
      sheetId = key ? attributes[key] : "";
    },
  });
  let target = "";
  parseXml(part("xl/_rels/workbook.xml.rels"), {
    open(name, attributes) {
      if (
        name === "Relationship" &&
        sheetId &&
        attributes.Id === sheetId &&
        attributes.TargetMode !== "External"
      ) {
        target = attributes.Target ?? "";
      }
    },
  });
  if (!target) throw new XlsxError(BROKEN);

  const strings = entries.has("xl/sharedStrings.xml")
    ? readSharedStrings(part("xl/sharedStrings.xml"))
    : [];
  return readSheet(
    part(target.startsWith("/") ? target.slice(1) : `xl/${target}`),
    strings,
  );
}
