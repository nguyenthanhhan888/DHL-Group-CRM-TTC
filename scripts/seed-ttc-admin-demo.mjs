const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SEED_KEY = 'admin_ttc_demo_v1';

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});

async function main() {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL.');
  if (!SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');

  const users = await rest('user_profiles', {
    select: 'user_id,display_name,email,user_facebook_accounts(id,facebook_id,facebook_id_status)',
    status: 'eq.active',
    order: 'created_at.desc',
    limit: '20',
  });
  const demoWorkers = users.filter((user) => Array.isArray(user.user_facebook_accounts) && user.user_facebook_accounts.length);
  if (demoWorkers.length < 2) throw new Error('Need at least 2 active users with Facebook accounts for TTC demo tasks.');

  const campaigns = await rest('ttc_campaigns', {
    select: 'id,owner_user_id,interaction_type_code,target_url,status',
    order: 'created_at.desc',
    limit: '6',
  });
  if (!campaigns.length) throw new Error('Need at least 1 TTC campaign before seeding admin demo tasks.');

  const tasks = await rest('ttc_tasks', {
    select: 'id,campaign_id,sequence_no,status',
    campaign_id: `in.(${campaigns.map((campaign) => campaign.id).join(',')})`,
    order: 'campaign_id.asc,sequence_no.asc',
    limit: '30',
  });
  if (!tasks.length) throw new Error('No TTC tasks found for existing campaigns.');

  const demoTasks = tasks.slice(0, 5);
  for (let index = 0; index < demoTasks.length; index += 1) {
    const task = demoTasks[index];
    const worker = demoWorkers[index % demoWorkers.length];
    const facebookAccount = worker.user_facebook_accounts[0] || {};
    const status = index % 2 === 0 ? 'submitted' : 'verifying';
    await restUpdate('ttc_tasks', { id: `eq.${task.id}` }, {
      assignee_user_id: worker.user_id,
      worker_facebook_account_id: facebookAccount.id || null,
      worker_facebook_id: facebookAccount.facebook_id || `10000000090${index}`,
      status,
      claimed_at: shiftedIso(-(index + 3) * 60),
      submitted_at: shiftedIso(-(index + 1) * 18),
      expires_at: shiftedIso((index + 1) * 60),
      evidence: {
        text: `Demo bằng chứng ${index + 1}: đã hoàn thành tương tác và gửi ảnh xác nhận.`,
        screenshot_url: `https://example.com/demo-ttc-proof-${index + 1}.png`,
      },
      metadata: {
        seed: SEED_KEY,
        note: 'Demo row for admin TTC review table',
      },
    });
  }

  const existingLogs = await rest('ttc_task_check_logs', {
    select: 'id',
    'metadata->>seed': `eq.${SEED_KEY}`,
    limit: '1',
  });
  if (!existingLogs.length) {
    const logs = demoTasks.slice(0, 4).map((task, index) => ({
      task_id: task.id,
      campaign_id: task.campaign_id,
      check_type: index % 2 === 0 ? 'user_submit' : 'manual',
      result: index === 2 ? 'manual_review' : 'success',
      before_status: index % 2 === 0 ? 'assigned' : 'submitted',
      after_status: index % 2 === 0 ? 'submitted' : 'verifying',
      reason: index === 2 ? 'Demo log cần admin kiểm tra lại bằng chứng.' : 'Demo log tạo dữ liệu kiểm tra TTC.',
      metadata: {
        seed: SEED_KEY,
        note: 'Demo row for admin TTC check logs table',
      },
      created_at: shiftedIso(-(index + 1) * 12),
    }));
    await restInsert('ttc_task_check_logs', logs);
  }

  console.log(`Seeded TTC admin demo: ${demoTasks.length} review tasks, check logs ready.`);
}

async function rest(table, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: restHeaders(),
  });
  if (!response.ok) throw new Error(`${table} select failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function restUpdate(table, filters, payload) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: 'PATCH',
    headers: restHeaders({ prefer: 'return=minimal' }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`${table} update failed: ${response.status} ${await response.text()}`);
}

async function restInsert(table, rows) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: restHeaders({ prefer: 'return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`${table} insert failed: ${response.status} ${await response.text()}`);
}

function restHeaders({ prefer = '' } = {}) {
  return {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
    ...(prefer ? { prefer } : {}),
  };
}

function shiftedIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}
