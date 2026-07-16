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
      const runId = await createRun(document.id, config.geminiModel, PROMPT_VERSION);
      let prepared: Awaited<ReturnType<typeof prepareDocument>> | undefined;
      try {
        prepared = await prepareDocument(document);
        await setDocumentStatus(document.id, "ocr_running");
        const extraction = await this.gemini.extract(prepared, document.original_name);
        await setDocumentStatus(document.id, "validating");
        const normalized = normalizeOcrResult(extraction.raw);
        await completeDocument(
          document.id,
          extraction.raw,
          normalized,
          config.geminiModel,
          PROMPT_VERSION
        );
        await finishRun(runId, "completed", Date.now() - started, extraction.interactionId);
        console.log(`OCR completed: ${document.original_name} (${normalized.items.length} items)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failDocument(document.id, document.attempts, error);
        await finishRun(runId, "failed", Date.now() - started, undefined, message);
        console.error(`OCR failed: ${document.original_name}: ${message}`);
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
