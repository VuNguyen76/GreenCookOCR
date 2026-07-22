CREATE TABLE IF NOT EXISTS adempiere.kg_order_ai
(
    kg_order_ai_id numeric(10,0) NOT NULL DEFAULT nextidf('kg_order_ai'::character varying),
    ad_client_id numeric(10,0) NOT NULL,
    ad_org_id numeric(10,0) NOT NULL,
    isactive character(1) NOT NULL DEFAULT 'Y'::bpchar,
    created timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdby numeric(10,0) NOT NULL,
    updated timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedby numeric(10,0) NOT NULL,

    value character varying(60),
    description character varying(1000),

    ma_tai_lieu_nguon character varying(36),
    thu_tu_phieu_trong_file integer,
    source_sha256 character varying(64),
    ten_file_nguon character varying(255),
    duoi_file character varying(20),
    loai_mime character varying(150),
    kich_thuoc_file numeric(18,0),
    so_trang integer,
    phuong_thuc_trich_xuat character varying(30),
    raw_text text,
    raw_json jsonb,

    tieu_de_chung_tu character varying(255),
    loai_chung_tu character varying(255),
    so_po character varying(255),
    order_id character varying(255),
    ngay_dat_hang date,
    ngay_giao_hang date,
    ngay_xuat_hoa_don date,

    ma_nha_cung_cap character varying(255),
    ten_nha_cung_cap character varying(255),
    c_bpartner_id numeric(10,0),

    ma_cua_hang character varying(255),
    ten_cua_hang character varying(500),
    dia_chi_giao_hang character varying(1000),

    ten_nhan_vien_kinh_doanh character varying(255),
    nhan_vien_kinh_doanh_id numeric(10,0),

    trang_thai_don_hang character varying(255),
    trang_thai_xu_ly character varying(255),
    ma_khuyen_mai character varying(255),

    tien_hang numeric(24,6),
    ty_le_vat numeric(9,6),
    tien_thue numeric(24,6),
    tong_tien numeric(24,6),
    tong_tien_sau_thue numeric(24,6),

    ma_tien_te character varying(10),
    c_currency_id numeric(10,0),
    kg_po_id numeric(10,0),
    thoi_gian_xac_nhan timestamp without time zone,
    kiem_tra_file character(1),

    CONSTRAINT kg_order_ai_pkey PRIMARY KEY (kg_order_ai_id),
    CONSTRAINT fk_kg_order_ai_client FOREIGN KEY (ad_client_id) REFERENCES adempiere.ad_client (ad_client_id),
    CONSTRAINT fk_kg_order_ai_org FOREIGN KEY (ad_org_id) REFERENCES adempiere.ad_org (ad_org_id),
    CONSTRAINT fk_kg_order_ai_nha_cung_cap FOREIGN KEY (c_bpartner_id) REFERENCES adempiere.c_bpartner (c_bpartner_id),
    CONSTRAINT fk_kg_order_ai_tien_te FOREIGN KEY (c_currency_id) REFERENCES adempiere.c_currency (c_currency_id),
    CONSTRAINT fk_kg_order_ai_kg_po FOREIGN KEY (kg_po_id) REFERENCES adempiere.kg_po (kg_po_id)
);

