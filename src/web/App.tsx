import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localizeOcrWarning } from "../shared/warning-messages.js";

type Status = "queued" | "preprocessing" | "ocr_running" | "validating" | "completed" | "needs_review" | "Chưa xác nhận" | "failed";

interface DocumentSummary {
  id: string;
  original_name: string;
  upload_url?: string | null;
  mime_type: string;
  size_bytes: string;
  status: Status;
  document_title: string | null;
  template_key: string | null;
  issuer_name: string | null;
  attempts: number;
  error_message: string | null;
  warnings: string[];
  item_count: number;
  created_at: string;
  updated_at: string;
}

interface DocumentDetail extends DocumentSummary {
  po_number: string | null;
  po_date: string | null;
  delivery_date: string | null;
  currency: string | null;
  supplier_name: string | null;
  subtotal_amount: string | null;
  tax_amount: string | null;
  total_amount: string | null;
  normalized_result: Record<string, unknown> | null;
  items: Array<{
    id: string;
    line_no: number;
    po_number: string | null;
    po_date: string | null;
    store_code: string | null;
    store_name: string | null;
    delivery_address: string | null;
    product_code: string | null;
    vendor_product_code: string | null;
    barcode: string | null;
    product_name: string | null;
    model: string | null;
    article_code?: string | null;
    sku?: string | null;
    ou_type?: string | null;
    quantity: string | null;
    free_quantity?: string | null;
    units_per_order_unit: string | null;
    unit: string | null;
    list_price?: string | null;
    unit_price: string | null;
    discount_percent?: string | null;
    discount_amount?: string | null;
    vat_rate: string | null;
    tax_amount?: string | null;
    amount: string | null;
    gross_amount?: string | null;
    promised_date?: string | null;
    warehouse_code?: string | null;
    warehouse_name?: string | null;
    extra_fields?: Array<{ label?: string; value?: string }>;
    source_page?: number | null;
    confidence: string;
  }>;
}

const STATUS_LABELS: Record<Status, string> = {
  queued: "Đang chờ",
  preprocessing: "Đang chuẩn bị",
  ocr_running: "Đang đọc dữ liệu",
  validating: "Đang kiểm tra",
  completed: "Sẵn sàng",
  needs_review: "Cần xem lại",
  "Chưa xác nhận": "Chờ xác nhận",
  failed: "Không xử lý được"
};
const VI_NUMBER_FORMAT = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 });
type DocumentFilter = "all" | "review" | "processing" | "waiting";
const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 60000;

