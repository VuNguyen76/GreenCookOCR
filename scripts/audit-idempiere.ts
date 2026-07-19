import { pool } from "../src/server/db/pool.js";

interface CandidateColumn {
  table_name: string;
  column_name: string;
  data_type: string;
}

try {
  const [metadata, kgTables, candidateColumns, poCatalog, metadataIssues, detailFields, detailRows, userDefColumns, issueRows] = await Promise.all([
    pool.query(`
      SELECT
        win.ad_window_id::text,
        win.name AS window_name,
        tab.ad_tab_id::text,
        tab.name AS tab_name,
        tab.seqno,
        tab.tablevel,
        tab.ad_table_id::text,
        table_meta.tablename,
        table_meta.name AS table_name,
        table_meta.isactive AS table_active,
        to_regclass('adempiere.' || table_meta.tablename)::text AS physical_table
      FROM adempiere.ad_window win
      LEFT JOIN adempiere.ad_tab tab ON tab.ad_window_id = win.ad_window_id
      LEFT JOIN adempiere.ad_table table_meta ON table_meta.ad_table_id = tab.ad_table_id
      WHERE win.entitytype = 'KG'
      ORDER BY win.ad_window_id, tab.seqno, tab.ad_tab_id
    `),
    pool.query(`
      SELECT
        table_name,
        string_agg(column_name, ', ' ORDER BY ordinal_position) AS columns
      FROM information_schema.columns
      WHERE table_schema = 'adempiere' AND table_name LIKE 'kg\\_%' ESCAPE '\\'
      GROUP BY table_name
      ORDER BY table_name
    `),
    pool.query<CandidateColumn>(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'adempiere'
        AND (table_name LIKE 'kg\\_%' ESCAPE '\\' OR table_name = 'c_order')
        AND (
          column_name ~* '(^|_)(po|purchase)(_.*|$)'
          OR column_name ~* 'poreference|ponumber'
        )
      ORDER BY table_name, ordinal_position
    `),
    pool.query(`
      SELECT
        count(*)::int AS total_rows,
        count(*) FILTER (WHERE value IS NOT NULL AND btrim(value) <> '')::int AS po_rows,
        count(DISTINCT ad_client_id)::int AS clients,
        count(*) FILTER (WHERE isactive = 'Y')::int AS active_rows
      FROM adempiere.kg_po
    `),
    pool.query(`
      SELECT 'Tab khong co AD_Table' AS issue, count(*)::int AS count
      FROM adempiere.ad_tab tab
      LEFT JOIN adempiere.ad_table table_meta ON table_meta.ad_table_id = tab.ad_table_id
      WHERE tab.ad_window_id IN (
        SELECT ad_window_id FROM adempiere.ad_window WHERE entitytype = 'KG'
      ) AND table_meta.ad_table_id IS NULL
      UNION ALL
      SELECT 'Field khong co AD_Column', count(*)::int
      FROM adempiere.ad_field field
      JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
      LEFT JOIN adempiere.ad_column column_meta ON column_meta.ad_column_id = field.ad_column_id
      WHERE tab.ad_window_id IN (
        SELECT ad_window_id FROM adempiere.ad_window WHERE entitytype = 'KG'
      ) AND column_meta.ad_column_id IS NULL
      UNION ALL
      SELECT 'Field khac bang voi Tab', count(*)::int
      FROM adempiere.ad_field field
      JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
      JOIN adempiere.ad_column column_meta ON column_meta.ad_column_id = field.ad_column_id
      WHERE tab.ad_window_id IN (
        SELECT ad_window_id FROM adempiere.ad_window WHERE entitytype = 'KG'
      ) AND column_meta.ad_table_id <> tab.ad_table_id
      UNION ALL
      SELECT 'Bang khong co cot khoa', count(*)::int
      FROM adempiere.ad_tab tab
      JOIN adempiere.ad_table table_meta ON table_meta.ad_table_id = tab.ad_table_id
      WHERE tab.ad_window_id IN (
        SELECT ad_window_id FROM adempiere.ad_window WHERE entitytype = 'KG'
      ) AND NOT EXISTS (
        SELECT 1 FROM adempiere.ad_column column_meta
        WHERE column_meta.ad_table_id = table_meta.ad_table_id
          AND column_meta.iskey = 'Y' AND column_meta.isactive = 'Y'
      )
    `),
    pool.query(`
      SELECT field.ad_field_id::text, field.name AS field_name, field.seqno,
             field.isdisplayed, field.seqnogrid, field.isdisplayedgrid,
             field.isactive AS field_active,
             column_meta.ad_column_id::text, column_meta.columnname,
             column_meta.ad_reference_id::text, column_meta.ad_reference_value_id::text,
             column_meta.iskey, column_meta.isparent, column_meta.ismandatory,
             table_meta.tablename
      FROM adempiere.ad_field field
      JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
      JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
      JOIN adempiere.ad_column column_meta ON column_meta.ad_column_id = field.ad_column_id
      JOIN adempiere.ad_table table_meta ON table_meta.ad_table_id = column_meta.ad_table_id
      WHERE win.name = 'Đơn Đặt Hàng' AND tab.name = 'Sản phẩm đơn hàng'
      ORDER BY field.isdisplayed DESC, field.seqno, column_meta.columnname
    `),
    pool.query(`
      SELECT kg_detail_id::text, kg_order_id::text, kg_sp_id::text,
             c_uom_id::text, model, product_code, barcode, product_name,
             quantity::text, unit_name
      FROM adempiere.kg_detail
      ORDER BY updated DESC, kg_detail_id
      LIMIT 10
    `),
    pool.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'adempiere'
        AND table_name IN ('ad_userdef_win', 'ad_userdef_tab', 'ad_userdef_field')
      ORDER BY table_name, ordinal_position
    `),
    pool.query(`
      SELECT ad_issue_id::text, created::text, issuesummary,
             sourceclassname, sourcemethodname, lineno::text,
             left(stacktrace, 1500) AS stacktrace,
             left(errortrace, 1500) AS errortrace
      FROM adempiere.ad_issue
      WHERE created >= now() - interval '7 days'
        AND (
          issuesummary ILIKE '%Cannot invoke%'
          OR stacktrace ILIKE '%getKeyColumns%'
          OR errortrace ILIKE '%getKeyColumns%'
        )
      ORDER BY created DESC
      LIMIT 10
    `)
  ]);

  console.log("\n=== Metadata Window/Tab KG ===");
  console.table(metadata.rows);

  console.log("\n=== Bang vat ly tien to kg_ ===");
  console.table(kgTables.rows);

  console.log("\n=== Cot co kha nang chua So PO ===");
  console.table(candidateColumns.rows);

  console.log("\n=== Danh muc PO chuan kg_po.value ===");
  console.table(poCatalog.rows);
  const poSamples = await pool.query(`
    SELECT kg_po_id::text, ad_client_id::text, value, isactive, ngay::text
    FROM adempiere.kg_po
    WHERE value IS NOT NULL AND btrim(value) <> ''
    ORDER BY updated DESC
    LIMIT 10
  `);
  console.table(poSamples.rows);

  console.log("\n=== Kiem tra lien ket metadata ===");
  console.table(metadataIssues.rows);

  console.log("\n=== Field cua tab San pham don hang ===");
  console.table(detailFields.rows);

  console.log("\n=== Du lieu kg_detail gan nhat ===");
  console.table(detailRows.rows);

  const tableDirectTargets = await pool.query(`
    WITH refs AS (
      SELECT column_meta.columnname,
             regexp_replace(column_meta.columnname, '_ID$', '', 'i') AS target_table
      FROM adempiere.ad_column column_meta
      WHERE column_meta.ad_table_id IN (1000237, 1000238)
        AND column_meta.ad_reference_id = 19
    )
    SELECT refs.columnname, refs.target_table,
           table_meta.ad_table_id::text, table_meta.tablename,
           table_meta.isactive,
           count(key_column.ad_column_id)::int AS key_columns,
           count(identifier_column.ad_column_id)::int AS identifier_columns
    FROM refs
    LEFT JOIN adempiere.ad_table table_meta
      ON lower(table_meta.tablename) = lower(refs.target_table)
    LEFT JOIN adempiere.ad_column key_column
      ON key_column.ad_table_id = table_meta.ad_table_id
     AND key_column.iskey = 'Y' AND key_column.isactive = 'Y'
    LEFT JOIN adempiere.ad_column identifier_column
      ON identifier_column.ad_table_id = table_meta.ad_table_id
     AND identifier_column.isidentifier = 'Y' AND identifier_column.isactive = 'Y'
    GROUP BY refs.columnname, refs.target_table, table_meta.ad_table_id,
             table_meta.tablename, table_meta.isactive
    ORDER BY refs.columnname
  `);
  console.log("\n=== Dich Table Direct cua Window Don Dat Hang ===");
  console.table(tableDirectTargets.rows);

  const auditUserReferences = await pool.query(`
    SELECT table_meta.tablename, column_meta.columnname,
           column_meta.ad_reference_id::text,
           column_meta.ad_reference_value_id::text,
           reference_meta.name AS reference_name
    FROM adempiere.ad_column column_meta
    JOIN adempiere.ad_table table_meta
      ON table_meta.ad_table_id = column_meta.ad_table_id
    LEFT JOIN adempiere.ad_reference reference_meta
      ON reference_meta.ad_reference_id = column_meta.ad_reference_value_id
    WHERE lower(table_meta.tablename) IN ('c_order', 'kg_order', 'kg_detail')
      AND lower(column_meta.columnname) IN ('createdby', 'updatedby')
    ORDER BY table_meta.tablename, column_meta.columnname
  `);
  console.log("\n=== Tham chieu CreatedBy va UpdatedBy ===");
  console.table(auditUserReferences.rows);

  console.log("\n=== Cot cau hinh layout ca nhan ===");
  console.table(userDefColumns.rows);

  const userDefWindows = await pool.query(`
    SELECT *
    FROM adempiere.ad_userdef_win
    WHERE ad_window_id = 1000110
    ORDER BY updated DESC
  `);
  console.log("\n=== Layout ca nhan cua Window Don Dat Hang ===");
  console.table(userDefWindows.rows);

  const userDefTabs = await pool.query(`
    SELECT *
    FROM adempiere.ad_userdef_tab
    WHERE ad_tab_id IN (1000194, 1000195)
       OR ad_userdef_win_id IN (
         SELECT ad_userdef_win_id
         FROM adempiere.ad_userdef_win
         WHERE ad_window_id = 1000110
       )
    ORDER BY updated DESC
  `);
  console.log("\n=== Layout ca nhan cua cac Tab Don Dat Hang ===");
  console.table(userDefTabs.rows);

  const userDefFields = await pool.query(`
    SELECT field.*
    FROM adempiere.ad_userdef_field field
    WHERE field.ad_field_id IN (
      SELECT ad_field_id
      FROM adempiere.ad_field
      WHERE ad_tab_id IN (1000194, 1000195)
    )
       OR field.ad_userdef_tab_id IN (
         SELECT ad_userdef_tab_id
         FROM adempiere.ad_userdef_tab
         WHERE ad_tab_id IN (1000194, 1000195)
            OR ad_userdef_win_id IN (
              SELECT ad_userdef_win_id
              FROM adempiere.ad_userdef_win
              WHERE ad_window_id = 1000110
            )
       )
    ORDER BY field.updated DESC
  `);
  console.log("\n=== Field layout ca nhan cua Window Don Dat Hang ===");
  console.table(userDefFields.rows);

  console.log("\n=== AD_Issue gan day lien quan MTable ===");
  console.dir(issueRows.rows, { depth: null });

  console.log("\n=== Mau So PO dang co du lieu ===");
  for (const candidate of candidateColumns.rows) {
    const table = quoteIdentifier(candidate.table_name);
    const column = quoteIdentifier(candidate.column_name);
    const sample = await pool.query(`
      SELECT ${column}::text AS value
      FROM adempiere.${table}
      WHERE ${column} IS NOT NULL AND btrim(${column}::text) <> ''
      LIMIT 5
    `);
    if (sample.rows.length) {
      console.log(`${candidate.table_name}.${candidate.column_name}:`, sample.rows.map((row) => row.value));
    }
  }
} finally {
  await pool.end();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
