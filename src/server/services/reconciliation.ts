import type { OcrDocument, OcrItem } from "../../shared/ocr.js";
import { z } from "zod";

export const RECONCILIATION_VERSION = "greencook-reconcile-1.1.0";

export type MatchMethod =
  | "barcode_exact"
  | "product_code_exact"
  | "vendor_product_code_exact"
  | "ai_semantic"
  | "none";

export type FieldSource = "ocr" | "reference";

export interface ScopedProductIdentifier {
  templateKey: string;
  issuerName: string | null;
  productCode: string | null;
  vendorProductCode: string | null;
  unit: string | null;
}

export interface ProductReference {
  id: string;
  referenceKey: string;
  barcode: string | null;
  productCodes: string[];
  vendorProductCodes: string[];
  canonicalName: string;
  nameAliases: string[];
  units: string[];
  templateKeys: string[];
  issuerNames: string[];
  scopedIdentifiers: ScopedProductIdentifier[];
  sourceCount: number;
  trustScore: number;
  verified: boolean;
}

export interface RankedProductCandidate {
  referenceId: string;
  referenceKey: string;
  canonicalName: string;
  barcode: string | null;
  productCodes: string[];
  vendorProductCodes: string[];
  units: string[];
  score: number;
  nameSimilarity: number;
  method: Exclude<MatchMethod, "ai_semantic" | "none"> | "name_semantic";
  barcodeConflict: boolean;
  reference: ProductReference;
}

export interface AiReconciliationDecision {
  line_no: number;
  matched_reference_key: string | null;
  decision: "match" | "no_match" | "needs_review";
  confidence: number;
  reason: string;
}

export const AiReconciliationResponseSchema = z.object({
  decisions: z.array(z.object({
    line_no: z.number().int().positive(),
    matched_reference_key: z.string().nullable(),
    decision: z.enum(["match", "no_match", "needs_review"]),
    confidence: z.number().min(0).max(1),
    reason: z.string()
  }))
});

export const AI_RECONCILIATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          line_no: { type: "integer", minimum: 1 },
          matched_reference_key: { anyOf: [{ type: "string" }, { type: "null" }] },
          decision: { type: "string", enum: ["match", "no_match", "needs_review"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string" }
        },
        required: ["line_no", "matched_reference_key", "decision", "confidence", "reason"]
      }
    }
  },
  required: ["decisions"]
} as const;

export interface AiReconciliationInput {
  document: {
    template_key: OcrDocument["template_key"];
    issuer_name: string | null;
    supplier_name: string | null;
  };
  rows: Array<{
    ocr_item: OcrItem;
    candidates: Array<Omit<RankedProductCandidate, "reference">>;
  }>;
}

export type AiReconciliationResolver = (
  input: AiReconciliationInput
) => Promise<AiReconciliationDecision[]>;

export interface ReconciliationLineAudit {
  lineNo: number;
  matchedReferenceId: string | null;
  matchedReferenceKey: string | null;
  matchMethod: MatchMethod;
  matchConfidence: number;
  reconciledByAi: boolean;
  fieldSources: Record<string, FieldSource>;
  warnings: string[];
}

export interface ReconciliationResult {
  version: string;
  document: OcrDocument;
  lines: ReconciliationLineAudit[];
  usedAi: boolean;
}

export function createSourceOnlyReconciliation(source: OcrDocument): ReconciliationResult {
  const document = { ...source, items: source.items.map((item) => ({ ...item })) };
  return {
    version: "source-only-1.0",
    document,
    lines: document.items.map((item) => emptyAudit(item)),
    usedAi: false
  };
}

const TRANSACTION_FIELDS = [
  "quantity",
  "units_per_order_unit",
  "unit_price",
  "vat_rate",
  "amount"
] as const;

