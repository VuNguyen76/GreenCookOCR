import { pool } from "../src/server/db/pool.js";

interface Check {
  name: string;
  sql: string;
  expected?: number;
  minimum?: number;
}

const orderSourceColumns = [
  "kg_source_document_id", "kg_source_file_name", "kg_source_payload", "kg_source_sha256",
  "kg_document_title", "kg_document_type", "kg_currency_text", "kg_template_key", "kg_issuer_name",
  "kg_issuer_branch", "kg_supplier_name", "kg_buyer_name", "kg_document_number",
  "kg_reference_number", "kg_buyer_code", "kg_supplier_code", "kg_buyer_tax_id",
  "kg_supplier_tax_id", "kg_order_contact", "kg_contact_phone", "kg_contact_email",
  "kg_delivery_address", "kg_bill_to_address", "kg_ship_to_address", "kg_store_code",
  "kg_store_name", "kg_warehouse_code", "kg_warehouse_name", "kg_department",
  "kg_payment_terms", "kg_payment_method", "kg_delivery_method", "kg_delivery_window",
  "kg_price_list_name", "kg_price_includes_tax", "kg_print_date", "kg_print_time",
  "kg_form_type", "kg_approved_by", "kg_industry_code", "kg_contract_number",
  "kg_subtotal_amount", "kg_discount_amount", "kg_tax_amount", "kg_total_amount",
  "kg_confidence", "kg_warnings", "kg_extra_fields"
];

const lineSourceColumns = [
  "kg_sp_id", "kg_source_line_id", "kg_line_source_payload", "kg_product_code",
  "kg_vendor_product_code", "kg_barcode", "kg_product_name", "kg_model",
  "kg_article_code", "kg_sku", "kg_ou_type", "kg_free_quantity",
  "kg_units_per_order_unit", "kg_unit_name", "kg_list_price", "kg_unit_price",
  "kg_discount_percent", "kg_discount_amount", "kg_vat_rate", "kg_tax_amount",
  "kg_amount", "kg_gross_amount", "kg_source_page", "kg_confidence",
  "kg_warehouse_code", "kg_warehouse_name", "kg_extra_fields"
];

const coreOrderColumns = [
  "kg_source_file_name", "kg_document_title", "kg_document_type",
  "kg_issuer_name", "kg_supplier_name", "kg_buyer_name",
  "kg_order_contact", "kg_delivery_address", "kg_store_code", "kg_store_name",
  "kg_warehouse_code", "kg_warehouse_name",
  "kg_subtotal_amount", "kg_discount_amount", "kg_tax_amount",
  "kg_total_amount"
];
const coreLineColumns = [
  "kg_product_code", "kg_barcode", "kg_product_name", "kg_units_per_order_unit",
  "kg_unit_name", "kg_unit_price", "kg_discount_percent", "kg_discount_amount",
  "kg_vat_rate", "kg_tax_amount", "kg_amount", "kg_gross_amount",
  "kg_warehouse_code", "kg_warehouse_name", "kg_source_page"
];
const editableOrderColumns = coreOrderColumns;
const editableLineColumns = coreLineColumns;

const sqlList = (values: string[]) => values.map((value) => `'${value}'`).join(", ");

