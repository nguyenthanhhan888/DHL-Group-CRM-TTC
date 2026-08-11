const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

module.exports = async function verifyFacebookTaskHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Chỉ hỗ trợ phương thức POST.' });
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    return res.status(500).json({ ok: false, message: `Thiếu biến môi trường: ${missing.join(', ')}` });
  }

  try {
    const accessToken = bearerToken(req);
    if (!accessToken) return res.status(401).json({ ok: false, message: 'Bạn cần đăng nhập để xác minh nhiệm vụ.' });

    const taskId = positiveInteger(req.body?.taskId);
    if (!taskId) return res.status(400).json({ ok: false, message: 'Thiếu nhiệm vụ cần xác minh.' });

    const authUser = await getAuthenticatedUser(accessToken);
    const task = await getTask(taskId);
    if (!task) return res.status(404).json({ ok: false, message: 'Không tìm thấy nhiệm vụ.' });
    if (task.assignee_user_id !== authUser.id) {
      return res.status(403).json({ ok: false, message: 'Nhiệm vụ không thuộc tài khoản đang đăng nhập.' });
    }
    if (task.status === 'completed') {
      return res.status(200).json({ ok: true, verified: true, credited: true, alreadyProcessed: true, task });
    }
    if (!['submitted', 'verifying'].includes(task.status)) {
      return res.status(409).json({ ok: false, message: 'Nhiệm vụ chưa ở trạng thái có thể auto check.' });
    }

    const verification = await verifyWithFacebook(task);
    if (!verification.verified) {
      await logAutoCheck(task, verification);
      return res.status(200).json({
        ok: true,
        verified: false,
        credited: false,
        reason: verification.reason,
        message: verification.message || 'Facebook API chưa xác nhận nhiệm vụ.',
      });
    }

    const result = await approveVerifiedTask(task, verification);

    return res.status(200).json({
      ok: true,
      verified: true,
      credited: true,
      task: result?.task || null,
      wallet: result?.wallet || null,
      alreadyProcessed: Boolean(result?.already_processed),
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      message: error.message || 'Không thể auto check nhiệm vụ Facebook.',
    });
  }
};

async function verifyWithFacebook(task) {
  const webhookUrl = clean(process.env.FACEBOOK_VERIFY_WEBHOOK_URL);
  if (webhookUrl) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.FACEBOOK_VERIFY_WEBHOOK_SECRET
          ? { Authorization: `Bearer ${process.env.FACEBOOK_VERIFY_WEBHOOK_SECRET}` }
          : {}),
      },
      body: JSON.stringify({
        action: task.ttc_campaigns?.interaction_type_code || '',
        target_url: task.ttc_campaigns?.target_url || '',
        target_facebook_id: task.ttc_campaigns?.target_facebook_id || '',
        worker_facebook_id: task.worker_facebook_id || '',
        task_id: task.id,
        campaign_id: task.campaign_id,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        verified: false,
        provider: 'facebook-webhook',
        reason: payload?.message || `Webhook xác minh trả HTTP ${response.status}`,
      };
    }
    return {
      verified: Boolean(payload?.verified),
      provider: 'facebook-webhook',
      reason: payload?.reason || payload?.message || '',
      message: payload?.message || '',
    };
  }

  const graphToken = clean(process.env.FACEBOOK_GRAPH_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN);
  if (graphToken) return verifyWithFacebookGraph(task, graphToken);

  if (isDevBypassEnabled()) {
    return {
      verified: true,
      provider: 'dev-bypass',
      reason: 'Local dev bypass: giả lập Facebook API đã xác minh.',
    };
  }

  return {
    verified: false,
    provider: 'not-configured',
    reason: 'Chưa cấu hình FACEBOOK_VERIFY_WEBHOOK_URL.',
    message: isProductionRuntime()
      ? 'Production chưa cấu hình API Facebook thật để auto check nhiệm vụ.'
      : 'Chưa cấu hình API Facebook để auto check nhiệm vụ. Local có thể bật FACEBOOK_VERIFY_DEV_BYPASS=true để test flow.',
  };
}

