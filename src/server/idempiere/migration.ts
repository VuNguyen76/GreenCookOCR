import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { ensureWebOrderSchema } from "./web-schema.js";

const SYSTEM_USER_ID = 100;
const ENTITY_TYPE = "KG";
const SAIGON_ADMIN_ROLE_KEYS = ["SAIGONADMIN", "SAIGONCOMMADMIN"];
const WINDOW_NAME = "Đơn Đặt Hàng";
const LEGACY_WINDOW_NAME = "Đơn Hàng OCR";
const AI_SOURCE_WINDOW_NAME = "Chứng Từ Đọc File AI";
const AI_ORDER_WINDOW_NAME = "Đơn Hàng Đọc File AI";
const ORDER_TABLE_LABEL = "Đơn đặt hàng";
const DETAIL_TABLE_LABEL = "Sản phẩm đơn hàng";
const BLANK_STATUS_MESSAGE_VALUE = "KG_GreenCookBlankStatusLine";
const BLANK_STATUS_LINE_NAME = "GreenCookBlankStatusLine";
const EDITABLE_STANDARD_ORDER_COLUMNS = [
  "DocumentNo", "POReference", "DateOrdered", "DateAcct", "DatePromised",
  "Description", "C_BPartner_ID", "C_BPartner_Location_ID", "AD_User_ID",
  "Bill_BPartner_ID", "Bill_Location_ID", "Bill_User_ID", "M_Warehouse_ID",
  "IsDropShip", "DropShip_BPartner_ID", "DropShip_Location_ID", "DropShip_User_ID",
  "DeliveryRule", "DeliveryViaRule", "M_Shipper_ID", "FreightCostRule", "FreightAmt",
  "PriorityRule", "M_PriceList_ID", "C_Currency_ID", "C_ConversionType_ID",
  "PaymentRule", "C_PaymentTerm_ID", "InvoiceRule", "SalesRep_ID",
  "IsDiscountPrinted", "C_Charge_ID", "ChargeAmt", "C_Project_ID",
  "C_Activity_ID", "C_Campaign_ID", "AD_OrgTrx_ID", "User1_ID", "User2_ID",
  "C_CashPlanLine_ID", "DatePrinted", "DocAction"
];
const EDITABLE_STANDARD_ORDER_LINE_COLUMNS = [
  "Line", "QtyEntered", "QtyOrdered", "C_UOM_ID", "PriceList", "PriceActual",
  "PriceEntered", "Discount", "C_Tax_ID", "DatePromised", "M_Warehouse_ID",
  "Description"
];

type FieldGroupKey =
  | "order"
  | "partner"
  | "delivery"
  | "accounting"
  | "status"
  | "source"
  | "sourceAmounts"
  | "lineProduct"
  | "lineAmounts"
  | "lineSource";

const FIELD_GROUPS: Array<{
  key: FieldGroupKey;
  name: string;
  collapsed: boolean;
}> = [
  { key: "order", name: "Thông tin đặt hàng", collapsed: false },
  { key: "partner", name: "Đối tác và hóa đơn", collapsed: false },
  { key: "delivery", name: "Giao nhận", collapsed: false },
  { key: "accounting", name: "Thanh toán và hạch toán", collapsed: true },
  { key: "status", name: "Trạng thái xử lý", collapsed: true },
  { key: "source", name: "Chứng từ nguồn", collapsed: true },
  { key: "sourceAmounts", name: "Tổng tiền từ chứng từ", collapsed: false },
  { key: "lineProduct", name: "Thông tin sản phẩm", collapsed: false },
  { key: "lineAmounts", name: "Số lượng và giá", collapsed: false },
  { key: "lineSource", name: "Chi tiết dòng nguồn", collapsed: true }
];

interface FieldSpec {
  columnName: string;
  name: string;
  fieldGroup?: FieldGroupKey;
  displayed?: boolean;
  fieldSeq?: number;
  sameLine?: boolean;
  readOnly?: boolean;
  gridDisplayed?: boolean;
  gridSeq?: number;
}

interface ColumnSpec extends FieldSpec {
  referenceId: number;
  fieldLength: number;
  mandatory?: boolean;
  key?: boolean;
  parent?: boolean;
  identifier?: boolean;
  updateable?: boolean;
  defaultValue?: string;
  valRuleId?: number;
  referenceValueId?: number;
}

interface PhysicalColumn {
  column_name: string;
  data_type: string;
  udt_name: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: "YES" | "NO";
}

const STANDARD_COLUMNS: ColumnSpec[] = [
  { columnName: "AD_Client_ID", name: "Tenant", referenceId: 19, fieldLength: 10, mandatory: true, updateable: false },
  { columnName: "AD_Org_ID", name: "Organization", referenceId: 19, fieldLength: 10, mandatory: true, defaultValue: "0" },
  { columnName: "IsActive", name: "Kích hoạt", referenceId: 20, fieldLength: 1, mandatory: true, defaultValue: "Y" },
  { columnName: "Created", name: "Created", referenceId: 16, fieldLength: 29, mandatory: true, updateable: false, defaultValue: "SYSDATE" },
  { columnName: "CreatedBy", name: "Created By", referenceId: 30, referenceValueId: 110, fieldLength: 10, mandatory: true, updateable: false },
  { columnName: "Updated", name: "Updated", referenceId: 16, fieldLength: 29, mandatory: true, updateable: false, defaultValue: "SYSDATE" },
  { columnName: "UpdatedBy", name: "Updated By", referenceId: 30, referenceValueId: 110, fieldLength: 10, mandatory: true, updateable: false }
];

const ORDER_COLUMNS: ColumnSpec[] = [
  { columnName: "KG_Order_ID", name: ORDER_TABLE_LABEL, referenceId: 13, fieldLength: 10, mandatory: true, key: true, updateable: false },
  ...STANDARD_COLUMNS,
  { columnName: "Value", name: "Số PO", referenceId: 10, fieldLength: 60, mandatory: true, identifier: true, displayed: true, fieldSeq: 10 },
  { columnName: "DocStatus", name: "Trạng thái", referenceId: 10, fieldLength: 2, mandatory: true, defaultValue: "CO", displayed: true, fieldSeq: 20 },
  { columnName: "PO_Date", name: "Ngày PO", referenceId: 15, fieldLength: 7, displayed: true, fieldSeq: 30 },
  { columnName: "Delivery_Date", name: "Ngày giao", referenceId: 15, fieldLength: 7, displayed: true, fieldSeq: 40, sameLine: true },
  { columnName: "PO_Matched", name: "PO đã có trong hệ thống", referenceId: 20, fieldLength: 1, mandatory: true, defaultValue: "N", displayed: true, fieldSeq: 50 },
  { columnName: "PO_Source_Table", name: "Nguồn đối chiếu PO", referenceId: 10, fieldLength: 30, displayed: true, fieldSeq: 60, sameLine: true },
  { columnName: "PO_Source_Value", name: "Số PO đối chiếu", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 70, sameLine: true },
  { columnName: "PO_Source_Record_ID", name: "Mã bản ghi đối chiếu", referenceId: 11, fieldLength: 10 },
  { columnName: "Issuer_Name", name: "Đơn vị đặt hàng", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 80 },
  { columnName: "C_BPartner_ID", name: "Đối tác", referenceId: 30, fieldLength: 10, mandatory: false, valRuleId: 230, displayed: true, fieldSeq: 90, sameLine: true },
  { columnName: "Store_Code", name: "Mã cửa hàng", referenceId: 10, fieldLength: 60, displayed: true, fieldSeq: 100 },
  { columnName: "Store_Name", name: "Tên cửa hàng", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 110, sameLine: true },
  { columnName: "Delivery_Address", name: "Địa chỉ giao hàng", referenceId: 14, fieldLength: 500, displayed: true, fieldSeq: 120 },
  { columnName: "C_Currency_ID", name: "Tiền tệ", referenceId: 19, fieldLength: 10, mandatory: true, defaultValue: "@#C_Currency_ID@", displayed: true, fieldSeq: 130 },
  { columnName: "Subtotal_Amount", name: "Tiền hàng", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 140 },
  { columnName: "Tax_Amount", name: "Tiền thuế", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 150, sameLine: true },
  { columnName: "Total_Amount", name: "Tổng đơn hàng", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 160, sameLine: true },
  { columnName: "Confirmed_At", name: "Thời điểm xác nhận", referenceId: 16, fieldLength: 29, mandatory: true, defaultValue: "SYSDATE", displayed: true, fieldSeq: 170 },
  { columnName: "Source_File_Name", name: "Tệp nguồn", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 180 },
  { columnName: "Description", name: "Ghi chú", referenceId: 14, fieldLength: 500 },
  { columnName: "Document_Title", name: "Tiêu đề chứng từ", referenceId: 10, fieldLength: 150 },
  { columnName: "Template_Key", name: "Mẫu tài liệu", referenceId: 10, fieldLength: 80 },
  { columnName: "Source_Document_ID", name: "Mã tài liệu nguồn", referenceId: 10, fieldLength: 36 },
  { columnName: "Source_Order_Key", name: "Khóa bản ghi nguồn", referenceId: 10, fieldLength: 120 },
  { columnName: "Source_SHA256", name: "SHA-256 file nguồn", referenceId: 10, fieldLength: 64 },
  { columnName: "Document_Type", name: "Loại chứng từ", referenceId: 10, fieldLength: 30 }
];

const DETAIL_COLUMNS: ColumnSpec[] = [
  { columnName: "KG_Detail_ID", name: DETAIL_TABLE_LABEL, referenceId: 13, fieldLength: 10, mandatory: true, key: true, updateable: false },
  ...STANDARD_COLUMNS,
  { columnName: "KG_Order_ID", name: ORDER_TABLE_LABEL, referenceId: 19, fieldLength: 10, mandatory: true, parent: true, displayed: false },
  { columnName: "Line", name: "Dòng", referenceId: 11, fieldLength: 10, mandatory: true, defaultValue: "@SQL=SELECT COALESCE(MAX(Line),0)+10 FROM KG_Detail WHERE KG_Order_ID=@KG_Order_ID@", displayed: true, fieldSeq: 10 },
  { columnName: "Product_Code", name: "Mã sản phẩm", referenceId: 10, fieldLength: 60, displayed: true, fieldSeq: 20 },
  { columnName: "Barcode", name: "Barcode", referenceId: 10, fieldLength: 32, displayed: true, fieldSeq: 30, sameLine: true },
  { columnName: "Product_Name", name: "Tên sản phẩm", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 40 },
  { columnName: "Quantity", name: "Số lượng", referenceId: 29, fieldLength: 18, mandatory: true, displayed: true, fieldSeq: 50 },
  { columnName: "Unit_Name", name: "Đơn vị", referenceId: 10, fieldLength: 30, displayed: true, fieldSeq: 60, sameLine: true },
  { columnName: "Unit_Price", name: "Đơn giá", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 70 },
  { columnName: "VAT_Rate", name: "Thuế suất", referenceId: 22, fieldLength: 9, displayed: true, fieldSeq: 80, sameLine: true },
  { columnName: "Amount", name: "Thành tiền", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 90, sameLine: true },
  { columnName: "Source_Page", name: "Trang nguồn", referenceId: 11, fieldLength: 10, displayed: true, fieldSeq: 100 },
  { columnName: "Confidence", name: "Độ tin cậy dữ liệu", referenceId: 22, fieldLength: 5 },
  { columnName: "Description", name: "Ghi chú", referenceId: 14, fieldLength: 500 },
  { columnName: "KG_SP_ID", name: "Sản phẩm liên kết", referenceId: 19, fieldLength: 10, mandatory: false },
  { columnName: "Units_Per_Order_Unit", name: "Hệ số quy đổi", referenceId: 29, fieldLength: 18 },
  { columnName: "C_UOM_ID", name: "Đơn vị liên kết", referenceId: 19, fieldLength: 10, valRuleId: 210 },
  { columnName: "Vendor_Product_Code", name: "Mã sản phẩm NCC", referenceId: 10, fieldLength: 60 },
  { columnName: "Model", name: "Model nguồn", referenceId: 10, fieldLength: 80 }
];

