import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

const SYSTEM_USER_ID = 100;
const ENTITY_TYPE = "KG";

interface ColumnSpec {
  columnName: string;
  name: string;
  referenceId: number;
  fieldLength: number;
  mandatory?: boolean;
  key?: boolean;
  parent?: boolean;
  identifier?: boolean;
  updateable?: boolean;
  defaultValue?: string;
  valRuleId?: number;
  displayed?: boolean;
  fieldSeq?: number;
  sameLine?: boolean;
}

const STANDARD_COLUMNS: ColumnSpec[] = [
  { columnName: "AD_Client_ID", name: "Tenant", referenceId: 19, fieldLength: 10, mandatory: true, updateable: false },
  { columnName: "AD_Org_ID", name: "Organization", referenceId: 19, fieldLength: 10, mandatory: true, defaultValue: "0" },
  { columnName: "IsActive", name: "Kích hoạt", referenceId: 20, fieldLength: 1, mandatory: true, defaultValue: "Y" },
  { columnName: "Created", name: "Created", referenceId: 16, fieldLength: 29, mandatory: true, updateable: false, defaultValue: "SYSDATE" },
  { columnName: "CreatedBy", name: "Created By", referenceId: 30, fieldLength: 10, mandatory: true, updateable: false },
  { columnName: "Updated", name: "Updated", referenceId: 16, fieldLength: 29, mandatory: true, updateable: false, defaultValue: "SYSDATE" },
  { columnName: "UpdatedBy", name: "Updated By", referenceId: 30, fieldLength: 10, mandatory: true, updateable: false }
];

const ORDER_COLUMNS: ColumnSpec[] = [
  { columnName: "KG_Order_ID", name: "Đơn hàng OCR", referenceId: 13, fieldLength: 10, mandatory: true, key: true, updateable: false },
  ...STANDARD_COLUMNS,
  { columnName: "Value", name: "Số PO", referenceId: 10, fieldLength: 60, mandatory: true, identifier: true, displayed: true, fieldSeq: 10 },
  { columnName: "C_BPartner_ID", name: "Khách hàng", referenceId: 30, fieldLength: 10, mandatory: false, valRuleId: 230, displayed: true, fieldSeq: 20 },
  { columnName: "PO_Date", name: "Ngày PO", referenceId: 15, fieldLength: 7, displayed: true, fieldSeq: 30 },
  { columnName: "Delivery_Date", name: "Ngày giao", referenceId: 15, fieldLength: 7, displayed: true, fieldSeq: 40, sameLine: true },
  { columnName: "DocStatus", name: "Trạng thái", referenceId: 10, fieldLength: 2, mandatory: true, defaultValue: "CO", displayed: true, fieldSeq: 50 },
  { columnName: "C_Currency_ID", name: "Tiền tệ", referenceId: 19, fieldLength: 10, mandatory: true, displayed: true, fieldSeq: 60 },
  { columnName: "Subtotal_Amount", name: "Tiền hàng", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 70 },
  { columnName: "Tax_Amount", name: "Tiền thuế", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 80, sameLine: true },
  { columnName: "Total_Amount", name: "Tổng đơn hàng", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 90, sameLine: true },
  { columnName: "Issuer_Name", name: "Đơn vị đặt hàng", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 100 },
  { columnName: "Store_Code", name: "Mã cửa hàng", referenceId: 10, fieldLength: 60, displayed: true, fieldSeq: 110 },
  { columnName: "Store_Name", name: "Tên cửa hàng", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 120, sameLine: true },
  { columnName: "Delivery_Address", name: "Địa chỉ giao hàng", referenceId: 14, fieldLength: 500, displayed: true, fieldSeq: 130 },
  { columnName: "Source_File_Name", name: "File nguồn", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 140 },
  { columnName: "Document_Title", name: "Tiêu đề chứng từ", referenceId: 10, fieldLength: 150, displayed: true, fieldSeq: 150 },
  { columnName: "Template_Key", name: "Mẫu OCR", referenceId: 10, fieldLength: 80, displayed: true, fieldSeq: 160, sameLine: true },
  { columnName: "Confirmed_At", name: "Thời điểm xác nhận", referenceId: 16, fieldLength: 29, mandatory: true, displayed: true, fieldSeq: 170 },
  { columnName: "Description", name: "Ghi chú", referenceId: 14, fieldLength: 500, displayed: true, fieldSeq: 180 },
  { columnName: "Source_Document_ID", name: "Mã tài liệu OCR", referenceId: 10, fieldLength: 36 },
  { columnName: "Source_Order_Key", name: "Khóa đơn nguồn", referenceId: 10, fieldLength: 120 },
  { columnName: "Source_SHA256", name: "SHA-256 file nguồn", referenceId: 10, fieldLength: 64 },
  { columnName: "Document_Type", name: "Loại chứng từ", referenceId: 10, fieldLength: 30 }
];

