import { z } from "zod";

export const TEMPLATE_KEYS = [
  "po_dmx_pdf_customer_manual",
  "po_bigc_go_purchase_note",
  "po_emart_thiso_purchase_order",
  "po_aeon_store_order",
  "po_nguyenkim_delivery_request",
  "po_mena_gourmet_purchase_order",
  "po_wincommerce_purchase_order",
  "po_dmx_excel_order_export",
  "po_jda_purchase_order",
  "unknown"
] as const;

const nullableText = z.string().nullable();
const nullableNumberText = z.string().regex(/^-?\d+(?:\.\d+)?$/).nullable();

export const OcrItemSchema = z.object({
  line_no: z.number().int().positive(),
  product_code: nullableText,
  vendor_product_code: nullableText,
  barcode: nullableText,
  product_name: nullableText,
  model: nullableText,
  quantity: nullableNumberText,
  units_per_order_unit: nullableNumberText,
  unit: nullableText,
  unit_price: nullableNumberText,
  vat_rate: nullableNumberText,
  amount: nullableNumberText,
  source_page: z.number().int().positive().nullable(),
  confidence: z.number().min(0).max(1)
});

export const OcrDocumentSchema = z.object({
  schema_version: z.literal("1.0"),
  document_title: z.string().min(1),
  title_source: z.enum(["document", "inferred"]),
  template_key: z.enum(TEMPLATE_KEYS),
  document_type: z.enum(["purchase_order", "delivery_request", "store_order", "unknown"]),
  issuer_name: nullableText,
  issuer_branch: nullableText,
  po_number: nullableText,
  po_date: nullableText,
  delivery_date: nullableText,
  currency: nullableText,
  supplier_name: nullableText,
  buyer_name: nullableText,
  delivery_address: nullableText,
  subtotal_amount: nullableNumberText,
  tax_amount: nullableNumberText,
  total_amount: nullableNumberText,
  items: z.array(OcrItemSchema),
  warnings: z.array(z.string()),
  confidence: z.number().min(0).max(1)
});

export type OcrItem = z.infer<typeof OcrItemSchema>;
export type OcrDocument = z.infer<typeof OcrDocumentSchema>;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const nullableStringSchema = {
  anyOf: [{ type: "string" }, { type: "null" }]
};

const nullableNumberStringSchema = {
  anyOf: [
    { type: "string", pattern: "^-?[0-9]+(?:\\.[0-9]+)?$" },
    { type: "null" }
  ]
};

export const OCR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema_version: { type: "string", enum: ["1.0"] },
    document_title: { type: "string", description: "Exact visible document title." },
    title_source: { type: "string", enum: ["document", "inferred"] },
    template_key: { type: "string", enum: TEMPLATE_KEYS },
    document_type: {
      type: "string",
      enum: ["purchase_order", "delivery_request", "store_order", "unknown"]
    },
    issuer_name: nullableStringSchema,
    issuer_branch: nullableStringSchema,
    po_number: nullableStringSchema,
    po_date: nullableStringSchema,
    delivery_date: nullableStringSchema,
    currency: nullableStringSchema,
    supplier_name: nullableStringSchema,
    buyer_name: nullableStringSchema,
    delivery_address: nullableStringSchema,
    subtotal_amount: nullableNumberStringSchema,
    tax_amount: nullableNumberStringSchema,
    total_amount: nullableNumberStringSchema,
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          line_no: { type: "integer", minimum: 1 },
          product_code: nullableStringSchema,
          vendor_product_code: nullableStringSchema,
          barcode: nullableStringSchema,
          product_name: nullableStringSchema,
          model: nullableStringSchema,
          quantity: nullableNumberStringSchema,
          units_per_order_unit: nullableNumberStringSchema,
          unit: nullableStringSchema,
          unit_price: nullableNumberStringSchema,
          vat_rate: nullableNumberStringSchema,
          amount: nullableNumberStringSchema,
          source_page: {
            anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }]
          },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: [
          "line_no", "product_code", "vendor_product_code", "barcode",
          "product_name", "model", "quantity", "units_per_order_unit", "unit", "unit_price",
          "vat_rate", "amount", "source_page", "confidence"
        ]
      }
    },
    warnings: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: [
    "schema_version", "document_title", "title_source", "template_key",
    "document_type", "issuer_name", "issuer_branch", "po_number", "po_date",
    "delivery_date", "currency", "supplier_name", "buyer_name",
    "delivery_address", "subtotal_amount", "tax_amount", "total_amount",
    "items", "warnings", "confidence"
  ]
} as const;

export type DocumentStatus =
  | "queued"
  | "preprocessing"
  | "ocr_running"
  | "validating"
  | "completed"
  | "needs_review"
  | "failed";

export interface DocumentRow {
  id: string;
  batch_id: string;
  batch_position: number;
  original_name: string;
  stored_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: string;
  sha256: string;
  status: DocumentStatus;
  document_title: string | null;
  template_key: TemplateKey | null;
  issuer_name: string | null;
  subtotal_amount: string | null;
  tax_amount: string | null;
  total_amount: string | null;
  attempts: number;
  error_message: string | null;
  warnings: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  item_count?: number;
}