const STANDARD_ORDER_FIELDS: FieldSpec[] = [
  { columnName: "C_Order_ID", name: "Đơn đặt hàng", readOnly: true },
  { columnName: "AD_Org_ID", name: "Tổ chức", displayed: true, fieldSeq: 10, fieldGroup: "order", gridDisplayed: false },
  { columnName: "DocumentNo", name: "Số chứng từ", displayed: true, fieldSeq: 20, fieldGroup: "order", readOnly: true, gridDisplayed: true, gridSeq: 10 },
  { columnName: "POReference", name: "Số PO", displayed: true, fieldSeq: 30, fieldGroup: "order", sameLine: true, gridDisplayed: true, gridSeq: 20 },
  { columnName: "C_DocTypeTarget_ID", name: "Loại chứng từ", displayed: true, fieldSeq: 40, fieldGroup: "order", gridDisplayed: false },
  { columnName: "DocStatus", name: "Trạng thái", displayed: true, fieldSeq: 50, fieldGroup: "order", readOnly: true, gridDisplayed: true, gridSeq: 30 },
  { columnName: "C_DocType_ID", name: "Loại chứng từ hiện tại", displayed: true, fieldSeq: 60, fieldGroup: "order", readOnly: true, gridDisplayed: false },
  { columnName: "DateOrdered", name: "Ngày PO", displayed: true, fieldSeq: 70, fieldGroup: "order", gridDisplayed: true, gridSeq: 40 },
  { columnName: "DateAcct", name: "Ngày hạch toán", displayed: true, fieldSeq: 80, fieldGroup: "order", sameLine: true, gridDisplayed: false },
  { columnName: "DatePromised", name: "Ngày giao", displayed: true, fieldSeq: 90, fieldGroup: "order", gridDisplayed: true, gridSeq: 50 },
  { columnName: "Description", name: "Ghi chú đơn hàng", displayed: true, fieldSeq: 100, fieldGroup: "order", gridDisplayed: false },

  { columnName: "C_BPartner_ID", name: "Đối tác", displayed: true, fieldSeq: 200, fieldGroup: "partner", gridDisplayed: false },
  { columnName: "C_BPartner_Location_ID", name: "Địa chỉ đối tác", displayed: true, fieldSeq: 210, fieldGroup: "partner", sameLine: true, gridDisplayed: false },
  { columnName: "AD_User_ID", name: "Người liên hệ đối tác", displayed: true, fieldSeq: 220, fieldGroup: "partner", gridDisplayed: false },
  { columnName: "Bill_BPartner_ID", name: "Đối tác xuất hóa đơn", displayed: true, fieldSeq: 230, fieldGroup: "partner", gridDisplayed: false },
  { columnName: "Bill_Location_ID", name: "Địa chỉ xuất hóa đơn", displayed: true, fieldSeq: 240, fieldGroup: "partner", sameLine: true, gridDisplayed: false },
  { columnName: "Bill_User_ID", name: "Người nhận hóa đơn", displayed: true, fieldSeq: 250, fieldGroup: "partner", gridDisplayed: false },

  { columnName: "M_Warehouse_ID", name: "Kho iDempiere", displayed: true, fieldSeq: 300, fieldGroup: "delivery", gridDisplayed: false },
  { columnName: "IsDropShip", name: "Giao thẳng", displayed: true, fieldSeq: 310, fieldGroup: "delivery", sameLine: true, gridDisplayed: false },
  { columnName: "DropShip_BPartner_ID", name: "Đối tác giao thẳng", displayed: true, fieldSeq: 320, fieldGroup: "delivery", gridDisplayed: false },
  { columnName: "DropShip_Location_ID", name: "Địa chỉ giao thẳng", displayed: true, fieldSeq: 330, fieldGroup: "delivery", sameLine: true, gridDisplayed: false },
  { columnName: "DropShip_User_ID", name: "Người nhận giao thẳng", displayed: true, fieldSeq: 340, fieldGroup: "delivery", gridDisplayed: false },
  { columnName: "DeliveryRule", name: "Quy tắc giao hàng", displayed: true, fieldSeq: 350, fieldGroup: "delivery", gridDisplayed: false },
  { columnName: "DeliveryViaRule", name: "Phương thức giao hàng", displayed: true, fieldSeq: 360, fieldGroup: "delivery", sameLine: true, gridDisplayed: false },
  { columnName: "M_Shipper_ID", name: "Đơn vị vận chuyển", displayed: true, fieldSeq: 370, fieldGroup: "delivery", gridDisplayed: false },
  { columnName: "FreightCostRule", name: "Quy tắc phí vận chuyển", displayed: true, fieldSeq: 380, fieldGroup: "delivery", gridDisplayed: false },
  { columnName: "FreightAmt", name: "Phí vận chuyển", displayed: true, fieldSeq: 390, fieldGroup: "delivery", sameLine: true, gridDisplayed: false },
  { columnName: "PriorityRule", name: "Mức ưu tiên", displayed: true, fieldSeq: 400, fieldGroup: "delivery", gridDisplayed: false },

  { columnName: "M_PriceList_ID", name: "Bảng giá iDempiere", displayed: true, fieldSeq: 500, fieldGroup: "accounting", gridDisplayed: false },
  { columnName: "C_Currency_ID", name: "Tiền tệ", displayed: true, fieldSeq: 510, fieldGroup: "accounting", readOnly: true, sameLine: true, gridDisplayed: false },
  { columnName: "C_ConversionType_ID", name: "Loại tỷ giá", displayed: true, fieldSeq: 520, fieldGroup: "accounting", gridDisplayed: false },
  { columnName: "IsTaxIncluded", name: "Thiết lập thuế", displayed: false, fieldSeq: 530, fieldGroup: "accounting", sameLine: true, gridDisplayed: false },
  { columnName: "PaymentRule", name: "Phương thức thanh toán", displayed: true, fieldSeq: 540, fieldGroup: "accounting", gridDisplayed: false },
  { columnName: "C_PaymentTerm_ID", name: "Điều khoản thanh toán", displayed: true, fieldSeq: 550, fieldGroup: "accounting", sameLine: true, gridDisplayed: false },
  { columnName: "InvoiceRule", name: "Quy tắc hóa đơn", displayed: true, fieldSeq: 560, fieldGroup: "accounting", gridDisplayed: false },
  { columnName: "SalesRep_ID", name: "Người phụ trách", displayed: true, fieldSeq: 570, fieldGroup: "accounting", sameLine: true, gridDisplayed: false },
  { columnName: "IsDiscountPrinted", name: "In chiết khấu", displayed: true, fieldSeq: 580, fieldGroup: "accounting", gridDisplayed: false },
  { columnName: "C_Charge_ID", name: "Loại phụ phí", displayed: true, fieldSeq: 590, fieldGroup: "accounting", gridDisplayed: false },
  { columnName: "ChargeAmt", name: "Phụ phí", displayed: true, fieldSeq: 600, fieldGroup: "accounting", sameLine: true, gridDisplayed: false },
  { columnName: "C_Project_ID", name: "Dự án", displayed: true, fieldSeq: 610, fieldGroup: "accounting", gridDisplayed: false },
  { columnName: "C_Activity_ID", name: "Hoạt động", displayed: true, fieldSeq: 620, fieldGroup: "accounting", sameLine: true, gridDisplayed: false },
  { columnName: "C_Campaign_ID", name: "Chiến dịch", displayed: true, fieldSeq: 630, fieldGroup: "accounting", gridDisplayed: false },
  { columnName: "AD_OrgTrx_ID", name: "Tổ chức giao dịch", displayed: true, fieldSeq: 640, fieldGroup: "accounting", sameLine: true, gridDisplayed: false },
  { columnName: "User1_ID", name: "Yếu tố người dùng 1", displayed: true, fieldSeq: 650, fieldGroup: "accounting", gridDisplayed: false },
  { columnName: "User2_ID", name: "Yếu tố người dùng 2", displayed: true, fieldSeq: 660, fieldGroup: "accounting", sameLine: true, gridDisplayed: false },
  { columnName: "C_CashPlanLine_ID", name: "Dòng kế hoạch tiền", displayed: true, fieldSeq: 670, fieldGroup: "accounting", gridDisplayed: false },

  { columnName: "TotalLines", name: "Tiền hàng hệ thống", displayed: true, fieldSeq: 700, fieldGroup: "status", readOnly: true, gridDisplayed: false },
  { columnName: "GrandTotal", name: "Tổng đơn hệ thống", displayed: true, fieldSeq: 710, fieldGroup: "status", readOnly: true, sameLine: true, gridDisplayed: true, gridSeq: 60 },
  { columnName: "IsPayScheduleValid", name: "Lịch thanh toán hợp lệ", displayed: true, fieldSeq: 720, fieldGroup: "status", readOnly: true, gridDisplayed: false },
  { columnName: "DatePrinted", name: "Ngày in hệ thống", displayed: true, fieldSeq: 730, fieldGroup: "status", gridDisplayed: false },
  { columnName: "IsApproved", name: "Đã phê duyệt", displayed: true, fieldSeq: 740, fieldGroup: "status", readOnly: true, gridDisplayed: false },
  { columnName: "IsDelivered", name: "Đã giao", displayed: true, fieldSeq: 750, fieldGroup: "status", readOnly: true, sameLine: true, gridDisplayed: false },
  { columnName: "IsInvoiced", name: "Đã xuất hóa đơn", displayed: true, fieldSeq: 760, fieldGroup: "status", readOnly: true, gridDisplayed: false },
  { columnName: "IsPrinted", name: "Đã in", displayed: true, fieldSeq: 770, fieldGroup: "status", readOnly: true, sameLine: true, gridDisplayed: false },
  { columnName: "IsTransferred", name: "Đã chuyển", displayed: true, fieldSeq: 780, fieldGroup: "status", readOnly: true, gridDisplayed: false },
  { columnName: "Processed", name: "Đã xử lý", displayed: true, fieldSeq: 790, fieldGroup: "status", readOnly: true, sameLine: true, gridDisplayed: false },
  { columnName: "Posted", name: "Đã ghi sổ", displayed: true, fieldSeq: 800, fieldGroup: "status", readOnly: true, gridDisplayed: false },
  { columnName: "DocAction", name: "Xử lý đơn hàng", displayed: true, fieldSeq: 810, fieldGroup: "status", gridDisplayed: false }
];

