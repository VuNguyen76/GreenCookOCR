import { config } from "../config.js";
import {
  claimNextDocument,
  completeDocument,
  createRun,
  failDocument,
  finishRun,
  recoverStaleDocuments,
  setDocumentStatus
} from "../db/repository.js";
import { GeminiOcrService } from "./gemini.js";
import { normalizeOcrResult } from "./normalizer.js";
import { cleanupPreparedInput, prepareDocument } from "./preprocessor.js";
import { PROMPT_VERSION } from "./prompt.js";
import { toPublicOcrErrorMessage } from "./public-errors.js";
import { createSourceOnlyReconciliation } from "./reconciliation.js";
import { extractStructuredSpreadsheet } from "./structured-extractor.js";

export class SequentialOcrWorker {
  private running = false;
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private readonly gemini = new GeminiOcrService();

  async start(): Promise<void> {
    await recoverStaleDocuments();
    this.schedule(200);
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay = config.workerPollMs): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopping) return this.schedule();
    this.running = true;
    try {
      await recoverStaleDocuments();
      const document = await claimNextDocument();
      if (!document) return;

      const started = Date.now();
      const model = config.geminiModel;
      const runId = await createRun(document.id, model, PROMPT_VERSION);
      let prepared: Awaited<ReturnType<typeof prepareDocument>> | undefined;
      try {
        prepared = await prepareDocument(document);
        await setDocumentStatus(document.id, "ocr_running");
        const structured = prepared.mode === "text"
          ? extractStructuredSpreadsheet(prepared.text, document.original_name)
          : null;
        const extraction = structured
          ? { raw: structured, interactionId: undefined }
          : await this.gemini.extract(prepared, document.original_name);
        await setDocumentStatus(document.id, "validating");
        const normalizedOcr = normalizeOcrResult(extraction.raw);
        const reconciliation = createSourceOnlyReconciliation(normalizedOcr);
        await completeDocument(
          document.id,
          extraction.raw,
          normalizedOcr,
          reconciliation,
          model,
          PROMPT_VERSION
        );
        await finishRun(runId, "completed", Date.now() - started, extraction.interactionId);
        console.log(
          `OCR completed: ${document.original_name} (${reconciliation.document.items.length} items, source-only normalization)`
        );
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        const publicMessage = toPublicOcrErrorMessage(error);
        await failDocument(document.id, document.attempts, new Error(publicMessage));
        await finishRun(runId, "failed", Date.now() - started, undefined, publicMessage);
        console.error(`OCR failed: ${document.original_name}: ${rawMessage}`);
      } finally {
        if (prepared) await cleanupPreparedInput(prepared).catch(() => undefined);
      }
    } catch (error) {
      console.error("Worker loop error", error);
    } finally {
      this.running = false;
      this.schedule(250);
    }
  }
}
