import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Upload,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "queued" | "preprocessing" | "ocr_running" | "validating" | "completed" | "needs_review" | "failed";

interface DocumentSummary {
  id: string;
  original_name: string;
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
    product_code: string | null;
    vendor_product_code: string | null;
    barcode: string | null;
    product_name: string | null;
    model: string | null;
    quantity: string | null;
    units_per_order_unit: string | null;
    unit: string | null;
    unit_price: string | null;
    amount: string | null;
    confidence: string;
  }>;
}

const STATUS_LABELS: Record<Status, string> = {
  queued: "Đang chờ",
  preprocessing: "Tiền xử lý",
  ocr_running: "Gemini OCR",
  validating: "Kiểm tra JSON",
  completed: "Hoàn tất",
  needs_review: "Cần kiểm tra",
  failed: "Thất bại"
};

export function App() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<DocumentDetail | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, name: "" });
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    const response = await fetch("/api/documents");
    if (!response.ok) throw new Error("Không tải được hàng đợi");
    const data = await response.json();
    setDocuments(data.documents);
    setStats(data.stats);
  }, []);

  useEffect(() => {
    void loadDocuments().catch((reason) => setError(reason.message));
    const timer = setInterval(() => void loadDocuments().catch(() => undefined), 2000);
    return () => clearInterval(timer);
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
        await loadDocuments();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
      setUploadProgress({ current: 0, total: 0, name: "" });
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [loadDocuments, uploading]);

  const retry = useCallback(async (id: string) => {
    const response = await fetch(`/api/documents/${id}/retry`, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "Không thể chạy lại");
      return;
    }
    await loadDocuments();
  }, [loadDocuments]);

  const total = useMemo(() => Object.values(stats).reduce((sum, count) => sum + count, 0), [stats]);
  const processing = (stats.queued ?? 0) + (stats.preprocessing ?? 0) + (stats.ocr_running ?? 0) + (stats.validating ?? 0);
  const issues = (stats.failed ?? 0) + (stats.needs_review ?? 0);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark"><ScanLine size={20} /></span>
          <div><strong>GreenCookOCR</strong><span>Gemini document pipeline</span></div>
        </div>
        <div className="header-actions">
          <button className="icon-button" title="Làm mới" onClick={() => void loadDocuments()}><RefreshCw size={18} /></button>
          <button className="primary-button" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <LoaderCircle className="spin" size={18} /> : <Upload size={18} />}
            Chọn file
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

      <main>
        <section className="metrics-band">
          <Metric label="Tổng tài liệu" value={total} icon={<FileText size={18} />} />
          <Metric label="Đang xử lý" value={processing} icon={<Clock3 size={18} />} tone="amber" />
          <Metric label="Hoàn tất" value={stats.completed ?? 0} icon={<CheckCircle2 size={18} />} tone="green" />
          <Metric label="Cần xử lý" value={issues} icon={<AlertTriangle size={18} />} tone="red" />
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
            <strong>{uploading ? `${uploadProgress.current}/${uploadProgress.total} ${uploadProgress.name}` : "Thả tài liệu vào đây"}</strong>
            <span>PDF, ảnh, Word, Excel</span>
          </div>
          {uploading && <div className="upload-track"><span style={{ width: `${uploadProgress.current / uploadProgress.total * 100}%` }} /></div>}
        </section>

        {error && <div className="error-banner"><AlertTriangle size={17} /><span>{error}</span><button title="Đóng" onClick={() => setError(null)}><X size={17} /></button></div>}

        <section className="workspace">
          <div className="queue-pane">
            <div className="section-heading"><div><h1>Hàng đợi OCR</h1><span>{documents.length} tài liệu gần nhất</span></div></div>
            <div className="table-wrap">
              <table className="queue-table">
                <thead><tr><th>Tài liệu</th><th>Tiêu đề</th><th>Mẫu</th><th>Trạng thái</th><th className="numeric">Dòng</th><th aria-label="Thao tác" /></tr></thead>
                <tbody>
                  {documents.map((document) => (
                    <tr key={document.id} className={selected?.id === document.id ? "selected" : ""} onClick={() => void openDocument(document.id)}>
                      <td><div className="file-cell">{fileIcon(document.original_name)}<div><strong title={document.original_name}>{document.original_name}</strong><span>{formatBytes(Number(document.size_bytes))}</span></div></div></td>
                      <td><span className="title-cell">{document.document_title ?? "Chưa nhận diện"}</span></td>
                      <td><code>{shortTemplate(document.template_key)}</code></td>
                      <td><StatusBadge status={document.status} /></td>
                      <td className="numeric">{document.item_count ?? 0}</td>
                      <td><div className="row-actions">
                        {(document.status === "failed" || document.status === "needs_review") && <button className="icon-button compact" title="Chạy lại" onClick={(event) => { event.stopPropagation(); void retry(document.id); }}><RotateCcw size={16} /></button>}
                        <ChevronRight size={17} />
                      </div></td>
                    </tr>
                  ))}
                  {!documents.length && <tr><td colSpan={6} className="empty-state">Chưa có tài liệu</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {selected && <DetailPane document={selected} onClose={() => setSelected(null)} onRetry={retry} />}
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value, icon, tone = "neutral" }: { label: string; value: number; icon: React.ReactNode; tone?: string }) {
  return <div className={`metric ${tone}`}><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>;
}