export function normalizeProductNameForMatch(value: string | null): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\b(pack|qty|price|unit|dvt|ou type)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isValidGs1Barcode(value: string | null): boolean {
  if (!value || !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  const digits = [...value].map(Number);
  const checkDigit = digits.pop();
  if (checkDigit === undefined) return false;
  let sum = 0;
  for (let index = digits.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += digits[index] * weight;
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}

export function productReferenceKey(item: OcrItem, templateKey: string): string | null {
  if (isValidGs1Barcode(item.barcode)) return `barcode:${item.barcode}`;
  if (item.product_code) return `product:${templateKey}:${normalizeIdentifier(item.product_code)}`;
  if (item.vendor_product_code) {
    return `vendor:${templateKey}:${normalizeIdentifier(item.vendor_product_code)}`;
  }
  return null;
}

export function rankProductCandidates(
  item: OcrItem,
  references: ProductReference[],
  document: Pick<OcrDocument, "template_key" | "issuer_name">
): RankedProductCandidate[] {
  const itemProductCode = normalizeIdentifier(item.product_code);
  const itemVendorCode = normalizeIdentifier(item.vendor_product_code);
  const validItemBarcode = isValidGs1Barcode(item.barcode) ? item.barcode : null;

  return references
    .map((reference): RankedProductCandidate | null => {
      const barcodeExact = Boolean(validItemBarcode && reference.barcode === validItemBarcode);
      const scopedIdentifiers = identifiersForDocument(reference, document);
      const scopedProductCodes = uniqueText(
        scopedIdentifiers.map((identifier) => identifier.productCode)
      );
      const scopedVendorProductCodes = uniqueText(
        scopedIdentifiers.map((identifier) => identifier.vendorProductCode)
      );
      const scopedUnits = uniqueText(scopedIdentifiers.map((identifier) => identifier.unit));
      const productCodeExact = Boolean(
        itemProductCode && scopedProductCodes.some((code) => normalizeIdentifier(code) === itemProductCode)
      );
      const vendorCodeExact = Boolean(
        itemVendorCode
        && scopedVendorProductCodes.some((code) => normalizeIdentifier(code) === itemVendorCode)
      );
      const barcodeConflict = Boolean(
        validItemBarcode && reference.barcode && validItemBarcode !== reference.barcode
      );
      const nameSimilarity = bestNameSimilarity(item.product_name, reference);
      const sameTemplate = reference.templateKeys.includes(document.template_key);
      const issuerName = document.issuer_name;
      const sameIssuer = Boolean(
        issuerName
        && reference.issuerNames.some((name) => normalizeText(name) === normalizeText(issuerName))
      );

      let method: RankedProductCandidate["method"];
      let score: number;
      if (barcodeExact) {
        method = "barcode_exact";
        score = 1;
      } else if (productCodeExact) {
        method = "product_code_exact";
        score = barcodeConflict ? 0.62 : 0.97;
      } else if (vendorCodeExact) {
        method = "vendor_product_code_exact";
        score = barcodeConflict ? 0.6 : 0.96;
      } else {
        method = "name_semantic";
        score = nameSimilarity * 0.82 + reference.trustScore * 0.1;
        if (sameTemplate) score += 0.04;
        if (sameIssuer) score += 0.03;
        if (barcodeConflict) score -= 0.35;
      }

      score = roundScore(Math.max(0, Math.min(1, score)));
      if (score < 0.55) return null;
      return {
        referenceId: reference.id,
        referenceKey: reference.referenceKey,
        canonicalName: reference.canonicalName,
        barcode: reference.barcode,
        productCodes: scopedProductCodes,
        vendorProductCodes: scopedVendorProductCodes,
        units: scopedUnits,
        score,
        nameSimilarity: roundScore(nameSimilarity),
        method,
        barcodeConflict,
        reference
      };
    })
    .filter((candidate): candidate is RankedProductCandidate => candidate !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

export async function reconcileOcrDocument(
  source: OcrDocument,
  references: ProductReference[],
  aiResolver?: AiReconciliationResolver
): Promise<ReconciliationResult> {
  const items = source.items.map((item) => ({ ...item }));
  const warnings = new Set(source.warnings);
  const audits = items.map((item) => emptyAudit(item));
  const ambiguous: Array<{ index: number; candidates: RankedProductCandidate[] }> = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const candidates = rankProductCandidates(item, references, source);
    const best = candidates[0];
    if (!best) {
      if (item.confidence < 0.8) {
        addReviewWarning(
          warnings,
          audits[index],
          "Độ tin cậy thấp và chưa có dữ liệu tham chiếu phù hợp"
        );
      }
      continue;
    }

    if (isDeterministicMatch(best)) {
      const applied = applyReference(item, best, source, best.method, best.score, false);
      items[index] = applied.item;
      audits[index] = applied.audit;
    } else {
      ambiguous.push({ index, candidates });
    }
  }

  let usedAi = false;
  if (ambiguous.length > 0) {
    if (!aiResolver) {
      for (const entry of ambiguous) {
        addReviewWarning(warnings, audits[entry.index], "Thiếu AI đối soát cho kết quả gần nghĩa");
      }
    } else {
      usedAi = true;
      try {
        const decisions = await aiResolver({
          document: {
            template_key: source.template_key,
            issuer_name: source.issuer_name,
            supplier_name: source.supplier_name
          },
          rows: ambiguous.map(({ index, candidates }) => ({
            ocr_item: items[index],
            candidates: candidates.map(({ reference: _reference, ...candidate }) => candidate)
          }))
        });
        const decisionsByLine = new Map(decisions.map((decision) => [decision.line_no, decision]));

        for (const entry of ambiguous) {
          const item = items[entry.index];
          const decision = decisionsByLine.get(item.line_no);
          const selected = decision?.matched_reference_key
            ? entry.candidates.find((candidate) => candidate.referenceKey === decision.matched_reference_key)
            : undefined;
          if (decision?.decision === "match" && selected && decision.confidence >= 0.8) {
            const applied = applyReference(
              item,
              selected,
              source,
              "ai_semantic",
              decision.confidence,
              true
            );
            items[entry.index] = applied.item;
            audits[entry.index] = applied.audit;
            continue;
          }

          if (
            decision?.decision === "no_match"
            && decision.confidence >= 0.8
            && item.confidence >= 0.8
          ) {
            audits[entry.index].reconciledByAi = true;
            audits[entry.index].matchConfidence = clampConfidence(decision.confidence);
            continue;
          }

          const reason = decision?.decision === "match" && !selected
            ? "AI đối soát chọn sản phẩm ngoài danh sách ứng viên"
            : decision?.reason || "AI chưa xác định được sản phẩm tham chiếu";
          addReviewWarning(warnings, audits[entry.index], reason);
          audits[entry.index].reconciledByAi = true;
          audits[entry.index].matchConfidence = clampConfidence(decision?.confidence ?? item.confidence);
        }
      } catch {
        for (const entry of ambiguous) {
          addReviewWarning(warnings, audits[entry.index], "AI đối soát tạm thời không khả dụng");
          audits[entry.index].reconciledByAi = true;
        }
      }
    }
  }

  return {
    version: RECONCILIATION_VERSION,
    document: { ...source, items, warnings: [...warnings] },
    lines: audits,
    usedAi
  };
}

export function buildAiReconciliationPrompt(input: AiReconciliationInput): string {
  return [
    "Bạn là tầng đối soát dữ liệu sản phẩm của GreenCookOCR.",
    "Mỗi dòng OCR chỉ được ghép với reference_key có trong candidates của chính dòng đó.",
    "So sánh tên đa ngôn ngữ theo nghĩa, model, kích thước, chất liệu và quy cách.",
    "Barcode hoặc mã sản phẩm mâu thuẫn là dấu hiệu cần kiểm tra; không được đoán để bỏ qua mâu thuẫn.",
    "Không sửa và không suy diễn số lượng, SKU/OU, đơn vị, đơn giá, VAT hoặc thành tiền.",
    "Nếu dòng OCR có mã/model rõ nhưng không trùng bất kỳ candidate nào, trả decision=no_match; đây có thể là sản phẩm mới hợp lệ.",
    "Chỉ trả decision=needs_review khi chính dữ liệu OCR bị thiếu, độ tin cậy thấp hoặc mâu thuẫn nội bộ.",
    "Ngưỡng match tối thiểu là 0.80.",
    "Trả đúng một JSON object: {\"decisions\":[{\"line_no\":1,\"matched_reference_key\":null,\"decision\":\"match|no_match|needs_review\",\"confidence\":0.0,\"reason\":\"...\"}]}",
    "Dữ liệu đối soát:",
    JSON.stringify(input)
  ].join("\n");
}

function isDeterministicMatch(
  candidate: RankedProductCandidate
): candidate is RankedProductCandidate & {
  method: "barcode_exact" | "product_code_exact" | "vendor_product_code_exact";
} {
  if (candidate.barcodeConflict) return false;
  return candidate.method === "barcode_exact"
    || candidate.method === "product_code_exact"
    || candidate.method === "vendor_product_code_exact";
}

function applyReference(
  source: OcrItem,
  candidate: RankedProductCandidate,
  document: Pick<OcrDocument, "template_key" | "issuer_name">,
  method: Exclude<MatchMethod, "none">,
  confidence: number,
  reconciledByAi: boolean
): { item: OcrItem; audit: ReconciliationLineAudit } {
  const item = { ...source };
  const reference = candidate.reference;
  const fieldSources = defaultFieldSources();

  if (reference.canonicalName && item.product_name !== reference.canonicalName) {
    item.product_name = reference.canonicalName;
    fieldSources.product_name = "reference";
  }
  if (!item.barcode && reference.barcode) {
    item.barcode = reference.barcode;
    fieldSources.barcode = "reference";
  }
  if (
    !item.product_code
    && templateSupportsProductCode(document.template_key)
    && candidate.productCodes.length === 1
  ) {
    item.product_code = candidate.productCodes[0];
    fieldSources.product_code = "reference";
  }
  if (
    !item.vendor_product_code
    && templateSupportsVendorProductCode(document.template_key)
    && candidate.vendorProductCodes.length === 1
  ) {
    item.vendor_product_code = candidate.vendorProductCodes[0];
    fieldSources.vendor_product_code = "reference";
  }
  if (!item.unit && candidate.units.length === 1) {
    item.unit = candidate.units[0];
    fieldSources.unit = "reference";
  }

  return {
    item,
    audit: {
      lineNo: source.line_no,
      matchedReferenceId: reference.id,
      matchedReferenceKey: reference.referenceKey,
      matchMethod: method,
      matchConfidence: clampConfidence(confidence),
      reconciledByAi,
      fieldSources,
      warnings: []
    }
  };
}

function identifiersForDocument(
  reference: ProductReference,
  document: Pick<OcrDocument, "template_key" | "issuer_name">
): ScopedProductIdentifier[] {
  const issuer = normalizeText(document.issuer_name ?? "");
  return reference.scopedIdentifiers.filter((identifier) => {
    if (identifier.templateKey !== document.template_key) return false;
    const identifierIssuer = normalizeText(identifier.issuerName ?? "");
    return issuer ? identifierIssuer === issuer : !identifierIssuer;
  });
}

function templateSupportsProductCode(templateKey: OcrDocument["template_key"]): boolean {
  return ![
    "po_bigc_go_purchase_note",
    "po_wincommerce_purchase_order",
    "unknown"
  ].includes(templateKey);
}

function templateSupportsVendorProductCode(templateKey: OcrDocument["template_key"]): boolean {
  return [
    "po_dmx_pdf_customer_manual",
    "po_dmx_excel_order_export",
    "po_jda_purchase_order"
  ].includes(templateKey);
}

function uniqueText(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function emptyAudit(item: OcrItem): ReconciliationLineAudit {
  return {
    lineNo: item.line_no,
    matchedReferenceId: null,
    matchedReferenceKey: null,
    matchMethod: "none",
    matchConfidence: clampConfidence(item.confidence),
    reconciledByAi: false,
    fieldSources: defaultFieldSources(),
    warnings: []
  };
}

function defaultFieldSources(): Record<string, FieldSource> {
  const sources: Record<string, FieldSource> = {
    product_code: "ocr",
    vendor_product_code: "ocr",
    barcode: "ocr",
    product_name: "ocr",
    model: "ocr",
    unit: "ocr"
  };
  for (const field of TRANSACTION_FIELDS) sources[field] = "ocr";
  return sources;
}

function addReviewWarning(
  documentWarnings: Set<string>,
  audit: ReconciliationLineAudit,
  reason: string
): void {
  const warning = `Cần đối soát sản phẩm dòng ${audit.lineNo}: ${reason}`;
  documentWarnings.add(warning);
  audit.warnings.push(warning);
}

function bestNameSimilarity(productName: string | null, reference: ProductReference): number {
  const source = normalizeProductNameForMatch(productName);
  if (!source) return 0;
  return Math.max(
    stringSimilarity(source, normalizeProductNameForMatch(reference.canonicalName)),
    ...reference.nameAliases.map((alias) => stringSimilarity(source, normalizeProductNameForMatch(alias)))
  );
}

function stringSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenDice = (2 * overlap) / (leftTokens.size + rightTokens.size);
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  const bigramOverlap = [...leftBigrams].filter((token) => rightBigrams.has(token)).length;
  const charDice = leftBigrams.size + rightBigrams.size === 0
    ? 0
    : (2 * bigramOverlap) / (leftBigrams.size + rightBigrams.size);
  return Math.max(tokenDice, tokenDice * 0.75 + charDice * 0.25);
}

function bigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, " ");
  const result = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    result.add(compact.slice(index, index + 2));
  }
  return result;
}

function normalizeIdentifier(value: string | null): string {
  return value?.replace(/\s+/g, "").toUpperCase() ?? "";
}

function normalizeText(value: string): string {
  return normalizeProductNameForMatch(value);
}

function clampConfidence(value: number): number {
  return roundScore(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)));
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
