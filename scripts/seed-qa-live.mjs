const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const YES_LIVE = process.argv.includes('--yes-live');

const PASSWORD = process.env.QA_PASSWORD || 'DHLTest@2026';
const QA_LIKE_TARGET_URL = 'https://www.facebook.com/share/p/1Lrfe5TSbj/';
const QA_LIKE_TARGET_LABEL = 'Bài test trong nhóm Macbook Người Dùng';

const QA_USERS = [
  {
    key: 'admin',
    email: 'qa.admin@dhl.local',
    displayName: 'QA Admin DHL',
    username: 'qa_admin',
    role: 'admin',
    phone: '0900003100',
  },
  {
    key: 'owner',
    email: 'qa.customer.owner@dhl.local',
    displayName: 'QA Khach Hang Owner',
    phone: '0900003101',
    walletBalance: 100000,
    facebookId: '100000000310001',
    facebookUrl: 'https://www.facebook.com/profile.php?id=100000000310001',
  },
  {
    key: 'worker',
    email: 'qa.customer.worker@dhl.local',
    displayName: 'QA Khach Hang Worker',
    phone: '0900003102',
    walletBalance: 50000,
    facebookId: '100000000310002',
    facebookUrl: 'https://www.facebook.com/profile.php?id=100000000310002',
  },
];

const FACEBOOK_TYPES = [
  ['facebook_like', 'Facebook - Tang like', 200, 100, 10, 1000, 'like'],
  ['facebook_follow', 'Facebook - Tang follow', 200, 100, 10, 1000, 'follow'],
  ['facebook_comment', 'Facebook - Tang comment', 300, 150, 5, 500, 'comment'],
  ['facebook_reaction', 'Facebook - Tang cam xuc', 200, 100, 10, 1000, 'reaction'],
  ['facebook_share', 'Facebook - Tang share', 300, 150, 5, 500, 'share'],
  ['facebook_join_group', 'Facebook - Tham gia nhom', 300, 150, 5, 500, 'join_group'],
];

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});

async function main() {
  assertEnv();
  console.log(YES_LIVE ? 'Mode: WRITE live QA seed' : 'Mode: DRY RUN');
  console.log(`Project: ${SUPABASE_URL}`);

  const existingUsers = await listAuthUsers();
  const authByEmail = new Map(existingUsers.map((user) => [String(user.email || '').toLowerCase(), user]));
  const seeded = {};

  for (const qaUser of QA_USERS) {
    const authUser = await ensureAuthUser(qaUser, authByEmail);
    seeded[qaUser.key] = { ...qaUser, id: authUser.id };
  }

  await seedAdminRole(seeded.admin);
  await seedCustomerProfile(seeded.owner);
  await seedCustomerProfile(seeded.worker);
  await seedFacebookTypes();
  await seedOwnerCampaign(seeded.owner);

  console.log('QA seed summary:');
  for (const user of Object.values(seeded)) {
    console.log(`- ${user.email} -> ${user.id}`);
  }
  console.log(`- Password chung: ${PASSWORD}`);
  await verifySeededState(seeded);
}