ALTER TABLE adempiere.kg_order_ai
    DROP COLUMN IF EXISTS batch_id CASCADE,
    DROP COLUMN IF EXISTS batch_position CASCADE,
    DROP COLUMN IF EXISTS stored_name CASCADE,
    DROP COLUMN IF EXISTS storage_path CASCADE,
    DROP COLUMN IF EXISTS ma_ben_mua CASCADE,
    DROP COLUMN IF EXISTS ten_ben_mua CASCADE,
    DROP COLUMN IF EXISTS ma_so_thue_ben_mua CASCADE,
    DROP COLUMN IF EXISTS ma_so_thue_nha_cung_cap CASCADE,
    DROP COLUMN IF EXISTS nguoi_lien_he CASCADE,
    DROP COLUMN IF EXISTS dien_thoai_lien_he CASCADE,
    DROP COLUMN IF EXISTS email_lien_he CASCADE,
    DROP COLUMN IF EXISTS dia_chi_nhan_hang CASCADE,
    DROP COLUMN IF EXISTS dia_chi_thanh_toan CASCADE,
    DROP COLUMN IF EXISTS ma_kho CASCADE,
    DROP COLUMN IF EXISTS ten_kho CASCADE,
    DROP COLUMN IF EXISTS bo_phan CASCADE,
    DROP COLUMN IF EXISTS dieu_khoan_thanh_toan CASCADE,
    DROP COLUMN IF EXISTS phuong_thuc_thanh_toan CASCADE,
    DROP COLUMN IF EXISTS phuong_thuc_giao_hang CASCADE,
    DROP COLUMN IF EXISTS khung_gio_giao CASCADE,
    DROP COLUMN IF EXISTS bang_gia CASCADE,
    DROP COLUMN IF EXISTS gia_da_gom_thue CASCADE,
    DROP COLUMN IF EXISTS attempts CASCADE,
    DROP COLUMN IF EXISTS next_attempt_at CASCADE,
    DROP COLUMN IF EXISTS error_message CASCADE,
    DROP COLUMN IF EXISTS started_at CASCADE,
    DROP COLUMN IF EXISTS completed_at CASCADE,
    DROP COLUMN IF EXISTS gemini_file_name CASCADE,
    DROP COLUMN IF EXISTS model CASCADE,
    DROP COLUMN IF EXISTS prompt_version CASCADE,
    DROP COLUMN IF EXISTS published_kg_order_id CASCADE,
    DROP COLUMN IF EXISTS published_at CASCADE,
    DROP COLUMN IF EXISTS button_confirm CASCADE;


