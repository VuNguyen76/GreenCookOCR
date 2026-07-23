import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResult } from "pg";
import { config } from "../config.js";
import { sanitizeClientErrorMessage } from "../services/public-errors.js";
import type { ReconciliationResult } from "../services/reconciliation.js";
import type { DocumentRow, DocumentStatus, OcrDocument, OcrItem } from "../../shared/ocr.js";
import { pool } from "./pool.js";

export interface NewDocument {
  batchId: string;
  batchPosition: number;
  originalName: string;
  storedName: string;
  storagePath: string;
  uploadUrl?: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface PublishJob {
  id: string;
  document_id: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  error_message: string | null;
}

type Queryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[]
  ): Promise<QueryResult<T>>;
};

type Connectable = Queryable & {
  connect(): Promise<PoolClient>;
};

const ACTIVE_STATUSES: DocumentStatus[] = ["preprocessing", "ocr_running", "validating"];

export class StagingRepository {
  constructor(private readonly database: Connectable = pool) {}

  async createBatch(_fileCount: number): Promise<string> {
    return randomUUID();
  }

  async insertDocument(input: NewDocument): Promise<DocumentRow> {
    const id = randomUUID();
    await this.database.query(`
      INSERT INTO adempiere.kg_order_ai_test(
        ad_client_id, ad_org_id, createdby, updatedby,
        value, ma_tai_lieu_nguon, thu_tu_phieu_trong_file,
        ten_file_nguon, duoi_file, loai_mime,
        kich_thuoc_file, source_sha256, trang_thai_xu_ly,
        upload_url, raw_json
      ) VALUES (
        $1, $2, $3, $3,
        $4, $4, $5,
        $6, $7, $8,
        $9, $10, 'queued',
        $11, $12::jsonb
      )
    `, [
      config.targetAdClientId,
      config.targetAdOrgId,
      config.targetAdUserId,
      id,
      input.batchPosition,
      input.originalName,
      extensionOf(input.originalName),
      input.mimeType,
      input.sizeBytes,
      input.sha256,
      input.uploadUrl ?? null,
      json({
        upload: {
          batch_id: input.batchId,
          batch_position: input.batchPosition,
          stored_name: input.storedName,
          storage_path: input.storagePath,
          upload_url: input.uploadUrl ?? null,
          attempts: 0,
          next_attempt_at: new Date().toISOString()
        }
      })
    ]);
    return this.documentRow(id);
  }

  async listDocuments(limit = 200): Promise<DocumentRow[]> {
    const rows = await this.database.query<Record<string, unknown>>(`
      SELECT ${DOCUMENT_LIST_SELECT},
             (
               SELECT count(*)::int
               FROM adempiere.kg_order_detail_ai_test detail
               WHERE detail.kg_order_ai_test_id = document.kg_order_ai_test_id
             ) AS item_count
      FROM adempiere.kg_order_ai_test document
      WHERE document.ad_client_id = $1
        AND document.ma_tai_lieu_nguon IS NOT NULL
      ORDER BY document.created DESC, document.kg_order_ai_test_id DESC
      LIMIT $2
    `, [config.targetAdClientId, limit]);
    return rows.rows.map((row) => sanitizeDocumentRow(hydrateDocumentRow(row) as unknown as DocumentRow));
  }

  async getDocument(id: string): Promise<(Record<string, unknown> & { items: Record<string, unknown>[] }) | null> {
    const result = await this.database.query<Record<string, unknown>>(`
      SELECT ${DOCUMENT_SELECT}
      FROM adempiere.kg_order_ai_test document
      WHERE document.ma_tai_lieu_nguon = $1
        AND document.ad_client_id = $2
      LIMIT 1
    `, [id, config.targetAdClientId]);
    const row = result.rows[0];
    if (!row) return null;

    const items = await this.database.query<Record<string, unknown>>(`
      SELECT ${ITEM_SELECT}
      FROM adempiere.kg_order_detail_ai_test item
      JOIN adempiere.kg_order_ai_test document ON document.kg_order_ai_test_id = item.kg_order_ai_test_id
      WHERE document.ma_tai_lieu_nguon = $1
        AND document.ad_client_id = $2
      ORDER BY item.dong NULLS LAST, item.kg_order_detail_ai_test_id
    `, [id, config.targetAdClientId]);

    const document = sanitizeDocumentRecord(hydrateDocumentRow(row));
    const normalizedItems = normalizedItemsByLine(document.normalized_result);
    return {
      ...document,
      items: items.rows.map((item) => {
        const hydrated = hydrateItemRow(item);
        return { ...normalizedItems.get(Number(hydrated.line_no)), ...hydrated };
      })
    };
  }

