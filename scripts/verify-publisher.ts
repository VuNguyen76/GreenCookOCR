import { getDocument, listDocuments } from "../src/server/db/repository.js";
import { pool } from "../src/server/db/pool.js";
import { IdempierePublisher } from "../src/server/idempiere/publisher.js";
import { stagingDatabase } from "../src/server/db/staging.js";

const documents = await Promise.all((await listDocuments(500)).map((summary) => getDocument(summary.id)));
const candidate = documents.find((document) =>
  document?.items.length && document.items.every((item) => item.matched_kg_sp_id)
);
if (!candidate) throw new Error("Chưa có tài liệu staging nào đã đối chiếu đủ sản phẩm");

const client = await pool.connect();
let orderCount = 0;
let detailCount = 0;
try {
  await client.query("BEGIN");
  const orderIds = await new IdempierePublisher().publishDocument(String(candidate.id), client);
  const result = await client.query<{ orders: number; details: number }>(`
    SELECT count(DISTINCT orders.kg_order_id)::int AS orders,
           count(details.kg_detail_id)::int AS details
    FROM adempiere.kg_order orders
    LEFT JOIN adempiere.kg_detail details ON details.kg_order_id = orders.kg_order_id
    WHERE orders.kg_order_id = ANY($1::numeric[])
  `, [orderIds]);
  orderCount = Number(result.rows[0]?.orders ?? 0);
  detailCount = Number(result.rows[0]?.details ?? 0);
  if (orderCount !== orderIds.length || detailCount < 1) {
    throw new Error("Publish thử không tạo đủ header/detail trong transaction");
  }
  await client.query("ROLLBACK");

  const residual = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count FROM adempiere.kg_order WHERE source_document_id = $1
  `, [candidate.id]);
  if (Number(residual.rows[0]?.count ?? 0) !== 0) {
    throw new Error("Transaction kiểm thử còn để lại dữ liệu trong kg_order");
  }
  console.log(JSON.stringify({
    ok: true,
    documentId: candidate.id,
    orderCount,
    detailCount,
    residualOrders: 0
  }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
  stagingDatabase.close();
}
