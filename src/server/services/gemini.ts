import { GoogleGenAI } from "@google/genai";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  OCR_JSON_SCHEMA,
  OcrDocumentSchema,
  TEMPLATE_KEYS,
  type OcrDocument,
  type TemplateKey
} from "../../shared/ocr.js";
import { config } from "../config.js";
import type { PreparedInput } from "./preprocessor.js";
import { OCR_PROMPT } from "./prompt.js";
import {
  AI_RECONCILIATION_JSON_SCHEMA,
  AiReconciliationResponseSchema,
  buildAiReconciliationPrompt,
  type AiReconciliationDecision,
  type AiReconciliationInput
} from "./reconciliation.js";

const execFileAsync = promisify(execFile);

export interface GeminiExtraction {
  raw: unknown;
  interactionId?: string;
}

export class GeminiOcrService {
  private readonly client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  private readonly interactionTimeoutMs = 180_000;

  async extract(input: PreparedInput, originalName: string): Promise<GeminiExtraction> {
    if (config.ocrProvider === "openai-compatible") {
      return this.extractViaOpenAiCompatible(input, originalName);
    }
    return this.extractViaGemini(input, originalName);
  }

  async reconcileProducts(input: AiReconciliationInput): Promise<AiReconciliationDecision[]> {
    const prompt = buildAiReconciliationPrompt(input);
    if (config.ocrProvider === "openai-compatible") {
      if (!config.openAiCompatibleApiKey) {
        throw new Error("OPENAI_COMPATIBLE_API_KEY is not configured");
      }
      const raw = await this.createOpenAiCompatibleJson(
        [{ type: "text", text: prompt }],
        4_000
      );
      return AiReconciliationResponseSchema.parse(raw).decisions;
    }

    const interaction = await withTimeout(
      this.client.interactions.create({
        model: config.geminiModel,
        input: [{ type: "text", text: prompt }] as never,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: AI_RECONCILIATION_JSON_SCHEMA
        }
      }),
      this.interactionTimeoutMs,
      "Timed out waiting for Gemini reconciliation response"
    );
    if (!interaction.output_text) throw new Error("Gemini returned an empty reconciliation response");
    return AiReconciliationResponseSchema.parse(JSON.parse(interaction.output_text)).decisions;
  }

  private async extractViaGemini(input: PreparedInput, originalName: string): Promise<GeminiExtraction> {
    if (input.mode === "text") {
      return this.createGeminiInteraction([
        {
          type: "text",
          text: `${OCR_PROMPT}\n\nNOI DUNG DA TRICH TU FILE ${originalName}:\n<document>\n${input.text}\n</document>`
        }
      ]);
    }

    let uploadedName: string | undefined;
    try {
      const uploaded = await this.client.files.upload({
        file: input.path,
        config: {
          mimeType: input.mimeType,
          displayName: path.basename(originalName)
        }
      });
      uploadedName = uploaded.name;
      const ready = await this.waitUntilReady(uploaded.name!);
      if (!ready.uri || !ready.mimeType) throw new Error("Gemini file has no URI or MIME type");
      return await this.createGeminiInteraction([
        {
          type: input.kind,
          uri: ready.uri,
          mime_type: ready.mimeType
        },
        { type: "text", text: OCR_PROMPT }
      ]);
    } finally {
      if (uploadedName) {
        await this.client.files.delete({ name: uploadedName }).catch(() => undefined);
      }
    }
  }

  private async extractViaOpenAiCompatible(
    input: PreparedInput,
    originalName: string
  ): Promise<GeminiExtraction> {
    if (!config.openAiCompatibleApiKey) {
      throw new Error("OPENAI_COMPATIBLE_API_KEY is not configured");
    }

    const temporaryPaths: string[] = [];
    try {
      const content: Array<Record<string, unknown>> = [];
      if (input.mode === "text") {
        content.push({
          type: "text",
          text: `${OCR_PROMPT}\n\nNOI DUNG DA TRICH TU FILE ${originalName}:\n<document>\n${input.text}\n</document>`
        });
      } else {
        const imagePaths = input.mimeType === "application/pdf"
          ? await this.renderPdfPages(input.path, temporaryPaths)
          : [input.path];
        content.push({
          type: "text",
          text: `${OCR_PROMPT}\n\nReturn exactly one JSON object matching the schema. Do not wrap it in markdown.`
        });
        const imageParts = await Promise.all(
          imagePaths.map(async (imagePath) => {
            const image = await fs.readFile(imagePath);
            return {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${image.toString("base64")}`
              }
            };
          })
        );
        content.push(...imageParts);
      }

      const raw = await this.createOpenAiCompatibleInteraction(content);
      return { raw };
    } finally {
      await Promise.all(
        temporaryPaths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => undefined))
      );
    }
  }

  private async createGeminiInteraction(input: unknown[]): Promise<GeminiExtraction> {
    const interaction = await withTimeout(
      this.client.interactions.create({
        model: config.geminiModel,
        input: input as never,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: OCR_JSON_SCHEMA
        }
      }),
      this.interactionTimeoutMs,
      "Timed out waiting for Gemini OCR response"
    );
    if (!interaction.output_text) throw new Error("Gemini returned an empty response");
    const raw = JSON.parse(interaction.output_text);
    OcrDocumentSchema.parse(raw);
    return { raw, interactionId: interaction.id };
  }

  private async createOpenAiCompatibleInteraction(content: Array<Record<string, unknown>>): Promise<OcrDocument> {
    const raw = await this.createOpenAiCompatibleJson(content, 12_000);
    return OcrDocumentSchema.parse(canonicalizeOcrDocument(raw));
  }

  private async createOpenAiCompatibleJson(
    content: Array<Record<string, unknown>>,
    maxTokens: number
  ): Promise<unknown> {
    const response = await fetch(`${config.openAiCompatibleBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openAiCompatibleApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openAiCompatibleModel,
        messages: [{ role: "user", content }],
        temperature: 0,
        max_tokens: maxTokens
      }),
      signal: AbortSignal.timeout(this.interactionTimeoutMs)
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI-compatible request failed (${response.status}): ${responseText.slice(0, 1000)}`);
    }
    const outputText = extractOpenAiCompatibleText(responseText);
    return JSON.parse(extractJsonObject(outputText));
  }

  private async renderPdfPages(inputPath: string, temporaryPaths: string[]): Promise<string[]> {
    const prefix = path.join(os.tmpdir(), `greencook-ocr-${randomUUID()}`);
    // The local OpenAI-compatible router is less reliable with oversized page
    // images: at 180 DPI it sometimes returns an empty SSE response or tool calls
    // instead of JSON. 120 DPI keeps DMX/retail forms readable while staying stable.
    await execFileAsync(config.pdftoppmPath, ["-png", "-r", "120", inputPath, prefix], {
      maxBuffer: 20 * 1024 * 1024,
      shell: process.platform === "win32" && /\.cmd$/i.test(config.pdftoppmPath)
    });
    const directory = path.dirname(prefix);
    const basename = path.basename(prefix);
    const files = (await fs.readdir(directory))
      .filter((file) => file.startsWith(`${basename}-`) && file.endsWith(".png"))
      .sort((a, b) => pageNumber(a) - pageNumber(b))
      .map((file) => path.join(directory, file));
    if (files.length === 0) throw new Error("PDF rendering produced no images");
    temporaryPaths.push(...files);
    return files.slice(0, 8);
  }

  private async waitUntilReady(name: string) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const file = await this.client.files.get({ name });
      if (file.state === "ACTIVE" || file.state === undefined) return file;
      if (file.state === "FAILED") throw new Error("Gemini failed to process the uploaded file");
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("Timed out waiting for Gemini file processing");
  }
}

function extractOpenAiCompatibleText(responseText: string): string {
  const trimmed = responseText.trim();
  if (!trimmed.startsWith("data:")) {
    const payload = JSON.parse(trimmed) as {
      choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>;
    };
    return payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.delta?.content ?? "";
  }

  let output = "";
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
    output += chunk.choices?.[0]?.delta?.content ?? "";
  }
  return output;
}

function extractJsonObject(text: string): string {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("OCR response did not contain a JSON object");
  return cleaned.slice(start, end + 1);
}

function pageNumber(fileName: string): number {
  return Number(fileName.match(/-(\d+)\.png$/)?.[1] ?? 0);
}

export function canonicalizeOcrDocument(value: unknown): Record<string, unknown> {
  const source = isRecord(value) ? value : {};
  const items = Array.isArray(source.items) ? source.items : [];
  const templateKey = stringValue(source.template_key);
  const documentTitle = stringValue(source.document_title)
    ?? stringValue(source.title)
    ?? stringValue(source.document_type)
    ?? "Purchase Order";
  const orderedBy = firstLineString(source.ordered_by ?? source.order_by);
  const bySupplier = firstLineString(source.by_supplier);

  return {
    schema_version: "1.0",
    document_title: documentTitle,
    title_source: source.title_source === "document" ? "document" : "inferred",
    template_key: isTemplateKey(templateKey) ? templateKey : "unknown",
    document_type: isDocumentType(source.document_type) ? source.document_type : "purchase_order",
    issuer_name: nullableString(
      source.issuer_name ?? orderedBy ?? source.issuer ?? source.buyer_name
    ),
    issuer_branch: nullableString(source.issuer_branch ?? source.for_store),
    po_number: nullableString(source.po_number ?? source.order_number ?? source.order_no),
    po_date: nullableString(source.po_date ?? source.order_date),
    delivery_date: nullableString(source.delivery_date),
    currency: nullableString(source.currency ?? "VND"),
    supplier_name: nullableString(
      source.supplier_name ?? bySupplier ?? source.supplier ?? source.vendor
    ),
    buyer_name: nullableString(source.buyer_name ?? source.buyer),
    delivery_address: nullableString(source.delivery_address ?? source.delivered_to),
    subtotal_amount: nullableNumberString(source.subtotal_amount ?? source.subtotal ?? source.total_before_tax),
    tax_amount: nullableNumberString(source.tax_amount ?? source.vat_amount ?? source.total_vat),
    total_amount: nullableNumberString(source.total_amount ?? source.grand_total ?? source.total_after_tax),
    items: items.map((item, index) => canonicalizeOcrItem(item, index + 1)),
    warnings: Array.isArray(source.warnings) ? source.warnings.map(String) : [],
    confidence: confidenceValue(source.confidence)
  };
}

function canonicalizeOcrItem(value: unknown, fallbackLineNo: number): Record<string, unknown> {
  const source = isRecord(value) ? value : {};
  return {
    line_no: positiveInteger(source.line_no) ?? fallbackLineNo,
    po_number: nullableString(source.po_number ?? source.order_id ?? source.order_number),
    po_date: nullableString(source.po_date ?? source.order_date),
    store_code: nullableString(source.store_code ?? source.store_id),
    store_name: nullableString(source.store_name),
    delivery_address: nullableString(source.delivery_address ?? source.store_address),
    product_code: nullableString(source.product_code ?? source.article_code),
    vendor_product_code: nullableString(source.vendor_product_code),
    barcode: nullableString(source.barcode ?? source.article),
    product_name: nullableString(source.product_name ?? source.name ?? source.description ?? source.article_desc),
    model: nullableString(source.model),
    quantity: nullableNumberString(source.quantity ?? source.qty ?? source.po_qty ?? source.ou_qty),
    units_per_order_unit: nullableNumberString(
      source.units_per_order_unit ?? source.conversion_factor ?? source.sku_per_ou ?? source.sku_ou
    ),
    unit: nullableString(source.unit ?? source.po_unit),
    unit_price: nullableNumberString(source.unit_price ?? source.price ?? source.net_purchase_price),
    vat_rate: nullableNumberString(source.vat_rate),
    amount: nullableNumberString(source.amount ?? source.total_net_purchase_price ?? source.line_total),
    source_page: positiveInteger(source.source_page),
    confidence: confidenceValue(source.confidence)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function nullableString(value: unknown): string | null {
  return stringValue(value);
}

function firstLineString(value: unknown): string | null {
  const text = stringValue(value);
  return text?.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function nullableNumberString(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  let cleaned = text.replace(/[^0-9,.-]/g, "").trim();
  if (!cleaned) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) return cleaned;
  if (/^-?\d{1,3}(?:[.,]\d{3})+$/.test(cleaned)) return cleaned.replace(/[.,]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    const decimalMark = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
    const thousandsMark = decimalMark === "," ? "." : ",";
    cleaned = cleaned.replaceAll(thousandsMark, "").replace(decimalMark, ".");
  } else {
    cleaned = cleaned.replace(",", ".");
  }
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? cleaned : null;
}

function positiveInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function confidenceValue(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0.5;
  return Math.min(1, Math.max(0, numberValue));
}

function isDocumentType(value: unknown): value is "purchase_order" | "delivery_request" | "store_order" | "unknown" {
  return ["purchase_order", "delivery_request", "store_order", "unknown"].includes(String(value));
}

function isTemplateKey(value: string | null): value is TemplateKey {
  return Boolean(value && (TEMPLATE_KEYS as readonly string[]).includes(value));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
