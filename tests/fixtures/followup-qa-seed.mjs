export async function seedFollowupReports(db) {
  // Synthetic historical snapshots, including legacy incomplete rows. Restore triggers before every tested read.
  await db.exec('set session_replication_role=replica');
  try {
  await db.exec("update customers set facebook_name='Alpha' where id=1; update kiosks set facebook_name='Alpha Kiosk' where id=1");
  const entries = [
    ['2025-01-01T00:00:00+07:00',500],['2025-06-15T12:00:00+07:00',1000],
    ['2026-06-15T12:00:00+07:00',600],['2026-07-31T23:59:59+07:00',70],
    ['2026-08-01T00:00:00+07:00',100],['2026-08-15T12:00:00+07:00',50],['2026-08-31T23:59:59+07:00',200],
    ['2026-09-01T00:00:00+07:00',400],['2026-10-01T00:00:00+07:00',900],
  ];
  for (const [at,amount] of entries) await db.query("insert into payments(customer_id,kiosk_id,price_per_month,total_amount,payment_status,confirmed_at,payment_method) values(1,1,$1,$1,'completed',$2,'cash')",[amount,at]);
  for (const status of ['pending','cancelled','completed']) await db.query("insert into payments(customer_id,kiosk_id,price_per_month,total_amount,payment_status,confirmed_at) values(1,1,9999,9999,$1,null)",[status]);
  for(const [at,amount] of [['2025-06-15',300],['2026-06-15',60],['2026-08-01',25],['2026-08-31',50],['2026-10-01',90]])
    await db.query("insert into expenses(category_id,category,note,amount,expense_date,payment_method,created_by) values((select id from expense_categories where code='other'),'other','TEST expense',$1,$2,'cash','00000000-0000-4000-8000-000000001001')",[amount,at]);
  await db.exec("insert into expenses(category_id,category,note,amount,expense_date,archived_at,payment_method,created_by) values((select id from expense_categories where code='other'),'other','TEST archived',9999,'2026-08-15',now(),'cash','00000000-0000-4000-8000-000000001001')");
  } finally { await db.exec('set session_replication_role=origin'); }
}