  async getStats(): Promise<Record<string, number>> {
    const rows = await this.database.query<{ status: string; count: string }>(`
      SELECT CASE
               WHEN trang_thai_xu_ly IN ('published', 'publish_failed') THEN 'Chưa xác nhận'
               ELSE coalesce(trang_thai_xu_ly, 'queued')
             END AS status,
             count(*)::text AS count
      FROM adempiere.kg_order_ai_test
      WHERE ad_client_id = $1
        AND ma_tai_lieu_nguon IS NOT NULL
      GROUP BY 1
    `, [config.targetAdClientId]);
    return Object.fromEntries(rows.rows.map((row) => [row.status, Number(row.count)]));
  }

  async recoverStaleDocuments(): Promise<void> {
    await this.database.query(`
      UPDATE adempiere.kg_order_ai_test
      SET trang_thai_xu_ly = 'queued',
          description = NULL,
          updated = now(),
          updatedby = $1
      WHERE ad_client_id = $2
        AND trang_thai_xu_ly = ANY($3::text[])
        AND updated < now() - interval '2 minutes'
    `, [config.targetAdUserId, config.targetAdClientId, ACTIVE_STATUSES]);
  }

  async claimNextDocument(): Promise<DocumentRow | null> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const claim = await client.query<{ id: string }>(`
        SELECT ma_tai_lieu_nguon AS id
        FROM adempiere.kg_order_ai_test
        WHERE ad_client_id = $1
          AND trang_thai_xu_ly = 'queued'
          AND coalesce((raw_json->'upload'->>'next_attempt_at')::timestamp, now()) <= now()
        ORDER BY created, thu_tu_phieu_trong_file NULLS LAST, kg_order_ai_test_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `, [config.targetAdClientId]);
      const id = claim.rows[0]?.id;
      if (!id) {
        await client.query("COMMIT");
        return null;
      }
      await client.query(`
        UPDATE adempiere.kg_order_ai_test
        SET trang_thai_xu_ly = 'preprocessing',
            raw_json = jsonb_set(
              jsonb_set(coalesce(raw_json, '{}'::jsonb), '{upload,attempts}', to_jsonb(coalesce((raw_json->'upload'->>'attempts')::int, 0) + 1), true),
              '{runtime,started_at}', to_jsonb(now()::text), true
            ),
            updated = now(),
            updatedby = $1,
            description = NULL
        WHERE ma_tai_lieu_nguon = $2
      `, [config.targetAdUserId, id]);
      await client.query("COMMIT");
      return this.documentRow(id);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async setDocumentStatus(id: string, status: DocumentStatus, geminiFileName?: string): Promise<void> {
    await this.database.query(`
      UPDATE adempiere.kg_order_ai_test
      SET trang_thai_xu_ly = $1,
          raw_json = CASE
            WHEN $2::text IS NULL THEN raw_json
            ELSE jsonb_set(coalesce(raw_json, '{}'::jsonb), '{runtime,gemini_file_name}', to_jsonb($2::text), true)
          END,
          updated = now(),
          updatedby = $3
      WHERE ma_tai_lieu_nguon = $4
        AND ad_client_id = $5
    `, [status, geminiFileName ?? null, config.targetAdUserId, id, config.targetAdClientId]);
  }