CREATE INDEX IF NOT EXISTS idx_kg_order_ai_client_org
    ON adempiere.kg_order_ai (ad_client_id, ad_org_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_ai_so_po
    ON adempiere.kg_order_ai (so_po);

CREATE INDEX IF NOT EXISTS idx_kg_order_ai_order_id
    ON adempiere.kg_order_ai (order_id);
CREATE INDEX IF NOT EXISTS idx_kg_order_ai_nha_cung_cap
    ON adempiere.kg_order_ai (c_bpartner_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_ai_nhan_vien
    ON adempiere.kg_order_ai (nhan_vien_kinh_doanh_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_ai_tien_te
    ON adempiere.kg_order_ai (c_currency_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_ai_kg_po
    ON adempiere.kg_order_ai (kg_po_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_ai_trang_thai
    ON adempiere.kg_order_ai (trang_thai_xu_ly);

CREATE INDEX IF NOT EXISTS idx_kg_order_ai_source_sha256
    ON adempiere.kg_order_ai (source_sha256);

CREATE INDEX IF NOT EXISTS idx_kg_order_ai_created
    ON adempiere.kg_order_ai (created);


CREATE TABLE IF NOT EXISTS adempiere.kg_order_detail_ai
(
    kg_order_detail_ai_id numeric(10,0) NOT NULL DEFAULT nextidf('kg_order_detail_ai'::character varying),
    ad_client_id numeric(10,0) NOT NULL,
    ad_org_id numeric(10,0) NOT NULL,
    isactive character(1) NOT NULL DEFAULT 'Y'::bpchar,
    created timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdby numeric(10,0) NOT NULL,
    updated timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedby numeric(10,0) NOT NULL,

    kg_order_ai_id numeric(10,0),

    dong integer,
    dong_nguon integer,
    trang_nguon integer,

    barcode character varying(255),
    ten_san_pham_khach_hang character varying(500),
    ten_san_pham_cong_ty character varying(500),
    quy_cach character varying(255),

    so_luong numeric(18,6),
    don_vi_tinh character varying(100),
    so_luong_quy_doi numeric(18,6),

    kg_sp_id numeric(10,0),
    c_uom_id numeric(10,0),

    don_gia_khach_hang numeric(24,6),
    don_gia_cong_ty numeric(24,6),

    ty_le_vat numeric(9,6),
    thanh_tien numeric(24,6),

    trang_thai_lien_ket character varying(30),
    raw_json jsonb,
    description character varying(1000),

    CONSTRAINT kg_order_detail_ai_pkey PRIMARY KEY (kg_order_detail_ai_id),
    CONSTRAINT fk_kg_order_detail_ai_client FOREIGN KEY (ad_client_id) REFERENCES adempiere.ad_client (ad_client_id),
    CONSTRAINT fk_kg_order_detail_ai_org FOREIGN KEY (ad_org_id) REFERENCES adempiere.ad_org (ad_org_id),
    CONSTRAINT fk_kg_order_detail_ai_order FOREIGN KEY (kg_order_ai_id) REFERENCES adempiere.kg_order_ai (kg_order_ai_id) ON DELETE CASCADE,
    CONSTRAINT fk_kg_order_detail_ai_san_pham FOREIGN KEY (kg_sp_id) REFERENCES adempiere.kg_sp (kg_sp_id),
    CONSTRAINT fk_kg_order_detail_ai_don_vi_tinh FOREIGN KEY (c_uom_id) REFERENCES adempiere.c_uom (c_uom_id)
);

ALTER TABLE adempiere.kg_order_detail_ai
    DROP COLUMN IF EXISTS ma_san_pham_khach_hang CASCADE,
    DROP COLUMN IF EXISTS ma_san_pham_nha_cung_cap CASCADE,
    DROP COLUMN IF EXISTS model CASCADE,
    DROP COLUMN IF EXISTS so_po CASCADE,
    DROP COLUMN IF EXISTS ngay_po CASCADE,
    DROP COLUMN IF EXISTS ma_cua_hang CASCADE,
    DROP COLUMN IF EXISTS ten_cua_hang CASCADE,
    DROP COLUMN IF EXISTS dia_chi_giao_hang CASCADE,
    DROP COLUMN IF EXISTS so_luong_mien_phi CASCADE,
    DROP COLUMN IF EXISTS gia_niem_yet CASCADE,
    DROP COLUMN IF EXISTS ty_le_chiet_khau CASCADE,
    DROP COLUMN IF EXISTS tien_chiet_khau CASCADE,
    DROP COLUMN IF EXISTS tien_thue CASCADE,
    DROP COLUMN IF EXISTS tong_tien_sau_thue CASCADE,
    DROP COLUMN IF EXISTS ma_kho CASCADE,
    DROP COLUMN IF EXISTS ten_kho CASCADE;


CREATE INDEX IF NOT EXISTS idx_kg_order_detail_ai_client_org
    ON adempiere.kg_order_detail_ai (ad_client_id, ad_org_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_ai_order
    ON adempiere.kg_order_detail_ai (kg_order_ai_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_ai_barcode
    ON adempiere.kg_order_detail_ai (barcode);
CREATE INDEX IF NOT EXISTS idx_kg_order_detail_ai_san_pham
    ON adempiere.kg_order_detail_ai (kg_sp_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_ai_don_vi_tinh
    ON adempiere.kg_order_detail_ai (c_uom_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_ai_trang_thai
    ON adempiere.kg_order_detail_ai (trang_thai_lien_ket);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_ai_created
    ON adempiere.kg_order_detail_ai (created);


CREATE TABLE IF NOT EXISTS adempiere.kg_order
(
    kg_order_id numeric(10,0) NOT NULL DEFAULT nextidf('kg_order'::character varying),
    ad_client_id numeric(10,0) NOT NULL,
    ad_org_id numeric(10,0) NOT NULL,
    isactive character(1) NOT NULL DEFAULT 'Y'::bpchar,
    created timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdby numeric(10,0) NOT NULL,
    updated timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedby numeric(10,0) NOT NULL,

    value character varying(60),
    description character varying(1000),

    kg_order_ai_id numeric(10,0),
    kg_po_id numeric(10,0),

    so_po character varying(255),
    order_id character varying(255),

    ngay_dat_hang date,
    ngay_giao_hang date,
    ngay_xuat_hoa_don date,

    c_bpartner_id numeric(10,0),

    ma_nha_cung_cap character varying(255),
    ten_nha_cung_cap character varying(255),

    ma_cua_hang character varying(255),
    ten_cua_hang character varying(500),
    dia_chi_giao_hang character varying(1000),
    ma_ben_mua character varying(255),
    ten_ben_mua character varying(500),
    ma_so_thue_ben_mua character varying(80),
    ma_so_thue_nha_cung_cap character varying(80),
    nguoi_lien_he character varying(500),
    dien_thoai_lien_he character varying(120),
    email_lien_he character varying(255),
    dia_chi_nhan_hang character varying(1000),
    dia_chi_thanh_toan character varying(1000),
    ma_kho character varying(255),
    ten_kho character varying(500),
    bo_phan character varying(255),
    dieu_khoan_thanh_toan character varying(255),
    phuong_thuc_thanh_toan character varying(255),
    phuong_thuc_giao_hang character varying(255),
    khung_gio_giao character varying(255),
    bang_gia character varying(255),
    gia_da_gom_thue character(1),

    nhan_vien_kinh_doanh_id numeric(10,0),

    trang_thai_don_hang character varying(255),
    trang_thai_xu_ly character varying(255),
    ma_khuyen_mai character varying(255),

    tien_hang numeric(24,6),
    ty_le_vat numeric(9,6),
    tien_thue numeric(24,6),
    tong_tien numeric(24,6),
    tong_tien_sau_thue numeric(24,6),

    ma_tien_te character varying(10),
    c_currency_id numeric(10,0),

    thoi_gian_xac_nhan timestamp without time zone,

    CONSTRAINT kg_order_pkey PRIMARY KEY (kg_order_id),
    CONSTRAINT fk_kg_order_client FOREIGN KEY (ad_client_id) REFERENCES adempiere.ad_client (ad_client_id),
    CONSTRAINT fk_kg_order_org FOREIGN KEY (ad_org_id) REFERENCES adempiere.ad_org (ad_org_id),
    CONSTRAINT fk_kg_order_createdby FOREIGN KEY (createdby) REFERENCES adempiere.ad_user (ad_user_id),
    CONSTRAINT fk_kg_order_updatedby FOREIGN KEY (updatedby) REFERENCES adempiere.ad_user (ad_user_id),
    CONSTRAINT fk_kg_order_order_ai FOREIGN KEY (kg_order_ai_id) REFERENCES adempiere.kg_order_ai (kg_order_ai_id),
    CONSTRAINT fk_kg_order_kg_po FOREIGN KEY (kg_po_id) REFERENCES adempiere.kg_po (kg_po_id),
    CONSTRAINT fk_kg_order_nha_cung_cap FOREIGN KEY (c_bpartner_id) REFERENCES adempiere.c_bpartner (c_bpartner_id),
    CONSTRAINT fk_kg_order_tien_te FOREIGN KEY (c_currency_id) REFERENCES adempiere.c_currency (c_currency_id)
);

ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS ma_ben_mua character varying(255);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS ten_ben_mua character varying(500);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS ma_so_thue_ben_mua character varying(80);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS ma_so_thue_nha_cung_cap character varying(80);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS nguoi_lien_he character varying(500);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS dien_thoai_lien_he character varying(120);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS email_lien_he character varying(255);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS dia_chi_nhan_hang character varying(1000);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS dia_chi_thanh_toan character varying(1000);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS ma_kho character varying(255);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS ten_kho character varying(500);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS bo_phan character varying(255);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS dieu_khoan_thanh_toan character varying(255);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS phuong_thuc_thanh_toan character varying(255);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS phuong_thuc_giao_hang character varying(255);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS khung_gio_giao character varying(255);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS bang_gia character varying(255);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS gia_da_gom_thue character(1);



CREATE INDEX IF NOT EXISTS idx_kg_order_client_org
    ON adempiere.kg_order (ad_client_id, ad_org_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_order_ai
    ON adempiere.kg_order (kg_order_ai_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_kg_po
    ON adempiere.kg_order (kg_po_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_so_po
    ON adempiere.kg_order (so_po);

CREATE INDEX IF NOT EXISTS idx_kg_order_order_id
    ON adempiere.kg_order (order_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_nha_cung_cap
    ON adempiere.kg_order (c_bpartner_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_nhan_vien
    ON adempiere.kg_order (nhan_vien_kinh_doanh_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_tien_te
    ON adempiere.kg_order (c_currency_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_trang_thai
    ON adempiere.kg_order (trang_thai_xu_ly);

CREATE INDEX IF NOT EXISTS idx_kg_order_ngay_dat_hang
    ON adempiere.kg_order (ngay_dat_hang);

CREATE INDEX IF NOT EXISTS idx_kg_order_created
    ON adempiere.kg_order (created);


CREATE TABLE IF NOT EXISTS adempiere.kg_order_detail
(
    kg_order_detail_id numeric(10,0) NOT NULL DEFAULT nextidf('kg_order_detail'::character varying),
    ad_client_id numeric(10,0) NOT NULL,
    ad_org_id numeric(10,0) NOT NULL,
    isactive character(1) NOT NULL DEFAULT 'Y'::bpchar,
    created timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdby numeric(10,0) NOT NULL,
    updated timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedby numeric(10,0) NOT NULL,

    kg_order_id numeric(10,0),
    kg_order_detail_ai_id numeric(10,0),
    kg_po_d_id numeric(10,0),

    dong integer,

    barcode character varying(255),
    ma_san_pham_khach_hang character varying(255),
    ma_san_pham_nha_cung_cap character varying(255),
    ten_san_pham_khach_hang character varying(500),
    ten_san_pham_cong_ty character varying(500),
    model character varying(255),
    quy_cach character varying(255),
    so_po character varying(255),
    ngay_po date,
    ma_cua_hang character varying(255),
    ten_cua_hang character varying(500),
    dia_chi_giao_hang character varying(1000),

    so_luong numeric(18,6),
    so_luong_mien_phi numeric(18,6),
    don_vi_tinh character varying(100),
    so_luong_quy_doi numeric(18,6),

    kg_sp_id numeric(10,0),
    c_uom_id numeric(10,0),

    don_gia_khach_hang numeric(24,6),
    don_gia_cong_ty numeric(24,6),
    gia_niem_yet numeric(24,6),
    ty_le_chiet_khau numeric(9,6),
    tien_chiet_khau numeric(24,6),

    ty_le_vat numeric(9,6),
    tien_thue numeric(24,6),
    thanh_tien numeric(24,6),
    tong_tien_sau_thue numeric(24,6),
    ma_kho character varying(255),
    ten_kho character varying(500),

    description character varying(1000),

    CONSTRAINT kg_order_detail_pkey PRIMARY KEY (kg_order_detail_id),
    CONSTRAINT fk_kg_order_detail_client FOREIGN KEY (ad_client_id) REFERENCES adempiere.ad_client (ad_client_id),
    CONSTRAINT fk_kg_order_detail_org FOREIGN KEY (ad_org_id) REFERENCES adempiere.ad_org (ad_org_id),
    CONSTRAINT fk_kg_order_detail_createdby FOREIGN KEY (createdby) REFERENCES adempiere.ad_user (ad_user_id),
    CONSTRAINT fk_kg_order_detail_updatedby FOREIGN KEY (updatedby) REFERENCES adempiere.ad_user (ad_user_id),
    CONSTRAINT fk_kg_order_detail_order FOREIGN KEY (kg_order_id) REFERENCES adempiere.kg_order (kg_order_id) ON DELETE CASCADE,
    CONSTRAINT fk_kg_order_detail_order_detail_ai FOREIGN KEY (kg_order_detail_ai_id) REFERENCES adempiere.kg_order_detail_ai (kg_order_detail_ai_id),
    CONSTRAINT fk_kg_order_detail_kg_po_d FOREIGN KEY (kg_po_d_id) REFERENCES adempiere.kg_po_d (kg_po_d_id),
    CONSTRAINT fk_kg_order_detail_san_pham FOREIGN KEY (kg_sp_id) REFERENCES adempiere.kg_sp (kg_sp_id),
    CONSTRAINT fk_kg_order_detail_don_vi_tinh FOREIGN KEY (c_uom_id) REFERENCES adempiere.c_uom (c_uom_id)
);

ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS ma_san_pham_khach_hang character varying(255);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS ma_san_pham_nha_cung_cap character varying(255);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS model character varying(255);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS so_po character varying(255);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS ngay_po date;
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS ma_cua_hang character varying(255);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS ten_cua_hang character varying(500);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS dia_chi_giao_hang character varying(1000);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS so_luong_mien_phi numeric(18,6);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS gia_niem_yet numeric(24,6);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS ty_le_chiet_khau numeric(9,6);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS tien_chiet_khau numeric(24,6);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS tien_thue numeric(24,6);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS tong_tien_sau_thue numeric(24,6);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS ma_kho character varying(255);
ALTER TABLE adempiere.kg_order_detail ADD COLUMN IF NOT EXISTS ten_kho character varying(500);



CREATE INDEX IF NOT EXISTS idx_kg_order_detail_client_org
    ON adempiere.kg_order_detail (ad_client_id, ad_org_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_order
    ON adempiere.kg_order_detail (kg_order_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_order_detail_ai
    ON adempiere.kg_order_detail (kg_order_detail_ai_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_kg_po_d
    ON adempiere.kg_order_detail (kg_po_d_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_barcode
    ON adempiere.kg_order_detail (barcode);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_san_pham
    ON adempiere.kg_order_detail (kg_sp_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_don_vi_tinh
    ON adempiere.kg_order_detail (c_uom_id);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_order_dong
    ON adempiere.kg_order_detail (kg_order_id, dong);

CREATE INDEX IF NOT EXISTS idx_kg_order_detail_created
    ON adempiere.kg_order_detail (created);


CREATE OR REPLACE FUNCTION adempiere.kg_confirm_order_ai(
    p_document_id character varying,
    p_user_id numeric
)
RETURNS TABLE(result_status text, kg_order_id numeric, result_message text)
LANGUAGE plpgsql
AS $$
DECLARE
    v_source adempiere.kg_order_ai%ROWTYPE;
    v_existing_id numeric(10,0);
    v_new_order_id numeric(10,0);
    v_normalized_po text;
BEGIN
    SELECT *
      INTO v_source
      FROM adempiere.kg_order_ai
     WHERE ma_tai_lieu_nguon = p_document_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy dữ liệu tạm của chứng từ %', p_document_id;
    END IF;

    IF nullif(btrim(coalesce(v_source.so_po, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Chưa có số PO nên chưa thể đưa chứng từ vào hệ thống';
    END IF;

    v_normalized_po := regexp_replace(upper(btrim(v_source.so_po)), '[^A-Z0-9]', '', 'g');

    SELECT orders.kg_order_id
      INTO v_existing_id
      FROM adempiere.kg_order orders
     WHERE orders.ad_client_id = v_source.ad_client_id
       AND regexp_replace(upper(btrim(coalesce(orders.so_po, ''))), '[^A-Z0-9]', '', 'g') = v_normalized_po
     ORDER BY orders.kg_order_id
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        UPDATE adempiere.kg_order_ai
           SET trang_thai_xu_ly = 'published',
               thoi_gian_xac_nhan = coalesce(thoi_gian_xac_nhan, now()),
               description = NULL,
               updated = now(),
               updatedby = p_user_id
         WHERE kg_order_ai_id = v_source.kg_order_ai_id;

        result_status := 'already_exists';
        kg_order_id := v_existing_id;
        result_message := 'PO đã có trong hệ thống';
        RETURN NEXT;
        RETURN;
    END IF;

    INSERT INTO adempiere.kg_order(
        ad_client_id, ad_org_id, createdby, updatedby,
        value, description, kg_order_ai_id, kg_po_id,
        so_po, order_id, ngay_dat_hang, ngay_giao_hang, ngay_xuat_hoa_don,
        c_bpartner_id, ma_nha_cung_cap, ten_nha_cung_cap,
        ma_cua_hang, ten_cua_hang, dia_chi_giao_hang,
        nhan_vien_kinh_doanh_id, trang_thai_don_hang, trang_thai_xu_ly,
        ma_khuyen_mai, tien_hang, ty_le_vat, tien_thue,
        tong_tien, tong_tien_sau_thue, ma_tien_te, c_currency_id,
        thoi_gian_xac_nhan
    )
    SELECT
        source.ad_client_id, source.ad_org_id, p_user_id, p_user_id,
        coalesce(source.value, source.so_po, source.ma_tai_lieu_nguon), source.description, source.kg_order_ai_id, source.kg_po_id,
        source.so_po, source.order_id, source.ngay_dat_hang, source.ngay_giao_hang, source.ngay_xuat_hoa_don,
        source.c_bpartner_id, source.ma_nha_cung_cap, source.ten_nha_cung_cap,
        source.ma_cua_hang, source.ten_cua_hang, source.dia_chi_giao_hang,
        source.nhan_vien_kinh_doanh_id, source.trang_thai_don_hang, 'confirmed',
        source.ma_khuyen_mai, source.tien_hang, source.ty_le_vat, source.tien_thue,
        source.tong_tien, source.tong_tien_sau_thue, source.ma_tien_te, source.c_currency_id,
        now()
      FROM adempiere.kg_order_ai source
     WHERE source.kg_order_ai_id = v_source.kg_order_ai_id
     RETURNING adempiere.kg_order.kg_order_id INTO v_new_order_id;

    INSERT INTO adempiere.kg_order_detail(
        ad_client_id, ad_org_id, createdby, updatedby,
        kg_order_id, kg_order_detail_ai_id, dong,
        barcode, ten_san_pham_khach_hang, ten_san_pham_cong_ty, quy_cach,
        so_luong, don_vi_tinh, so_luong_quy_doi,
        kg_sp_id, c_uom_id,
        don_gia_khach_hang, don_gia_cong_ty,
        ty_le_vat, thanh_tien, description
    )
    SELECT
        detail.ad_client_id, detail.ad_org_id, p_user_id, p_user_id,
        v_new_order_id, detail.kg_order_detail_ai_id, detail.dong,
        detail.barcode, detail.ten_san_pham_khach_hang, detail.ten_san_pham_cong_ty, detail.quy_cach,
        detail.so_luong, detail.don_vi_tinh, detail.so_luong_quy_doi,
        detail.kg_sp_id, detail.c_uom_id,
        detail.don_gia_khach_hang, detail.don_gia_cong_ty,
        detail.ty_le_vat, detail.thanh_tien, detail.description
      FROM adempiere.kg_order_detail_ai detail
     WHERE detail.kg_order_ai_id = v_source.kg_order_ai_id
     ORDER BY detail.dong NULLS LAST, detail.kg_order_detail_ai_id;

    UPDATE adempiere.kg_order_ai
       SET trang_thai_xu_ly = 'published',
           thoi_gian_xac_nhan = now(),
           description = NULL,
           updated = now(),
           updatedby = p_user_id
     WHERE kg_order_ai_id = v_source.kg_order_ai_id;

    result_status := 'confirmed';
    kg_order_id := v_new_order_id;
    result_message := 'Đã đưa chứng từ vào hệ thống';
    RETURN NEXT;
END;
$$;