function assertEnv() {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL in environment.');
  if (!SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY in environment.');
}

async function ensureAuthUser(qaUser, authByEmail) {
  const existing = authByEmail.get(qaUser.email.toLowerCase());
  const body = {
    email: qaUser.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      display_name: qaUser.displayName,
      name: qaUser.displayName,
      phone: qaUser.phone,
      qa_seed: 'dhl_qa_seed_v1',
      qa_role: qaUser.role || 'customer',
    },
  };

  if (existing) {
    await authFetch(`/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT',
      body,
      dryRunLabel: `update auth user ${qaUser.email}`,
    });
    return existing;
  }

  const created = await authFetch('/auth/v1/admin/users', {
    method: 'POST',
    body,
    dryRunLabel: `create auth user ${qaUser.email}`,
  });
  if (!created?.id && YES_LIVE) throw new Error(`Auth API did not return id for ${qaUser.email}.`);
  return created || { id: `dry-run-${qaUser.key}` };
}

async function seedAdminRole(admin) {
  await restUpsert('user_roles', 'user_id', [{
    user_id: admin.id,
    username: admin.username,
    display_name: admin.displayName,
    role: admin.role,
    is_active: true,
  }], `upsert admin role ${admin.email}`);
}

async function seedCustomerProfile(user) {
  await restUpsert('user_profiles', 'user_id', [{
    user_id: user.id,
    display_name: user.displayName,
    phone: user.phone,
    email: user.email,
    status: 'active',
    metadata: {
      qa_seed: 'dhl_qa_seed_v1',
      seeded_at: new Date().toISOString(),
    },
  }], `upsert profile ${user.email}`);

  await restUpsert('wallets', 'user_id', [{
    user_id: user.id,
    balance: user.walletBalance,
    total_earned: user.walletBalance,
    total_spent: 0,
  }], `upsert wallet ${user.email}`);

  await upsertFacebookAccount({
    user_id: user.id,
    facebook_id: user.facebookId,
    facebook_url_original: user.facebookUrl,
    facebook_url_normalized: user.facebookUrl,
    facebook_id_status: 'manual_verified',
    resolved_at: new Date().toISOString(),
    is_primary: true,
    note: 'QA seed Facebook account',
    metadata: {
      qa_seed: 'dhl_qa_seed_v1',
    },
  }, `upsert facebook account ${user.email}`);
}

async function seedFacebookTypes() {
  const rows = FACEBOOK_TYPES.map(([code, label, unit_cost, worker_reward, min_quantity, max_quantity, action]) => ({
    code,
    label,
    unit_cost,
    worker_reward,
    min_quantity,
    max_quantity,
    hold_seconds: 0,
    is_active: true,
    config: {
      platform: 'facebook',
      action,
      qa_seed_checked: true,
    },
  }));
  await restUpsert('ttc_interaction_types', 'code', rows, 'upsert Facebook TTC interaction types');
}

async function seedOwnerCampaign(owner) {
  if (!YES_LIVE) {
    console.log('[dry-run] insert QA owner like campaign');
    return;
  }

  const existing = await restFetch(
    `/rest/v1/ttc_campaigns?owner_user_id=eq.${owner.id}&idempotency_key=eq.qa-owner-like-v1&select=id`,
    { method: 'GET' },
  );
  if (Array.isArray(existing) && existing.length) {
    console.log(`skip existing QA campaign -> ${existing[0].id}`);
    await restFetch(`/rest/v1/ttc_campaigns?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: {
        target_url: QA_LIKE_TARGET_URL,
        target_facebook_id: null,
        target_label: QA_LIKE_TARGET_LABEL,
        metadata: {
          qa_seed: 'dhl_qa_seed_v1',
          note: 'Campaign test de worker thay nhiem vu like bai viet.',
        },
      },
      dryRunLabel: `update QA owner like campaign ${existing[0].id}`,
    });
    await seedCampaignTasks(existing[0].id);
    return;
  }

  const created = await restFetch('/rest/v1/ttc_campaigns', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      owner_user_id: owner.id,
      interaction_type_code: 'facebook_like',
      target_url: QA_LIKE_TARGET_URL,
      target_facebook_id: null,
      target_label: QA_LIKE_TARGET_LABEL,
      target_quantity: 10,
      unit_cost: 200,
      worker_reward: 100,
      reserved_amount: 2000,
      status: 'queued',
      idempotency_key: 'qa-owner-like-v1',
      metadata: {
        qa_seed: 'dhl_qa_seed_v1',
        note: 'Campaign test de worker thay nhiem vu like bai viet.',
      },
    }],
    dryRunLabel: 'insert QA owner like campaign',
  });
  const campaignId = Array.isArray(created) ? created[0]?.id : null;
  if (!campaignId) throw new Error('Could not read created QA campaign id.');
  await seedCampaignTasks(campaignId);
}

async function seedCampaignTasks(campaignId) {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    campaign_id: campaignId,
    sequence_no: index + 1,
    status: 'available',
    metadata: {
      qa_seed: 'dhl_qa_seed_v1',
      note: 'Available task for QA worker account.',
    },
  }));
  await restUpsert('ttc_tasks', 'campaign_id,sequence_no', rows, `upsert QA tasks for campaign ${campaignId}`);
}