  async completeDocument(
    id: string,
    rawResult: unknown,
    normalizedOcr: OcrDocument,
    reconciliation: ReconciliationResult,
    model: string,
    promptVersion: string
  ): Promise<DocumentStatus> {
    const normalized = reconciliation.document;
    const auditsByLine = new Map(reconciliation.lines.map((line) => [line.lineNo, line]));
    const rawItems = getRawItems(rawResult);
    const firstItem = normalized.items[0];
    const storeCode = firstNonEmpty([
      firstItem?.store_code,
      normalized.warehouse_code,
      normalized.buyer_code,
      firstItem?.warehouse_code
    ]);
    const storeName = firstNonEmpty([
      firstItem?.store_name,
      normalized.warehouse_name,
      firstItem?.warehouse_name,
      normalized.buyer_name,
      normalized.issuer_branch
    ]);
    const deliveryAddress = firstNonEmpty([
      normalized.delivery_address,
      normalized.ship_to_address,
      firstItem?.delivery_address
    ]);
    const orderDate = firstNonEmpty([
      normalized.po_date,
      firstItem?.po_date,
      normalized.delivery_date,
      firstItem?.promised_date ?? null
    ]);
    const deliveryDate = firstNonEmpty([
      normalized.delivery_date,
      firstItem?.promised_date ?? null,
      firstItem?.po_date,
      normalized.po_date
    ]);
    const salesContact = joinText([normalized.order_contact, normalized.contact_phone], " - ");
    const partnerNames = uniqueLower([
      normalized.buyer_name,
      normalized.issuer_name,
      storeName,
      normalized.supplier_name
    ]);
    const headerVatRate = firstNonEmpty(normalized.items.map((item) => item.vat_rate));
    const pageCount = pageCountFromOcr(rawResult, normalized);
    const rawText = rawTextFromOcr(rawResult, normalized);
    const invoiceDate = normalizeDateForDb(rawFieldValue(normalized.raw_fields, [
      "ngay xuat hoa don",
      "ngay hoa don",
      "invoice date"
    ]));
    const orderStatus = rawFieldValue(normalized.raw_fields, [
      "trang thai don hang",
      "order status",
      "status"
    ]);
    const promotionCode = rawFieldValue(normalized.raw_fields, [
      "ma khuyen mai",
      "promotion code",
      "promo code",
      "promotion",
      "khuyen mai"
    ]);
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const parent = await client.query<{ kg_order_ai_test_id: string }>(`
        SELECT kg_order_ai_test_id::text
        FROM adempiere.kg_order_ai_test
        WHERE ma_tai_lieu_nguon = $1 AND ad_client_id = $2
        FOR UPDATE
      `, [id, config.targetAdClientId]);
      const parentId = parent.rows[0]?.kg_order_ai_test_id;
      if (!parentId) throw new Error("KhÃ´ng tÃ¬m tháº¥y dá»¯ liá»‡u táº¡m cá»§a chá»©ng tá»«.");

      await client.query("DELETE FROM adempiere.kg_order_detail_ai_test WHERE kg_order_ai_test_id = $1", [parentId]);
      for (const [index, item] of normalized.items.entries()) {
        const audit = auditsByLine.get(item.line_no);
        await client.query(`
          INSERT INTO adempiere.kg_order_detail_ai_test(
            ad_client_id, ad_org_id, createdby, updatedby, kg_order_ai_test_id,
            dong, dong_nguon, trang_nguon, barcode,
            ten_san_pham_khach_hang, ten_san_pham_cong_ty, quy_cach,
            so_luong, don_vi_tinh, so_luong_quy_doi,
            don_gia_khach_hang, don_gia_cong_ty,
            ty_le_vat, thanh_tien,
            trang_thai_lien_ket, raw_json, description
          ) VALUES (
            $1, $2, $3, $3, $4,
            $5, $5, $6, $7,
            $8, $9, $10,
            $11::numeric, $12, $13::numeric,
            $14::numeric, $15::numeric,
            $16::numeric, $17::numeric,
            $18, $19::jsonb, $20
          )
        `, [
          config.targetAdClientId,
          config.targetAdOrgId,
          config.targetAdUserId,
          parentId,
          item.line_no,
          item.source_page,
          item.barcode,
          item.product_name,
          item.product_name,
          item.model,
          numericOrNull(item.quantity),
          item.unit,
          numericOrNull(item.units_per_order_unit),
          numericOrNull(item.unit_price),
          detailCompanyUnitPrice(item),
          numericOrNull(item.vat_rate),
          numericOrNull(item.amount),
          audit?.matchMethod ?? "source",
          json({
            ...rawItems[index] as Record<string, unknown>,
            normalized: item,
            audit: audit ? {
              matchMethod: audit.matchMethod,
              matchConfidence: audit.matchConfidence,
              fieldSources: audit.fieldSources,
              warnings: audit.warnings,
              reconciledByAi: audit.reconciledByAi
            } : null
          }),
          joinText([
            item.product_code ? `Ma SP: ${item.product_code}` : null,
            item.vendor_product_code ? `Ma NCC: ${item.vendor_product_code}` : null
          ], "; ")
        ]);
      }

      await client.query(`
        UPDATE adempiere.kg_order_ai_test SET
          trang_thai_xu_ly = 'Chưa xác nhận',
          value = coalesce($3, $4, ma_tai_lieu_nguon),
          tieu_de_chung_tu = $5,
          loai_chung_tu = $6,
          so_trang = $24::integer,
          raw_text = $25,
          so_po = $3,
          order_id = $4,
          ngay_dat_hang = $7::date,
          ngay_giao_hang = $8::date,
          ngay_xuat_hoa_don = $26::date,
          ma_nha_cung_cap = $9,
          ten_nha_cung_cap = $10,
          ma_cua_hang = $11,
          ten_cua_hang = $12,
          dia_chi_giao_hang = $13,
          tien_hang = $14::numeric,
          tien_thue = $15::numeric,
          tong_tien = $16::numeric,
          tong_tien_sau_thue = $16::numeric,
          ma_tien_te = coalesce($17, 'VND'),
          c_currency_id = coalesce(c_currency_id, (
            SELECT currency.c_currency_id
            FROM adempiere.c_currency currency
            WHERE currency.iso_code = coalesce($17, 'VND')
            ORDER BY currency.c_currency_id
            LIMIT 1
          )),
          c_bpartner_id = coalesce(c_bpartner_id, (
            SELECT partner.c_bpartner_id
            FROM adempiere.c_bpartner partner
            WHERE partner.ad_client_id IN (0, $23)
              AND partner.isactive = 'Y'
              AND lower(trim(partner.name)) = ANY($22::text[])
            ORDER BY partner.ad_client_id DESC, partner.c_bpartner_id
            LIMIT 1
          )),
          ten_nhan_vien_kinh_doanh = $20,
          trang_thai_don_hang = $27,
          ma_khuyen_mai = $28,
          ty_le_vat = $21::numeric,
          phuong_thuc_trich_xuat = $18,
          raw_json = coalesce(raw_json, '{}'::jsonb) || $19::jsonb,
          thoi_gian_xac_nhan = NULL,
          kiem_tra_file = 'N',
          button_confirm = 'N',
          button_xacnhan = 'N',
          description = NULL,
          updated = now(),
          updatedby = $1
        WHERE kg_order_ai_test_id = $2
      `, [
        config.targetAdUserId,
        parentId,
        normalized.po_number,
        normalized.document_number ?? normalized.reference_number ?? normalized.po_number,
        normalized.document_title,
        normalized.document_type,
        normalizeDateForDb(orderDate),
        normalizeDateForDb(deliveryDate),
        normalized.supplier_code ?? null,
        normalized.supplier_name,
        storeCode,
        storeName,
        deliveryAddress,
        numericOrNull(normalized.subtotal_amount),
        numericOrNull(normalized.tax_amount),
        numericOrNull(normalized.total_amount),
        normalized.currency,
        normalized.template_key,
        json({
          raw_result: rawResult,
          normalized_ocr_result: normalizedOcr,
          normalized_result: normalized,
          reconciliation_result: {
            version: reconciliation.version,
            usedAi: reconciliation.usedAi,
            lines: reconciliation.lines
          },
          warnings: normalized.warnings,
          runtime: {
            model,
            prompt_version: promptVersion,
            completed_at: new Date().toISOString()
          },
          completed_at: new Date().toISOString()
        }),
        salesContact,
        numericOrNull(headerVatRate),
        partnerNames,
        config.targetAdClientId,
        pageCount,
        rawText,
        invoiceDate,
        orderStatus,
        promotionCode
      ]);
      await client.query("COMMIT");
      return "Chưa xác nhận";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async failDocument(id: string, attempts: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const publicMessage = sanitizeClientErrorMessage(message)
      ?? "Không đọc được tài liệu. Vui lòng kiểm tra lại file hoặc thử quét lại.";
    const retry = attempts < config.maxAttempts;
    const delaySeconds = Math.min(120, 2 ** attempts * 5);
    await this.database.query(`
      UPDATE adempiere.kg_order_ai_test
      SET trang_thai_xu_ly = $1,
          description = $2::text,
          raw_json = jsonb_set(
            jsonb_set(coalesce(raw_json, '{}'::jsonb), '{upload,next_attempt_at}', to_jsonb($3::text), true),
            '{runtime,error_message}', to_jsonb($2::text), true
          ),
          updated = now(),
          updatedby = $4
      WHERE ma_tai_lieu_nguon = $5
        AND ad_client_id = $6
    `, [
      retry ? "queued" : "failed",
      publicMessage.slice(0, 2000),
      retry ? new Date(Date.now() + delaySeconds * 1000).toISOString() : new Date().toISOString(),
      config.targetAdUserId,
      id,
      config.targetAdClientId
    ]);
  }

  async retryDocument(id: string): Promise<boolean> {
    const result = await this.database.query(`
      UPDATE adempiere.kg_order_ai_test
      SET trang_thai_xu_ly = 'queued',
          description = NULL,
          raw_json = jsonb_set(
            jsonb_set(coalesce(raw_json, '{}'::jsonb), '{upload,attempts}', '0'::jsonb, true),
            '{upload,next_attempt_at}', to_jsonb(now()::text), true
          ) #- '{runtime,error_message}',
          thoi_gian_xac_nhan = NULL,
          kiem_tra_file = 'N',
          button_confirm = 'N',
          button_xacnhan = 'N',
          updated = now(),
          updatedby = $1
      WHERE ma_tai_lieu_nguon = $2
        AND ad_client_id = $3
        AND trang_thai_xu_ly = ANY($4::text[])
    `, [
      config.targetAdUserId,
      id,
      config.targetAdClientId,
      ["failed", "needs_review", "completed", "Chưa xác nhận", "published", "publish_failed", "preprocessing", "ocr_running", "validating"]
    ]);
    return Number(result.rowCount) > 0;
  }

  async setTargetPartner(id: string, bpartnerId: string, bpartnerName: string): Promise<boolean> {
    const result = await this.database.query(`
      UPDATE adempiere.kg_order_ai_test
      SET c_bpartner_id = $1::numeric,
          ten_nha_cung_cap = coalesce(ten_nha_cung_cap, $2),
          updated = now(),
          updatedby = $3
      WHERE ma_tai_lieu_nguon = $4
        AND ad_client_id = $5
        AND trang_thai_xu_ly IN ('needs_review', 'Chưa xác nhận')
    `, [bpartnerId, bpartnerName, config.targetAdUserId, id, config.targetAdClientId]);
    return Number(result.rowCount) > 0;
  }

  async setItemProductMatch(
    documentId: string,
    itemId: string,
    product: { id: string; value: string; name: string },
    method = "manual"
  ): Promise<boolean> {
    const result = await this.database.query(`
      UPDATE adempiere.kg_order_detail_ai_test item
      SET kg_sp_id = $1::numeric,
          ten_san_pham_cong_ty = $3,
          trang_thai_lien_ket = $4,
          updated = now(),
          updatedby = $5
      FROM adempiere.kg_order_ai_test document
      WHERE document.kg_order_ai_test_id = item.kg_order_ai_test_id
        AND document.ma_tai_lieu_nguon = $6
        AND item.kg_order_detail_ai_test_id = $2::numeric
        AND document.ad_client_id = $7
        AND document.trang_thai_xu_ly IN ('needs_review', 'Chưa xác nhận')
    `, [product.id, itemId, product.name ?? product.value, method, config.targetAdUserId, documentId, config.targetAdClientId]);
    return Number(result.rowCount) > 0;
  }

  async deleteDocument(id: string): Promise<DeleteDocumentResult> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const row = await client.query<{ stored_name: string; status: string | null }>(`
        SELECT raw_json->'upload'->>'stored_name' AS stored_name,
               trang_thai_xu_ly AS status
        FROM adempiere.kg_order_ai_test
        WHERE ma_tai_lieu_nguon = $1 AND ad_client_id = $2
        FOR UPDATE
      `, [id, config.targetAdClientId]);
      const document = row.rows[0];
      if (!document) {
        await client.query("COMMIT");
        return { deleted: false, reason: "not_found" };
      }
      if (ACTIVE_STATUSES.includes(document.status as DocumentStatus)) {
        await client.query("COMMIT");
        return { deleted: false, reason: "processing" };
      }
      await client.query(`
        DELETE FROM adempiere.kg_order_detail_ai_test detail
        USING adempiere.kg_order_ai_test document
        WHERE detail.kg_order_ai_test_id = document.kg_order_ai_test_id
          AND document.ma_tai_lieu_nguon = $1
          AND document.ad_client_id = $2
      `, [id, config.targetAdClientId]);
      await client.query(`
        DELETE FROM adempiere.kg_order_ai_test
        WHERE ma_tai_lieu_nguon = $1
          AND ad_client_id = $2
      `, [id, config.targetAdClientId]);
      await client.query("COMMIT");
      return { deleted: true, storedName: document.stored_name };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createRun(documentId: string, model: string, promptVersion: string): Promise<string> {
    await this.database.query(`
      UPDATE adempiere.kg_order_ai_test
      SET raw_json = jsonb_set(
            jsonb_set(coalesce(raw_json, '{}'::jsonb), '{runtime,model}', to_jsonb($1::text), true),
            '{runtime,prompt_version}', to_jsonb($2::text), true
          ),
          updated = now(),
          updatedby = $3
      WHERE ma_tai_lieu_nguon = $4
        AND ad_client_id = $5
    `, [model, promptVersion, config.targetAdUserId, documentId, config.targetAdClientId]);
    return randomUUID();
  }

  async finishRun(
    _id: string,
    _status: "completed" | "failed",
    _durationMs: number,
    _interactionId?: string,
    errorMessage?: string
  ): Promise<void> {
    if (!errorMessage) return;
    const publicErrorMessage = sanitizeClientErrorMessage(errorMessage);
    if (!publicErrorMessage) return;
  }

  async claimNextPublishJob(): Promise<PublishJob | null> {
    return null;
  }

  async markPublished(_jobId: string, _documentId: string, _orderIds: string[]): Promise<void> {}

  async markPublishFailed(_jobId: string, _documentId: string, _error: unknown): Promise<void> {}

  private async documentRow(id: string): Promise<DocumentRow> {
    const row = await this.getDocument(id);
    if (!row) throw new Error(`KhÃ´ng tÃ¬m tháº¥y tÃ i liá»‡u táº¡m ${id}`);
    return row as unknown as DocumentRow;
  }
}

export type DeleteDocumentResult =
  | { deleted: true; storedName: string }
  | { deleted: false; reason: "not_found" | "processing" };

const repository = new StagingRepository();

export const createBatch = (fileCount: number) => repository.createBatch(fileCount);
export const insertDocument = (input: NewDocument) => repository.insertDocument(input);
export const listDocuments = (limit = 200) => repository.listDocuments(limit);
export const getDocument = (id: string) => repository.getDocument(id);
export const getStats = () => repository.getStats();
export const recoverStaleDocuments = () => repository.recoverStaleDocuments();
export const claimNextDocument = () => repository.claimNextDocument();
export const setDocumentStatus = (id: string, status: DocumentStatus, fileName?: string) =>
  repository.setDocumentStatus(id, status, fileName);
export const completeDocument = (
  id: string,
  rawResult: unknown,
  normalizedOcr: OcrDocument,
  reconciliation: ReconciliationResult,
  model: string,
  promptVersion: string
) => repository.completeDocument(id, rawResult, normalizedOcr, reconciliation, model, promptVersion);
export const failDocument = (id: string, attempts: number, error: unknown) =>
  repository.failDocument(id, attempts, error);
export const retryDocument = (id: string) => repository.retryDocument(id);
export const claimNextPublishJob = () => repository.claimNextPublishJob();
export const markPublished = (jobId: string, documentId: string, orderIds: string[]) =>
  repository.markPublished(jobId, documentId, orderIds);
export const markPublishFailed = (jobId: string, documentId: string, error: unknown) =>
  repository.markPublishFailed(jobId, documentId, error);
export const setTargetPartner = (id: string, bpartnerId: string, name: string) =>
  repository.setTargetPartner(id, bpartnerId, name);
export const setItemProductMatch = (
  documentId: string,
  itemId: string,
  product: { id: string; value: string; name: string },
  method?: string
) => repository.setItemProductMatch(documentId, itemId, product, method);
export const deleteDocument = (id: string) => repository.deleteDocument(id);
export const createRun = (documentId: string, model: string, promptVersion: string) =>
  repository.createRun(documentId, model, promptVersion);
export const finishRun = (
  id: string,
  status: "completed" | "failed",
  durationMs: number,
  interactionId?: string,
  errorMessage?: string
) => repository.finishRun(id, status, durationMs, interactionId, errorMessage);

const DOCUMENT_SELECT = `
  document.ma_tai_lieu_nguon AS id,
  document.raw_json->'upload'->>'batch_id' AS batch_id,
  coalesce((document.raw_json->'upload'->>'batch_position')::int, document.thu_tu_phieu_trong_file) AS batch_position,
  document.ten_file_nguon AS original_name,
  document.raw_json->'upload'->>'stored_name' AS stored_name,
  document.raw_json->'upload'->>'storage_path' AS storage_path,
  coalesce(document.upload_url, document.raw_json->'upload'->>'upload_url') AS upload_url,
  document.loai_mime AS mime_type,
  document.kich_thuoc_file::text AS size_bytes,
  document.source_sha256 AS sha256,
  CASE
    WHEN document.trang_thai_xu_ly IN ('published', 'publish_failed') THEN 'Chưa xác nhận'
    ELSE coalesce(document.trang_thai_xu_ly, 'queued')
  END AS status,
  document.tieu_de_chung_tu AS document_title,
  coalesce(document.raw_json->'normalized_result'->>'template_key', document.phuong_thuc_trich_xuat) AS template_key,
  coalesce(document.raw_json->'normalized_result'->>'issuer_name', document.ten_nha_cung_cap, document.ten_cua_hang) AS issuer_name,
  document.so_po AS po_number,
  document.ngay_dat_hang::text AS po_date,
  document.ngay_giao_hang::text AS delivery_date,
  coalesce(document.ma_tien_te, document.raw_json->'normalized_result'->>'currency') AS currency,
  document.ten_nha_cung_cap AS supplier_name,
  coalesce(document.raw_json->'normalized_result'->>'buyer_name', document.ten_cua_hang) AS buyer_name,
  document.dia_chi_giao_hang AS delivery_address,
  document.tien_hang::text AS subtotal_amount,
  document.tien_thue::text AS tax_amount,
  coalesce(document.tong_tien_sau_thue, document.tong_tien)::text AS total_amount,
  coalesce((document.raw_json->'upload'->>'attempts')::int, 0) AS attempts,
  coalesce(document.raw_json->'runtime'->>'error_message', document.description) AS error_message,
  coalesce(document.raw_json->'warnings', '[]'::jsonb) AS warnings,
  document.raw_json->'raw_result' AS raw_result,
  document.raw_json->'normalized_ocr_result' AS normalized_ocr_result,
  document.raw_json->'normalized_result' AS normalized_result,
  document.raw_json->'reconciliation_result' AS reconciliation_result,
  document.created::text AS created_at,
  document.updated::text AS updated_at,
  coalesce(document.raw_json->'runtime'->>'completed_at', document.raw_json->>'completed_at') AS completed_at
`;

const DOCUMENT_LIST_SELECT = `
  document.ma_tai_lieu_nguon AS id,
  document.raw_json->'upload'->>'batch_id' AS batch_id,
  coalesce((document.raw_json->'upload'->>'batch_position')::int, document.thu_tu_phieu_trong_file) AS batch_position,
  document.ten_file_nguon AS original_name,
  document.raw_json->'upload'->>'stored_name' AS stored_name,
  document.raw_json->'upload'->>'storage_path' AS storage_path,
  coalesce(document.upload_url, document.raw_json->'upload'->>'upload_url') AS upload_url,
  document.loai_mime AS mime_type,
  document.kich_thuoc_file::text AS size_bytes,
  document.source_sha256 AS sha256,
  CASE
    WHEN document.trang_thai_xu_ly IN ('published', 'publish_failed') THEN 'Chưa xác nhận'
    ELSE coalesce(document.trang_thai_xu_ly, 'queued')
  END AS status,
  document.tieu_de_chung_tu AS document_title,
  coalesce(document.raw_json->'normalized_result'->>'template_key', document.phuong_thuc_trich_xuat) AS template_key,
  coalesce(document.raw_json->'normalized_result'->>'issuer_name', document.ten_nha_cung_cap, document.ten_cua_hang) AS issuer_name,
  document.so_po AS po_number,
  document.ngay_dat_hang::text AS po_date,
  document.ngay_giao_hang::text AS delivery_date,
  coalesce(document.ma_tien_te, document.raw_json->'normalized_result'->>'currency') AS currency,
  document.ten_nha_cung_cap AS supplier_name,
  coalesce(document.raw_json->'normalized_result'->>'buyer_name', document.ten_cua_hang) AS buyer_name,
  document.dia_chi_giao_hang AS delivery_address,
  document.tien_hang::text AS subtotal_amount,
  document.tien_thue::text AS tax_amount,
  coalesce(document.tong_tien_sau_thue, document.tong_tien)::text AS total_amount,
  coalesce((document.raw_json->'upload'->>'attempts')::int, 0) AS attempts,
  coalesce(document.raw_json->'runtime'->>'error_message', document.description) AS error_message,
  coalesce(document.raw_json->'warnings', '[]'::jsonb) AS warnings,
  document.created::text AS created_at,
  document.updated::text AS updated_at,
  coalesce(document.raw_json->'runtime'->>'completed_at', document.raw_json->>'completed_at') AS completed_at
`;

const ITEM_SELECT = `
  item.kg_order_detail_ai_test_id::text AS id,
  coalesce(item.dong, item.dong_nguon, 1)::int AS line_no,
  coalesce(item.raw_json->'normalized'->>'po_number', document.so_po) AS po_number,
  coalesce(item.raw_json->'normalized'->>'po_date', document.ngay_dat_hang::text) AS po_date,
  item.raw_json->'normalized'->>'store_code' AS store_code,
  item.raw_json->'normalized'->>'store_name' AS store_name,
  coalesce(item.raw_json->'normalized'->>'delivery_address', document.dia_chi_giao_hang) AS delivery_address,
  item.raw_json->'normalized'->>'product_code' AS product_code,
  item.raw_json->'normalized'->>'vendor_product_code' AS vendor_product_code,
  item.barcode,
  coalesce(item.ten_san_pham_khach_hang, item.ten_san_pham_cong_ty) AS product_name,
  coalesce(item.raw_json->'normalized'->>'model', item.quy_cach) AS model,
  item.raw_json->'normalized'->>'article_code' AS article_code,
  item.raw_json->'normalized'->>'sku' AS sku,
  item.raw_json->'normalized'->>'ou_type' AS ou_type,
  item.so_luong::text AS quantity,
  item.raw_json->'normalized'->>'free_quantity' AS free_quantity,
  item.so_luong_quy_doi::text AS units_per_order_unit,
  item.don_vi_tinh AS unit,
  item.raw_json->'normalized'->>'list_price' AS list_price,
  item.don_gia_khach_hang::text AS unit_price,
  item.raw_json->'normalized'->>'discount_percent' AS discount_percent,
  item.raw_json->'normalized'->>'discount_amount' AS discount_amount,
  item.ty_le_vat::text AS vat_rate,
  item.raw_json->'normalized'->>'tax_amount' AS tax_amount,
  item.thanh_tien::text AS amount,
  item.raw_json->'normalized'->>'gross_amount' AS gross_amount,
  item.raw_json->'normalized'->>'promised_date' AS promised_date,
  item.raw_json->'normalized'->>'warehouse_code' AS warehouse_code,
  item.raw_json->'normalized'->>'warehouse_name' AS warehouse_name,
  item.raw_json->'normalized'->'extra_fields' AS extra_fields,
  item.trang_nguon AS source_page,
  coalesce(item.raw_json->'normalized'->>'confidence', '0') AS confidence,
  item.raw_json AS raw_row,
  item.trang_thai_lien_ket AS match_method,
  item.raw_json->'audit'->>'matchConfidence' AS match_confidence,
  coalesce(item.raw_json->'audit'->'fieldSources', '{}'::jsonb) AS field_sources,
  coalesce(item.raw_json->'audit'->'warnings', '[]'::jsonb) AS reconciliation_warnings,
  coalesce((item.raw_json->'audit'->>'reconciledByAi')::boolean, false) AS reconciled_by_ai,
  item.kg_sp_id::text AS matched_kg_sp_id,
  item.ten_san_pham_cong_ty AS matched_product_name
`;

function hydrateDocumentRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    warnings: parseJson(row.warnings, []),
    raw_result: parseJson(row.raw_result, null),
    normalized_ocr_result: parseJson(row.normalized_ocr_result, null),
    normalized_result: parseJson(row.normalized_result, null),
    reconciliation_result: parseJson(row.reconciliation_result, null)
  };
}

function hydrateItemRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    raw_row: parseJson(row.raw_row, {}),
    extra_fields: parseJson(row.extra_fields, []),
    field_sources: parseJson(row.field_sources, {}),
    reconciliation_warnings: parseJson(row.reconciliation_warnings, []),
    reconciled_by_ai: Boolean(row.reconciled_by_ai)
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function normalizeDateForDb(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function numericOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  return /^-?\d+(?:\.\d+)?$/.test(text) ? text : null;
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function joinText(values: Array<string | null | undefined>, separator: string): string | null {
  const parts = values
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean);
  return parts.length ? parts.join(separator) : null;
}

function uniqueLower(values: Array<string | null | undefined>): string[] {
  return [...new Set(values
    .map((value) => typeof value === "string" ? value.trim().toLowerCase() : "")
    .filter(Boolean))];
}

function booleanFlag(value: unknown): "Y" | "N" | null {
  if (typeof value === "boolean") return value ? "Y" : "N";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["y", "yes", "true", "1", "co", "cÃ³"].includes(normalized)) return "Y";
    if (["n", "no", "false", "0", "khong", "khÃ´ng"].includes(normalized)) return "N";
  }
  return null;
}

function rawFieldValue(fields: OcrDocument["raw_fields"] | OcrItem["extra_fields"], labels: string[]): string | null {
  if (!Array.isArray(fields)) return null;
  const expected = new Set(labels.map(normalizeFieldLabel));
  for (const field of fields) {
    const label = normalizeFieldLabel(field.label);
    if (!expected.has(label)) continue;
    const value = field.value?.trim();
    if (value) return value;
  }
  return null;
}

