import { getDocument, listDocuments } from "../src/server/db/repository.js";
import { pool } from "../src/server/db/pool.js";
import { stagingDatabase } from "../src/server/db/staging.js";
import { checkPoReferences, normalizePoNumber } from "../src/server/idempiere/po-reference.js";

try {
  const documents = await Promise.all(
    (await listDocuments(500)).map((summary) => getDocument(summary.id))
  );
  const poNumbers = [...new Map(documents.flatMap((document) => {
    if (!document) return [];
    return [document.po_number, ...document.items.map((item) => item.po_number)]
      .filter((value): value is string => Boolean(value))
      .map((value) => [normalizePoNumber(value), value] as const);
  })).values()];
  const checks = await checkPoReferences(poNumbers);
  const matched = checks.filter((check) => check.matched);
  const sourceSample = await pool.query<{ po: string }>(`
    SELECT poreference AS po FROM adempiere.c_order
    WHERE ad_client_id = 11 AND isactive = 'Y'
      AND poreference IS NOT NULL AND btrim(poreference) <> ''
    LIMIT 1
  `);
  const sourceProbe = sourceSample.rows[0]
    ? (await checkPoReferences([sourceSample.rows[0].po]))[0]
    : null;
  if (sourceSample.rows[0] && !sourceProbe?.matched) {
    throw new Error("Truy vấn đối chiếu không nhận ra Số PO đang có trong C_Order");
  }

  console.log(JSON.stringify({
    uniquePoNumbers: checks.length,
    matchedPoNumbers: matched.length,
    unmatchedPoNumbers: checks.length - matched.length,
    matchedSamples: matched.slice(0, 20),
    sourceProbe
  }, null, 2));
} finally {
  await pool.end();
  stagingDatabase.close();
}
