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
const nullableItemText = nullableText.default(null);
const nullableBoolean = z.boolean().nullable().default(null);

export const RawFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
  section: nullableItemText,
  page: z.number().int().positive().nullable().default(null)
});

export const RawTableSchema = z.object({
  title: nullableItemText,
  page: z.number().int().positive().nullable().default(null),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string()))
});

export const OcrItemSchema = z.object({
  line_no: z.number().int().positive(),
  po_number: nullableItemText,
  po_date: nullableItemText,
  store_code: nullableItemText,
  store_name: nullableItemText,
  delivery_address: nullableItemText,
  product_code: nullableText,
  vendor_product_code: nullableText,
  barcode: nullableText,
  product_name: nullableText,
  model: nullableText,
  article_code: nullableText.optional(),
  sku: nullableText.optional(),
  ou_type: nullableText.optional(),
  quantity: nullableNumberText,
  free_quantity: nullableNumberText.optional(),
  units_per_order_unit: nullableNumberText,
  unit: nullableText,
  list_price: nullableNumberText.optional(),
  unit_price: nullableNumberText,
  discount_percent: nullableNumberText.optional(),
  discount_amount: nullableNumberText.optional(),
  vat_rate: nullableNumberText,
  tax_amount: nullableNumberText.optional(),
  amount: nullableNumberText,
  gross_amount: nullableNumberText.optional(),
  promised_date: nullableText.optional(),
  warehouse_code: nullableText.optional(),
  warehouse_name: nullableText.optional(),
  extra_fields: z.array(RawFieldSchema).optional(),
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
  document_number: nullableText.optional(),
  reference_number: nullableText.optional(),
  buyer_code: nullableText.optional(),
  supplier_code: nullableText.optional(),
  buyer_tax_id: nullableText.optional(),
  supplier_tax_id: nullableText.optional(),
  order_contact: nullableText.optional(),
  contact_phone: nullableText.optional(),
  contact_email: nullableText.optional(),
  bill_to_address: nullableText.optional(),
  ship_to_address: nullableText.optional(),
  warehouse_code: nullableText.optional(),
  warehouse_name: nullableText.optional(),
  department: nullableText.optional(),
  payment_terms: nullableText.optional(),
  payment_method: nullableText.optional(),
  delivery_method: nullableText.optional(),
  delivery_window: nullableText.optional(),
  price_list_name: nullableText.optional(),
  price_includes_tax: nullableBoolean.optional(),
  subtotal_amount: nullableNumberText,
  discount_amount: nullableNumberText.optional(),
  charge_amount: nullableNumberText.optional(),
  freight_amount: nullableNumberText.optional(),
  tax_amount: nullableNumberText,
  total_amount: nullableNumberText,
  raw_fields: z.array(RawFieldSchema).optional(),
  raw_tables: z.array(RawTableSchema).optional(),
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

const rawFieldJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    value: { type: "string" },
    section: nullableStringSchema,
    page: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] }
  },
  required: ["label", "value", "section", "page"]
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
    document_number: nullableStringSchema,
    reference_number: nullableStringSchema,
    buyer_code: nullableStringSchema,
    supplier_code: nullableStringSchema,
    buyer_tax_id: nullableStringSchema,
    supplier_tax_id: nullableStringSchema,
    order_contact: nullableStringSchema,
    contact_phone: nullableStringSchema,
    contact_email: nullableStringSchema,
    bill_to_address: nullableStringSchema,
    ship_to_address: nullableStringSchema,
    warehouse_code: nullableStringSchema,
    warehouse_name: nullableStringSchema,
    department: nullableStringSchema,
    payment_terms: nullableStringSchema,
    payment_method: nullableStringSchema,
    delivery_method: nullableStringSchema,
    delivery_window: nullableStringSchema,
    price_list_name: nullableStringSchema,
    price_includes_tax: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    subtotal_amount: nullableNumberStringSchema,
    discount_amount: nullableNumberStringSchema,
    charge_amount: nullableNumberStringSchema,
    freight_amount: nullableNumberStringSchema,
    tax_amount: nullableNumberStringSchema,
    total_amount: nullableNumberStringSchema,
    raw_fields: { type: "array", items: rawFieldJsonSchema },
    raw_tables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: nullableStringSchema,
          page: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          headers: { type: "array", items: { type: "string" } },
          rows: {
            type: "array",
            items: { type: "array", items: { type: "string" } }
          }
        },
        required: ["title", "page", "headers", "rows"]
      }
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          line_no: { type: "integer", minimum: 1 },
          po_number: nullableStringSchema,
          po_date: nullableStringSchema,
          store_code: nullableStringSchema,
          store_name: nullableStringSchema,
          delivery_address: nullableStringSchema,
          product_code: nullableStringSchema,
          vendor_product_code: nullableStringSchema,
          barcode: nullableStringSchema,
          product_name: nullableStringSchema,
          model: nullableStringSchema,
          article_code: nullableStringSchema,
          sku: nullableStringSchema,
          ou_type: nullableStringSchema,
          quantity: nullableNumberStringSchema,
          free_quantity: nullableNumberStringSchema,
          units_per_order_unit: nullableNumberStringSchema,
          unit: nullableStringSchema,
          list_price: nullableNumberStringSchema,
          unit_price: nullableNumberStringSchema,
          discount_percent: nullableNumberStringSchema,
          discount_amount: nullableNumberStringSchema,
          vat_rate: nullableNumberStringSchema,
          tax_amount: nullableNumberStringSchema,
          amount: nullableNumberStringSchema,
          gross_amount: nullableNumberStringSchema,
          promised_date: nullableStringSchema,
          warehouse_code: nullableStringSchema,
          warehouse_name: nullableStringSchema,
          extra_fields: { type: "array", items: rawFieldJsonSchema },
          source_page: {
            anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }]
          },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: [
          "line_no", "po_number", "po_date", "store_code", "store_name", "delivery_address",
          "product_code", "vendor_product_code", "barcode",
          "product_name", "model", "article_code", "sku", "ou_type", "quantity",
          "free_quantity", "units_per_order_unit", "unit", "list_price", "unit_price",
          "discount_percent", "discount_amount", "vat_rate", "tax_amount", "amount",
          "gross_amount", "promised_date", "warehouse_code", "warehouse_name", "extra_fields",
          "source_page", "confidence"
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
    "delivery_address", "document_number", "reference_number", "buyer_code", "supplier_code",
    "buyer_tax_id", "supplier_tax_id", "order_contact", "contact_phone", "contact_email",
    "bill_to_address", "ship_to_address", "warehouse_code", "warehouse_name", "department",
    "payment_terms", "payment_method", "delivery_method", "delivery_window", "price_list_name",
    "price_includes_tax", "subtotal_amount", "discount_amount", "charge_amount", "freight_amount",
    "tax_amount", "total_amount", "raw_fields", "raw_tables", "items", "warnings", "confidence"
  ]
} as const;

export type DocumentStatus =
  | "queued"
  | "preprocessing"
  | "ocr_running"
  | "validating"
  | "completed"
  | "needs_review"
  | "Chưa xác nhận"
  | "publishing"
  | "published"
  | "publish_failed"
  | "failed";

export interface DocumentRow {
  id: string;
  batch_id: string;
  batch_position: number;
  original_name: string;
  stored_name: string;
  storage_path: string;
  upload_url?: string | null;
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