export function App() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<DocumentDetail | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, name: "" });
  const [dragging, setDragging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const refreshInFlightRef = useRef(false);
  const documentsRef = useRef<DocumentSummary[]>([]);
  const uploadingRef = useRef(false);
  const retryingCountRef = useRef(0);

  useEffect(() => {
    documentsRef.current = documents;
    uploadingRef.current = uploading;
    retryingCountRef.current = retryingIds.size;
  }, [documents, retryingIds.size, uploading]);

  const loadDocuments = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
    const response = await fetch("/api/documents");
    if (!response.ok) throw new Error("Không tải được hàng đợi");
    const data = await response.json();
    setDocuments(data.documents);
    setStats(data.stats);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      timer = window.setTimeout(async () => {
        if (cancelled || document.hidden) {
          schedule(IDLE_POLL_MS);
          return;
        }
        await loadDocuments().catch(() => undefined);
        const hasActiveWork = uploadingRef.current
          || retryingCountRef.current > 0
          || documentsRef.current.some((item) => isProcessingStatus(item.status));
        schedule(hasActiveWork ? ACTIVE_POLL_MS : IDLE_POLL_MS);
      }, delay);
    };

    void loadDocuments().catch((reason) => setError(reason.message));
    schedule(ACTIVE_POLL_MS);

    const onVisibilityChange = () => {
      if (!document.hidden) void loadDocuments().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadDocuments]);

  const openDocument = useCallback(async (id: string) => {
    const response = await fetch(`/api/documents/${id}`);
    if (!response.ok) return;
    setSelected(await response.json());
  }, []);

  useEffect(() => {
    if (!selected) return;
    const fresh = documents.find((item) => item.id === selected.id);
    if (fresh && fresh.updated_at !== selected.updated_at) void openDocument(selected.id);
  }, [documents, openDocument, selected]);

  const uploadFiles = useCallback(async (input: FileList | File[]) => {
    const files = Array.from(input);
    if (!files.length || uploading) return;
    setUploading(true);
    setError(null);
    setUploadProgress({ current: 0, total: files.length, name: files[0].name });
    try {
      const batchResponse = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileCount: files.length })
      });
      if (!batchResponse.ok) throw new Error("Không tạo được lô upload");
      const batch = await batchResponse.json();

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadProgress({ current: index + 1, total: files.length, name: file.name });
        const body = new FormData();
        body.append("batchId", batch.id);
        body.append("batchPosition", String(index + 1));
        body.append("file", file);
        const response = await fetch("/api/uploads", { method: "POST", body });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(`${file.name}: ${payload.error ?? "Upload thất bại"}`);
        }
      }
      await loadDocuments();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
      setUploadProgress({ current: 0, total: 0, name: "" });
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [loadDocuments, uploading]);

  const retry = useCallback(async (id: string) => {
    setRetryingIds((current) => new Set(current).add(id));
    setDocuments((current) => current.map((document) => (
      document.id === id ? { ...document, status: "queued", error_message: null } : document
    )));
    setSelected((current) => current?.id === id ? { ...current, status: "queued", error_message: null } : current);
    try {
      const response = await fetch(`/api/documents/${id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Không thể đọc lại tài liệu");
        await openDocument(id);
        return;
      }
      await loadDocuments();
      await openDocument(id);
    } finally {
      window.setTimeout(() => {
        setRetryingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, 1200);
    }
  }, [loadDocuments, openDocument]);

  const removeDocument = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Xóa tài liệu "${name}" và file đã upload?`)) return;
    setDeletingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Không thể xóa tài liệu");
      }
      setSelected((current) => current?.id === id ? null : current);
      await loadDocuments();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeletingId(null);
    }
  }, [loadDocuments]);

  const total = useMemo(() => Object.values(stats).reduce((sum, count) => sum + count, 0), [stats]);
  const processing = (stats.queued ?? 0) + (stats.preprocessing ?? 0) + (stats.ocr_running ?? 0) + (stats.validating ?? 0);
  const waitingForConfirm = stats["Chưa xác nhận"] ?? 0;
  const issues = (stats.failed ?? 0) + (stats.needs_review ?? 0);
  const visibleDocuments = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("vi");
    return documents.filter((document) => {
      const matchesQuery = !keyword || [document.original_name, document.document_title, document.issuer_name]
        .some((value) => value?.toLocaleLowerCase("vi").includes(keyword));
      const matchesFilter = filter === "all"
        || (filter === "review" && ["needs_review", "failed"].includes(document.status))
        || (filter === "processing" && isProcessingStatus(document.status))
        || (filter === "waiting" && document.status === "Chưa xác nhận");
      return matchesQuery && matchesFilter;
    });
  }, [documents, filter, query]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark"><ScanLine size={20} /></span>
          <div><strong>GreenCook</strong><span>Xử lý chứng từ đặt hàng</span></div>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-button" title="Làm mới" onClick={() => void loadDocuments()}><RefreshCw size={18} /></button>
          <button type="button" className="primary-button" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <LoaderCircle className="spin" size={18} /> : <Upload size={18} />}
            Thêm tài liệu
          </button>
          <input
            ref={inputRef}
            hidden
            multiple
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.doc,.docx,.xlsx,.txt,.csv"
            onChange={(event) => event.target.files && void uploadFiles(event.target.files)}
          />
        </div>
      </header>

      <main className={selected ? "has-selection" : ""}>
        <section className="metrics-band">
          <Metric label="Tất cả tài liệu" value={total} icon={<FileText size={18} />} />
          <Metric label="Đang xử lý" value={processing} icon={<Clock3 size={18} />} tone="amber" />
          <Metric label="Chờ xác nhận" value={waitingForConfirm} icon={<CheckCircle2 size={18} />} tone="green" />
          <Metric label="Cần xem lại" value={issues} icon={<AlertTriangle size={18} />} tone="red" />
        </section>

        <section
          className={`drop-band ${dragging ? "dragging" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void uploadFiles(event.dataTransfer.files);
          }}
        >
          <Upload size={20} />
          <div>
            <strong>{uploading ? `Đang thêm ${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.name}` : "Kéo thả tài liệu hoặc bấm Thêm tài liệu"}</strong>
            <span>PDF, ảnh, Word, Excel. Tài liệu mới sẽ được đọc tuần tự.</span>
          </div>
          {uploading && <div className="upload-track"><span style={{ width: `${uploadProgress.current / uploadProgress.total * 100}%` }} /></div>}
        </section>

        {error && <div className="error-banner"><AlertTriangle size={17} /><span>{displayUserMessage(error)}</span><button type="button" title="Đóng" onClick={() => setError(null)}><X size={17} /></button></div>}

        <section className="workspace">
          <div className="queue-pane">
            <div className="section-heading queue-heading">
              <div><h1>Danh sách chứng từ</h1><span>{visibleDocuments.length}/{documents.length} tài liệu</span></div>
              <label className="queue-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên hoặc đơn vị" aria-label="Tìm chứng từ" /></label>
            </div>
            <div className="queue-filters" aria-label="Lọc chứng từ">
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>Tất cả</FilterButton>
              <FilterButton active={filter === "review"} onClick={() => setFilter("review")}>Cần xem lại</FilterButton>
              <FilterButton active={filter === "processing"} onClick={() => setFilter("processing")}>Đang xử lý</FilterButton>
              <FilterButton active={filter === "waiting"} onClick={() => setFilter("waiting")}>Chờ xác nhận</FilterButton>
            </div>
            <div className="table-wrap">
              <table className="queue-table">
                <thead><tr><th>Tài liệu</th><th>Nội dung</th><th>Loại chứng từ</th><th>Trạng thái</th><th className="numeric">Sản phẩm</th><th aria-label="Thao tác" /></tr></thead>
                <tbody>
                  {visibleDocuments.map((document) => {
                    const retrying = retryingIds.has(document.id);
                    return (
                    <tr
                      key={document.id}
                      className={selected?.id === document.id ? "selected" : ""}
                      tabIndex={0}
                      onClick={() => void openDocument(document.id)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        void openDocument(document.id);
                      }}
                    >
                      <td><div className="file-cell">{fileIcon(document.original_name)}<div><strong title={document.original_name}>{document.original_name}</strong><span>{formatBytes(Number(document.size_bytes))}</span></div></div></td>
                      <td><span className="title-cell">{displayDocumentTitle(document.document_title, document.original_name)}</span></td>
                      <td><span className="document-type">{documentTypeLabel(document.template_key)}</span></td>
                      <td><StatusBadge status={document.status} retrying={retrying} /></td>
                      <td className="numeric">{document.item_count ?? 0}</td>
                      <td><div className="row-actions">
                        {(document.status === "failed" || document.status === "needs_review" || document.status === "completed" || document.status === "Chưa xác nhận") && <button type="button" className="icon-button compact" title="Đọc lại tài liệu" disabled={retrying} onClick={(event) => { event.stopPropagation(); void retry(document.id); }}>{retrying ? <LoaderCircle className="spin" size={16} /> : <RotateCcw size={16} />}</button>}
                        {!isProcessingStatus(document.status) && !retrying && <button type="button" className="icon-button compact danger-icon" title="Xóa tài liệu" disabled={deletingId === document.id} onClick={(event) => { event.stopPropagation(); void removeDocument(document.id, document.original_name); }}><Trash2 size={16} /></button>}
                        <ChevronRight size={17} />
                      </div></td>
                    </tr>
                  );})}
                  {!visibleDocuments.length && <tr><td colSpan={6} className="empty-state">Không tìm thấy chứng từ phù hợp</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {selected && <DetailPane key={selected.id} document={selected} deleting={deletingId === selected.id} retrying={retryingIds.has(selected.id)} onClose={() => setSelected(null)} onRetry={retry} onDelete={removeDocument} />}
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value, icon, tone = "neutral" }: { label: string; value: number; icon: React.ReactNode; tone?: string }) {
  return <div className={`metric ${tone}`}><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>;
}

function StatusBadge({ status, retrying = false }: { status: Status; retrying?: boolean }) {
  const active = retrying || ["queued", "preprocessing", "ocr_running", "validating"].includes(status);
  return <span className={`status ${retrying ? "status-retrying" : `status-${statusClass(status)}`}`}>{active && <LoaderCircle className="spin" size={13} />}{retrying ? "Đang đọc lại" : STATUS_LABELS[status]}</span>;
}

function statusClass(status: Status): string {
  if (status === "Chưa xác nhận") return "waiting";
  return status;
}

function DetailPane({ document, deleting, retrying, onClose, onRetry, onDelete }: { document: DocumentDetail; deleting: boolean; retrying: boolean; onClose: () => void; onRetry: (id: string) => Promise<void>; onDelete: (id: string, name: string) => Promise<void> }) {
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(true);
  const poNumbers = [...new Set(document.items.map((item) => item.po_number).filter((value): value is string => Boolean(value)))];
  const hasRowOrders = poNumbers.length > 1;
  const poSummary = document.po_number ?? (hasRowOrders ? `${poNumbers.length} PO trong file` : poNumbers[0] ?? "-");
  const warnings = [...new Set(document.warnings
    .map(displayUserMessage)
    .filter((warning): warning is string => Boolean(warning)))];
  const canRetry = (["failed", "needs_review", "completed", "Chưa xác nhận"] as Status[]).includes(document.status);
  const canDelete = !isProcessingStatus(document.status);
  const documentFields = buildDocumentFields(document, poSummary, hasRowOrders);
  const additionalFields = [...documentFields, ...buildAdditionalFields(document, documentFields)];

  return <aside className="detail-pane">
    <div className="detail-header"><div><span>Thông tin chứng từ</span><h2>{displayDocumentTitle(document.document_title, document.original_name)}</h2></div><button type="button" className="icon-button" title="Đóng" onClick={onClose}><X size={18} /></button></div>
    <div className="totals-strip">
      <TotalStat label="Tiền hàng" value={formatMoney(document.subtotal_amount, document.currency)} />
      <TotalStat label="Thuế" value={formatMoney(document.tax_amount, document.currency)} />
      <TotalStat label={hasRowOrders ? "Tổng giá trị dòng" : "Tổng đơn hàng"} value={formatMoney(document.total_amount, document.currency)} emphasis />
    </div>
    {(retrying || isProcessingStatus(document.status) || document.status === "queued") && <div className="processing-banner">
      <LoaderCircle className="spin" size={18} />
      <div><strong>{retrying ? "Đang đọc lại tài liệu" : STATUS_LABELS[document.status]}</strong><span>Hệ thống đang xử lý, dữ liệu sẽ tự cập nhật khi có kết quả.</span></div>
    </div>}
    {additionalFields.length > 0 && <section className={`source-fields collapsible-panel ${sourceExpanded ? "expanded" : ""}`}>
      <button type="button" className="collapse-trigger" aria-expanded={sourceExpanded} onClick={() => setSourceExpanded((current) => !current)}>
        <span><FileText size={15} /><strong>Thông tin chứng từ</strong><small>{additionalFields.length} trường</small></span>
        {sourceExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {sourceExpanded && <div className="source-field-scroll"><div className="source-field-grid">{additionalFields.map((field) => <div key={`${field.label}:${field.value}`}><span>{field.label}</span><strong>{field.value}</strong></div>)}</div></div>}
    </section>}
    {document.error_message && <div className="detail-error"><AlertTriangle size={16} />{displayUserMessage(document.error_message)}</div>}
    {warnings.length > 0 && <section className={`warning-list collapsible-panel ${warningsExpanded ? "expanded" : ""}`}>
      <button type="button" className="collapse-trigger" aria-expanded={warningsExpanded} onClick={() => setWarningsExpanded((current) => !current)}>
        <span><AlertTriangle size={15} /><strong>Thông tin cần bổ sung</strong><small>{warnings.length} mục</small></span>
        {warningsExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {warningsExpanded && <div className="collapse-content">{warnings.map((warning) => <div key={warning}><AlertTriangle size={14} /><span>{warning}</span></div>)}</div>}
    </section>}
    {document.status === "Chưa xác nhận" && <div className="pending-review"><Clock3 size={17} /><div><strong>Đã lưu vào bảng tạm</strong><span>Chờ người dùng xác nhận trong iDempiere.</span></div></div>}
    <div className="detail-table-heading"><h3>Dòng sản phẩm</h3><span>{document.items.length} dòng</span></div>
    <div className="detail-table-wrap"><table className={`product-table ${hasRowOrders ? "with-orders" : ""}`}><thead><tr><th>#</th>{hasRowOrders && <th>PO / Cửa hàng</th>}<th>Mã sản phẩm</th><th>Barcode</th><th>Tên sản phẩm</th><th className="numeric">Số lượng</th><th>Đơn vị</th><th className="numeric">Thuế suất</th><th className="numeric">Đơn giá</th><th className="numeric">Thành tiền</th></tr></thead><tbody>
      {document.items.map((item) => <tr key={item.id}><td>{item.line_no}</td>{hasRowOrders && <td className="po-cell"><strong>{item.po_number ?? "-"}</strong><span>{item.store_name ?? item.store_code ?? "-"}</span></td>}<td><strong>{item.product_code ?? item.vendor_product_code ?? "-"}</strong>{item.product_code && item.vendor_product_code && <span>NCC: {item.vendor_product_code}</span>}</td><td className="mono">{item.barcode ?? "-"}</td><td><strong>{item.product_name ?? "-"}</strong>{item.model && <span>Model: {item.model}</span>}<ItemExtraFields item={item} /></td><td className="numeric"><strong>{formatDecimal(item.quantity)}</strong>{item.units_per_order_unit && item.units_per_order_unit !== "1" && <span>× {formatDecimal(item.units_per_order_unit)} / ĐVT</span>}</td><td><strong>{item.unit ?? "-"}</strong></td><td className="numeric vat-cell">{formatVatRate(item.vat_rate)}</td><td className="numeric money-cell">{formatMoney(item.unit_price, null)}</td><td className="numeric money-cell strong">{formatMoney(item.amount, null)}</td></tr>)}
      {!document.items.length && <tr><td colSpan={hasRowOrders ? 10 : 9} className="empty-state">Chưa có dữ liệu</td></tr>}
    </tbody></table></div>
    <div className="mobile-product-list">
      {document.items.map((item) => <article className="mobile-product" key={item.id}>
        <div className="mobile-product-title"><span>#{item.line_no}</span><strong>{item.product_name ?? item.model ?? "Chưa có tên sản phẩm"}</strong></div>
        {hasRowOrders && <div className="mobile-product-order"><span>PO {item.po_number ?? "-"}</span><strong>{item.store_name ?? item.store_code ?? "-"}</strong></div>}
        <div className="mobile-product-keys"><div><span>Mã sản phẩm</span><strong>{item.product_code ?? item.vendor_product_code ?? "-"}</strong></div><div><span>Barcode</span><strong>{item.barcode ?? "-"}</strong></div></div>
        <ItemExtraFields item={item} />
        <div className="mobile-product-values"><div><span>Số lượng</span><strong>{formatDecimal(item.quantity)}{item.units_per_order_unit && item.units_per_order_unit !== "1" ? ` × ${formatDecimal(item.units_per_order_unit)}` : ""}</strong></div><div><span>Đơn vị</span><strong>{item.unit ?? "-"}</strong></div><div><span>Thuế suất</span><strong>{formatVatRate(item.vat_rate)}</strong></div><div><span>Đơn giá</span><strong>{formatMoney(item.unit_price, null)}</strong></div><div><span>Thành tiền</span><strong>{formatMoney(item.amount, null)}</strong></div></div>
      </article>)}
      {!document.items.length && <div className="empty-state">Chưa có dữ liệu</div>}
    </div>
    {(canRetry || canDelete) && <div className="detail-footer">
      {canRetry && <button type="button" className="secondary-button" disabled={retrying} onClick={() => void onRetry(document.id)}>{retrying ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}{retrying ? "Đang đọc lại" : "Đọc lại"}</button>}
      {canDelete && !retrying && <button type="button" className="danger-button" disabled={deleting} onClick={() => void onDelete(document.id, document.original_name)}>{deleting ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}Xóa chứng từ</button>}
    </div>}
  </aside>;
}

function TotalStat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={emphasis ? "emphasis" : ""}><span>{label}</span><strong>{value}</strong></div>;
}

function ItemExtraFields({ item }: { item: DocumentDetail["items"][number] }) {
  const fields = buildItemAdditionalFields(item);
  if (!fields.length) return null;
  return <details className="item-extra-fields"><summary>{fields.length} thông tin khác</summary><div>{fields.map((field) => <span key={`${field.label}:${field.value}`}><small>{field.label}</small><strong>{field.value}</strong></span>)}</div></details>;
}

function buildDocumentFields(document: DocumentDetail, poSummary: string, hasRowOrders: boolean): Array<{ label: string; value: string }> {
  const fields: Array<[string, unknown]> = [
    ["Tệp gốc", document.original_name],
    ["Link file", document.upload_url],
    ["Loại chứng từ", documentTypeLabel(document.template_key)],
    [hasRowOrders ? "Số PO trong file" : "Số PO", poSummary],
    ["Ngày PO", formatDate(document.po_date)],
    ["Đơn vị đặt hàng", document.issuer_name],
    ["Trạng thái", STATUS_LABELS[document.status]],
    ["Tiền hàng", formatMoney(document.subtotal_amount, document.currency)],
    ["Thuế", formatMoney(document.tax_amount, document.currency)],
    [hasRowOrders ? "Tổng giá trị dòng" : "Tổng đơn hàng", formatMoney(document.total_amount, document.currency)]
  ];
  return fields.flatMap(([label, value]) => {
    const displayed = displayFieldValue(value);
    return displayed && displayed !== "-" ? [{ label, value: displayed }] : [];
  });
}

function buildAdditionalFields(document: DocumentDetail, existingFields: Array<{ label: string; value: string }> = []): Array<{ label: string; value: string }> {
  const normalized = document.normalized_result ?? {};
  const candidates: Array<[string, unknown]> = [
    ["Số chứng từ", normalized.document_number],
    ["Số tham chiếu", normalized.reference_number],
    ["Chi nhánh đặt hàng", normalized.issuer_branch],
    ["Ngày giao", normalized.delivery_date ?? document.delivery_date],
    ["Khung giờ giao", normalized.delivery_window],
    ["Bên mua", normalized.buyer_name],
    ["Mã bên mua", normalized.buyer_code],
    ["Mã số thuế bên mua", normalized.buyer_tax_id],
    ["Tên nhà cung cấp", normalized.supplier_name],
    ["Mã nhà cung cấp", normalized.supplier_code],
    ["Mã số thuế nhà cung cấp", normalized.supplier_tax_id],
    ["Người liên hệ", normalized.order_contact],
    ["Điện thoại", normalized.contact_phone],
    ["Email", normalized.contact_email],
    ["Địa chỉ giao hàng", normalized.delivery_address],
    ["Địa chỉ nhận hàng", normalized.ship_to_address],
    ["Địa chỉ thanh toán", normalized.bill_to_address],
    ["Kho nhận hàng", normalized.warehouse_name],
    ["Mã kho", normalized.warehouse_code],
    ["Bộ phận", normalized.department],
    ["Điều khoản thanh toán", normalized.payment_terms],
    ["Phương thức thanh toán", normalized.payment_method],
    ["Phương thức giao hàng", normalized.delivery_method],
    ["Bảng giá", normalized.price_list_name],
    ["Chiết khấu", normalized.discount_amount],
    ["Phụ phí", normalized.charge_amount],
    ["Phí vận chuyển", normalized.freight_amount]
  ];
  const rawFields = Array.isArray(normalized.raw_fields)
    ? normalized.raw_fields as Array<Record<string, unknown>>
    : [];
  for (const field of rawFields) candidates.push([String(field.label ?? "Thông tin khác"), field.value]);

  const seen = new Set(existingFields.map((field) => `${field.label.toLocaleLowerCase("vi")}:${field.value}`));
  return candidates.flatMap(([label, value]) => {
    const displayed = displayFieldValue(value);
    const key = `${label.toLocaleLowerCase("vi")}:${displayed}`;
    if (!displayed || seen.has(key)) return [];
    seen.add(key);
    return [{ label, value: displayed }];
  });
}

function buildItemAdditionalFields(item: DocumentDetail["items"][number]): Array<{ label: string; value: string }> {
  const candidates: Array<[string, unknown]> = [
    ["Mã Article", item.article_code],
    ["SKU", item.sku],
    ["Loại đơn vị đặt", item.ou_type],
    ["Số lượng miễn phí", item.free_quantity],
    ["Giá niêm yết", item.list_price],
    ["Chiết khấu (%)", item.discount_percent],
    ["Tiền chiết khấu", item.discount_amount],
    ["Tiền thuế", item.tax_amount],
    ["Tổng sau thuế", item.gross_amount],
    ["Ngày hẹn", item.promised_date],
    ["Mã kho", item.warehouse_code],
    ["Kho", item.warehouse_name],
    ["Trang nguồn", item.source_page]
  ];
  for (const field of item.extra_fields ?? []) {
    candidates.push([field.label ?? "Thông tin khác", field.value]);
  }
  const seen = new Set<string>();
  return candidates.flatMap(([label, value]) => {
    const displayed = displayFieldValue(value);
    const key = `${label.toLocaleLowerCase("vi")}:${displayed}`;
    if (!displayed || seen.has(key)) return [];
    seen.add(key);
    return [{ label, value: displayed }];
  });
}

function displayFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (["string", "number"].includes(typeof value)) return String(value);
  return "";
}

function fileIcon(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") return <FileSpreadsheet size={19} />;
  if (["png", "jpg", "jpeg", "webp", "tif", "tiff"].includes(extension ?? "")) return <ImageIcon size={19} />;
  return <FileText size={19} />;
}

function documentTypeLabel(value: string | null) {
  if (!value) return "Chưa xác định";
  const normalized = value.toLowerCase();
  if (normalized.includes("delivery_request")) return "Đề nghị giao hàng";
  if (normalized.includes("purchase_note")) return "Phiếu đặt hàng";
  if (
    normalized.includes("purchase_order")
    || normalized.includes("order_export")
    || normalized.includes("customer_manual")
    || normalized.includes("manual_purchase")
    || normalized.includes("dmx")
    || normalized.startsWith("po_")
  ) return "Đơn đặt hàng";
  if (normalized.includes("store_order")) return "Đơn hàng cửa hàng";
  return "Chứng từ bán hàng";
}

function displayDocumentTitle(value: string | null, fallback: string) {
  if (!value) return fallback;
  const normalized = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (/đề nghị giao hàng|request delivery/i.test(normalized)) return "Đề nghị giao hàng";
  if (/purchase note/i.test(normalized)) return "Phiếu đặt hàng";
  if (/purchase order/i.test(normalized)) return "Đơn đặt hàng";
  return normalized.replace(/\bREQUEST DELIVERY\b/gi, "").replace(/\s+/g, " ").trim();
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatDecimal(value: string | null) {
  if (!value) return "-";
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatVatRate(value: string | null) {
  return value === null ? "-" : `${formatDecimal(value)}%`;
}

function FilterButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} aria-pressed={active} onClick={onClick}>{children}</button>;
}

function displayUserMessage(value: string) {
  const localized = localizeOcrWarning(value) ?? value;
  const cleaned = localized
    .replace(/\s*\((?:unit_price|vat_rate|amount|subtotal_amount|tax_amount|total_amount|po_date)\)/gi, "")
    .replace(/\bunit_price\b/gi, "đơn giá")
    .replace(/\bvat_rate\b/gi, "thuế suất")
    .replace(/\bsubtotal_amount\b/gi, "tiền hàng")
    .replace(/\btax_amount\b/gi, "tiền thuế")
    .replace(/\btotal_amount\b/gi, "tổng tiền")
    .replace(/\bpo_date\b/gi, "ngày PO")
    .replace(/\bamount\b/gi, "thành tiền")
    .replace(/Gemini(?: API)?/gi, "dịch vụ xử lý tài liệu")
    .replace(/model OCR|OCR model|Model OCR/gi, "hệ thống đọc tài liệu")
    .replace(/OCR/gi, "đọc dữ liệu")
    .replace(/JSON/gi, "dữ liệu");
  const vietnameseCharacters = (cleaned.match(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi) ?? []).length;
  const asciiWords = cleaned.match(/[A-Za-z]{3,}/g)?.length ?? 0;
  return asciiWords >= 5 && vietnameseCharacters === 0
    ? "Có thông tin trên chứng từ cần được kiểm tra lại."
    : cleaned;
}

function isProcessingStatus(status: Status) {
  return ["queued", "preprocessing", "ocr_running", "validating"].includes(status);
}

function formatMoney(value: string | null, currency: string | null) {
  if (!value) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const formatted = VI_NUMBER_FORMAT.format(number);
  return currency ? `${formatted} ${currency}` : formatted;
}