async function verifyWithFacebookGraph(task, accessToken) {
  const action = normalizeFacebookAction(task.ttc_campaigns?.interaction_type_code);
  const targetUrl = clean(task.ttc_campaigns?.target_url);
  const workerFacebookId = clean(task.worker_facebook_id);
  const objectId = await resolveFacebookObjectId({
    targetFacebookId: task.ttc_campaigns?.target_facebook_id,
    targetUrl,
    accessToken,
  });

  if (!workerFacebookId) {
    return graphFailure('missing-worker-facebook-id', 'Nhiệm vụ chưa có Facebook ID của user để đối chiếu.');
  }
  if (!objectId) {
    return graphFailure('missing-facebook-object-id', 'Không lấy được Facebook object ID từ link nhiệm vụ. Hãy dùng permalink có story_fbid/id hoặc cấu hình target_facebook_id.');
  }

  if (action === 'like' || action === 'reaction') {
    return verifyFacebookEdgeContainsUser({
      accessToken,
      objectId,
      edge: action === 'like' ? 'reactions?type=LIKE' : 'reactions',
      workerFacebookId,
      provider: 'facebook-graph-reactions',
      successReason: 'Graph API xác nhận user đã thả cảm xúc.',
      failureReason: 'Graph API chưa thấy user trong danh sách reactions của bài.',
    });
  }

  if (action === 'comment') {
    return verifyFacebookEdgeContainsUser({
      accessToken,
      objectId,
      edge: 'comments?filter=stream',
      workerFacebookId,
      provider: 'facebook-graph-comments',
      successReason: 'Graph API xác nhận user đã comment.',
      failureReason: 'Graph API chưa thấy comment của user trên bài.',
      idFromItem: (item) => clean(item?.from?.id),
      fields: 'id,from{id,name}',
    });
  }

  return graphFailure(
    'unsupported-action',
    `Graph API hiện chưa xác minh chắc được nhiệm vụ ${action || 'Facebook'} này. Cần dùng FACEBOOK_VERIFY_WEBHOOK_URL với verifier riêng.`,
  );
}

async function verifyFacebookEdgeContainsUser({
  accessToken,
  objectId,
  edge,
  workerFacebookId,
  provider,
  successReason,
  failureReason,
  idFromItem = (item) => clean(item?.id),
  fields = 'id,name',
}) {
  try {
    const matched = await graphEdgeHasUser({
      accessToken,
      objectId,
      edge,
      workerFacebookId,
      fields,
    }, idFromItem);
    return {
      verified: matched,
      provider,
      reason: matched ? successReason : failureReason,
      message: matched ? '' : failureReason,
    };
  } catch (error) {
    return graphFailure(error.code || 'graph-api-error', error.message || 'Facebook Graph API không xác minh được nhiệm vụ.');
  }
}

async function graphEdgeHasUser({ accessToken, objectId, edge, workerFacebookId, fields }, idFromItem) {
  const separator = edge.includes('?') ? '&' : '?';
  let url = `${graphBaseUrl()}/${encodeURIComponent(objectId)}/${edge}${separator}fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(accessToken)}`;
  for (let page = 0; page < 10 && url; page += 1) {
    const payload = await graphFetch(url);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (rows.some((item) => idFromItem(item) === workerFacebookId)) return true;
    url = payload?.paging?.next || '';
  }
  return false;
}

async function resolveFacebookObjectId({ targetFacebookId, targetUrl, accessToken }) {
  const configuredId = clean(targetFacebookId);
  if (configuredId) return configuredId;

  const parsedFromInput = parseFacebookObjectId(targetUrl);
  if (parsedFromInput) return parsedFromInput;

  const resolvedUrl = await resolveFacebookRedirect(targetUrl);
  const parsedFromResolved = parseFacebookObjectId(resolvedUrl);
  if (parsedFromResolved) return parsedFromResolved;

  return resolveFacebookObjectIdViaGraph(targetUrl, accessToken);
}

async function resolveFacebookRedirect(url) {
  if (!url) return '';
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow' });
    return response?.url || '';
  } catch {
    return '';
  }
}

async function resolveFacebookObjectIdViaGraph(url, accessToken) {
  if (!url) return '';
  try {
    const payload = await graphFetch(`${graphBaseUrl()}/?id=${encodeURIComponent(url)}&fields=og_object{id}&access_token=${encodeURIComponent(accessToken)}`);
    return clean(payload?.og_object?.id || payload?.id);
  } catch {
    return '';
  }
}

