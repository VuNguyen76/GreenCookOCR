import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import {
  OCR_JSON_SCHEMA,
  OcrDocumentSchema
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

export interface GeminiExtraction {
  raw: unknown;
  interactionId?: string;
}

export type GeminiMediaResolution = "low" | "medium" | "high";

interface GeminiInteractionLike {
  id?: string;
  status?: string;
  output_text?: string;
}

export class GeminiOcrService {
  private readonly client = new GoogleGenAI({
    apiKey: config.geminiApiKey,
    apiVersion: config.geminiApiVersion
  });
  private readonly interactionTimeoutMs = 180_000;

  async extract(input: PreparedInput, originalName: string): Promise<GeminiExtraction> {
    if (input.mode === "text") {
      return this.createOcrInteraction(buildGeminiTextInput(input.text, originalName));
    }

    const data = (await fs.readFile(input.path)).toString("base64");
    return this.createOcrInteraction(buildGeminiMediaInput(
      input.kind,
      data,
      input.mimeType,
      originalName,
      config.geminiMediaResolution
    ));
  }

  private async createOcrInteraction(
    geminiInput: Array<Record<string, unknown>>
  ): Promise<GeminiExtraction> {
    const interaction = await withTimeout(
      this.client.interactions.create({
        model: config.geminiModel,
        input: geminiInput as never,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: OCR_JSON_SCHEMA
        }
      }),
      this.interactionTimeoutMs,
      "Timed out waiting for Gemini OCR response"
    );
    return parseGeminiInteraction(interaction);
  }

  async reconcileProducts(input: AiReconciliationInput): Promise<AiReconciliationDecision[]> {
    const interaction = await withTimeout(
      this.client.interactions.create({
        model: config.geminiModel,
        input: buildGeminiUserInput([{
          type: "text",
          text: buildAiReconciliationPrompt(input)
        }]) as never,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: AI_RECONCILIATION_JSON_SCHEMA
        }
      }),
      this.interactionTimeoutMs,
      "Timed out waiting for Gemini reconciliation response"
    );
    if (interaction.status === "failed") {
      throw new Error("Gemini reconciliation interaction failed");
    }
    if (!interaction.output_text) {
      throw new Error("Gemini returned an empty reconciliation response");
    }
    return AiReconciliationResponseSchema.parse(JSON.parse(interaction.output_text)).decisions;
  }

}

export function buildGeminiMediaInput(
  kind: "document" | "image",
  data: string,
  mimeType: string,
  originalName: string,
  resolution: GeminiMediaResolution
): Array<Record<string, unknown>> {
  const media = {
    type: kind,
    data,
    mime_type: mimeType,
    ...(kind === "image" ? { resolution } : {})
  };

  return buildGeminiUserInput([
    media,
    {
      type: "text",
      text: `${OCR_PROMPT}\n\nTên file: ${originalName}`
    }
  ]);
}

export function buildGeminiTextInput(
  text: string,
  originalName: string
): Array<Record<string, unknown>> {
  return buildGeminiUserInput([{
    type: "text",
    text: `${OCR_PROMPT}\n\nTên file: ${originalName}\nNỘI DUNG ĐÃ TRÍCH TỪ FILE:\n<document>\n${text}\n</document>`
  }]);
}

function buildGeminiUserInput(
  content: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return [{ type: "user_input", content }];
}

export function parseGeminiInteraction(interaction: GeminiInteractionLike): GeminiExtraction {
  if (interaction.status === "failed" || interaction.status === "cancelled") {
    throw new Error(`Gemini interaction failed (${interaction.status})`);
  }
  if (!interaction.output_text) throw new Error("Gemini returned an empty response");

  const raw = JSON.parse(interaction.output_text);
  OcrDocumentSchema.parse(raw);
  return { raw, interactionId: interaction.id };
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
