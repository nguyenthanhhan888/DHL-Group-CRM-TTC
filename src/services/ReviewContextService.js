import { requireSupabaseClient, runQuery } from './BaseService.js';

// Read-only enrichment for Reports/Logs. Every lookup uses an explicit relationship
// and the signed-in client's existing RLS; denied/missing reads retain safe fallbacks.
const unique = values => [...new Set(values.filter(value => value != null && /^\d+$/.test(String(value))).map(String))];
const index = rows => new Map(rows.map(row => [String(row.id), row]));
const find = (map, id) => map.get(String(id));

async function readRecords(table, columns, ids, key = 'id') {
  if (!ids.length) return [];
  const { data } = await runQuery(requireSupabaseClient().from(table).select(columns).in(key, ids));
  return data || [];
}

export async function resolveReviewContexts(refs, read = readRecords) {
  const safeRead = async (table, columns, ids, key) => {
    const selected = unique(ids);
    if (!selected.length) return [];
    try { return await read(table, columns, selected, key); } catch { return []; }
  };
  const orders = index(await safeRead('payos_orders', 'id,payment_id,amount,status,purpose,reconciliation_reason', refs.map(ref => ref.orderId)));
  const payments = index(await safeRead('payments', 'id,customer_id,kiosk_id,registration_request_id,registration_batch_id,total_amount,payment_method,payment_status,transaction_type,confirmed_at,created_at', [
    ...refs.map(ref => ref.paymentId), ...[...orders.values()].map(row => row.payment_id),
  ]));
  const paymentRows = [...payments.values()];
  const requestColumns = 'id,payment_id,customer_id,kiosk_id,registration_batch_id,facebook_name';
  const [directRequests, paymentRequests, batches, batchItems] = await Promise.all([
    safeRead('registration_requests', requestColumns, [...refs.map(ref => ref.requestId), ...paymentRows.map(row => row.registration_request_id)]),
    safeRead('registration_requests', requestColumns, paymentRows.map(row => row.id), 'payment_id'),
    safeRead('registration_batches', 'id,customer_id', paymentRows.map(row => row.registration_batch_id)),
    safeRead('registration_batch_items', 'id,batch_id,kiosk_id', paymentRows.map(row => row.registration_batch_id), 'batch_id'),
  ]);
  const requests = index([...directRequests, ...paymentRequests]);
  const kiosks = index(await safeRead('kiosks', 'id,customer_id,facebook_name', [
    ...refs.map(ref => ref.kioskId), ...paymentRows.map(row => row.kiosk_id),
    ...[...requests.values()].map(row => row.kiosk_id), ...batchItems.map(row => row.kiosk_id),
  ]));
  const customers = index(await safeRead('customers', 'id,facebook_name', [
    ...refs.map(ref => ref.customerId), ...paymentRows.map(row => row.customer_id),
    ...[...requests.values()].map(row => row.customer_id), ...batches.map(row => row.customer_id),
    ...[...kiosks.values()].map(row => row.customer_id),
  ]));
  return refs.map(ref => {
    const order = find(orders, ref.orderId);
    const payment = find(payments, ref.paymentId || order?.payment_id);
    const relatedRequests = [...requests.values()].filter(row => String(row.id) === String(ref.requestId)
      || (payment && (String(row.id) === String(payment.registration_request_id) || String(row.payment_id) === String(payment.id))));
    const relatedKioskIds = unique([ref.kioskId, payment?.kiosk_id, ...relatedRequests.map(row => row.kiosk_id),
      ...batchItems.filter(row => payment?.registration_batch_id != null && String(row.batch_id) === String(payment.registration_batch_id)).map(row => row.kiosk_id)]);
    const relatedKiosks = relatedKioskIds.map(id => find(kiosks, id)).filter(Boolean);
    // Prefer the recorded customer; fall back through explicit request/batch/Kiosk ownership.
    const directCustomerIds = unique([ref.customerId, payment?.customer_id]);
    const relatedCustomerIds = directCustomerIds.some(id => find(customers, id)) ? directCustomerIds : unique([
      ...relatedRequests.map(row => row.customer_id), ...relatedKiosks.map(row => row.customer_id),
      ...batches.filter(row => payment?.registration_batch_id != null && String(row.id) === String(payment.registration_batch_id)).map(row => row.customer_id),
    ]);
    return { payment, order, customers: relatedCustomerIds.map(id => find(customers, id)).filter(Boolean), kiosks: relatedKiosks };
  });
}

export const ReviewContextService = { resolve: resolveReviewContexts };