const DETAIL_COLUMNS: ColumnSpec[] = [
  { columnName: "KG_Detail_ID", name: "Chi tiết đơn OCR", referenceId: 13, fieldLength: 10, mandatory: true, key: true, updateable: false },
  ...STANDARD_COLUMNS,
  { columnName: "KG_Order_ID", name: "Đơn hàng OCR", referenceId: 19, fieldLength: 10, mandatory: true, parent: true, displayed: false },
  { columnName: "Line", name: "Dòng", referenceId: 11, fieldLength: 10, mandatory: true, displayed: true, fieldSeq: 10 },
  { columnName: "KG_SP_ID", name: "Sản phẩm", referenceId: 19, fieldLength: 10, mandatory: true, displayed: true, fieldSeq: 20 },
  { columnName: "Barcode", name: "Barcode", referenceId: 10, fieldLength: 32, displayed: true, fieldSeq: 30 },
  { columnName: "Product_Name", name: "Tên sản phẩm nguồn", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 40 },
  { columnName: "Quantity", name: "Số lượng", referenceId: 29, fieldLength: 18, mandatory: true, displayed: true, fieldSeq: 50 },
  { columnName: "Units_Per_Order_Unit", name: "Hệ số quy đổi", referenceId: 29, fieldLength: 18, displayed: true, fieldSeq: 60, sameLine: true },
  { columnName: "C_UOM_ID", name: "Đơn vị", referenceId: 19, fieldLength: 10, valRuleId: 210, displayed: true, fieldSeq: 70 },
  { columnName: "Unit_Price", name: "Đơn giá", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 80 },
  { columnName: "VAT_Rate", name: "Thuế suất", referenceId: 22, fieldLength: 9, displayed: true, fieldSeq: 90, sameLine: true },
  { columnName: "Amount", name: "Thành tiền", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 100, sameLine: true },
  { columnName: "Product_Code", name: "Mã sản phẩm nguồn", referenceId: 10, fieldLength: 60, displayed: true, fieldSeq: 110 },
  { columnName: "Vendor_Product_Code", name: "Mã sản phẩm NCC", referenceId: 10, fieldLength: 60, displayed: true, fieldSeq: 120, sameLine: true },
  { columnName: "Model", name: "Model nguồn", referenceId: 10, fieldLength: 80, displayed: true, fieldSeq: 130 },
  { columnName: "Unit_Name", name: "Đơn vị nguồn", referenceId: 10, fieldLength: 30, displayed: true, fieldSeq: 140, sameLine: true },
  { columnName: "Source_Page", name: "Trang nguồn", referenceId: 11, fieldLength: 10, displayed: true, fieldSeq: 150 },
  { columnName: "Confidence", name: "Độ tin cậy OCR", referenceId: 22, fieldLength: 5, displayed: true, fieldSeq: 160, sameLine: true },
  { columnName: "Description", name: "Ghi chú", referenceId: 14, fieldLength: 500, displayed: true, fieldSeq: 170 }
];