function StatusBadge({ status }: { status: Status }) {
  const active = ["preprocessing", "ocr_running", "validating"].includes(status);
  return <span className={`status status-${status}`}>{active && <LoaderCircle className="spin" size={13} />}{STATUS_LABELS[status]}</span>;
}

function DetailPane({ document, onClose, onRetry }: { document: DocumentDetail; onClose: () => void; onRetry: (id: string) => Promise<void> }) {
  return <aside className="detail-pane">
    <div className="detail-header"><div><span>Chi tiết đơn hàng</span><h2>{document.document_title ?? document.original_name}</h2></div><button className="icon-button" title="Đóng" onClick={onClose}><X size={18} /></button></div>
    <div className="detail-meta">
      <Meta label="File" value={document.original_name} />
      <Meta label="Mẫu" value={document.template_key ?? "Chưa xác định"} mono />
      <Meta label="Số PO" value={document.po_number ?? "-"} />
      <Meta label="Ngày PO" value={formatDate(document.po_date)} />
      <Meta label="Đơn vị" value={document.issuer_name ?? "-"} />
      <Meta label="Trạng thái" value={STATUS_LABELS[document.status]} />
    </div>
    <div className="totals-strip">
      <TotalStat label="Tiền hàng" value={formatMoney(document.subtotal_amount, document.currency)} />
      <TotalStat label="Thuế" value={formatMoney(document.tax_amount, document.currency)} />
      <TotalStat label="Tổng đơn hàng" value={formatMoney(document.total_amount, document.currency)} emphasis />
    </div>
    {document.error_message && <div className="detail-error"><AlertTriangle size={16} />{document.error_message}</div>}
    {document.warnings?.length > 0 && <div className="warning-list">{document.warnings.map((warning) => <div key={warning}><AlertTriangle size={14} />{warning}</div>)}</div>}
    <div className="detail-table-heading"><h3>Dòng sản phẩm</h3><span>{document.items.length} dòng</span></div>
    <div className="detail-table-wrap"><table className="product-table"><thead><tr><th>#</th><th>Mã sản phẩm</th><th>Barcode</th><th>Tên sản phẩm</th><th className="numeric">Số lượng</th><th>Đơn vị</th><th className="numeric">Đơn giá</th><th className="numeric">Thành tiền</th></tr></thead><tbody>
      {document.items.map((item) => <tr key={item.id}><td>{item.line_no}</td><td><strong>{item.product_code ?? item.vendor_product_code ?? "-"}</strong>{item.product_code && item.vendor_product_code && <span>NCC: {item.vendor_product_code}</span>}</td><td className="mono">{item.barcode ?? "-"}</td><td><strong>{item.product_name ?? "-"}</strong>{item.model && <span>Model: {item.model}</span>}</td><td className="numeric"><strong>{formatDecimal(item.quantity)}</strong>{item.units_per_order_unit && item.units_per_order_unit !== "1" && <span>× {formatDecimal(item.units_per_order_unit)} / ĐVT</span>}</td><td><strong>{item.unit ?? "-"}</strong></td><td className="numeric money-cell">{formatMoney(item.unit_price, null)}</td><td className="numeric money-cell strong">{formatMoney(item.amount, null)}</td></tr>)}
      {!document.items.length && <tr><td colSpan={8} className="empty-state">Chưa có dữ liệu</td></tr>}
    </tbody></table></div>
    <div className="mobile-product-list">
      {document.items.map((item) => <article className="mobile-product" key={item.id}>
        <div className="mobile-product-title"><span>#{item.line_no}</span><strong>{item.product_name ?? item.model ?? "Chưa có tên sản phẩm"}</strong></div>
        <div className="mobile-product-keys"><div><span>Mã sản phẩm</span><strong>{item.product_code ?? item.vendor_product_code ?? "-"}</strong></div><div><span>Barcode</span><strong>{item.barcode ?? "-"}</strong></div></div>
        <div className="mobile-product-values"><div><span>Số lượng</span><strong>{formatDecimal(item.quantity)}{item.units_per_order_unit && item.units_per_order_unit !== "1" ? ` × ${formatDecimal(item.units_per_order_unit)}` : ""}</strong></div><div><span>Đơn vị</span><strong>{item.unit ?? "-"}</strong></div><div><span>Đơn giá</span><strong>{formatMoney(item.unit_price, null)}</strong></div><div><span>Thành tiền</span><strong>{formatMoney(item.amount, null)}</strong></div></div>
      </article>)}
      {!document.items.length && <div className="empty-state">Chưa có dữ liệu</div>}
    </div>
    {(["failed", "needs_review", "completed"] as Status[]).includes(document.status) && <div className="detail-footer"><button className="secondary-button" onClick={() => void onRetry(document.id)}><RotateCcw size={17} />{document.status === "completed" ? "OCR lại" : "Chạy lại OCR"}</button></div>}
  </aside>;
}

function TotalStat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={emphasis ? "emphasis" : ""}><span>{label}</span><strong>{value}</strong></div>;
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>;
}

function fileIcon(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") return <FileSpreadsheet size={19} />;
  if (["png", "jpg", "jpeg", "webp", "tif", "tiff"].includes(extension ?? "")) return <ImageIcon size={19} />;
  return <FileText size={19} />;
}

function shortTemplate(value: string | null) {
  if (!value) return "-";
  return value.replace(/^po_/, "").replace(/_purchase_order$/, "").replace(/_/g, " ");
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

function formatMoney(value: string | null, currency: string | null) {
  if (!value) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const formatted = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 }).format(number);
  return currency ? `${formatted} ${currency}` : formatted;
}