async function verifySeededState(seeded) {
  if (!YES_LIVE) return;

  const customerIds = [seeded.owner.id, seeded.worker.id];
  const profiles = await restFetch(
    `/rest/v1/user_profiles?user_id=in.(${customerIds.join(',')})&select=user_id,email,status,display_name`,
    { method: 'GET' },
  );
  const wallets = await restFetch(
    `/rest/v1/wallets?user_id=in.(${customerIds.join(',')})&select=user_id,balance,total_earned,total_spent`,
    { method: 'GET' },
  );
  const facebookAccounts = await restFetch(
    `/rest/v1/user_facebook_accounts?user_id=in.(${customerIds.join(',')})&select=user_id,facebook_id,facebook_id_status,is_primary`,
    { method: 'GET' },
  );
  const adminRoles = await restFetch(
    `/rest/v1/user_roles?user_id=eq.${seeded.admin.id}&select=user_id,username,role,is_active`,
    { method: 'GET' },
  );
  const facebookTypes = await restFetch(
    '/rest/v1/ttc_interaction_types?code=like.facebook_%25&is_active=eq.true&select=code,label,unit_cost,worker_reward',
    { method: 'GET' },
  );
  const campaigns = await restFetch(
    `/rest/v1/ttc_campaigns?owner_user_id=eq.${seeded.owner.id}&idempotency_key=eq.qa-owner-like-v1&select=id,status,interaction_type_code,target_quantity`,
    { method: 'GET' },
  );
  const campaignId = campaigns?.[0]?.id;
  const tasks = campaignId
    ? await restFetch(`/rest/v1/ttc_tasks?campaign_id=eq.${campaignId}&status=eq.available&select=id`, { method: 'GET' })
    : [];

  console.log('QA live verify:');
  console.log(`- admin role rows: ${adminRoles?.length || 0}`);
  console.log(`- customer profiles active: ${profiles?.filter((row) => row.status === 'active').length || 0}/2`);
  console.log(`- wallets: ${wallets?.map((row) => `${row.user_id}:${row.balance}`).join(', ') || 'none'}`);
  console.log(`- facebook accounts: ${facebookAccounts?.length || 0}/2`);
  console.log(`- active Facebook interaction types: ${facebookTypes?.length || 0}/6`);
  console.log(`- QA campaign: ${campaignId || 'missing'}, available tasks: ${tasks?.length || 0}`);
}

async function upsertFacebookAccount(row, dryRunLabel) {
  if (!YES_LIVE) {
    console.log(`[dry-run] ${dryRunLabel}`);
    return null;
  }

  const existing = await restFetch(
    `/rest/v1/user_facebook_accounts?facebook_id=eq.${encodeURIComponent(row.facebook_id)}&select=id`,
    { method: 'GET' },
  );

  if (Array.isArray(existing) && existing.length) {
    return restFetch(`/rest/v1/user_facebook_accounts?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: row,
      dryRunLabel,
    });
  }

  return restFetch('/rest/v1/user_facebook_accounts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [row],
    dryRunLabel,
  });
}

async function listAuthUsers() {
  const result = await authFetch('/auth/v1/admin/users?page=1&per_page=1000', { method: 'GET' });
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.users)) return result.users;
  return [];
}

async function restUpsert(table, conflictColumn, rows, dryRunLabel) {
  return restFetch(`/rest/v1/${table}?on_conflict=${encodeURIComponent(conflictColumn)}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: rows,
    dryRunLabel,
  });
}

async function authFetch(path, options = {}) {
  return apiFetch(`${SUPABASE_URL}${path}`, options);
}

async function restFetch(path, options = {}) {
  return apiFetch(`${SUPABASE_URL}${path}`, options);
}

async function apiFetch(url, options = {}) {
  const method = options.method || 'GET';
  if (!YES_LIVE && method !== 'GET') {
    console.log(`[dry-run] ${options.dryRunLabel || `${method} ${url}`}`);
    return null;
  }

  const response = await fetch(url, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const payload = text ? parseJson(text) : null;
  if (!response.ok) {
    const message = payload?.message || payload?.error_description || payload?.error || text || response.statusText;
    throw new Error(`${method} ${url} failed: ${response.status} ${message}`);
  }
  return payload;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