function detailCompanyUnitPrice(item: OcrItem): string | null {
  return numericOrNull(rawFieldValue(item.extra_fields, [
    "don gia cong ty",
    "gia cong ty",
    "company unit price",
    "company price"
  ]));
}

function normalizeFieldLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function pageCountFromOcr(rawResult: unknown, normalized: OcrDocument): number | null {
  const pages = new Set<number>();
  for (const field of normalized.raw_fields ?? []) addPage(pages, field.page);
  for (const table of normalized.raw_tables ?? []) addPage(pages, table.page);
  for (const item of normalized.items) addPage(pages, item.source_page);
  collectPages(rawResult, pages, 0);
  return pages.size ? Math.max(...pages) : null;
}

function addPage(pages: Set<number>, value: unknown): void {
  const page = Number(value);
  if (Number.isInteger(page) && page > 0) pages.add(page);
}

function collectPages(value: unknown, pages: Set<number>, depth: number): void {
  if (!value || depth > 4) return;
  if (Array.isArray(value)) {
    for (const item of value) collectPages(item, pages, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  addPage(pages, record.page);
  addPage(pages, record.source_page);
  for (const child of Object.values(record)) collectPages(child, pages, depth + 1);
}

function rawTextFromOcr(rawResult: unknown, normalized: OcrDocument): string | null {
  const directText = firstDirectText(rawResult);
  if (directText) return directText.slice(0, 500_000);

  const lines: string[] = [];
  for (const field of normalized.raw_fields ?? []) {
    const label = field.label?.trim();
    const value = field.value?.trim();
    if (label && value) lines.push(`${label}: ${value}`);
  }
  for (const table of normalized.raw_tables ?? []) {
    if (table.title) lines.push(table.title);
    if (table.headers.length) lines.push(table.headers.join("\t"));
    for (const row of table.rows) lines.push(row.join("\t"));
  }
  const text = lines.join("\n").trim();
  return text ? text.slice(0, 500_000) : null;
}

function firstDirectText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["raw_text", "full_text", "text", "markdown", "content"]) {
    const text = record[key];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return null;
}

function getRawItems(rawResult: unknown): unknown[] {
  if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) return [];
  const items = (rawResult as Record<string, unknown>).items;
  return Array.isArray(items) ? items : [];
}

function normalizedItemsByLine(value: unknown): Map<number, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items)) return new Map();
  return new Map(items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const lineNo = Number(row.line_no);
    return Number.isInteger(lineNo) ? [[lineNo, row] as const] : [];
  }));
}

function extensionOf(fileName: string): string {
  const match = fileName.match(/(\.[^.]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}

export function sanitizeDocumentRow<T extends { error_message: string | null }>(row: T): T {
  return { ...row, error_message: sanitizeClientErrorMessage(row.error_message) };
}

function sanitizeDocumentRecord(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    error_message: typeof row.error_message === "string"
      ? sanitizeClientErrorMessage(row.error_message)
      : null
  };
}