const checks: Check[] = [
  {
    name: "Window Đơn Đặt Hàng dùng đúng C_Order/C_OrderLine",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_tab tab
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = tab.ad_table_id
          WHERE win.name = 'Đơn Đặt Hàng' AND win.entitytype = 'KG'
            AND tab.isactive = 'Y'
            AND lower(tablemeta.tablename) IN ('c_order', 'c_orderline')`,
    expected: 2
  },
  {
    name: "Không còn tab legacy hoạt động",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_tab tab
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = tab.ad_table_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND lower(tablemeta.tablename) IN ('kg_order', 'kg_detail')`,
    expected: 0
  },
  {
    name: "Đủ cột chứng từ vật lý trên C_Order",
    sql: `SELECT count(*)::int AS count FROM information_schema.columns
          WHERE table_schema = 'adempiere' AND table_name = 'c_order'
            AND column_name IN (${sqlList(orderSourceColumns)})`,
    expected: orderSourceColumns.length
  },
  {
    name: "Đủ cột chứng từ vật lý trên C_OrderLine",
    sql: `SELECT count(*)::int AS count FROM information_schema.columns
          WHERE table_schema = 'adempiere' AND table_name = 'c_orderline'
            AND column_name IN (${sqlList(lineSourceColumns)})`,
    expected: lineSourceColumns.length
  },
  {
    name: "Đủ AD_Column chứng từ trên C_Order",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_column columnmeta
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = columnmeta.ad_table_id
          WHERE lower(tablemeta.tablename) = 'c_order' AND columnmeta.isactive = 'Y'
            AND lower(columnmeta.columnname) IN (${sqlList(orderSourceColumns)})`,
    expected: orderSourceColumns.length
  },
  {
    name: "Đủ AD_Column chứng từ trên C_OrderLine",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_column columnmeta
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = columnmeta.ad_table_id
          WHERE lower(tablemeta.tablename) = 'c_orderline' AND columnmeta.isactive = 'Y'
            AND lower(columnmeta.columnname) IN (${sqlList(lineSourceColumns)})`,
    expected: lineSourceColumns.length
  },
  {
    name: "Field core đầu đơn hiển thị và cho phép sửa",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_column columnmeta ON columnmeta.ad_column_id = field.ad_column_id
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = tab.ad_table_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND lower(tablemeta.tablename) = 'c_order'
            AND lower(columnmeta.columnname) IN (${sqlList(editableOrderColumns)})
            AND field.isactive = 'Y' AND field.isdisplayed = 'Y'
            AND field.isreadonly = 'N' AND columnmeta.isupdateable = 'Y'
            AND field.isalwaysupdateable = 'Y' AND columnmeta.isalwaysupdateable = 'Y'`,
    expected: editableOrderColumns.length
  },
  {
    name: "Field core dòng hàng hiển thị và cho phép sửa",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_column columnmeta ON columnmeta.ad_column_id = field.ad_column_id
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = tab.ad_table_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND lower(tablemeta.tablename) = 'c_orderline'
            AND lower(columnmeta.columnname) IN (${sqlList(editableLineColumns)})
            AND field.isactive = 'Y' AND field.isdisplayed = 'Y'
            AND field.isreadonly = 'N' AND columnmeta.isupdateable = 'Y'
            AND field.isalwaysupdateable = 'Y' AND columnmeta.isalwaysupdateable = 'Y'`,
    expected: editableLineColumns.length
  },
  {
    name: "Tab header-detail liên kết bằng C_Order_ID",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_tab detail
          JOIN adempiere.ad_window win ON win.ad_window_id = detail.ad_window_id
          JOIN adempiere.ad_column linkcol ON linkcol.ad_column_id = detail.ad_column_id
          WHERE win.name = 'Đơn Đặt Hàng' AND detail.name = 'Sản phẩm đơn hàng'
            AND detail.isactive = 'Y' AND lower(linkcol.columnname) = 'c_order_id'
            AND detail.tablevel = 1`,
    expected: 1
  },
  {
    name: "Tab đầu đơn chỉ hiển thị giao dịch mua",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_tab tab
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = tab.ad_table_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND lower(tablemeta.tablename) = 'c_order'
            AND regexp_replace(lower(coalesce(tab.whereclause, '')), '\\s', '', 'g')
              = 'c_order.issotrx=''n'''`,
    expected: 1
  },
  {
    name: "Đủ field chuẩn của Purchase Order trên đầu đơn",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_column columnmeta ON columnmeta.ad_column_id = field.ad_column_id
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = tab.ad_table_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND lower(tablemeta.tablename) = 'c_order'
            AND field.isactive = 'Y' AND field.isdisplayed = 'Y'
            AND lower(columnmeta.columnname) NOT LIKE 'kg\\_%' ESCAPE '\\'`,
    expected: 4
  },
  {
    name: "Các field nghiệp vụ chuẩn đầu đơn cho phép sửa",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_column columnmeta ON columnmeta.ad_column_id = field.ad_column_id
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = tab.ad_table_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND lower(tablemeta.tablename) = 'c_order'
            AND field.isactive = 'Y' AND field.isdisplayed = 'Y'
            AND field.isreadonly = 'N' AND columnmeta.isupdateable = 'Y'
            AND field.isalwaysupdateable = 'Y' AND columnmeta.isalwaysupdateable = 'Y'
            AND lower(columnmeta.columnname) IN ('poreference', 'dateordered', 'datepromised')`,
    expected: 3
  },
  {
    name: "Các field chuẩn dòng sản phẩm đều cho phép sửa",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_column columnmeta ON columnmeta.ad_column_id = field.ad_column_id
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = tab.ad_table_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND lower(tablemeta.tablename) = 'c_orderline'
            AND field.isactive = 'Y' AND field.isdisplayed = 'Y'
            AND field.isreadonly = 'N' AND columnmeta.isupdateable = 'Y'
            AND field.isalwaysupdateable = 'Y' AND columnmeta.isalwaysupdateable = 'Y'
            AND lower(columnmeta.columnname) IN ('line', 'qtyentered', 'datepromised')`,
    expected: 3
  },
  {
    name: "Đầu đơn được chia đủ nhóm giao diện",
    sql: `SELECT count(DISTINCT field.ad_fieldgroup_id)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = tab.ad_table_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND lower(tablemeta.tablename) = 'c_order'
            AND field.isactive = 'Y' AND field.isdisplayed = 'Y'`,
    expected: 3
  },
  {
    name: "Dòng sản phẩm được chia đủ nhóm giao diện",
    sql: `SELECT count(DISTINCT field.ad_fieldgroup_id)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = tab.ad_table_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND lower(tablemeta.tablename) = 'c_orderline'
            AND field.isactive = 'Y' AND field.isdisplayed = 'Y'`,
    expected: 3
  },
  {
    name: "Không còn field hiển thị nằm ngoài nhóm giao diện",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND field.isactive = 'Y' AND field.isdisplayed = 'Y'
            AND field.ad_fieldgroup_id IS NULL`,
    expected: 0
  },
  {
    name: "Khong con field hien thi trung ten cot trong Window",
    sql: `SELECT count(*)::int AS count
          FROM (
            SELECT field.ad_tab_id, lower(columnmeta.columnname) AS column_name
            FROM adempiere.ad_field field
            JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
            JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
            JOIN adempiere.ad_column columnmeta ON columnmeta.ad_column_id = field.ad_column_id
            WHERE win.name = 'ÄÆ¡n Äáº·t HÃ ng'
              AND tab.isactive = 'Y'
              AND field.isactive = 'Y'
              AND field.isdisplayed = 'Y'
            GROUP BY field.ad_tab_id, lower(columnmeta.columnname)
            HAVING count(*) > 1
          ) duplicate_fields`,
    expected: 0
  },
  {
    name: "Field tien te he thong duoc an khoi UI",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_column columnmeta ON columnmeta.ad_column_id = field.ad_column_id
          JOIN adempiere.ad_table tablemeta ON tablemeta.ad_table_id = tab.ad_table_id
          WHERE win.entitytype = 'KG'
            AND win.name LIKE '%Hàng'
            AND lower(tablemeta.tablename) = 'c_order'
            AND tab.ad_table_id = columnmeta.ad_table_id
            AND field.isactive = 'Y'
            AND field.isdisplayed = 'Y'
            AND lower(columnmeta.columnname) = 'c_currency_id'`,
    expected: 0
  },
  {
    name: "Không hiển thị workflow và trạng thái thừa",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_column columnmeta ON columnmeta.ad_column_id = field.ad_column_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND field.isactive = 'Y' AND field.isdisplayed = 'Y'
            AND lower(columnmeta.columnname) IN (
              'docstatus', 'docaction', 'processed', 'posted', 'isapproved',
              'isdelivered', 'isinvoiced', 'isprinted', 'istransferred'
            )`,
    expected: 0
  },
  {
    name: "Hai tab cho phép thêm và sửa",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_tab tab
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND tab.isreadonly = 'N' AND tab.isinsertrecord = 'Y'`,
    expected: 2
  },
  {
    name: "Hai bảng cho phép xóa bản ghi",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_table
          WHERE lower(tablename) IN ('c_order', 'c_orderline')
            AND isactive = 'Y' AND isdeleteable = 'Y'`,
    expected: 2
  },
  {
    name: "Role SAIGONADMIN khong con Table Access include lam trang menu",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_table_access access
          JOIN adempiere.ad_role rolemeta ON rolemeta.ad_role_id = access.ad_role_id
          WHERE access.accesstyperule = 'A'
            AND regexp_replace(upper(rolemeta.name), '[^A-Z0-9]', '', 'g')
              IN ('SAIGONADMIN', 'SAIGONCOMMADMIN')`,
    expected: 0
  },
  {
    name: "Role SAIGONADMIN duoc sua xoa moi org trong tenant",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_role rolemeta
          WHERE regexp_replace(upper(rolemeta.name), '[^A-Z0-9]', '', 'g')
              IN ('SAIGONADMIN', 'SAIGONCOMMADMIN')
            AND rolemeta.userlevel = 'SCO'
            AND rolemeta.isaccessallorgs = 'Y'
            AND rolemeta.isuseuserorgaccess = 'N'`,
    expected: 1
  },
  {
    name: "Role SAIGONADMIN khong co org access readonly",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_role_orgaccess access
          JOIN adempiere.ad_role rolemeta ON rolemeta.ad_role_id = access.ad_role_id
          WHERE regexp_replace(upper(rolemeta.name), '[^A-Z0-9]', '', 'g')
              IN ('SAIGONADMIN', 'SAIGONCOMMADMIN')
            AND access.ad_client_id = rolemeta.ad_client_id
            AND access.isactive = 'Y'
            AND access.isreadonly = 'Y'`,
    expected: 0
  },
  {
    name: "Quyền Window dùng đúng tenant SAIGONCOMM",
    sql: `SELECT count(*)::int AS count
          FROM (
            SELECT access.ad_client_id
            FROM adempiere.ad_window_access access
            JOIN adempiere.ad_role rolemeta ON rolemeta.ad_role_id = access.ad_role_id
            JOIN adempiere.ad_window win ON win.ad_window_id = access.ad_window_id
            WHERE win.name = 'Đơn Đặt Hàng'
              AND regexp_replace(upper(rolemeta.name), '[^A-Z0-9]', '', 'g')
                IN ('SAIGONADMIN', 'SAIGONCOMMADMIN')
              AND access.ad_client_id = rolemeta.ad_client_id
          ) matched_access`,
    expected: 1
  },
  {
    name: "Role co Table Access van doc duoc menu/dictionary ngoai whitelist",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_sysconfig
          WHERE name = 'READ_TABLES_NOT_IN_TABLE_ACCESS_INCLUDE_LIST'
            AND ad_client_id IN (0, 11)
            AND ad_org_id = 0
            AND value = 'Y'
            AND isactive = 'Y'`,
    expected: 2
  },
  {
    name: "Khong con status line trong lam phinh dau form",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_statuslineusedin used
          JOIN adempiere.ad_window win ON win.ad_window_id = used.ad_window_id
          JOIN adempiere.ad_statusline status ON status.ad_statusline_id = used.ad_statusline_id
          WHERE win.name = 'ÄÆ¡n Äáº·t HÃ ng'
            AND used.isactive = 'Y'
            AND status.name = 'GreenCookBlankStatusLine'`,
    expected: 0
  },
  {
    name: "Don da dua vao he thong khong thieu loai chung tu hien tai",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.c_order
          WHERE ad_client_id = 11
            AND issotrx = 'N'
            AND kg_source_document_id IS NOT NULL
            AND (c_doctype_id IS NULL OR c_doctype_id = 0)`,
    expected: 0
  },
  {
    name: "Don da dua vao he thong khong thieu tien te",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.c_order
          WHERE ad_client_id = 11
            AND issotrx = 'N'
            AND kg_source_document_id IS NOT NULL
            AND (c_currency_id IS NULL OR c_currency_id = 0)`,
    expected: 0
  },
  {
    name: "Role SAIGONADMIN thấy menu Đơn Đặt Hàng trong cây tenant",
    sql: `SELECT count(DISTINCT rolemeta.ad_role_id)::int AS count
          FROM adempiere.ad_role rolemeta
          JOIN adempiere.ad_tree tree ON tree.ad_tree_id = rolemeta.ad_tree_menu_id
          JOIN adempiere.ad_treenodemm node ON node.ad_tree_id = tree.ad_tree_id
            AND node.ad_client_id = rolemeta.ad_client_id
          JOIN adempiere.ad_menu menu ON menu.ad_menu_id = node.node_id
          JOIN adempiere.ad_window win ON win.ad_window_id = menu.ad_window_id
          JOIN adempiere.ad_window_access access ON access.ad_window_id = win.ad_window_id
            AND access.ad_role_id = rolemeta.ad_role_id
          WHERE rolemeta.isactive = 'Y'
            AND tree.isactive = 'Y'
            AND tree.treetype = 'MM'
            AND menu.isactive = 'Y'
            AND win.name = 'Đơn Đặt Hàng'
            AND access.isactive = 'Y'
            AND regexp_replace(upper(rolemeta.name), '[^A-Z0-9]', '', 'g')
              IN ('SAIGONADMIN', 'SAIGONCOMMADMIN')`,
    minimum: 1
  },
  {
    name: "Cây menu tenant SAIGONCOMM đã có cấu trúc đầy đủ",
    sql: `SELECT count(node.node_id)::int AS count
          FROM adempiere.ad_role rolemeta
          JOIN adempiere.ad_tree tree ON tree.ad_tree_id = rolemeta.ad_tree_menu_id
          JOIN adempiere.ad_treenodemm node ON node.ad_tree_id = tree.ad_tree_id
          WHERE rolemeta.isactive = 'Y'
            AND rolemeta.ad_client_id = 11
            AND tree.ad_client_id = rolemeta.ad_client_id
            AND tree.treetype = 'MM'
            AND regexp_replace(upper(rolemeta.name), '[^A-Z0-9]', '', 'g')
              IN ('SAIGONADMIN', 'SAIGONCOMMADMIN')`,
    minimum: 100
  },
  {
    name: "Tenant SAIGONCOMM dùng đúng cây menu của role",
    sql: `SELECT count(DISTINCT rolemeta.ad_role_id)::int AS count
          FROM adempiere.ad_role rolemeta
          JOIN adempiere.ad_clientinfo info ON info.ad_client_id = rolemeta.ad_client_id
          JOIN adempiere.ad_tree tree ON tree.ad_tree_id = info.ad_tree_menu_id
          WHERE rolemeta.isactive = 'Y'
            AND rolemeta.ad_client_id = 11
            AND info.ad_tree_menu_id = rolemeta.ad_tree_menu_id
            AND tree.ad_client_id = rolemeta.ad_client_id
            AND tree.treetype = 'MM'
            AND tree.isallnodes = 'Y'
            AND regexp_replace(upper(rolemeta.name), '[^A-Z0-9]', '', 'g')
              IN ('SAIGONADMIN', 'SAIGONCOMMADMIN')`,
    minimum: 1
  },
  {
    name: "Dòng tổng hợp chuẩn C_Order đã được ẩn trong Window",
    sql: `SELECT count(DISTINCT tab.ad_tab_id)::int AS count
          FROM adempiere.ad_statuslineusedin usedin
          JOIN adempiere.ad_statusline statusline
            ON statusline.ad_statusline_id = usedin.ad_statusline_id
          JOIN adempiere.ad_message message
            ON message.ad_message_id = statusline.ad_message_id
          JOIN adempiere.ad_window win ON win.ad_window_id = usedin.ad_window_id
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = usedin.ad_tab_id
          WHERE win.name = 'Đơn Đặt Hàng' AND win.entitytype = 'KG'
            AND tab.isactive = 'Y' AND usedin.isactive = 'Y'
            AND usedin.isstatusline = 'Y' AND statusline.isactive = 'Y'
            AND trim(message.msgtext) = ''
            AND regexp_replace(lower(statusline.sqlstatement), '\\s', '', 'g')
              = 'select''''::text'`,
    expected: 0
  },
  {
    name: "Grid header gọn",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.name = 'Đơn đặt hàng'
            AND tab.isactive = 'Y' AND field.isactive = 'Y'
            AND field.isdisplayedgrid = 'Y'`,
    expected: 6
  },
  {
    name: "Grid dòng sản phẩm gọn",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.name = 'Sản phẩm đơn hàng'
            AND tab.isactive = 'Y' AND field.isactive = 'Y'
            AND field.isdisplayedgrid = 'Y'`,
    expected: 8
  },
  {
    name: "Metadata không có field sai bảng",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_field field
          JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
          JOIN adempiere.ad_window win ON win.ad_window_id = tab.ad_window_id
          JOIN adempiere.ad_column columnmeta ON columnmeta.ad_column_id = field.ad_column_id
          WHERE win.name = 'Đơn Đặt Hàng' AND tab.isactive = 'Y'
            AND field.isactive = 'Y' AND columnmeta.ad_table_id <> tab.ad_table_id`,
    expected: 0
  },
  {
    name: "Role SAIGONADMIN có quyền ghi Window",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_window_access access
          JOIN adempiere.ad_window win ON win.ad_window_id = access.ad_window_id
          JOIN adempiere.ad_role rolemeta ON rolemeta.ad_role_id = access.ad_role_id
          WHERE win.name = 'Đơn Đặt Hàng' AND access.isactive = 'Y'
            AND access.isreadwrite = 'Y'
            AND regexp_replace(upper(rolemeta.name), '[^A-Z0-9]', '', 'g')
              IN ('SAIGONADMIN', 'SAIGONCOMMADMIN')`,
    minimum: 1
  },
  {
    name: "PO đã xác nhận có thể đọc qua Window mới",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.c_order
          WHERE ad_client_id = 11 AND kg_source_document_id IS NOT NULL
            AND poreference IS NOT NULL`,
    minimum: 1
  },
  {
    name: "Dữ liệu core từ mẫu chuẩn đã backfill",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.c_order
          WHERE ad_client_id = 11 AND kg_source_document_id IS NOT NULL
            AND (kg_print_date IS NOT NULL OR kg_form_type IS NOT NULL
              OR kg_approved_by IS NOT NULL OR kg_contract_number IS NOT NULL)`,
    minimum: 1
  },
  {
    name: "Cột Barcode trên kg_sp",
    sql: `SELECT count(*)::int AS count FROM information_schema.columns
          WHERE table_schema = 'adempiere' AND table_name = 'kg_sp'
            AND column_name = 'barcode'`,
    expected: 1
  },
  {
    name: "AD_Table cho 4 bảng đọc file AI",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_table
          WHERE lower(tablename) IN ('kg_order_ai_test', 'kg_order_detail_ai_test')
            AND isactive = 'Y' AND isdeleteable = 'Y'`,
    expected: 2
  },
  {
    name: "Hai window đọc file AI đã public",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_window
          WHERE name IN ('Chứng Từ Đọc File AI', 'Đơn Hàng Đọc File AI')
            AND entitytype = 'KG' AND isactive = 'Y'`,
    expected: 2
  },
  {
    name: "Tab header/detail đọc file AI đúng link",
    sql: `SELECT count(*)::int AS count
          FROM adempiere.ad_tab detail
          JOIN adempiere.ad_window win ON win.ad_window_id = detail.ad_window_id
          JOIN adempiere.ad_column linkcol ON linkcol.ad_column_id = detail.ad_column_id
          WHERE win.name IN ('Chứng Từ Đọc File AI', 'Đơn Hàng Đọc File AI')
            AND detail.tablevel = 1
            AND detail.isactive = 'Y'
            AND lower(linkcol.columnname) = 'kg_order_ai_test_id'`,
    minimum: 1
  },
  {
    name: "AD_Column đọc file AI đủ theo cột vật lý",
    sql: `WITH physical AS (
            SELECT table_name, count(*) AS physical_count
            FROM information_schema.columns
            WHERE table_schema = 'adempiere'
              AND table_name IN ('kg_order_ai_test', 'kg_order_detail_ai_test')
            GROUP BY table_name
          ),
          dictionary AS (
            SELECT lower(tablemeta.tablename) AS table_name, count(*) AS dictionary_count
            FROM adempiere.ad_table tablemeta
            JOIN adempiere.ad_column columnmeta ON columnmeta.ad_table_id = tablemeta.ad_table_id
            WHERE lower(tablemeta.tablename) IN ('kg_order_ai_test', 'kg_order_detail_ai_test')
              AND columnmeta.isactive = 'Y'
            GROUP BY lower(tablemeta.tablename)
          )
          SELECT count(*)::int AS count
          FROM physical
          JOIN dictionary USING (table_name)
          WHERE physical.physical_count = dictionary.dictionary_count`,
    expected: 2
  },
  {
    name: "Role SAIGONADMIN có quyền ghi window đọc file AI",
    sql: `SELECT count(DISTINCT win.ad_window_id)::int AS count
          FROM adempiere.ad_window win
          JOIN adempiere.ad_window_access access ON access.ad_window_id = win.ad_window_id
          JOIN adempiere.ad_role rolemeta ON rolemeta.ad_role_id = access.ad_role_id
          WHERE win.name IN ('Chứng Từ Đọc File AI', 'Đơn Hàng Đọc File AI')
            AND access.isactive = 'Y'
            AND access.isreadwrite = 'Y'
            AND regexp_replace(upper(rolemeta.name), '[^A-Z0-9]', '', 'g')
              IN ('SAIGONADMIN', 'SAIGONCOMMADMIN')`,
    expected: 2
  },
  {
    name: "Menu tenant SG có 2 window đọc file AI",
    sql: `SELECT count(DISTINCT win.ad_window_id)::int AS count
          FROM adempiere.ad_role rolemeta
          JOIN adempiere.ad_tree tree ON tree.ad_tree_id = rolemeta.ad_tree_menu_id
          JOIN adempiere.ad_treenodemm node ON node.ad_tree_id = tree.ad_tree_id
            AND node.ad_client_id = rolemeta.ad_client_id
          JOIN adempiere.ad_menu menu ON menu.ad_menu_id = node.node_id
          JOIN adempiere.ad_window win ON win.ad_window_id = menu.ad_window_id
          WHERE win.name IN ('Chứng Từ Đọc File AI', 'Đơn Hàng Đọc File AI')
            AND menu.isactive = 'Y'
            AND regexp_replace(upper(rolemeta.name), '[^A-Z0-9]', '', 'g')
              IN ('SAIGONADMIN', 'SAIGONCOMMADMIN')`,
    expected: 2
  }
];

try {
  let failed = false;
  for (const check of checks) {
    const result = await pool.query<{ count: number }>(check.sql);
    const count = Number(result.rows[0]?.count ?? 0);
    const passed = check.expected !== undefined
      ? count === check.expected
      : count >= (check.minimum ?? 1);
    console.log(`${passed ? "OK" : "FAIL"} | ${check.name} | ${count}`);
    failed ||= !passed;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sample = await client.query<{
      c_order_id: number;
      c_orderline_id: number;
    }>(`SELECT orderrow.c_order_id, linerow.c_orderline_id
        FROM adempiere.c_order orderrow
        JOIN adempiere.c_orderline linerow ON linerow.c_order_id = orderrow.c_order_id
        WHERE orderrow.ad_client_id = 11
          AND orderrow.kg_source_document_id IS NOT NULL
        ORDER BY orderrow.updated DESC, linerow.line
        LIMIT 1`);

    const row = sample.rows[0];
    let writable = Boolean(row);
    if (row) {
      const marker = `VERIFY_EDIT_${Date.now()}`;
      await client.query(
        `UPDATE adempiere.c_order SET kg_approved_by = $1 WHERE c_order_id = $2`,
        [marker, row.c_order_id]
      );
      await client.query(
        `UPDATE adempiere.c_orderline SET kg_product_name = $1 WHERE c_orderline_id = $2`,
        [marker, row.c_orderline_id]
      );
      const written = await client.query<{ header_value: string; line_value: string }>(
        `SELECT orderrow.kg_approved_by AS header_value,
                linerow.kg_product_name AS line_value
         FROM adempiere.c_order orderrow
         JOIN adempiere.c_orderline linerow ON linerow.c_order_id = orderrow.c_order_id
         WHERE orderrow.c_order_id = $1 AND linerow.c_orderline_id = $2`,
        [row.c_order_id, row.c_orderline_id]
      );
      writable = written.rows[0]?.header_value === marker
        && written.rows[0]?.line_value === marker;
    }
    await client.query("ROLLBACK");
    console.log(`${writable ? "OK" : "FAIL"} | Field đầu đơn và dòng sản phẩm ghi được (đã rollback) | ${writable ? 2 : 0}`);
    failed ||= !writable;
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(`FAIL | Field đầu đơn và dòng sản phẩm ghi được (đã rollback) | ${String(error)}`);
    failed = true;
  } finally {
    client.release();
  }

  if (failed) process.exitCode = 1;
} finally {
  await pool.end();
}
