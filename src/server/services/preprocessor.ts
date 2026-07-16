import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import mammoth from "mammoth";
import sharp from "sharp";
import type { DocumentRow } from "../../shared/ocr.js";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

export type PreparedInput =
  | { mode: "file"; path: string; mimeType: string; kind: "document" | "image"; temporary: boolean }
  | { mode: "text"; text: string; temporary: false };

export async function prepareDocument(document: DocumentRow): Promise<PreparedInput> {
  const extension = path.extname(document.original_name).toLowerCase();

  if (extension === ".pdf") {
    return {
      mode: "file",
      path: document.storage_path,
      mimeType: "application/pdf",
      kind: "document",
      temporary: false
    };
  }

  if ([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"].includes(extension)) {
    const outputPath = path.join(config.workDir, `${document.id}.jpg`);
    await sharp(document.storage_path)
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
      .toFile(outputPath);
    return {
      mode: "file",
      path: outputPath,
      mimeType: "image/jpeg",
      kind: "image",
      temporary: true
    };
  }

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path: document.storage_path });
    return { mode: "text", text: limitText(result.value), temporary: false };
  }

  if (extension === ".doc") {
    const { stdout } = await execFileAsync(
      config.antiwordPath,
      ["-m", "UTF-8.txt", document.storage_path],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
    );
    return { mode: "text", text: limitText(stdout), temporary: false };
  }

  if (extension === ".xlsx") {
    return { mode: "text", text: await workbookToText(document.storage_path), temporary: false };
  }

  if ([".txt", ".csv"].includes(extension)) {
    return { mode: "text", text: limitText(await fs.readFile(document.storage_path, "utf8")), temporary: false };
  }

  throw new Error(`Unsupported file type: ${extension || document.mime_type}`);
}

export async function cleanupPreparedInput(input: PreparedInput): Promise<void> {
  if (input.mode === "file" && input.temporary) {
    await fs.rm(input.path, { force: true });
  }
}

async function workbookToText(filePath: string): Promise<string> {
  const archive = unzipSync(new Uint8Array(await fs.readFile(filePath)));
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: false
  });
  const workbookXml = readArchiveText(archive, "xl/workbook.xml");
  const relationshipsXml = readArchiveText(archive, "xl/_rels/workbook.xml.rels");
  const workbook = parser.parse(workbookXml);
  const relationships = parser.parse(relationshipsXml);
  const relationshipTargets = new Map<string, string>();
  for (const relationship of asArray(relationships.Relationships?.Relationship)) {
    relationshipTargets.set(String(relationship["@_Id"]), String(relationship["@_Target"]));
  }
  const sharedStrings = readSharedStrings(archive, parser);
  const sections: string[] = [];
  for (const sheetMeta of asArray(workbook.workbook?.sheets?.sheet)) {
    const relationshipId = String(sheetMeta["@_r:id"] ?? "");
    const target = relationshipTargets.get(relationshipId);
    if (!target) continue;
    const archivePath = normalizeWorkbookTarget(target);
    const sheet = parser.parse(readArchiveText(archive, archivePath));
    sections.push(`### SHEET: ${String(sheetMeta["@_name"] ?? "Sheet")}`);
    for (const row of asArray(sheet.worksheet?.sheetData?.row)) {
      const values: string[] = [];
      for (const cell of asArray(row.c)) {
        const column = columnIndex(String(cell["@_r"] ?? "A1"));
        while (values.length < column) values.push("");
        values[column - 1] = readCellValue(cell, sharedStrings);
      }
      if (values.some(Boolean)) sections.push(`${String(row["@_r"] ?? "")}\t${values.join("\t")}`);
    }
  }
  return limitText(sections.join("\n"));
}

function readSharedStrings(archive: Record<string, Uint8Array>, parser: XMLParser): string[] {
  const entry = archive["xl/sharedStrings.xml"];
  if (!entry) return [];
  const parsed = parser.parse(new TextDecoder().decode(entry));
  return asArray(parsed.sst?.si).map((item) => richText(item));
}

function readCellValue(cell: Record<string, unknown>, sharedStrings: string[]): string {
  const type = String(cell["@_t"] ?? "");
  const raw = textValue(cell.v);
  if (type === "s") return sharedStrings[Number(raw)] ?? raw;
  if (type === "inlineStr") return richText(cell.is);
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  return raw;
}

function richText(value: unknown): string {
  if (!value || typeof value !== "object") return textValue(value);
  const record = value as Record<string, unknown>;
  if (record.t !== undefined) return textValue(record.t);
  return asArray<Record<string, unknown>>(
    record.r as Record<string, unknown> | Record<string, unknown>[] | undefined
  ).map((run) => textValue(run.t)).join("");
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)["#text"] ?? "").trim();
  }
  return String(value).trim();
}

function asArray<T = Record<string, unknown>>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function readArchiveText(archive: Record<string, Uint8Array>, name: string): string {
  const entry = archive[name];
  if (!entry) throw new Error(`XLSX entry not found: ${name}`);
  return new TextDecoder().decode(entry);
}

function normalizeWorkbookTarget(target: string): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\//, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized.replace(/^\.\//, "")}`;
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result;
}

function limitText(text: string): string {
  const normalized = text.replace(/\u0000/g, "").normalize("NFC");
  if (!normalized.trim()) throw new Error("Document has no readable text");
  return normalized.slice(0, 750_000);
}
