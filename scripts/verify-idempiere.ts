import { pool } from "../src/server/db/pool.js";

interface Check {
  name: string;
  sql: string;
  minimum: number;
}

const checks: Check[] = [
  {
    name: "Cột Barcode trên kg_sp",
    sql: `SELECT count(*)::int AS count FROM information_schema.columns
          WHERE table_schema = 'adempiere' AND table_name = 'kg_sp' AND column_name = 'barcode'`,
    minimum: 1
  },
  {
    name: "Bảng kg_order và kg_detail",
    sql: `SELECT count(*)::int AS count FROM information_schema.tables
          WHERE table_schema = 'adempiere' AND table_name IN ('kg_order', 'kg_detail')`,
    minimum: 2
  },
  {
    name: "Khóa ngoại chi tiết đơn hàng",
    sql: `SELECT count(*)::int AS count FROM information_schema.table_constraints
          WHERE constraint_schema = 'adempiere' AND table_name = 'kg_detail'
            AND constraint_type = 'FOREIGN KEY'`,
    minimum: 3
  },
  {
    name: "Đối tác là liên kết tùy chọn",
    sql: `SELECT count(*)::int AS count FROM information_schema.columns
          WHERE table_schema = 'adempiere' AND table_name = 'kg_order'
            AND column_name = 'c_bpartner_id' AND is_nullable = 'YES'`,
    minimum: 1
  },
  {
    name: "Khóa chống publish trùng file",
    sql: `SELECT count(*)::int AS count FROM pg_indexes
          WHERE schemaname = 'adempiere' AND tablename = 'kg_order'
            AND indexname = 'kg_order_source_file_uq'`,
    minimum: 1
  },
  {
    name: "Entity Type KG",
    sql: `SELECT count(*)::int AS count FROM adempiere.ad_entitytype WHERE entitytype = 'KG'`,
    minimum: 1
  },
  {
    name: "Data Dictionary cho hai bảng",
    sql: `SELECT count(*)::int AS count FROM adempiere.ad_table
          WHERE lower(tablename) IN ('kg_order', 'kg_detail') AND entitytype = 'KG'`,
    minimum: 2
  },
  {
    name: "Window Đơn Hàng OCR",
    sql: `SELECT count(*)::int AS count FROM adempiere.ad_window
          WHERE name = 'Đơn Hàng OCR' AND entitytype = 'KG'`,
    minimum: 1
  },
  {
    name: "Hai tab header-detail",
    sql: `SELECT count(*)::int AS count FROM adempiere.ad_tab tab
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          WHERE win.name = 'Đơn Hàng OCR' AND tab.name IN ('Đơn hàng', 'Chi tiết')`,
    minimum: 2
  },
  {
    name: "Các field hiển thị trong Window",
    sql: `SELECT count(*)::int AS count FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          WHERE win.name = 'Đơn Hàng OCR' AND field.isdisplayed = 'Y'`,
    minimum: 20
  },
  {
    name: "Metadata đối tác không bắt buộc",
    sql: `SELECT count(*)::int AS count FROM adempiere.ad_column column_meta
          JOIN adempiere.ad_table table_meta ON table_meta.ad_table_id = column_meta.ad_table_id
          WHERE lower(table_meta.tablename) = 'kg_order'
            AND lower(column_meta.columnname) = 'c_bpartner_id'
            AND column_meta.ismandatory = 'N'`,
    minimum: 1
  },
  {
    name: "Menu trong cây chính",
    sql: `SELECT count(*)::int AS count FROM adempiere.ad_treenodemm node
          JOIN adempiere.ad_menu menu ON menu.ad_menu_id = node.node_id
          WHERE node.ad_tree_id = 10 AND menu.name = 'Đơn Hàng OCR'`,
    minimum: 1
  },
  {
    name: "Field Barcode trong cửa sổ sản phẩm",
    sql: `SELECT count(*)::int AS count FROM adempiere.ad_field field
          JOIN adempiere.ad_column column_meta ON column_meta.ad_column_id = field.ad_column_id
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          WHERE win.name = 'DM Sản Phẩm' AND lower(column_meta.columnname) = 'barcode'`,
    minimum: 1
  }
];

try {
  let failed = false;
  for (const check of checks) {
    const result = await pool.query<{ count: number }>(check.sql);
    const count = Number(result.rows[0]?.count ?? 0);
    const passed = count >= check.minimum;
    console.log(`${passed ? "OK" : "FAIL"} | ${check.name} | ${count}`);
    failed ||= !passed;
  }
  if (failed) process.exitCode = 1;
} finally {
  await pool.end();
}