const ORDER_OCR_COLUMNS: ColumnSpec[] = [
  { columnName: "KG_Source_Document_ID", name: "Mã tài liệu nguồn", referenceId: 10, fieldLength: 36 },
  { columnName: "KG_Source_File_Name", name: "Tệp nguồn", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 240, gridDisplayed: true, gridSeq: 70 },
  { columnName: "KG_Source_SHA256", name: "SHA-256 file nguồn", referenceId: 10, fieldLength: 64 },
  { columnName: "KG_Source_Payload", name: "Payload nguồn", referenceId: 14, fieldLength: 4000 },
  { columnName: "KG_Document_Title", name: "Tiêu đề chứng từ", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 250, gridDisplayed: false },
  { columnName: "KG_Document_Type", name: "Loại chứng từ", referenceId: 10, fieldLength: 40, displayed: true, fieldSeq: 260, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Currency_Text", name: "Tien te", referenceId: 10, fieldLength: 20, displayed: true, fieldSeq: 265, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Template_Key", name: "Mẫu tài liệu", referenceId: 10, fieldLength: 100, displayed: true, fieldSeq: 270, gridDisplayed: false },
  { columnName: "KG_Issuer_Name", name: "Đơn vị đặt hàng", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 280, gridDisplayed: true, gridSeq: 80 },
  { columnName: "KG_Issuer_Branch", name: "Chi nhánh đặt hàng", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 290, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Buyer_Name", name: "Bên mua", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 300, gridDisplayed: false },
  { columnName: "KG_Buyer_Code", name: "Mã bên mua", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 310, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Buyer_Tax_ID", name: "Mã số thuế bên mua", referenceId: 10, fieldLength: 40, displayed: true, fieldSeq: 320, gridDisplayed: false },
  { columnName: "KG_Supplier_Name", name: "Nhà cung cấp", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 330, gridDisplayed: false },
  { columnName: "KG_Supplier_Code", name: "Mã nhà cung cấp", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 340, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Supplier_Tax_ID", name: "Mã số thuế nhà cung cấp", referenceId: 10, fieldLength: 40, displayed: true, fieldSeq: 350, gridDisplayed: false },
  { columnName: "KG_Document_Number", name: "Số chứng từ nguồn", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 360, gridDisplayed: false },
  { columnName: "KG_Reference_Number", name: "Số tham chiếu", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 370, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Contract_Number", name: "Số hợp đồng", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 380, gridDisplayed: false },
  { columnName: "KG_Order_Contact", name: "Người liên hệ", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 390, gridDisplayed: false },
  { columnName: "KG_Contact_Phone", name: "Điện thoại", referenceId: 10, fieldLength: 80, displayed: true, fieldSeq: 400, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Contact_Email", name: "Email", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 410, gridDisplayed: false },
  { columnName: "KG_Delivery_Address", name: "Địa chỉ giao hàng", referenceId: 14, fieldLength: 1000, displayed: true, fieldSeq: 420, gridDisplayed: false },
  { columnName: "KG_Ship_To_Address", name: "Địa chỉ nhận hàng", referenceId: 14, fieldLength: 1000, displayed: true, fieldSeq: 430, gridDisplayed: false },
  { columnName: "KG_Bill_To_Address", name: "Địa chỉ thanh toán", referenceId: 14, fieldLength: 1000, displayed: true, fieldSeq: 440, gridDisplayed: false },
  { columnName: "KG_Store_Code", name: "Mã cửa hàng", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 450, gridDisplayed: false },
  { columnName: "KG_Store_Name", name: "Tên cửa hàng", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 460, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Warehouse_Code", name: "Mã kho nguồn", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 470, gridDisplayed: false },
  { columnName: "KG_Warehouse_Name", name: "Kho nhận hàng nguồn", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 480, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Department", name: "Bộ phận", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 490, gridDisplayed: false },
  { columnName: "KG_Industry_Code", name: "Mã ngành hàng", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 500, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Payment_Terms", name: "Điều khoản thanh toán nguồn", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 510, gridDisplayed: false },
  { columnName: "KG_Payment_Method", name: "Phương thức thanh toán nguồn", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 520, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Delivery_Method", name: "Phương thức giao hàng nguồn", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 530, gridDisplayed: false },
  { columnName: "KG_Delivery_Window", name: "Khung giờ giao", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 540, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Price_List_Name", name: "Bảng giá nguồn", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 550, gridDisplayed: false },
  { columnName: "KG_Price_Includes_Tax", name: "Thiết lập thuế chứng từ", referenceId: 20, fieldLength: 1, displayed: false, fieldSeq: 560, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Print_Date", name: "Ngày in", referenceId: 10, fieldLength: 40, displayed: true, fieldSeq: 570, gridDisplayed: false },
  { columnName: "KG_Print_Time", name: "Giờ in", referenceId: 10, fieldLength: 40, displayed: true, fieldSeq: 580, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Form_Type", name: "Loại phiếu", referenceId: 10, fieldLength: 80, displayed: true, fieldSeq: 590, gridDisplayed: false },
  { columnName: "KG_Approved_By", name: "Được chấp thuận bởi", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 600, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Subtotal_Amount", name: "Tiền hàng chứng từ", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 610, gridDisplayed: false },
  { columnName: "KG_Discount_Amount", name: "Chiết khấu chứng từ", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 620, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Tax_Amount", name: "Tiền thuế chứng từ", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 630, gridDisplayed: false },
  { columnName: "KG_Total_Amount", name: "Tổng đơn chứng từ", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 640, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Extra_Fields", name: "Thông tin bổ sung", referenceId: 14, fieldLength: 4000, displayed: true, fieldSeq: 650, gridDisplayed: false },
  { columnName: "KG_Confidence", name: "Độ tin cậy", referenceId: 22, fieldLength: 5 },
  { columnName: "KG_Warnings", name: "Thông tin cần kiểm tra", referenceId: 14, fieldLength: 4000 }
].map((spec, index) => {
  const isSourceAmount = [
    "KG_Subtotal_Amount", "KG_Discount_Amount", "KG_Tax_Amount", "KG_Total_Amount"
  ].includes(spec.columnName);
  return {
    ...spec,
    fieldGroup: isSourceAmount ? "sourceAmounts" : "source",
    fieldSeq: spec.displayed
      ? isSourceAmount ? 1500 + (index - 40) * 10 : 1000 + index * 10
      : undefined
  };
});

const STANDARD_ORDER_LINE_FIELDS: FieldSpec[] = [
  { columnName: "C_OrderLine_ID", name: "Dòng đơn hàng", readOnly: true },
  { columnName: "C_Order_ID", name: ORDER_TABLE_LABEL },
  { columnName: "Line", name: "Dòng", displayed: true, fieldSeq: 10, fieldGroup: "lineProduct", gridDisplayed: true, gridSeq: 10 },
  { columnName: "QtyEntered", name: "Số lượng đặt", displayed: true, fieldSeq: 100, fieldGroup: "lineAmounts", gridDisplayed: true, gridSeq: 60 },
  { columnName: "QtyOrdered", name: "Số lượng quy đổi", displayed: true, fieldSeq: 110, fieldGroup: "lineAmounts", sameLine: true, gridDisplayed: false },
  { columnName: "C_UOM_ID", name: "Đơn vị liên kết", displayed: true, fieldSeq: 120, fieldGroup: "lineAmounts", gridDisplayed: false },
  { columnName: "PriceList", name: "Giá niêm yết hệ thống", displayed: true, fieldSeq: 130, fieldGroup: "lineAmounts", gridDisplayed: false },
  { columnName: "PriceActual", name: "Đơn giá hệ thống", displayed: true, fieldSeq: 140, fieldGroup: "lineAmounts", sameLine: true, gridDisplayed: true, gridSeq: 70 },
  { columnName: "PriceEntered", name: "Đơn giá nhập", displayed: true, fieldSeq: 150, fieldGroup: "lineAmounts", gridDisplayed: false },
  { columnName: "Discount", name: "Chiết khấu hệ thống (%)", displayed: true, fieldSeq: 160, fieldGroup: "lineAmounts", sameLine: true, gridDisplayed: false },
  { columnName: "LineNetAmt", name: "Thành tiền hệ thống", displayed: true, fieldSeq: 170, fieldGroup: "lineAmounts", readOnly: true, gridDisplayed: true, gridSeq: 80 },
  { columnName: "C_Tax_ID", name: "Thuế hệ thống", displayed: true, fieldSeq: 180, fieldGroup: "lineAmounts", gridDisplayed: false },
  { columnName: "DatePromised", name: "Ngày giao", displayed: true, fieldSeq: 400, fieldGroup: "lineSource", gridDisplayed: false },
  { columnName: "M_Warehouse_ID", name: "Kho iDempiere", displayed: true, fieldSeq: 410, fieldGroup: "lineSource", gridDisplayed: false },
  { columnName: "Description", name: "Ghi chú dòng", displayed: true, fieldSeq: 420, fieldGroup: "lineSource", gridDisplayed: false }
];

const ORDER_LINE_OCR_COLUMNS: ColumnSpec[] = [
  { columnName: "KG_SP_ID", name: "Sản phẩm liên kết", referenceId: 19, fieldLength: 10, displayed: true, fieldSeq: 20, gridDisplayed: true, gridSeq: 20 },
  { columnName: "KG_Product_Code", name: "Mã sản phẩm", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 30, gridDisplayed: true, gridSeq: 30 },
  { columnName: "KG_Vendor_Product_Code", name: "Mã sản phẩm NCC", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 40, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Barcode", name: "Barcode", referenceId: 10, fieldLength: 40, displayed: true, fieldSeq: 50, gridDisplayed: true, gridSeq: 40 },
  { columnName: "KG_Product_Name", name: "Tên sản phẩm", referenceId: 10, fieldLength: 500, displayed: true, fieldSeq: 60, gridDisplayed: true, gridSeq: 50 },
  { columnName: "KG_Model", name: "Model", referenceId: 10, fieldLength: 150, displayed: true, fieldSeq: 70, gridDisplayed: false },
  { columnName: "KG_Article_Code", name: "Mã Article", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 80, sameLine: true, gridDisplayed: false },
  { columnName: "KG_SKU", name: "SKU", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 210, gridDisplayed: false },
  { columnName: "KG_OU_Type", name: "Loại đơn vị đặt", referenceId: 10, fieldLength: 80, displayed: true, fieldSeq: 220, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Free_Quantity", name: "Số lượng miễn phí", referenceId: 29, fieldLength: 24, displayed: true, fieldSeq: 230, gridDisplayed: false },
  { columnName: "KG_Units_Per_Order_Unit", name: "Hệ số quy đổi", referenceId: 29, fieldLength: 24, displayed: true, fieldSeq: 240, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Unit_Name", name: "Đơn vị nguồn", referenceId: 10, fieldLength: 80, displayed: true, fieldSeq: 250, gridDisplayed: false },
  { columnName: "KG_List_Price", name: "Giá niêm yết chứng từ", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 260, gridDisplayed: false },
  { columnName: "KG_Unit_Price", name: "Đơn giá chứng từ", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 270, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Discount_Percent", name: "Chiết khấu chứng từ (%)", referenceId: 22, fieldLength: 12, displayed: true, fieldSeq: 280, gridDisplayed: false },
  { columnName: "KG_Discount_Amount", name: "Tiền chiết khấu chứng từ", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 290, sameLine: true, gridDisplayed: false },
  { columnName: "KG_VAT_Rate", name: "Thuế suất chứng từ", referenceId: 22, fieldLength: 12, displayed: true, fieldSeq: 300, gridDisplayed: true, gridSeq: 75 },
  { columnName: "KG_Tax_Amount", name: "Tiền thuế chứng từ", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 310, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Amount", name: "Thành tiền chứng từ", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 320, gridDisplayed: false },
  { columnName: "KG_Gross_Amount", name: "Tổng sau thuế chứng từ", referenceId: 12, fieldLength: 24, displayed: true, fieldSeq: 330, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Warehouse_Code", name: "Mã kho nguồn", referenceId: 10, fieldLength: 120, displayed: true, fieldSeq: 340, gridDisplayed: false },
  { columnName: "KG_Warehouse_Name", name: "Kho nguồn", referenceId: 10, fieldLength: 255, displayed: true, fieldSeq: 350, sameLine: true, gridDisplayed: false },
  { columnName: "KG_Source_Page", name: "Trang nguồn", referenceId: 11, fieldLength: 10, displayed: true, fieldSeq: 360, gridDisplayed: false },
  { columnName: "KG_Extra_Fields", name: "Thông tin bổ sung dòng", referenceId: 14, fieldLength: 4000, displayed: true, fieldSeq: 370, gridDisplayed: false },
  { columnName: "KG_Source_Line_ID", name: "Mã dòng nguồn", referenceId: 10, fieldLength: 36 },
  { columnName: "KG_Line_Source_Payload", name: "Payload dòng nguồn", referenceId: 14, fieldLength: 4000 },
  { columnName: "KG_Confidence", name: "Độ tin cậy", referenceId: 22, fieldLength: 5 }
].map((spec, index) => {
  const fieldGroup: FieldGroupKey = index <= 7
    ? "lineProduct"
    : index <= 19 ? "lineAmounts" : "lineSource";
  const fieldSeq = !spec.displayed
    ? undefined
    : index <= 7 ? 20 + index * 10
      : index <= 19 ? 200 + (index - 8) * 10
        : 500 + (index - 20) * 10;
  return { ...spec, fieldGroup, fieldSeq };
});

const CORE_STANDARD_ORDER_FIELDS: FieldSpec[] = [
  { columnName: "C_Order_ID", name: "Đơn đặt hàng", readOnly: true },
  { columnName: "DocumentNo", name: "Số chứng từ", displayed: true, fieldSeq: 10, fieldGroup: "order", readOnly: true, gridDisplayed: true, gridSeq: 10 },
  { columnName: "POReference", name: "Số PO", displayed: true, fieldSeq: 20, fieldGroup: "order", gridDisplayed: true, gridSeq: 20 },
  { columnName: "DateOrdered", name: "Ngày PO", displayed: true, fieldSeq: 30, fieldGroup: "order", gridDisplayed: true, gridSeq: 30 },
  { columnName: "DatePromised", name: "Ngày giao", displayed: true, fieldSeq: 40, fieldGroup: "order", sameLine: true, gridDisplayed: true, gridSeq: 40 },
  { columnName: "C_Currency_ID", name: "Tiền tệ", displayed: false, fieldSeq: 50, fieldGroup: "order", readOnly: true, gridDisplayed: false }
];

const CORE_ORDER_OCR_LAYOUT = new Map<string, {
  fieldGroup: FieldGroupKey;
  fieldSeq: number;
  gridDisplayed?: boolean;
  gridSeq?: number;
}>([
  ["KG_Source_File_Name", { fieldGroup: "order", fieldSeq: 60, gridDisplayed: true, gridSeq: 50 }],
  ["KG_Document_Title", { fieldGroup: "order", fieldSeq: 70 }],
  ["KG_Document_Type", { fieldGroup: "order", fieldSeq: 80 }],
  ["KG_Currency_Text", { fieldGroup: "order", fieldSeq: 90 }],
  ["KG_Issuer_Name", { fieldGroup: "source", fieldSeq: 100, gridDisplayed: true, gridSeq: 60 }],
  ["KG_Supplier_Name", { fieldGroup: "source", fieldSeq: 110 }],
  ["KG_Buyer_Name", { fieldGroup: "source", fieldSeq: 120 }],
  ["KG_Order_Contact", { fieldGroup: "source", fieldSeq: 130 }],
  ["KG_Delivery_Address", { fieldGroup: "source", fieldSeq: 140 }],
  ["KG_Store_Code", { fieldGroup: "source", fieldSeq: 150 }],
  ["KG_Store_Name", { fieldGroup: "source", fieldSeq: 160 }],
  ["KG_Warehouse_Code", { fieldGroup: "source", fieldSeq: 170 }],
  ["KG_Warehouse_Name", { fieldGroup: "source", fieldSeq: 180 }],
  ["KG_Subtotal_Amount", { fieldGroup: "sourceAmounts", fieldSeq: 400 }],
  ["KG_Discount_Amount", { fieldGroup: "sourceAmounts", fieldSeq: 410 }],
  ["KG_Tax_Amount", { fieldGroup: "sourceAmounts", fieldSeq: 420 }],
  ["KG_Total_Amount", { fieldGroup: "sourceAmounts", fieldSeq: 430 }]
]);

const CORE_ORDER_OCR_FIELDS: FieldSpec[] = ORDER_OCR_COLUMNS
  .filter((spec) => CORE_ORDER_OCR_LAYOUT.has(spec.columnName))
  .map((spec) => {
    const layout = CORE_ORDER_OCR_LAYOUT.get(spec.columnName)!;
    return {
      ...spec,
      ...layout,
      displayed: true,
      gridDisplayed: layout.gridDisplayed ?? false,
      gridSeq: layout.gridSeq
    };
  });

const CORE_STANDARD_ORDER_LINE_FIELDS: FieldSpec[] = [
  { columnName: "C_OrderLine_ID", name: "Dòng đơn hàng", readOnly: true },
  { columnName: "C_Order_ID", name: ORDER_TABLE_LABEL, readOnly: true },
  { columnName: "Line", name: "Dòng", displayed: true, fieldSeq: 10, fieldGroup: "lineProduct", gridDisplayed: true, gridSeq: 10 },
  { columnName: "QtyEntered", name: "Số lượng", displayed: true, fieldSeq: 100, fieldGroup: "lineAmounts", gridDisplayed: true, gridSeq: 50 },
  { columnName: "DatePromised", name: "Ngày giao", displayed: true, fieldSeq: 300, fieldGroup: "lineSource", gridDisplayed: false }
];

const CORE_ORDER_LINE_OCR_LAYOUT = new Map<string, {
  fieldGroup: FieldGroupKey;
  fieldSeq: number;
  gridDisplayed?: boolean;
  gridSeq?: number;
}>([
  ["KG_Product_Code", { fieldGroup: "lineProduct", fieldSeq: 20, gridDisplayed: true, gridSeq: 20 }],
  ["KG_Barcode", { fieldGroup: "lineProduct", fieldSeq: 30, gridDisplayed: true, gridSeq: 30 }],
  ["KG_Product_Name", { fieldGroup: "lineProduct", fieldSeq: 40, gridDisplayed: true, gridSeq: 40 }],
  ["KG_Units_Per_Order_Unit", { fieldGroup: "lineAmounts", fieldSeq: 110 }],
  ["KG_Unit_Name", { fieldGroup: "lineAmounts", fieldSeq: 120, gridDisplayed: true, gridSeq: 60 }],
  ["KG_Unit_Price", { fieldGroup: "lineAmounts", fieldSeq: 130, gridDisplayed: true, gridSeq: 70 }],
  ["KG_Discount_Percent", { fieldGroup: "lineAmounts", fieldSeq: 140 }],
  ["KG_Discount_Amount", { fieldGroup: "lineAmounts", fieldSeq: 150 }],
  ["KG_VAT_Rate", { fieldGroup: "lineAmounts", fieldSeq: 160 }],
  ["KG_Tax_Amount", { fieldGroup: "lineAmounts", fieldSeq: 170 }],
  ["KG_Amount", { fieldGroup: "lineAmounts", fieldSeq: 180, gridDisplayed: true, gridSeq: 80 }],
  ["KG_Gross_Amount", { fieldGroup: "lineAmounts", fieldSeq: 190 }],
  ["KG_Warehouse_Code", { fieldGroup: "lineSource", fieldSeq: 310 }],
  ["KG_Warehouse_Name", { fieldGroup: "lineSource", fieldSeq: 320 }],
  ["KG_Source_Page", { fieldGroup: "lineSource", fieldSeq: 330 }]
]);

const CORE_ORDER_LINE_OCR_FIELDS: FieldSpec[] = ORDER_LINE_OCR_COLUMNS
  .filter((spec) => CORE_ORDER_LINE_OCR_LAYOUT.has(spec.columnName))
  .map((spec) => {
    const layout = CORE_ORDER_LINE_OCR_LAYOUT.get(spec.columnName)!;
    return {
      ...spec,
      ...layout,
      displayed: true,
      gridDisplayed: layout.gridDisplayed ?? false,
      gridSeq: layout.gridSeq
    };
  });

export async function applyIdempiereMigration(): Promise<void> {
  const ddlPath = path.resolve("sql/idempiere/db_structure.sql");
  const aiDdlPath = path.resolve("sql/idempiere/ai_reader_structure.sql");
  const ddl = await fs.readFile(ddlPath, "utf8");
  const aiDdl = await fs.readFile(aiDdlPath, "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(ddl);
    void aiDdl;
    await ensureWebOrderSchema(client);
    await backfillOrderExtraFields(client);
    await clearNonCoreOrderFields(client);
    await ensureEntityType(client);
    const fieldGroups = await ensureFieldGroups(client);
    await ensureAiReaderDictionary(client);

    const productTableId = await tableId(client, "kg_sp");
    const barcodeColumnId = await ensureColumn(client, productTableId, {
      columnName: "Barcode", name: "Barcode", referenceId: 10, fieldLength: 32,
      displayed: true, fieldSeq: 45
    });
    await ensureField(client, 1000120, barcodeColumnId, {
      columnName: "Barcode", name: "Barcode", displayed: true,
      fieldSeq: 45, gridDisplayed: true, gridSeq: 45
    });

    const orderTableId = await tableId(client, "C_Order");
    const detailTableId = await tableId(client, "C_OrderLine");
    const orderColumns = await loadColumnMap(client, orderTableId, CORE_STANDARD_ORDER_FIELDS);
    const detailColumns = await loadColumnMap(client, detailTableId, CORE_STANDARD_ORDER_LINE_FIELDS);
    const orderOcrColumns = await ensureColumns(client, orderTableId, ORDER_OCR_COLUMNS);
    const detailOcrColumns = await ensureColumns(client, detailTableId, ORDER_LINE_OCR_COLUMNS);
    for (const [name, id] of orderOcrColumns) orderColumns.set(name, id);
    for (const [name, id] of detailOcrColumns) detailColumns.set(name, id);

    const windowId = await ensureWindow(client);
    await deactivateLegacyTabs(client, windowId, [orderTableId, detailTableId]);
    const orderTabId = await ensureTab(client, {
      windowId, tableId: orderTableId, name: ORDER_TABLE_LABEL, seqNo: 10,
      tableLevel: 0, singleRow: true, readOnly: false,
      orderBy: "DateOrdered DESC, DocumentNo DESC",
      whereClause: "C_Order.IsSOTrx='N'"
    });
    const detailTabId = await ensureTab(client, {
      windowId, tableId: detailTableId, name: DETAIL_TABLE_LABEL, seqNo: 20,
      tableLevel: 1, singleRow: false, readOnly: false,
      linkColumnId: detailColumns.get("c_order_id"),
      parentColumnId: orderColumns.get("c_order_id")
    });
    await ensureFields(client, orderTabId, [...CORE_STANDARD_ORDER_FIELDS, ...CORE_ORDER_OCR_FIELDS], orderColumns, fieldGroups);
    await ensureFields(client, detailTabId, [...CORE_STANDARD_ORDER_LINE_FIELDS, ...CORE_ORDER_LINE_OCR_FIELDS], detailColumns, fieldGroups);
    await hideNonCoreWindowFields(client, orderTabId, detailTabId);
    await ensureWindowFieldConsistency(client, windowId);
    await ensureWindowEditableFields(client, windowId);
    await backfillPublishedOrderDates(client);
    await backfillImportedOrderDocTypes(client);
    await removeBlankStatusLines(client, windowId);
    const menuId = await ensureMenu(client, windowId);
    await ensureRoleMenuTree(client, SAIGON_ADMIN_ROLE_KEYS, menuId);
    await ensureRoleWindowAccess(client, windowId, SAIGON_ADMIN_ROLE_KEYS);
    await ensureRoleUnrestrictedOrderEditing(client, SAIGON_ADMIN_ROLE_KEYS);
    await ensureReadOutsideTableAccessIncludeList(client);
    await removeRestrictiveRoleTableAccess(client, SAIGON_ADMIN_ROLE_KEYS);
    await assertWindowMetadata(client, windowId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureAiReaderDictionary(client: PoolClient): Promise<void> {
  /*
  const sourceHeader = await ensurePhysicalTableDictionary(client, "kg_order_ai", "Chứng từ đọc file");
  const sourceDetail = await ensurePhysicalTableDictionary(client, "kg_order_detail_ai", "Sản phẩm đọc từ file");
  const orderHeader = await ensurePhysicalTableDictionary(client, "kg_order", "Đơn hàng đọc file");
  const orderDetail = await ensurePhysicalTableDictionary(client, "kg_order_detail", "Sản phẩm đơn hàng đọc file");

  */
  const runtimeHeader = await ensurePhysicalTableDictionary(client, "kg_order_ai_test", "Chung tu doc file");
  const runtimeDetail = await ensurePhysicalTableDictionary(client, "kg_order_detail_ai_test", "San pham doc tu file");

  const sourceWindowId = await ensureNamedWindow(
    client,
    AI_SOURCE_WINDOW_NAME,
    "Dữ liệu chứng từ và dòng sản phẩm đọc từ file"
  );
  await ensureAiWindowTabsAndFields(client, {
    windowId: sourceWindowId,
    header: runtimeHeader,
    detail: runtimeDetail,
    headerTabName: "Chứng từ",
    detailTabName: "Dòng sản phẩm",
    parentColumnName: "kg_order_ai_test_id"
  });

  const orderWindowId = await ensureNamedWindow(
    client,
    AI_ORDER_WINDOW_NAME,
    "Đơn hàng trung gian đã tạo từ dữ liệu đọc file"
  );
  await ensureAiWindowTabsAndFields(client, {
    windowId: orderWindowId,
    header: runtimeHeader,
    detail: runtimeDetail,
    headerTabName: "Đơn hàng",
    detailTabName: "Dòng sản phẩm",
    parentColumnName: "kg_order_ai_test_id"
  });

  for (const windowId of [sourceWindowId, orderWindowId]) {
    const menuId = await ensureNamedMenu(client, windowId);
    await ensureRoleMenuTree(client, SAIGON_ADMIN_ROLE_KEYS, menuId);
    await ensureRoleWindowAccess(client, windowId, SAIGON_ADMIN_ROLE_KEYS);
    await assertWindowMetadata(client, windowId);
  }
}

async function ensurePhysicalTableDictionary(
  client: PoolClient,
  tableName: string,
  tableLabel: string
): Promise<{
  tableName: string;
  tableId: number;
  columns: Map<string, number>;
  fields: FieldSpec[];
}> {
  await ensureTableSequence(client, tableName);
  const tableIdValue = await ensureTable(client, tableName, tableLabel);
  const physicalColumns = await loadPhysicalColumns(client, tableName);
  const specs = physicalColumns.map((column, index) =>
    physicalColumnToSpec(tableName, column, index + 1)
  );
  const columns = await ensureColumns(client, tableIdValue, specs);
  const fields = specs.map((spec) => ({
    columnName: spec.columnName,
    name: spec.name,
    displayed: shouldDisplayAiField(spec.columnName),
    fieldSeq: spec.fieldSeq,
    sameLine: shouldDisplayAiField(spec.columnName) && (spec.fieldSeq ?? 0) % 30 !== 10,
    readOnly: spec.updateable === false,
    gridDisplayed: shouldDisplayAiGridField(spec.columnName),
    gridSeq: shouldDisplayAiGridField(spec.columnName) ? spec.fieldSeq : 0
  }));
  return { tableName, tableId: tableIdValue, columns, fields };
}

async function loadPhysicalColumns(client: PoolClient, tableName: string): Promise<PhysicalColumn[]> {
  const result = await client.query<PhysicalColumn>(`
    SELECT column_name, data_type, udt_name, character_maximum_length,
           numeric_precision, numeric_scale, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'adempiere' AND table_name = lower($1)
    ORDER BY ordinal_position
  `, [tableName]);
  if (!result.rows.length) {
    throw new Error(`Không tìm thấy cột vật lý của adempiere.${tableName}`);
  }
  return result.rows;
}

function physicalColumnToSpec(tableName: string, column: PhysicalColumn, index: number): ColumnSpec {
  const columnName = column.column_name;
  const reference = referenceForPhysicalColumn(column);
  const isKey = columnName === `${tableName}_id`;
  const isParent = columnName === parentColumnForDetailTable(tableName);
  return {
    columnName,
    name: labelForAiColumn(columnName),
    referenceId: isKey ? 13 : reference.referenceId,
    referenceValueId: reference.referenceValueId,
    valRuleId: reference.valRuleId,
    fieldLength: fieldLengthForPhysicalColumn(column),
    mandatory: column.is_nullable === "NO",
    key: isKey,
    parent: isParent,
    identifier: identifierForAiColumn(columnName),
    updateable: !isKey && !["ad_client_id", "created", "createdby", "updated", "updatedby"].includes(columnName),
    defaultValue: defaultValueForAiColumn(columnName),
    displayed: shouldDisplayAiField(columnName),
    fieldSeq: index * 10
  };
}

function referenceForPhysicalColumn(column: PhysicalColumn): {
  referenceId: number;
  referenceValueId?: number;
  valRuleId?: number;
} {
  const name = column.column_name;
  if (name === "createdby" || name === "updatedby" || name === "nhan_vien_kinh_doanh_id") {
    return { referenceId: 30, referenceValueId: 110 };
  }
  if (name === "c_bpartner_id") return { referenceId: 30, valRuleId: 230 };
  if (name === "c_uom_id") return { referenceId: 19, valRuleId: 210 };
  if (name === "c_currency_id") return { referenceId: 19 };
  if (name.endsWith("_id")) return { referenceId: 19 };
  if (name === "isactive" || name === "kiem_tra_file" || name.endsWith("_matched")) return { referenceId: 20 };
  if (column.data_type === "date") return { referenceId: 15 };
  if (column.data_type.includes("timestamp")) return { referenceId: 16 };
  if (column.udt_name === "jsonb" || column.data_type === "text") return { referenceId: 14 };
  if (column.data_type === "integer") return { referenceId: 11 };
  if (column.data_type === "numeric") {
    if (name.includes("so_luong")) return { referenceId: 29 };
    if (/(tien|gia|thanh|amount|total|tax|discount|vat)/.test(name)) return { referenceId: 12 };
    if ((column.numeric_scale ?? 0) === 0) return { referenceId: 11 };
    return { referenceId: 22 };
  }
  return { referenceId: 10 };
}

function fieldLengthForPhysicalColumn(column: PhysicalColumn): number {
  if (column.character_maximum_length) return column.character_maximum_length;
  if (column.udt_name === "jsonb" || column.data_type === "text") return 4000;
  if (column.data_type === "date") return 7;
  if (column.data_type.includes("timestamp")) return 29;
  if (column.data_type === "integer") return 10;
  if (column.data_type === "numeric") return column.numeric_precision ?? 24;
  return 255;
}

function defaultValueForAiColumn(columnName: string): string | undefined {
  if (columnName === "ad_client_id") return "@#AD_Client_ID@";
  if (columnName === "ad_org_id") return "@#AD_Org_ID@";
  if (columnName === "isactive") return "Y";
  if (columnName === "created" || columnName === "updated") return "SYSDATE";
  if (columnName === "createdby" || columnName === "updatedby") return "@#AD_User_ID@";
  if (columnName === "c_currency_id") return "@#C_Currency_ID@";
  return undefined;
}

function parentColumnForDetailTable(tableName: string): string {
  if (tableName === "kg_order_detail_ai_test") return "kg_order_ai_test_id";
  if (tableName === "kg_order_detail_ai") return "kg_order_ai_id";
  if (tableName === "kg_order_detail") return "kg_order_id";
  return "";
}

function identifierForAiColumn(columnName: string): boolean {
  return ["value", "so_po", "order_id", "tieu_de_chung_tu", "ten_file_nguon"].includes(columnName);
}

function shouldDisplayAiField(columnName: string): boolean {
  return ![
    "ad_client_id", "ad_org_id", "isactive", "created", "createdby", "updated", "updatedby",
    "raw_json", "raw_text", "source_sha256", "batch_id", "batch_position",
    "stored_name", "storage_path", "attempts", "next_attempt_at", "error_message",
    "started_at", "completed_at", "gemini_file_name", "model", "prompt_version",
    "published_kg_order_id", "published_at", "gia_da_gom_thue"
  ].includes(columnName);
}

function shouldDisplayAiGridField(columnName: string): boolean {
  return [
    "value", "so_po", "order_id", "ngay_dat_hang", "ngay_giao_hang",
    "ten_nha_cung_cap", "ma_cua_hang", "ten_cua_hang", "ten_ben_mua", "tong_tien", "tong_tien_sau_thue",
    "dong", "ma_san_pham_khach_hang", "ma_san_pham_nha_cung_cap", "barcode",
    "ten_san_pham_khach_hang", "so_luong", "don_vi_tinh", "thanh_tien"
  ].includes(columnName);
}

function labelForAiColumn(columnName: string): string {
  const labels: Record<string, string> = {
    kg_order_ai_id: "Chứng từ đọc file",
    kg_order_detail_ai_id: "Dòng sản phẩm đọc file",
    kg_order_id: "Đơn hàng đọc file",
    kg_order_detail_id: "Dòng sản phẩm đơn hàng",
    value: "Số chứng từ",
    description: "Ghi chú",
    ma_tai_lieu_nguon: "Mã tài liệu nguồn",
    thu_tu_phieu_trong_file: "Thứ tự phiếu trong file",
    source_sha256: "SHA-256 file nguồn",
    ten_file_nguon: "Tên file nguồn",
    duoi_file: "Đuôi file",
    loai_mime: "Loại MIME",
    kich_thuoc_file: "Kích thước file",
    so_trang: "Số trang",
    phuong_thuc_trich_xuat: "Phương thức đọc",
    raw_text: "Nội dung thô",
    raw_json: "JSON thô",
    tieu_de_chung_tu: "Tiêu đề chứng từ",
    loai_chung_tu: "Loại chứng từ",
    so_po: "Số PO",
    order_id: "Order ID",
    ngay_dat_hang: "Ngày đặt hàng",
    ngay_giao_hang: "Ngày giao hàng",
    ngay_xuat_hoa_don: "Ngày xuất hóa đơn",
    ma_nha_cung_cap: "Mã nhà cung cấp",
    ten_nha_cung_cap: "Tên nhà cung cấp",
    c_bpartner_id: "Đối tác iDempiere",
    ma_cua_hang: "Mã cửa hàng",
    ten_cua_hang: "Tên cửa hàng",
    dia_chi_giao_hang: "Địa chỉ giao hàng",
    ten_nhan_vien_kinh_doanh: "Tên nhân viên kinh doanh",
    nhan_vien_kinh_doanh_id: "Nhân viên kinh doanh",
    trang_thai_don_hang: "Trạng thái đơn hàng",
    trang_thai_xu_ly: "Trạng thái xử lý",
    ma_khuyen_mai: "Mã khuyến mãi",
    tien_hang: "Tiền hàng",
    ty_le_vat: "Tỷ lệ VAT",
    tien_thue: "Tiền thuế",
    tong_tien: "Tổng tiền",
    tong_tien_sau_thue: "Tổng tiền sau thuế",
    ma_tien_te: "Mã tiền tệ",
    c_currency_id: "Tiền tệ",
    kg_po_id: "PO iDempiere",
    thoi_gian_xac_nhan: "Thời gian xác nhận",
    kiem_tra_file: "Kiểm tra file",
    kg_po_d_id: "Dòng PO iDempiere",
    dong: "Dòng",
    dong_nguon: "Dòng nguồn",
    trang_nguon: "Trang nguồn",
    barcode: "Barcode",
    ten_san_pham_khach_hang: "Tên sản phẩm khách hàng",
    ten_san_pham_cong_ty: "Tên sản phẩm công ty",
    quy_cach: "Quy cách",
    so_luong: "Số lượng",
    don_vi_tinh: "Đơn vị tính",
    so_luong_quy_doi: "Số lượng quy đổi",
    kg_sp_id: "Sản phẩm iDempiere",
    c_uom_id: "Đơn vị iDempiere",
    don_gia_khach_hang: "Đơn giá khách hàng",
    don_gia_cong_ty: "Đơn giá công ty",
    thanh_tien: "Thành tiền",
    trang_thai_lien_ket: "Trạng thái liên kết"
  };
  return labels[columnName] ?? columnName
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function ensureNamedWindow(
  client: PoolClient,
  name: string,
  description: string
): Promise<number> {
  const existing = await client.query<{ ad_window_id: string }>(`
    SELECT ad_window_id FROM adempiere.ad_window
    WHERE name = $1
    ORDER BY ad_window_id
    LIMIT 1
  `, [name]);
  if (existing.rows[0]) {
    const id = Number(existing.rows[0].ad_window_id);
    await client.query(`
      UPDATE adempiere.ad_window SET name = $1, description = $2,
        windowtype = 'M', issotrx = 'N', entitytype = $3, isactive = 'Y',
        updated = now(), updatedby = $4
      WHERE ad_window_id = $5
    `, [name, description, ENTITY_TYPE, SYSTEM_USER_ID, id]);
    return id;
  }
  const id = await nextId(client, "AD_Window");
  await client.query(`
    INSERT INTO adempiere.ad_window(
      ad_window_id, ad_client_id, ad_org_id, createdby, updatedby,
      name, description, windowtype, issotrx, entitytype, processing,
      isdefault, isbetafunctionality, isactive
    ) VALUES ($1, 0, 0, $2, $2, $3, $4, 'M', 'N', $5,
      'N', 'N', 'N', 'Y')
  `, [id, SYSTEM_USER_ID, name, description, ENTITY_TYPE]);
  return id;
}

async function ensureNamedMenu(client: PoolClient, windowId: number): Promise<number> {
  const windowRow = await client.query<{ name: string; description: string | null }>(`
    SELECT name, description FROM adempiere.ad_window WHERE ad_window_id = $1
  `, [windowId]);
  const windowName = windowRow.rows[0]?.name;
  if (!windowName) throw new Error(`Không tìm thấy AD_Window ${windowId}`);

  const existing = await client.query<{ ad_menu_id: string }>(`
    SELECT ad_menu_id FROM adempiere.ad_menu WHERE ad_window_id = $1
  `, [windowId]);
  if (existing.rows[0]) {
    const id = Number(existing.rows[0].ad_menu_id);
    await client.query(`
      UPDATE adempiere.ad_menu SET name = $1, description = $2,
        action = 'W', ad_window_id = $3, issummary = 'N', issotrx = 'N',
        isreadonly = 'N', entitytype = $4, isactive = 'Y',
        updated = now(), updatedby = $5
      WHERE ad_menu_id = $6
    `, [windowName, windowRow.rows[0].description, windowId, ENTITY_TYPE, SYSTEM_USER_ID, id]);
    return id;
  }
  const id = await nextId(client, "AD_Menu");
  await client.query(`
    INSERT INTO adempiere.ad_menu(
      ad_menu_id, ad_client_id, ad_org_id, createdby, updatedby,
      name, description, action, ad_window_id, issummary, issotrx,
      isreadonly, iscentrallymaintained, entitytype, isactive
    ) VALUES ($1, 0, 0, $2, $2, $3, $4, 'W', $5,
      'N', 'N', 'N', 'Y', $6, 'Y')
  `, [id, SYSTEM_USER_ID, windowName, windowRow.rows[0].description, windowId, ENTITY_TYPE]);
  return id;
}

async function ensureAiWindowTabsAndFields(
  client: PoolClient,
  input: {
    windowId: number;
    header: { tableId: number; columns: Map<string, number>; fields: FieldSpec[] };
    detail: { tableId: number; columns: Map<string, number>; fields: FieldSpec[] };
    headerTabName: string;
    detailTabName: string;
    parentColumnName: string;
  }
): Promise<void> {
  const headerTabId = await ensureTab(client, {
    windowId: input.windowId,
    tableId: input.header.tableId,
    name: input.headerTabName,
    seqNo: 10,
    tableLevel: 0,
    singleRow: true,
    readOnly: false,
    orderBy: "Created DESC"
  });
  const detailTabId = await ensureTab(client, {
    windowId: input.windowId,
    tableId: input.detail.tableId,
    name: input.detailTabName,
    seqNo: 20,
    tableLevel: 1,
    singleRow: false,
    readOnly: false,
    linkColumnId: input.detail.columns.get(input.parentColumnName.toLowerCase()),
    parentColumnId: input.header.columns.get(input.parentColumnName.toLowerCase()),
    orderBy: "Dong"
  });
  await ensureFields(client, headerTabId, input.header.fields, input.header.columns, new Map());
  await ensureFields(client, detailTabId, input.detail.fields, input.detail.columns, new Map());
}

async function backfillOrderExtraFields(client: PoolClient): Promise<void> {
  const orders = await client.query<{
    c_order_id: string;
    kg_source_payload: string;
    kg_reference_number: string | null;
  }>(`
    SELECT c_order_id::text, kg_source_payload, kg_reference_number
    FROM adempiere.c_order
    WHERE kg_source_payload IS NOT NULL
      AND (kg_print_date IS NULL OR kg_print_time IS NULL OR kg_form_type IS NULL
        OR kg_approved_by IS NULL OR kg_industry_code IS NULL
        OR kg_contract_number IS NULL)
  `);
  for (const order of orders.rows) {
    let normalized: Record<string, unknown> = {};
    try {
      const payload = JSON.parse(order.kg_source_payload) as Record<string, unknown>;
      if (payload.normalized_result && typeof payload.normalized_result === "object"
        && !Array.isArray(payload.normalized_result)) {
        normalized = payload.normalized_result as Record<string, unknown>;
      }
    } catch {
      continue;
    }
    const fields = Array.isArray(normalized.raw_fields) ? normalized.raw_fields : [];
    await client.query(`
      UPDATE adempiere.c_order SET
        kg_print_date = coalesce(kg_print_date, $2),
        kg_print_time = coalesce(kg_print_time, $3),
        kg_form_type = coalesce(kg_form_type, $4),
        kg_approved_by = coalesce(kg_approved_by, $5),
        kg_industry_code = coalesce(kg_industry_code, $6),
        kg_contract_number = coalesce(kg_contract_number, $7),
        updated = updated
      WHERE c_order_id = $1
    `, [
      order.c_order_id,
      migrationRawFieldValue(fields, ["Ngày In"]),
      migrationRawFieldValue(fields, ["Giờ In"]),
      migrationRawFieldValue(fields, ["Loại Phiếu"]),
      migrationRawFieldValue(fields, ["Được Chấp Thuận Bởi", "Người duyệt"]),
      migrationRawFieldValue(fields, ["Mã Ngành Hàng"]),
      order.kg_reference_number
        ?? migrationRawFieldValue(fields, ["Số Hợp Đồng", "Hợp đồng số", "Số Hợp Đồng / Hợp đồng số"])
    ]);
  }
}

async function clearNonCoreOrderFields(client: PoolClient): Promise<void> {
  await client.query(`
    UPDATE adempiere.c_order SET
      kg_template_key = NULL,
      kg_document_number = NULL,
      kg_buyer_code = NULL,
      kg_supplier_code = NULL,
      kg_buyer_tax_id = NULL,
      kg_supplier_tax_id = NULL,
      kg_contact_phone = NULL,
      kg_contact_email = NULL,
      kg_bill_to_address = NULL,
      kg_payment_terms = NULL,
      kg_payment_method = NULL,
      kg_delivery_method = NULL,
      kg_delivery_window = NULL,
      kg_price_list_name = NULL,
      kg_confidence = NULL,
      kg_warnings = NULL,
      kg_extra_fields = NULL,
      updated = updated
    WHERE kg_source_document_id IS NOT NULL
  `);
  await client.query(`
    UPDATE adempiere.c_orderline line SET
      kg_sp_id = NULL,
      kg_vendor_product_code = NULL,
      kg_model = NULL,
      kg_article_code = NULL,
      kg_sku = NULL,
      kg_ou_type = NULL,
      kg_free_quantity = NULL,
      kg_list_price = NULL,
      kg_confidence = NULL,
      kg_extra_fields = NULL,
      updated = line.updated
    FROM adempiere.c_order orders
    WHERE orders.c_order_id = line.c_order_id
      AND orders.kg_source_document_id IS NOT NULL
  `);
}

async function hideNonCoreWindowFields(
  client: PoolClient,
  orderTabId: number,
  detailTabId: number
): Promise<void> {
  const orderColumns = [
    ...CORE_STANDARD_ORDER_FIELDS,
    ...CORE_ORDER_OCR_FIELDS
  ].filter((field) => field.displayed || field.gridDisplayed).map((field) => field.columnName);
  const detailColumns = [
    ...CORE_STANDARD_ORDER_LINE_FIELDS,
    ...CORE_ORDER_LINE_OCR_FIELDS
  ].filter((field) => field.displayed || field.gridDisplayed).map((field) => field.columnName);

  await client.query(`
    UPDATE adempiere.ad_field field SET
      isdisplayed = 'N',
      isdisplayedgrid = 'N',
      updated = now(),
      updatedby = $3
    FROM adempiere.ad_column columnmeta
    WHERE columnmeta.ad_column_id = field.ad_column_id
      AND field.ad_tab_id = $1
      AND field.isactive = 'Y'
      AND NOT (columnmeta.columnname = ANY($2::text[]))
  `, [orderTabId, orderColumns, SYSTEM_USER_ID]);

  await client.query(`
    UPDATE adempiere.ad_field field SET
      isdisplayed = 'N',
      isdisplayedgrid = 'N',
      updated = now(),
      updatedby = $3
    FROM adempiere.ad_column columnmeta
    WHERE columnmeta.ad_column_id = field.ad_column_id
      AND field.ad_tab_id = $1
      AND field.isactive = 'Y'
      AND NOT (columnmeta.columnname = ANY($2::text[]))
  `, [detailTabId, detailColumns, SYSTEM_USER_ID]);
}

async function ensureWindowFieldConsistency(client: PoolClient, windowId: number): Promise<void> {
  await client.query(`
    UPDATE adempiere.ad_field field SET
      isdisplayed = 'N',
      isdisplayedgrid = 'N',
      isactive = 'N',
      updated = now(),
      updatedby = $2
    FROM adempiere.ad_tab tab, adempiere.ad_column columnmeta
    WHERE field.ad_tab_id = tab.ad_tab_id
      AND field.ad_column_id = columnmeta.ad_column_id
      AND tab.ad_window_id = $1
      AND field.isactive = 'Y'
      AND columnmeta.ad_table_id <> tab.ad_table_id
  `, [windowId, SYSTEM_USER_ID]);

  await client.query(`
    WITH ranked AS (
      SELECT field.ad_field_id,
             row_number() OVER (
               PARTITION BY field.ad_tab_id, lower(columnmeta.columnname)
               ORDER BY
                 CASE WHEN columnmeta.ad_table_id = tab.ad_table_id THEN 0 ELSE 1 END,
                 CASE WHEN field.isdisplayed = 'Y' THEN 0 ELSE 1 END,
                 COALESCE(field.seqno, 999999),
                 field.ad_field_id
             ) AS row_no
      FROM adempiere.ad_field field
      JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
      JOIN adempiere.ad_column columnmeta ON columnmeta.ad_column_id = field.ad_column_id
      WHERE tab.ad_window_id = $1
        AND field.isactive = 'Y'
    )
    UPDATE adempiere.ad_field field SET
      isdisplayed = 'N',
      isdisplayedgrid = 'N',
      updated = now(),
      updatedby = $2
    FROM ranked
    WHERE field.ad_field_id = ranked.ad_field_id
      AND ranked.row_no > 1
  `, [windowId, SYSTEM_USER_ID]);
}

async function backfillPublishedOrderDates(client: PoolClient): Promise<void> {
  const orders = await client.query<{
    c_order_id: string;
    kg_source_payload: string;
  }>(`
    SELECT c_order_id::text, kg_source_payload
    FROM adempiere.c_order
    WHERE kg_source_payload IS NOT NULL
      AND kg_source_document_id IS NOT NULL
  `);

  for (const order of orders.rows) {
    let normalized: Record<string, unknown> = {};
    try {
      const payload = JSON.parse(order.kg_source_payload) as Record<string, unknown>;
      const candidate = payload.normalized_result;
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        normalized = candidate as Record<string, unknown>;
      }
    } catch {
      continue;
    }

    const poDate = migrationDateValue(normalized.po_date);
    const deliveryDate = migrationDateValue(normalized.delivery_date);
    const dateOrdered = poDate ?? deliveryDate;
    const datePromised = deliveryDate ?? poDate;
    if (!dateOrdered || !datePromised) continue;

    await client.query(`
      UPDATE adempiere.c_order SET
        dateordered = $2::timestamp,
        dateacct = $2::timestamp,
        datepromised = $3::timestamp,
        updated = updated
      WHERE c_order_id = $1
    `, [order.c_order_id, dateOrdered, datePromised]);

    await client.query(`
      UPDATE adempiere.c_orderline SET
        dateordered = $2::timestamp,
        datepromised = coalesce(datepromised, $3::timestamp),
        updated = updated
      WHERE c_order_id = $1
    `, [order.c_order_id, dateOrdered, datePromised]);
  }
}

function migrationRawFieldValue(fields: unknown[], labels: string[]): string | null {
  const accepted = new Set(labels.map(normalizeMetadataText));
  for (const field of fields) {
    if (!field || typeof field !== "object" || Array.isArray(field)) continue;
    const record = field as Record<string, unknown>;
    if (typeof record.label !== "string" || !accepted.has(normalizeMetadataText(record.label))) continue;
    if (record.value === null || record.value === undefined || record.value === "") return null;
    return String(record.value);
  }
  return null;
}

function migrationDateValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = text.match(/^(\d{1,2})[\/. -](\d{1,2})[\/. -](\d{4})/);
  if (!local) return null;
  const day = local[1].padStart(2, "0");
  const month = local[2].padStart(2, "0");
  return `${local[3]}-${month}-${day}`;
}

function normalizeMetadataText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function ensureEntityType(client: PoolClient): Promise<void> {
  const existing = await client.query("SELECT 1 FROM adempiere.ad_entitytype WHERE entitytype = $1", [ENTITY_TYPE]);
  if (existing.rowCount) {
    await client.query(`
      UPDATE adempiere.ad_entitytype
      SET name = 'GreenCook',
          description = 'Đối tượng tích hợp chứng từ GreenCook',
          modelpackage = 'vn.greencook.order',
          isactive = 'Y',
          updated = now(),
          updatedby = $2
      WHERE entitytype = $1
    `, [ENTITY_TYPE, SYSTEM_USER_ID]);
    return;
  }
  const id = await nextId(client, "AD_EntityType");
  await client.query(`
    INSERT INTO adempiere.ad_entitytype(
      ad_entitytype_id, ad_client_id, ad_org_id, createdby, updatedby,
      entitytype, name, description, version, modelpackage, isactive
    ) VALUES ($1, 0, 0, $2, $2, $3, 'GreenCook',
      'Đối tượng tích hợp chứng từ GreenCook', '1.0.0', 'vn.greencook.order', 'Y')
  `, [id, SYSTEM_USER_ID, ENTITY_TYPE]);
}

async function ensureFieldGroups(client: PoolClient): Promise<Map<FieldGroupKey, number>> {
  const result = new Map<FieldGroupKey, number>();
  for (const group of FIELD_GROUPS) {
    const existing = await client.query<{ ad_fieldgroup_id: string }>(`
      SELECT ad_fieldgroup_id
      FROM adempiere.ad_fieldgroup
      WHERE entitytype = $1 AND name = $2
      ORDER BY ad_fieldgroup_id
      LIMIT 1
    `, [ENTITY_TYPE, group.name]);

    let id: number;
    if (existing.rows[0]) {
      id = Number(existing.rows[0].ad_fieldgroup_id);
      await client.query(`
        UPDATE adempiere.ad_fieldgroup
        SET fieldgrouptype = 'C', iscollapsedbydefault = $1,
            isactive = 'Y', updated = now(), updatedby = $2
        WHERE ad_fieldgroup_id = $3
      `, [yn(group.collapsed), SYSTEM_USER_ID, id]);
    } else {
      id = await nextId(client, "AD_FieldGroup");
      await client.query(`
        INSERT INTO adempiere.ad_fieldgroup(
          ad_fieldgroup_id, ad_client_id, ad_org_id, createdby, updatedby,
          name, entitytype, fieldgrouptype, iscollapsedbydefault, isactive
        ) VALUES ($1, 0, 0, $2, $2, $3, $4, 'C', $5, 'Y')
      `, [id, SYSTEM_USER_ID, group.name, ENTITY_TYPE, yn(group.collapsed)]);
    }
    result.set(group.key, id);
  }
  return result;
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
  const physicalTable = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass('adempiere.' || $1)::text AS table_name", [tableName]
  );
  if (!physicalTable.rows[0]?.table_name) {
    throw new Error(`Không tìm thấy bảng vật lý adempiere.${tableName}`);
  }
  const existing = await client.query<{ ad_table_id: string }>(
    "SELECT ad_table_id FROM adempiere.ad_table WHERE lower(tablename) = lower($1)", [tableName]
  );
  if (existing.rows[0]) {
    const id = Number(existing.rows[0].ad_table_id);
    await client.query(`
      UPDATE adempiere.ad_table SET name = $1, tablename = $2,
        accesslevel = '3', entitytype = $3, isactive = 'Y', isview = 'N',
        isdeleteable = 'Y',
        updated = now(), updatedby = $4
      WHERE ad_table_id = $5
    `, [name, tableName, ENTITY_TYPE, SYSTEM_USER_ID, id]);
    return id;
  }
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

async function loadColumnMap(
  client: PoolClient,
  tableIdValue: number,
  specs: FieldSpec[]
): Promise<Map<string, number>> {
  const names = specs.map((spec) => spec.columnName.toLowerCase());
  const result = await client.query<{ ad_column_id: string; columnname: string }>(`
    SELECT ad_column_id, columnname
    FROM adempiere.ad_column
    WHERE ad_table_id = $1 AND lower(columnname) = ANY($2::text[])
      AND isactive = 'Y'
  `, [tableIdValue, names]);
  const columns = new Map(result.rows.map((row) => [row.columnname.toLowerCase(), Number(row.ad_column_id)]));
  const missing = names.filter((name) => !columns.has(name));
  if (missing.length) throw new Error(`Thiếu AD_Column chuẩn: ${missing.join(", ")}`);
  return columns;
}

async function deactivateLegacyTabs(
  client: PoolClient,
  windowId: number,
  activeTableIds: number[]
): Promise<void> {
  await client.query(`
    UPDATE adempiere.ad_tab
    SET isactive = 'N', updated = now(), updatedby = $2
    WHERE ad_window_id = $1 AND ad_table_id <> ALL($3::numeric[])
  `, [windowId, SYSTEM_USER_ID, activeTableIds]);
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
        name = $1, ad_reference_id = $2, ad_reference_value_id = $3,
        ad_val_rule_id = $4, fieldlength = $5, defaultvalue = $6,
        iskey = $7, isparent = $8, ismandatory = $9,
        isupdateable = $10, isidentifier = $11, seqno = $12,
        entitytype = $13, isalwaysupdateable = $14,
        isactive = 'Y', updated = now(), updatedby = $15
      WHERE ad_column_id = $16
    `, [
      spec.name, spec.referenceId, spec.referenceValueId ?? null,
      spec.valRuleId ?? null, spec.fieldLength, spec.defaultValue ?? null,
      yn(spec.key), yn(spec.parent), yn(spec.mandatory),
      spec.updateable === false ? "N" : "Y", yn(spec.identifier), spec.fieldSeq ?? null,
      ENTITY_TYPE, spec.updateable === false ? "N" : "Y", SYSTEM_USER_ID, id
    ]);
    return id;
  }
  const id = await nextId(client, "AD_Column");
  const elementId = await ensureElement(client, spec.columnName, spec.name);
  await client.query(`
    INSERT INTO adempiere.ad_column(
      ad_column_id, ad_client_id, ad_org_id, createdby, updatedby, name,
      version, columnname, ad_table_id, ad_reference_id, ad_reference_value_id, ad_val_rule_id,
      fieldlength, defaultvalue, iskey, isparent, ismandatory, isupdateable,
      isidentifier, seqno, ad_element_id, entitytype, isalwaysupdateable, isactive
    ) VALUES (
      $1, 0, 0, $2, $2, $3, 0, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, 'Y'
    )
  `, [
    id, SYSTEM_USER_ID, spec.name, spec.columnName, tableIdValue, spec.referenceId,
    spec.referenceValueId ?? null, spec.valRuleId ?? null, spec.fieldLength, spec.defaultValue ?? null,
    yn(spec.key), yn(spec.parent), yn(spec.mandatory), spec.updateable === false ? "N" : "Y",
    yn(spec.identifier), spec.fieldSeq ?? null, elementId, ENTITY_TYPE,
    spec.updateable === false ? "N" : "Y"
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
    WHERE entitytype = $1 AND name = ANY($2::text[])
    ORDER BY CASE WHEN name = $3 THEN 0 ELSE 1 END, ad_window_id
    LIMIT 1
  `, [ENTITY_TYPE, [WINDOW_NAME, LEGACY_WINDOW_NAME], WINDOW_NAME]);
  if (existing.rows[0]) {
    const id = Number(existing.rows[0].ad_window_id);
    await client.query(`
      UPDATE adempiere.ad_window SET name = $1,
        description = 'Đơn đặt hàng đã xác nhận từ hệ thống xử lý tài liệu',
        windowtype = 'M', issotrx = 'N', entitytype = $2, isactive = 'Y',
        updated = now(), updatedby = $3
      WHERE ad_window_id = $4
    `, [WINDOW_NAME, ENTITY_TYPE, SYSTEM_USER_ID, id]);
    return id;
  }
  const id = await nextId(client, "AD_Window");
  await client.query(`
    INSERT INTO adempiere.ad_window(
      ad_window_id, ad_client_id, ad_org_id, createdby, updatedby,
      name, description, windowtype, issotrx, entitytype, processing,
      isdefault, isbetafunctionality, isactive
    ) VALUES ($1, 0, 0, $2, $2, $3,
      'Đơn đặt hàng đã xác nhận từ hệ thống xử lý tài liệu', 'M', 'N', $4,
      'N', 'N', 'N', 'Y')
  `, [id, SYSTEM_USER_ID, WINDOW_NAME, ENTITY_TYPE]);
  return id;
}

async function ensureTab(client: PoolClient, input: {
  windowId: number;
  tableId: number;
  name: string;
  seqNo: number;
  tableLevel: number;
  singleRow: boolean;
  readOnly?: boolean;
  orderBy?: string;
  whereClause?: string;
  linkColumnId?: number;
  parentColumnId?: number;
}): Promise<number> {
  const existing = await client.query<{ ad_tab_id: string }>(`
    SELECT ad_tab_id FROM adempiere.ad_tab
    WHERE ad_window_id = $1 AND ad_table_id = $2
  `, [input.windowId, input.tableId]);
  if (existing.rows[0]) {
    const id = Number(existing.rows[0].ad_tab_id);
    await client.query(`
      UPDATE adempiere.ad_tab SET name = $1, ad_table_id = $2,
        ad_window_id = $3, seqno = $4, tablevel = $5, issinglerow = $6,
        isreadonly = $7, isinsertrecord = $8, orderbyclause = $9,
        whereclause = $10, ad_column_id = $11, parent_column_id = $12, entitytype = $13,
        processing = 'N', isactive = 'Y', updated = now(), updatedby = $14
      WHERE ad_tab_id = $15
    `, [
      input.name, input.tableId, input.windowId, input.seqNo, input.tableLevel,
      input.singleRow ? "Y" : "N", input.readOnly ? "Y" : "N",
      input.readOnly ? "N" : "Y", input.orderBy ?? null,
      input.whereClause ?? null, input.linkColumnId ?? null, input.parentColumnId ?? null,
      ENTITY_TYPE, SYSTEM_USER_ID, id
    ]);
    return id;
  }
  const id = await nextId(client, "AD_Tab");
  await client.query(`
    INSERT INTO adempiere.ad_tab(
      ad_tab_id, ad_client_id, ad_org_id, createdby, updatedby, name,
      ad_table_id, ad_window_id, seqno, tablevel, issinglerow,
      isreadonly, isinsertrecord, hastree, isinfotab, istranslationtab,
      issorttab, entitytype, processing, orderbyclause, ad_column_id,
      parent_column_id, whereclause, treedisplayedon, isadvancedtab, isactive
    ) VALUES (
      $1, 0, 0, $2, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, 'N', 'N', 'N', 'N', $11, 'N', $12, $13, $14,
      $15, 'B', 'N', 'Y'
    )
  `, [
    id, SYSTEM_USER_ID, input.name, input.tableId, input.windowId,
    input.seqNo, input.tableLevel, input.singleRow ? "Y" : "N",
    input.readOnly ? "Y" : "N", input.readOnly ? "N" : "Y",
    ENTITY_TYPE, input.orderBy ?? null, input.linkColumnId ?? null,
    input.parentColumnId ?? null, input.whereClause ?? null
  ]);
  return id;
}

async function ensureFields(
  client: PoolClient,
  tabId: number,
  specs: FieldSpec[],
  columns: Map<string, number>,
  fieldGroups: Map<FieldGroupKey, number>
): Promise<void> {
  const managedColumnIds = specs.map((spec) => columns.get(spec.columnName.toLowerCase()));
  const missingSpecs = specs.filter((_, index) => !managedColumnIds[index]);
  if (missingSpecs.length) {
    throw new Error(`Thiếu AD_Column ${missingSpecs.map((spec) => spec.columnName).join(", ")}`);
  }
  await client.query(`
    UPDATE adempiere.ad_field
    SET isactive = 'N', isdisplayed = 'N', isdisplayedgrid = 'N',
        seqno = 0, seqnogrid = 0, updated = now(), updatedby = $3
    WHERE ad_tab_id = $1
      AND NOT (ad_column_id = ANY($2::numeric[]))
  `, [tabId, managedColumnIds, SYSTEM_USER_ID]);

  for (const spec of specs) {
    const columnId = columns.get(spec.columnName.toLowerCase());
    if (!columnId) throw new Error(`Thiếu AD_Column ${spec.columnName}`);
    const fieldGroupId = spec.fieldGroup ? fieldGroups.get(spec.fieldGroup) : undefined;
    if (spec.fieldGroup && !fieldGroupId) {
      throw new Error(`Thiếu AD_FieldGroup ${spec.fieldGroup}`);
    }
    await ensureField(client, tabId, columnId, spec, fieldGroupId);
  }
}

async function ensureField(
  client: PoolClient,
  tabId: number,
  columnId: number,
  spec: FieldSpec,
  fieldGroupId?: number
): Promise<number> {
  const displayed = Boolean(spec.displayed);
  const seqNo = displayed ? spec.fieldSeq ?? 0 : 0;
  const gridDisplayed = displayed && (spec.gridDisplayed ?? displayed);
  const gridSeqNo = gridDisplayed ? spec.gridSeq ?? seqNo : 0;
  const existing = await client.query<{ ad_field_id: string }>(`
    SELECT ad_field_id FROM adempiere.ad_field
    WHERE ad_tab_id = $1 AND ad_column_id = $2
  `, [tabId, columnId]);
  if (existing.rows[0]) {
    await client.query(`
      UPDATE adempiere.ad_field SET name = $1, seqno = $2, seqnogrid = $3,
        isdisplayed = $4, isdisplayedgrid = $5, issameline = $6,
        isreadonly = $7, ad_fieldgroup_id = $8,
        iscentrallymaintained = 'N', entitytype = $9,
        isalwaysupdateable = $10, isactive = 'Y',
        updated = now(), updatedby = $11
      WHERE ad_field_id = $12
    `, [
      spec.name, seqNo, gridSeqNo, yn(displayed), yn(gridDisplayed),
      yn(spec.sameLine), yn(spec.readOnly), fieldGroupId ?? null,
      ENTITY_TYPE, spec.readOnly ? "N" : "Y", SYSTEM_USER_ID,
      existing.rows[0].ad_field_id
    ]);
    return Number(existing.rows[0].ad_field_id);
  }
  const id = await nextId(client, "AD_Field");
  await client.query(`
    INSERT INTO adempiere.ad_field(
      ad_field_id, ad_client_id, ad_org_id, createdby, updatedby,
      name, ad_tab_id, ad_column_id, seqno, seqnogrid,
      isdisplayed, isdisplayedgrid, issameline,
      isreadonly, isfieldonly, isheading, iscentrallymaintained,
      ad_fieldgroup_id, entitytype, isalwaysupdateable, isactive
    ) VALUES (
      $1, 0, 0, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, 'N', 'N', 'N', $12, $13, $14, 'Y'
    )
  `, [
    id, SYSTEM_USER_ID, spec.name, tabId, columnId, seqNo,
    gridSeqNo, yn(displayed), yn(gridDisplayed), yn(spec.sameLine),
    yn(spec.readOnly), fieldGroupId ?? null, ENTITY_TYPE,
    spec.readOnly ? "N" : "Y"
  ]);
  return id;
}

async function ensureWindowEditableFields(client: PoolClient, windowId: number): Promise<void> {
  await client.query(`
    UPDATE adempiere.ad_field field
    SET isreadonly = 'N',
        isalwaysupdateable = 'Y',
        readonlylogic = NULL,
        updated = now(),
        updatedby = $2
    FROM adempiere.ad_tab tab
    JOIN adempiere.ad_column column_meta ON column_meta.ad_table_id = tab.ad_table_id
    JOIN adempiere.ad_table table_meta ON table_meta.ad_table_id = tab.ad_table_id
    WHERE field.ad_tab_id = tab.ad_tab_id
      AND field.ad_column_id = column_meta.ad_column_id
      AND tab.ad_window_id = $1
      AND field.isdisplayed = 'Y'
      AND column_meta.iskey <> 'Y'
      AND column_meta.isparent <> 'Y'
      AND lower(column_meta.columnname) <> ALL($3::text[])
      AND (
        lower(column_meta.columnname) LIKE 'kg_%'
        OR (
          table_meta.tablename = 'C_Order'
          AND column_meta.columnname = ANY($4::text[])
        )
        OR (
          table_meta.tablename = 'C_OrderLine'
          AND column_meta.columnname = ANY($5::text[])
        )
      )
  `, [
    windowId,
    SYSTEM_USER_ID,
    ["docstatus", "c_doctype_id", "totallines", "grandtotal", "ispayschedulevalid", "isapproved", "isdelivered", "isinvoiced", "isprinted", "istransferred", "processed", "posted", "linenetamt"],
    EDITABLE_STANDARD_ORDER_COLUMNS,
    EDITABLE_STANDARD_ORDER_LINE_COLUMNS
  ]);

  await client.query(`
    UPDATE adempiere.ad_column column_meta
    SET isupdateable = 'Y',
        isalwaysupdateable = 'Y',
        readonlylogic = NULL,
        updated = now(),
        updatedby = $1
    FROM adempiere.ad_table table_meta
    WHERE column_meta.ad_table_id = table_meta.ad_table_id
      AND column_meta.iskey <> 'Y'
      AND column_meta.isparent <> 'Y'
      AND lower(column_meta.columnname) <> ALL($2::text[])
      AND (
        lower(column_meta.columnname) LIKE 'kg_%'
        OR (
          table_meta.tablename = 'C_Order'
          AND column_meta.columnname = ANY($3::text[])
        )
        OR (
          table_meta.tablename = 'C_OrderLine'
          AND column_meta.columnname = ANY($4::text[])
        )
      )
  `, [
    SYSTEM_USER_ID,
    ["docstatus", "c_doctype_id", "totallines", "grandtotal", "ispayschedulevalid", "isapproved", "isdelivered", "isinvoiced", "isprinted", "istransferred", "processed", "posted", "linenetamt"],
    EDITABLE_STANDARD_ORDER_COLUMNS,
    EDITABLE_STANDARD_ORDER_LINE_COLUMNS
  ]);
}

async function ensureMenu(client: PoolClient, windowId: number): Promise<number> {
  const existing = await client.query<{ ad_menu_id: string }>(`
    SELECT ad_menu_id FROM adempiere.ad_menu WHERE ad_window_id = $1
  `, [windowId]);
  let id: number;
  if (existing.rows[0]) {
    id = Number(existing.rows[0].ad_menu_id);
    await client.query(`
      UPDATE adempiere.ad_menu SET name = $1,
        description = 'Đơn đặt hàng đã xác nhận từ hệ thống xử lý tài liệu',
        action = 'W', ad_window_id = $2, issummary = 'N', issotrx = 'N',
        isreadonly = 'N', entitytype = $3, isactive = 'Y',
        updated = now(), updatedby = $4
      WHERE ad_menu_id = $5
    `, [WINDOW_NAME, windowId, ENTITY_TYPE, SYSTEM_USER_ID, id]);
  } else {
    id = await nextId(client, "AD_Menu");
    await client.query(`
      INSERT INTO adempiere.ad_menu(
        ad_menu_id, ad_client_id, ad_org_id, createdby, updatedby,
        name, description, action, ad_window_id, issummary, issotrx,
        isreadonly, iscentrallymaintained, entitytype, isactive
      ) VALUES ($1, 0, 0, $2, $2, $3,
        'Đơn đặt hàng đã xác nhận từ hệ thống xử lý tài liệu', 'W', $4,
        'N', 'N', 'N', 'Y', $5, 'Y')
    `, [id, SYSTEM_USER_ID, WINDOW_NAME, windowId, ENTITY_TYPE]);
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

async function ensureRoleWindowAccess(client: PoolClient, windowId: number, roleKeys: string[]): Promise<void> {
  const role = await client.query<{ ad_role_id: string; ad_client_id: string; ad_org_id: string }>(`
    SELECT ad_role_id, ad_client_id, ad_org_id
    FROM adempiere.ad_role
    WHERE regexp_replace(upper(name), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
    ORDER BY ad_role_id
    LIMIT 1
  `, [roleKeys]);
  if (!role.rows[0]) {
    throw new Error(`Khong tim thay role ${roleKeys.join(", ")}`);
  }

  await client.query(`
    INSERT INTO adempiere.ad_window_access(
      ad_window_id, ad_role_id, ad_client_id, ad_org_id,
      isactive, created, createdby, updated, updatedby, isreadwrite
    ) VALUES ($1, $2, $3, $4, 'Y', now(), $5, now(), $5, 'Y')
    ON CONFLICT (ad_window_id, ad_role_id) DO UPDATE SET
      ad_client_id = EXCLUDED.ad_client_id,
      ad_org_id = EXCLUDED.ad_org_id,
      isactive = 'Y',
      isreadwrite = 'Y',
      updated = now(),
      updatedby = EXCLUDED.updatedby
  `, [
    windowId,
    Number(role.rows[0].ad_role_id),
    Number(role.rows[0].ad_client_id),
    Number(role.rows[0].ad_org_id),
    SYSTEM_USER_ID
  ]);
}

async function ensureRoleUnrestrictedOrderEditing(client: PoolClient, roleKeys: string[]): Promise<void> {
  const roles = await client.query<{ ad_role_id: string; ad_client_id: string }>(`
    SELECT ad_role_id, ad_client_id
    FROM adempiere.ad_role
    WHERE regexp_replace(upper(name), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
      AND isactive = 'Y'
  `, [roleKeys]);
  if (!roles.rows.length) {
    throw new Error(`Khong tim thay role ${roleKeys.join(", ")}`);
  }

  for (const role of roles.rows) {
    const roleId = Number(role.ad_role_id);
    const clientId = Number(role.ad_client_id);
    await client.query(`
      UPDATE adempiere.ad_role
      SET userlevel = 'SCO',
          isaccessallorgs = 'Y',
          isuseuserorgaccess = 'N',
          updated = now(),
          updatedby = $2
      WHERE ad_role_id = $1
    `, [roleId, SYSTEM_USER_ID]);

    await client.query(`
      UPDATE adempiere.ad_role_orgaccess access
      SET isactive = 'Y',
          isreadonly = 'N',
          updated = now(),
          updatedby = $3
      FROM adempiere.ad_org org
      WHERE access.ad_role_id = $1
        AND access.ad_org_id = org.ad_org_id
        AND org.ad_client_id = $2
    `, [roleId, clientId, SYSTEM_USER_ID]);

    await client.query(`
      INSERT INTO adempiere.ad_role_orgaccess(
        ad_role_id, ad_client_id, ad_org_id,
        isactive, created, createdby, updated, updatedby, isreadonly
      )
      SELECT $1, org.ad_client_id, org.ad_org_id,
             'Y', now(), $3, now(), $3, 'N'
      FROM adempiere.ad_org org
      WHERE org.ad_client_id = $2
        AND org.isactive = 'Y'
        AND NOT EXISTS (
          SELECT 1
          FROM adempiere.ad_role_orgaccess existing
          WHERE existing.ad_role_id = $1
            AND existing.ad_org_id = org.ad_org_id
        )
    `, [roleId, clientId, SYSTEM_USER_ID]);
  }
}

async function ensureRoleMenuTree(client: PoolClient, roleKeys: string[], menuId: number): Promise<void> {
  const roles = await client.query<{ ad_role_id: string; ad_client_id: string; ad_org_id: string }>(`
    SELECT ad_role_id, ad_client_id, ad_org_id
    FROM adempiere.ad_role
    WHERE regexp_replace(upper(name), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
      AND isactive = 'Y'
  `, [roleKeys]);
  if (!roles.rows.length) {
    throw new Error(`Khong tim thay role ${roleKeys.join(", ")}`);
  }

  for (const role of roles.rows) {
    const roleClientId = Number(role.ad_client_id);
    const roleOrgId = Number(role.ad_org_id);
    const menuTree = await client.query<{ ad_tree_id: string }>(`
      SELECT tree.ad_tree_id::text
      FROM adempiere.ad_tree tree
      WHERE tree.treetype = 'MM'
        AND tree.isactive = 'Y'
        AND tree.ad_client_id = $1
      ORDER BY tree.ad_tree_id
      LIMIT 1
    `, [roleClientId]);
    const treeId = menuTree.rows[0]?.ad_tree_id;
    if (!treeId) {
      throw new Error(`Khong tim thay cay menu cho tenant ${roleClientId}.`);
    }

    await client.query(`
      UPDATE adempiere.ad_tree SET
        isallnodes = 'Y',
        updated = now(),
        updatedby = $2
      WHERE ad_tree_id = $1
        AND isallnodes <> 'Y'
    `, [treeId, SYSTEM_USER_ID]);

    await client.query(`
      UPDATE adempiere.ad_clientinfo SET
        ad_tree_menu_id = $2,
        updated = now(),
        updatedby = $3
      WHERE ad_client_id = $1
        AND (ad_tree_menu_id IS DISTINCT FROM $2::numeric)
    `, [roleClientId, treeId, SYSTEM_USER_ID]);

    const sourceTree = await client.query<{ ad_tree_id: string }>(`
      SELECT tree.ad_tree_id::text
      FROM adempiere.ad_tree tree
      JOIN adempiere.ad_treenodemm node ON node.ad_tree_id = tree.ad_tree_id
      WHERE tree.treetype = 'MM'
        AND tree.isactive = 'Y'
        AND tree.ad_client_id = 0
      GROUP BY tree.ad_tree_id
      ORDER BY count(node.node_id) DESC, tree.ad_tree_id
      LIMIT 1
    `);
    const sourceTreeId = sourceTree.rows[0]?.ad_tree_id;
    if (!sourceTreeId) {
      throw new Error("Khong tim thay cay menu he thong de dong bo.");
    }

    await client.query(`
      INSERT INTO adempiere.ad_treenodemm(
        ad_tree_id, node_id, ad_client_id, ad_org_id, createdby, updatedby,
        parent_id, seqno, isactive
      )
      SELECT $1, source.node_id, $2, $3, $4, $4,
        source.parent_id, source.seqno, source.isactive
      FROM adempiere.ad_treenodemm source
      WHERE source.ad_tree_id = $5
      ON CONFLICT (ad_tree_id, node_id) DO UPDATE SET
        ad_client_id = EXCLUDED.ad_client_id,
        ad_org_id = EXCLUDED.ad_org_id,
        isactive = EXCLUDED.isactive,
        updated = now(),
        updatedby = EXCLUDED.updatedby
    `, [treeId, roleClientId, roleOrgId, SYSTEM_USER_ID, sourceTreeId]);

    await client.query(`
      UPDATE adempiere.ad_role SET
        ad_tree_menu_id = $2,
        updated = now(),
        updatedby = $3
      WHERE ad_role_id = $1
        AND (ad_tree_menu_id IS DISTINCT FROM $2::numeric)
    `, [Number(role.ad_role_id), treeId, SYSTEM_USER_ID]);

    await client.query(`
      INSERT INTO adempiere.ad_treenodemm(
        ad_tree_id, node_id, ad_client_id, ad_org_id, createdby, updatedby,
        parent_id, seqno, isactive
      ) VALUES ($1, $2, $3, $4, $5, $5, 0, 10, 'Y')
      ON CONFLICT (ad_tree_id, node_id) DO UPDATE SET
        ad_client_id = EXCLUDED.ad_client_id,
        ad_org_id = EXCLUDED.ad_org_id,
        parent_id = EXCLUDED.parent_id,
        seqno = EXCLUDED.seqno,
        isactive = 'Y',
        updated = now(),
        updatedby = EXCLUDED.updatedby
    `, [treeId, menuId, roleClientId, roleOrgId, SYSTEM_USER_ID]);
  }
}

async function ensureReadOutsideTableAccessIncludeList(client: PoolClient): Promise<void> {
  for (const clientId of [0, 11]) {
    const existing = await client.query<{ ad_sysconfig_id: string }>(`
      SELECT ad_sysconfig_id
      FROM adempiere.ad_sysconfig
      WHERE name = 'READ_TABLES_NOT_IN_TABLE_ACCESS_INCLUDE_LIST'
        AND ad_client_id = $1
        AND ad_org_id = 0
      ORDER BY ad_sysconfig_id
      LIMIT 1
    `, [clientId]);
    const id = existing.rows[0]
      ? Number(existing.rows[0].ad_sysconfig_id)
      : await nextId(client, "AD_SysConfig");
    const configurationLevel = clientId === 0 ? "S" : "C";

    if (existing.rows[0]) {
      await client.query(`
        UPDATE adempiere.ad_sysconfig
        SET value = 'Y',
            description = 'Cho phep role co AD_Table_Access doc cac bang ngoai whitelist de menu va dictionary khong bi trang.',
            entitytype = $1,
            configurationlevel = $2,
            isactive = 'Y',
            updated = now(),
            updatedby = $3
        WHERE ad_sysconfig_id = $4
      `, [ENTITY_TYPE, configurationLevel, SYSTEM_USER_ID, id]);
      continue;
    }

    await client.query(`
      INSERT INTO adempiere.ad_sysconfig(
        ad_sysconfig_id, ad_client_id, ad_org_id,
        created, createdby, updated, updatedby,
        isactive, name, value, description, entitytype, configurationlevel
      ) VALUES (
        $1, $2, 0, now(), $3, now(), $3, 'Y',
        'READ_TABLES_NOT_IN_TABLE_ACCESS_INCLUDE_LIST',
        'Y',
        'Cho phep role co AD_Table_Access doc cac bang ngoai whitelist de menu va dictionary khong bi trang.',
        $4,
        $5
      )
    `, [id, clientId, SYSTEM_USER_ID, ENTITY_TYPE, configurationLevel]);
  }
}

async function removeRestrictiveRoleTableAccess(client: PoolClient, roleKeys: string[]): Promise<void> {
  await client.query(`
    DELETE FROM adempiere.ad_table_access access
    USING adempiere.ad_role rolemeta
    WHERE access.ad_role_id = rolemeta.ad_role_id
      AND access.accesstyperule = 'A'
      AND regexp_replace(upper(rolemeta.name), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
  `, [roleKeys]);
}

async function removeBlankStatusLines(client: PoolClient, windowId: number): Promise<void> {
  await client.query(`
    UPDATE adempiere.ad_statuslineusedin
    SET isactive = 'N',
        updated = now(),
        updatedby = $2
    WHERE ad_window_id = $1
      AND isstatusline = 'Y'
      AND ad_statusline_id IN (
        SELECT ad_statusline_id
        FROM adempiere.ad_statusline
        WHERE name = $3 AND entitytype = $4
      )
  `, [windowId, SYSTEM_USER_ID, BLANK_STATUS_LINE_NAME, ENTITY_TYPE]);

  await client.query(`
    UPDATE adempiere.ad_statusline
    SET isactive = 'N',
        updated = now(),
        updatedby = $2
    WHERE name = $1 AND entitytype = $3
  `, [BLANK_STATUS_LINE_NAME, SYSTEM_USER_ID, ENTITY_TYPE]);

  await client.query(`
    UPDATE adempiere.ad_message
    SET isactive = 'N',
        updated = now(),
        updatedby = $2
    WHERE value = $1 AND entitytype = $3
  `, [BLANK_STATUS_MESSAGE_VALUE, SYSTEM_USER_ID, ENTITY_TYPE]);
}

async function backfillImportedOrderDocTypes(client: PoolClient): Promise<void> {
  await client.query(`
    UPDATE adempiere.c_order
    SET c_doctype_id = c_doctypetarget_id,
        updated = now(),
        updatedby = $1
    WHERE ad_client_id = 11
      AND issotrx = 'N'
      AND c_doctypetarget_id > 0
      AND (c_doctype_id IS NULL OR c_doctype_id = 0)
  `, [SYSTEM_USER_ID]);

  await client.query(`
    UPDATE adempiere.c_order orderrow
    SET c_currency_id = currency.c_currency_id,
        updated = now(),
        updatedby = $1
    FROM adempiere.c_currency currency
    WHERE orderrow.ad_client_id = 11
      AND orderrow.issotrx = 'N'
      AND orderrow.kg_source_document_id IS NOT NULL
      AND (orderrow.c_currency_id IS NULL OR orderrow.c_currency_id = 0)
      AND currency.iso_code = 'VND'
      AND currency.isactive = 'Y'
  `, [SYSTEM_USER_ID]);

  await client.query(`
    UPDATE adempiere.c_order
    SET kg_currency_text = 'VND',
        updated = now(),
        updatedby = $1
    WHERE ad_client_id = 11
      AND issotrx = 'N'
      AND kg_source_document_id IS NOT NULL
      AND (kg_currency_text IS NULL OR trim(kg_currency_text) = '')
  `, [SYSTEM_USER_ID]);
}

async function ensureBlankStatusLines(
  client: PoolClient,
  windowId: number,
  tabIds: number[]
): Promise<void> {
  const existingMessage = await client.query<{ ad_message_id: string }>(`
    SELECT ad_message_id
    FROM adempiere.ad_message
    WHERE value = $1
  `, [BLANK_STATUS_MESSAGE_VALUE]);
  const messageId = existingMessage.rows[0]
    ? Number(existingMessage.rows[0].ad_message_id)
    : await nextId(client, "AD_Message");

  if (existingMessage.rows[0]) {
    await client.query(`
      UPDATE adempiere.ad_message
      SET msgtext = ' ', msgtip = NULL, msgtype = 'I', entitytype = $1,
          isactive = 'Y', updated = now(), updatedby = $2
      WHERE ad_message_id = $3
    `, [ENTITY_TYPE, SYSTEM_USER_ID, messageId]);
  } else {
    await client.query(`
      INSERT INTO adempiere.ad_message(
        ad_message_id, ad_client_id, ad_org_id, isactive,
        created, createdby, updated, updatedby,
        value, msgtext, msgtype, entitytype
      ) VALUES ($1, 0, 0, 'Y', now(), $2, now(), $2, $3, ' ', 'I', $4)
    `, [messageId, SYSTEM_USER_ID, BLANK_STATUS_MESSAGE_VALUE, ENTITY_TYPE]);
  }

  const existingStatusLine = await client.query<{ ad_statusline_id: string }>(`
    SELECT ad_statusline_id
    FROM adempiere.ad_statusline
    WHERE name = $1 AND entitytype = $2
  `, [BLANK_STATUS_LINE_NAME, ENTITY_TYPE]);
  const statusLineId = existingStatusLine.rows[0]
    ? Number(existingStatusLine.rows[0].ad_statusline_id)
    : await nextId(client, "AD_StatusLine");

  if (existingStatusLine.rows[0]) {
    await client.query(`
      UPDATE adempiere.ad_statusline
      SET ad_message_id = $1, sqlstatement = 'SELECT ''''::text',
          isactive = 'Y', updated = now(), updatedby = $2
      WHERE ad_statusline_id = $3
    `, [messageId, SYSTEM_USER_ID, statusLineId]);
  } else {
    await client.query(`
      INSERT INTO adempiere.ad_statusline(
        ad_statusline_id, ad_client_id, ad_org_id,
        created, createdby, updated, updatedby,
        entitytype, isactive, name, ad_message_id, sqlstatement
      ) VALUES ($1, 0, 0, now(), $2, now(), $2, $3, 'Y', $4, $5, 'SELECT ''''::text')
    `, [statusLineId, SYSTEM_USER_ID, ENTITY_TYPE, BLANK_STATUS_LINE_NAME, messageId]);
  }

  for (const tabId of tabIds) {
    const existingUsedIn = await client.query<{ ad_statuslineusedin_id: string }>(`
      SELECT ad_statuslineusedin_id
      FROM adempiere.ad_statuslineusedin
      WHERE ad_window_id = $1 AND ad_tab_id = $2 AND isstatusline = 'Y'
    `, [windowId, tabId]);

    if (existingUsedIn.rowCount) {
      await client.query(`
        UPDATE adempiere.ad_statuslineusedin
        SET ad_statusline_id = $1, ad_table_id = NULL, ad_infowindow_id = NULL,
            isactive = 'Y', entitytype = $2,
            updated = now(), updatedby = $3
        WHERE ad_window_id = $4 AND ad_tab_id = $5 AND isstatusline = 'Y'
      `, [statusLineId, ENTITY_TYPE, SYSTEM_USER_ID, windowId, tabId]);
      continue;
    }

    const usedInId = await nextId(client, "AD_StatusLineUsedIn");
    await client.query(`
      INSERT INTO adempiere.ad_statuslineusedin(
        ad_statuslineusedin_id, ad_client_id, ad_org_id,
        ad_statusline_id, created, createdby, updated, updatedby,
        ad_window_id, ad_tab_id, isstatusline, seqno,
        ad_table_id, entitytype, ad_infowindow_id, isactive
      ) VALUES ($1, 0, 0, $2, now(), $3, now(), $3,
        $4, $5, 'Y', 10, NULL, $6, NULL, 'Y')
    `, [usedInId, statusLineId, SYSTEM_USER_ID, windowId, tabId, ENTITY_TYPE]);
  }
}

async function assertWindowMetadata(client: PoolClient, windowId: number): Promise<void> {
  const result = await client.query<{ issue: string }>(`
    SELECT 'Tab không có bảng trong Data Dictionary' AS issue
    FROM adempiere.ad_tab tab
    LEFT JOIN adempiere.ad_table table_meta ON table_meta.ad_table_id = tab.ad_table_id
    WHERE tab.ad_window_id = $1
      AND (table_meta.ad_table_id IS NULL OR table_meta.isactive <> 'Y')

    UNION ALL

    SELECT 'Bảng của Tab không có cột khóa'
    FROM adempiere.ad_tab tab
    JOIN adempiere.ad_table table_meta ON table_meta.ad_table_id = tab.ad_table_id
    WHERE tab.ad_window_id = $1 AND NOT EXISTS (
      SELECT 1 FROM adempiere.ad_column column_meta
      WHERE column_meta.ad_table_id = table_meta.ad_table_id
        AND column_meta.iskey = 'Y' AND column_meta.isactive = 'Y'
    )

    UNION ALL

    SELECT 'Field không thuộc cùng bảng với Tab'
    FROM adempiere.ad_field field
    JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
    LEFT JOIN adempiere.ad_column column_meta ON column_meta.ad_column_id = field.ad_column_id
    WHERE tab.ad_window_id = $1
      AND (column_meta.ad_column_id IS NULL OR column_meta.ad_table_id <> tab.ad_table_id)

    UNION ALL

    SELECT 'Cấu hình hiển thị Grid không đồng bộ'
    FROM adempiere.ad_field field
    JOIN adempiere.ad_tab tab ON tab.ad_tab_id = field.ad_tab_id
    WHERE tab.ad_window_id = $1 AND (
      (field.isdisplayedgrid = 'Y' AND field.isdisplayed <> 'Y')
      OR (field.isdisplayedgrid = 'Y' AND coalesce(field.seqnogrid, 0) <= 0)
      OR (field.isdisplayedgrid = 'N' AND coalesce(field.seqnogrid, 0) <> 0)
    )

    UNION ALL

    SELECT 'CreatedBy/UpdatedBy thieu tham chieu AD_User'
    FROM adempiere.ad_column column_meta
    JOIN adempiere.ad_tab tab ON tab.ad_table_id = column_meta.ad_table_id
    WHERE tab.ad_window_id = $1
      AND lower(column_meta.columnname) IN ('createdby', 'updatedby')
      AND (
        column_meta.ad_reference_id <> 30
        OR column_meta.ad_reference_value_id <> 110
      )
    LIMIT 1
  `, [windowId]);
  if (result.rows[0]) throw new Error(result.rows[0].issue);
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