function parseFacebookObjectId(rawUrl) {
  const value = clean(rawUrl);
  if (!value) return '';
  if (/^\d+_\d+$/.test(value) || /^\d+$/.test(value)) return value;
  try {
    const url = new URL(value);
    const storyFbid = clean(url.searchParams.get('story_fbid'));
    const ownerId = clean(url.searchParams.get('id'));
    if (storyFbid && ownerId) return `${ownerId}_${storyFbid}`;
    if (storyFbid) return storyFbid;
    const match = url.pathname.match(/\/(?:posts|videos|reel|photo|photos)\/([^/?#]+)/i);
    if (match?.[1] && /^\d+$/.test(match[1])) return match[1];
  } catch {
    return '';
  }
  return '';
}

async function graphFetch(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    const error = new Error(payload?.error?.message || `Facebook Graph API trả HTTP ${response.status}`);
    error.code = payload?.error?.code ? `facebook-${payload.error.code}` : 'facebook-graph-http';
    throw error;
  }
  return payload;
}

function normalizeFacebookAction(code) {
  return clean(code).replace(/^facebook_/, '');
}

function graphBaseUrl() {
  return `https://graph.facebook.com/${clean(process.env.FACEBOOK_GRAPH_API_VERSION) || 'v25.0'}`;
}

function graphFailure(reason, message) {
  return {
    verified: false,
    provider: 'facebook-graph',
    reason,
    message,
  };
}

function isDevBypassEnabled() {
  if (String(process.env.FACEBOOK_VERIFY_DEV_BYPASS || '').toLowerCase() !== 'true') return false;
  return !isProductionRuntime();
}

function isProductionRuntime() {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === 'production';
  return process.env.NODE_ENV === 'production';
}

async function getAuthenticatedUser(accessToken) {
  const response = await fetch(`${baseUrl()}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) {
    const error = new Error('Phiên đăng nhập không hợp lệ.');
    error.status = 401;
    throw error;
  }
  return data;
}

async function getTask(taskId) {
  const rows = await serviceFetch(
    `/rest/v1/ttc_tasks?id=eq.${encodeURIComponent(taskId)}&select=id,campaign_id,status,assignee_user_id,worker_facebook_id,evidence,ttc_campaigns(id,interaction_type_code,target_url,target_facebook_id,target_label)`,
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function logAutoCheck(task, verification) {
  await serviceFetch('/rest/v1/ttc_task_check_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      task_id: task.id,
      campaign_id: task.campaign_id,
      actor_id: null,
      check_type: 'auto',
      result: verification.verified ? 'success' : 'failed',
      before_status: task.status,
      after_status: verification.verified ? 'completed' : task.status,
      reason: verification.reason || null,
      metadata: verification,
    }),
  }).catch(() => null);
}

async function approveVerifiedTask(task, verification) {
  const metadata = {
    verified: true,
    provider: verification.provider,
    reason: verification.reason || 'Facebook API đã xác minh nhiệm vụ thành công',
    checked_at: new Date().toISOString(),
    target_url: task.ttc_campaigns?.target_url || null,
    worker_facebook_id: task.worker_facebook_id || null,
  };

  try {
    return await rpc('system_verify_ttc_task', {
      task_id_input: task.id,
      metadata_input: metadata,
    });
  } catch (error) {
    if (!/system_verify_ttc_task|schema cache|function/i.test(error.message || '')) throw error;
    return approveVerifiedTaskDirect(task, metadata);
  }
}

async function approveVerifiedTaskDirect(task, metadata) {
  const freshTask = await getTask(task.id);
  if (!freshTask) throw new Error('Không tìm thấy nhiệm vụ.');
  if (freshTask.status === 'completed') {
    return { task: freshTask, wallet: await getWallet(freshTask.assignee_user_id), credited: true, already_processed: true };
  }
  if (!['submitted', 'verifying'].includes(freshTask.status)) {
    throw new Error('Nhiệm vụ chưa ở trạng thái có thể auto xác minh.');
  }

  const campaign = await getCampaign(freshTask.campaign_id);
  if (!campaign) throw new Error('Không tìm thấy chiến dịch TTC.');

  const completedRows = await serviceFetch(
    `/rest/v1/ttc_tasks?id=eq.${encodeURIComponent(freshTask.id)}&status=in.(submitted,verifying)`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'completed',
        verified_at: new Date().toISOString(),
        verified_by: null,
        verification_result: metadata,
        rejection_reason: null,
      }),
    },
  );
  const completedTask = Array.isArray(completedRows) ? completedRows[0] : null;
  if (!completedTask) {
    const latest = await getTask(freshTask.id);
    return { task: latest, wallet: await getWallet(freshTask.assignee_user_id), credited: latest?.status === 'completed', already_processed: true };
  }

  const nextCompletedCount = Number(campaign.completed_count || 0) + 1;
  await serviceFetch(`/rest/v1/ttc_campaigns?id=eq.${encodeURIComponent(campaign.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      completed_count: nextCompletedCount,
      spent_amount: Number(campaign.spent_amount || 0) + Number(campaign.unit_cost || 0),
      status: nextCompletedCount >= Number(campaign.target_quantity || 0) ? 'completed' : 'running',
    }),
  });

  const wallet = await postWalletReward({
    userId: completedTask.assignee_user_id,
    amount: Number(campaign.worker_reward || 0),
    taskId: completedTask.id,
    campaignId: campaign.id,
    reason: metadata.reason,
    metadata,
  });

  await logAutoCheck(completedTask, { ...metadata, verified: true });

  return {
    task: completedTask,
    wallet,
    credited: true,
    already_processed: false,
  };
}

async function getCampaign(campaignId) {
  const rows = await serviceFetch(
    `/rest/v1/ttc_campaigns?id=eq.${encodeURIComponent(campaignId)}&select=id,unit_cost,worker_reward,spent_amount,completed_count,target_quantity,status`,
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function getWallet(userId) {
  const rows = await serviceFetch(`/rest/v1/wallets?user_id=eq.${encodeURIComponent(userId)}&select=*`);
  return Array.isArray(rows) ? rows[0] : null;
}

async function ensureWallet(userId) {
  const existing = await getWallet(userId);
  if (existing) return existing;
  const rows = await serviceFetch('/rest/v1/wallets', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId }),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function postWalletReward({ userId, amount, taskId, campaignId, reason, metadata }) {
  const idempotencyKey = `ttc_task:reward:${taskId}`;
  const existingLedger = await serviceFetch(
    `/rest/v1/wallet_ledger?wallet_user_id=eq.${encodeURIComponent(userId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=*`,
  );
  if (Array.isArray(existingLedger) && existingLedger.length) return getWallet(userId);

  const wallet = await ensureWallet(userId);
  const beforeBalance = Number(wallet?.balance || 0);
  const afterBalance = beforeBalance + amount;
  const beforeEarned = Number(wallet?.total_earned || 0);

  await serviceFetch(`/rest/v1/wallets?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      balance: afterBalance,
      total_earned: beforeEarned + amount,
    }),
  });

  await serviceFetch('/rest/v1/wallet_ledger', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      wallet_user_id: userId,
      actor_id: null,
      actor_type: 'system',
      transaction_type: 'earn_task',
      amount,
      balance_before: beforeBalance,
      balance_after: afterBalance,
      related_table: 'ttc_tasks',
      related_id: String(taskId),
      idempotency_key: idempotencyKey,
      description: `Thưởng nhiệm vụ TTC #${taskId}`,
      reason,
      metadata: {
        task_id: taskId,
        campaign_id: campaignId,
        verification: metadata,
      },
    }),
  });

  return getWallet(userId);
}

async function rpc(name, body) {
  return serviceFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function serviceFetch(path, options = {}) {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });
  const text = await response.text().catch(() => '');
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || 'Supabase request failed.');
    error.status = response.status >= 400 && response.status < 500 ? response.status : 500;
    throw error;
  }
  return data;
}

function baseUrl() {
  return String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
}

function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function clean(value) {
  return String(value || '').trim();
}

module.exports.__test = {
  isDevBypassEnabled,
  isProductionRuntime,
};