export async function applyIdempiereMigration(): Promise<void> {
  const ddlPath = path.resolve("sql/idempiere/db_structure.sql");
  const ddl = await fs.readFile(ddlPath, "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(ddl);
    await ensureEntityType(client);
    await ensureTableSequence(client, "kg_order");
    await ensureTableSequence(client, "kg_detail");

    const productTableId = await tableId(client, "kg_sp");
    const barcodeColumnId = await ensureColumn(client, productTableId, {
      columnName: "Barcode", name: "Barcode", referenceId: 10, fieldLength: 32,
      displayed: true, fieldSeq: 45
    });
    await ensureField(client, 1000120, barcodeColumnId, "Barcode", 45, false);

    const orderTableId = await ensureTable(client, "kg_order", "Đơn hàng OCR");
    const detailTableId = await ensureTable(client, "kg_detail", "Chi tiết đơn OCR");
    const orderColumns = await ensureColumns(client, orderTableId, ORDER_COLUMNS);
    const detailColumns = await ensureColumns(client, detailTableId, DETAIL_COLUMNS);

    const windowId = await ensureWindow(client);
    const orderTabId = await ensureTab(client, {
      windowId, tableId: orderTableId, name: "Đơn hàng", seqNo: 10,
      tableLevel: 0, singleRow: true, orderBy: "kg_order.PO_Date DESC, kg_order.Value"
    });
    const detailTabId = await ensureTab(client, {
      windowId, tableId: detailTableId, name: "Chi tiết", seqNo: 20,
      tableLevel: 1, singleRow: false,
      linkColumnId: detailColumns.get("kg_order_id"),
      parentColumnId: orderColumns.get("kg_order_id")
    });
    await ensureFields(client, orderTabId, ORDER_COLUMNS, orderColumns);
    await ensureFields(client, detailTabId, DETAIL_COLUMNS, detailColumns);
    await client.query(
      "UPDATE adempiere.ad_table SET ad_window_id = $1, updated = now(), updatedby = $2 WHERE ad_table_id IN ($3, $4)",
      [windowId, SYSTEM_USER_ID, orderTableId, detailTableId]
    );
    await ensureMenu(client, windowId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureEntityType(client: PoolClient): Promise<void> {
  const existing = await client.query("SELECT 1 FROM adempiere.ad_entitytype WHERE entitytype = $1", [ENTITY_TYPE]);
  if (existing.rowCount) return;
  const id = await nextId(client, "AD_EntityType");
  await client.query(`
    INSERT INTO adempiere.ad_entitytype(
      ad_entitytype_id, ad_client_id, ad_org_id, createdby, updatedby,
      entitytype, name, description, version, modelpackage, isactive
    ) VALUES ($1, 0, 0, $2, $2, $3, 'GreenCook OCR',
      'Đối tượng tích hợp GreenCookOCR', '1.0.0', 'vn.greencook.ocr', 'Y')
  `, [id, SYSTEM_USER_ID, ENTITY_TYPE]);
}

async function ensureTableSequence(client: PoolClient, tableName: string): Promise<void> {
  const existing = await client.query(
    "SELECT 1 FROM adempiere.ad_sequence WHERE lower(name) = lower($1)", [tableName]
  );
  if (existing.rowCount) return;
  const id = await nextId(client, "AD_Sequence");
  await client.query(`
    INSERT INTO adempiere.ad_sequence(
      ad_sequence_id, ad_client_id, ad_org_id, createdby, updatedby, name,
      description, incrementno, startno, currentnext, currentnextsys,
      isautosequence, istableid, isaudited, startnewyear, startnewmonth,
      isorglevelsequence, isactive
    ) VALUES ($1, 0, 0, $2, $2, $3, $4, 1, 1000000, 1000000, 200000,
      'Y', 'Y', 'N', 'N', 'N', 'N', 'Y')
  `, [id, SYSTEM_USER_ID, tableName, `Table ${tableName}`]);
}

async function ensureTable(client: PoolClient, tableName: string, name: string): Promise<number> {
  const existing = await client.query<{ ad_table_id: string }>(
    "SELECT ad_table_id FROM adempiere.ad_table WHERE lower(tablename) = lower($1)", [tableName]
  );
  if (existing.rows[0]) return Number(existing.rows[0].ad_table_id);
  const id = await nextId(client, "AD_Table");
  await client.query(`
    INSERT INTO adempiere.ad_table(
      ad_table_id, ad_client_id, ad_org_id, createdby, updatedby,
      name, tablename, accesslevel, entitytype, isactive, isview,
      issecurityenabled, isdeleteable, ishighvolume, ischangelog,
      replicationtype, ispartition
    ) VALUES ($1, 0, 0, $2, $2, $3, $4, '3', $5, 'Y', 'N',
      'N', 'Y', 'N', 'Y', 'L', 'N')
  `, [id, SYSTEM_USER_ID, name, tableName, ENTITY_TYPE]);
  return id;
}

async function tableId(client: PoolClient, tableName: string): Promise<number> {
  const result = await client.query<{ ad_table_id: string }>(
    "SELECT ad_table_id FROM adempiere.ad_table WHERE lower(tablename) = lower($1)", [tableName]
  );
  if (!result.rows[0]) throw new Error(`Không tìm thấy AD_Table ${tableName}`);
  return Number(result.rows[0].ad_table_id);
}

async function ensureColumns(client: PoolClient, tableIdValue: number, specs: ColumnSpec[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const spec of specs) {
    result.set(spec.columnName.toLowerCase(), await ensureColumn(client, tableIdValue, spec));
  }
  return result;
}

async function ensureColumn(client: PoolClient, tableIdValue: number, spec: ColumnSpec): Promise<number> {
  const existing = await client.query<{ ad_column_id: string }>(`
    SELECT ad_column_id FROM adempiere.ad_column
    WHERE ad_table_id = $1 AND lower(columnname) = lower($2)
  `, [tableIdValue, spec.columnName]);
  if (existing.rows[0]) {
    const id = Number(existing.rows[0].ad_column_id);
    await client.query(`
      UPDATE adempiere.ad_column SET
        name = $1, ad_reference_id = $2, ad_val_rule_id = $3, fieldlength = $4,
        defaultvalue = $5, iskey = $6, isparent = $7, ismandatory = $8,
        isupdateable = $9, isidentifier = $10, seqno = $11,
        updated = now(), updatedby = $12
      WHERE ad_column_id = $13
    `, [
      spec.name, spec.referenceId, spec.valRuleId ?? null, spec.fieldLength,
      spec.defaultValue ?? null, yn(spec.key), yn(spec.parent), yn(spec.mandatory),
      spec.updateable === false ? "N" : "Y", yn(spec.identifier), spec.fieldSeq ?? null,
      SYSTEM_USER_ID, id
    ]);
    return id;
  }
  const id = await nextId(client, "AD_Column");
  const elementId = await ensureElement(client, spec.columnName, spec.name);
  await client.query(`
    INSERT INTO adempiere.ad_column(
      ad_column_id, ad_client_id, ad_org_id, createdby, updatedby, name,
      version, columnname, ad_table_id, ad_reference_id, ad_val_rule_id,
      fieldlength, defaultvalue, iskey, isparent, ismandatory, isupdateable,
      isidentifier, seqno, ad_element_id, entitytype, isactive
    ) VALUES (
      $1, 0, 0, $2, $2, $3, 0, $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14, $15, $16, $17, 'Y'
    )
  `, [
    id, SYSTEM_USER_ID, spec.name, spec.columnName, tableIdValue, spec.referenceId,
    spec.valRuleId ?? null, spec.fieldLength, spec.defaultValue ?? null,
    yn(spec.key), yn(spec.parent), yn(spec.mandatory), spec.updateable === false ? "N" : "Y",
    yn(spec.identifier), spec.fieldSeq ?? null, elementId, ENTITY_TYPE
  ]);
  return id;
}

async function ensureElement(client: PoolClient, columnName: string, name: string): Promise<number> {
  const existing = await client.query<{ ad_element_id: string }>(`
    SELECT ad_element_id FROM adempiere.ad_element
    WHERE lower(columnname) = lower($1) ORDER BY ad_element_id LIMIT 1
  `, [columnName]);
  if (existing.rows[0]) return Number(existing.rows[0].ad_element_id);
  const id = await nextId(client, "AD_Element");
  await client.query(`
    INSERT INTO adempiere.ad_element(
      ad_element_id, ad_client_id, ad_org_id, createdby, updatedby,
      columnname, name, printname, entitytype, isactive
    ) VALUES ($1, 0, 0, $2, $2, $3, $4, $4, $5, 'Y')
  `, [id, SYSTEM_USER_ID, columnName, name, ENTITY_TYPE]);
  return id;
}

async function ensureWindow(client: PoolClient): Promise<number> {
  const existing = await client.query<{ ad_window_id: string }>(`
    SELECT ad_window_id FROM adempiere.ad_window
    WHERE name = 'Đơn Hàng OCR' AND entitytype = $1
  `, [ENTITY_TYPE]);
  if (existing.rows[0]) return Number(existing.rows[0].ad_window_id);
  const id = await nextId(client, "AD_Window");
  await client.query(`
    INSERT INTO adempiere.ad_window(
      ad_window_id, ad_client_id, ad_org_id, createdby, updatedby,
      name, description, windowtype, issotrx, entitytype, processing,
      isdefault, isbetafunctionality, isactive
    ) VALUES ($1, 0, 0, $2, $2, 'Đơn Hàng OCR',
      'Đơn hàng đã được xác nhận từ GreenCookOCR', 'M', 'N', $3,
      'N', 'N', 'N', 'Y')
  `, [id, SYSTEM_USER_ID, ENTITY_TYPE]);
  return id;
}

async function ensureTab(client: PoolClient, input: {
  windowId: number;
  tableId: number;
  name: string;
  seqNo: number;
  tableLevel: number;
  singleRow: boolean;
  orderBy?: string;
  linkColumnId?: number;
  parentColumnId?: number;
}): Promise<number> {
  const existing = await client.query<{ ad_tab_id: string }>(`
    SELECT ad_tab_id FROM adempiere.ad_tab
    WHERE ad_window_id = $1 AND ad_table_id = $2
  `, [input.windowId, input.tableId]);
  if (existing.rows[0]) return Number(existing.rows[0].ad_tab_id);
  const id = await nextId(client, "AD_Tab");
  await client.query(`
    INSERT INTO adempiere.ad_tab(
      ad_tab_id, ad_client_id, ad_org_id, createdby, updatedby, name,
      ad_table_id, ad_window_id, seqno, tablevel, issinglerow,
      isreadonly, isinsertrecord, hastree, isinfotab, istranslationtab,
      issorttab, entitytype, processing, orderbyclause, ad_column_id,
      parent_column_id, treedisplayedon, isadvancedtab, isactive
    ) VALUES (
      $1, 0, 0, $2, $2, $3, $4, $5, $6, $7, $8,
      'N', 'Y', 'N', 'N', 'N', 'N', $9, 'N', $10, $11, $12,
      'B', 'N', 'Y'
    )
  `, [
    id, SYSTEM_USER_ID, input.name, input.tableId, input.windowId,
    input.seqNo, input.tableLevel, input.singleRow ? "Y" : "N",
    ENTITY_TYPE, input.orderBy ?? null, input.linkColumnId ?? null,
    input.parentColumnId ?? null
  ]);
  return id;
}

async function ensureFields(
  client: PoolClient,
  tabId: number,
  specs: ColumnSpec[],
  columns: Map<string, number>
): Promise<void> {
  for (const spec of specs) {
    const columnId = columns.get(spec.columnName.toLowerCase());
    if (!columnId) throw new Error(`Thiếu AD_Column ${spec.columnName}`);
    await ensureField(
      client, tabId, columnId, spec.name,
      spec.displayed ? spec.fieldSeq ?? 0 : 0,
      Boolean(spec.sameLine),
      Boolean(spec.displayed)
    );
  }
}

async function ensureField(
  client: PoolClient,
  tabId: number,
  columnId: number,
  name: string,
  seqNo: number,
  sameLine: boolean,
  displayed = true
): Promise<number> {
  const existing = await client.query<{ ad_field_id: string }>(`
    SELECT ad_field_id FROM adempiere.ad_field
    WHERE ad_tab_id = $1 AND ad_column_id = $2
  `, [tabId, columnId]);
  if (existing.rows[0]) {
    await client.query(`
      UPDATE adempiere.ad_field SET name = $1, seqno = $2, isdisplayed = $3,
        issameline = $4, updated = now(), updatedby = $5
      WHERE ad_field_id = $6
    `, [name, seqNo, yn(displayed), yn(sameLine), SYSTEM_USER_ID, existing.rows[0].ad_field_id]);
    return Number(existing.rows[0].ad_field_id);
  }
  const id = await nextId(client, "AD_Field");
  await client.query(`
    INSERT INTO adempiere.ad_field(
      ad_field_id, ad_client_id, ad_org_id, createdby, updatedby,
      name, ad_tab_id, ad_column_id, seqno, isdisplayed, issameline,
      isreadonly, isfieldonly, isheading, iscentrallymaintained,
      entitytype, isactive
    ) VALUES (
      $1, 0, 0, $2, $2, $3, $4, $5, $6, $7, $8,
      'N', 'N', 'N', 'Y', $9, 'Y'
    )
  `, [id, SYSTEM_USER_ID, name, tabId, columnId, seqNo, yn(displayed), yn(sameLine), ENTITY_TYPE]);
  return id;
}

async function ensureMenu(client: PoolClient, windowId: number): Promise<number> {
  const existing = await client.query<{ ad_menu_id: string }>(`
    SELECT ad_menu_id FROM adempiere.ad_menu WHERE ad_window_id = $1
  `, [windowId]);
  let id: number;
  if (existing.rows[0]) {
    id = Number(existing.rows[0].ad_menu_id);
  } else {
    id = await nextId(client, "AD_Menu");
    await client.query(`
      INSERT INTO adempiere.ad_menu(
        ad_menu_id, ad_client_id, ad_org_id, createdby, updatedby,
        name, description, action, ad_window_id, issummary, issotrx,
        isreadonly, iscentrallymaintained, entitytype, isactive
      ) VALUES ($1, 0, 0, $2, $2, 'Đơn Hàng OCR',
        'Đơn hàng được xác nhận từ GreenCookOCR', 'W', $3,
        'N', 'N', 'N', 'Y', $4, 'Y')
    `, [id, SYSTEM_USER_ID, windowId, ENTITY_TYPE]);
  }
  await client.query(`
    INSERT INTO adempiere.ad_treenodemm(
      ad_tree_id, node_id, ad_client_id, ad_org_id, createdby, updatedby,
      parent_id, seqno, isactive
    ) VALUES (10, $1, 0, 0, $2, $2, 0, 999, 'Y')
    ON CONFLICT (ad_tree_id, node_id) DO NOTHING
  `, [id, SYSTEM_USER_ID]);
  return id;
}

async function nextId(client: PoolClient, sequenceName: string): Promise<number> {
  const result = await client.query<{ id: number }>(`
    SELECT adempiere.nextidfunc(ad_sequence_id::integer, 'N') AS id
    FROM adempiere.ad_sequence WHERE lower(name) = lower($1)
  `, [sequenceName]);
  if (!result.rows[0]) throw new Error(`Không tìm thấy sequence ${sequenceName}`);
  return Number(result.rows[0].id);
}

function yn(value: boolean | undefined): "Y" | "N" {
  return value ? "Y" : "N";
}
