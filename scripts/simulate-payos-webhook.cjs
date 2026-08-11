#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const payosWebhookHandler = require('../api/payos/webhook');
const { signWebhookData } = require('../api/payos/_utils');

const args = parseArgs(process.argv.slice(2));
loadEnvFile(args.env || '.env.local');

const SUPABASE_URL = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || requireEnv('SUPABASE_SERVICE_KEY');
const PURPOSE = args.purpose || 'wallet_topup';
const EXECUTE = Boolean(args.execute);
const INSPECT = Boolean(args.inspect);

main().catch((error) => {
  console.error(error?.message || error);
  if (error?.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});

async function main() {
  const order = args.orderCode
    ? await fetchOrderByCode(args.orderCode)
    : await fetchLatestPendingOrder(PURPOSE);

  if (!order) {
    console.log(`No pending PayOS order found${args.orderCode ? ` for order_code=${args.orderCode}` : ` for purpose=${PURPOSE}`}.`);
    console.log('Create a wallet top-up/payment first, then rerun this script.');
    return;
  }

  const webhookBody = buildPaidWebhookBody(order);
  const maskedOrder = {
    id: order.id,
    order_code: order.order_code,
    purpose: order.purpose,
    payment_id: order.payment_id,
    wallet_user_id: order.wallet_user_id,
    amount: order.amount,
    status: order.status,
    payment_link_id: order.payment_link_id,
    created_at: order.created_at,
  };

  console.log('Matched order:');
  console.log(JSON.stringify(maskedOrder, null, 2));

  if (INSPECT) {
    if (order.purpose === 'wallet_topup') {
      await printWalletSnapshot(order.wallet_user_id);
    }
    return;
  }

  if (!EXECUTE) {
    console.log('\nDry run only. Re-run with --execute to POST the signed webhook into api/payos/webhook.');
    console.log('Signed webhook preview:');
    console.log(JSON.stringify({
      success: webhookBody.success,
      code: webhookBody.code,
      data: webhookBody.data,
      signature: `${webhookBody.signature.slice(0, 10)}...${webhookBody.signature.slice(-10)}`,
    }, null, 2));
    return;
  }

  const response = await invokeWebhook(webhookBody);
  console.log('\nWebhook handler response:');
  console.log(JSON.stringify(response, null, 2));

  const refreshedOrder = await fetchOrderByCode(order.order_code);
  console.log('\nOrder after webhook:');
  console.log(JSON.stringify({
    id: refreshedOrder.id,
    order_code: refreshedOrder.order_code,
    purpose: refreshedOrder.purpose,
    amount: refreshedOrder.amount,
    status: refreshedOrder.status,
    confirmed_at: refreshedOrder.confirmed_at,
    processed_at: refreshedOrder.processed_at,
  }, null, 2));

  if (refreshedOrder.purpose === 'wallet_topup') {
    await printWalletSnapshot(refreshedOrder.wallet_user_id);
  }
}

function buildPaidWebhookBody(order) {
  const reference = args.reference || `SIM${Date.now()}`;
  const data = {
    orderCode: Number(order.order_code),
    amount: Number(order.amount),
    description: order.description || `DHL${String(order.order_code).slice(-6)}`,
    accountNumber: args.accountNumber || '0000000000',
    reference,
    transactionDateTime: new Date().toISOString(),
    currency: 'VND',
    paymentLinkId: order.payment_link_id || `sim-${order.order_code}`,
    code: '00',
    desc: 'success',
  };
  const signature = signWebhookData(data, requireEnv('PAYOS_CHECKSUM_KEY'));
  return {
    success: true,
    code: '00',
    desc: 'success',
    data,
    signature,
  };
}

async function invokeWebhook(body) {
  const req = {
    method: 'POST',
    body,
  };

  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (this.statusCode >= 400) {
          const error = new Error(payload?.message || `Webhook failed with HTTP ${this.statusCode}`);
          error.details = payload;
          reject(error);
          return this;
        }
        resolve({ statusCode: this.statusCode, headers: this.headers, payload });
        return this;
      },
    };

    Promise.resolve(payosWebhookHandler(req, res)).catch(reject);
  });
}

async function fetchLatestPendingOrder(purpose) {
  const params = new URLSearchParams({
    select: '*',
    status: 'eq.pending',
    purpose: `eq.${purpose}`,
    order: 'created_at.desc',
    limit: '1',
  });
  const rows = await supabaseRest(`/rest/v1/payos_orders?${params}`);
  return Array.isArray(rows) ? rows[0] : null;
}

async function fetchOrderByCode(orderCode) {
  const params = new URLSearchParams({
    select: '*',
    order_code: `eq.${Number(orderCode)}`,
    limit: '1',
  });
  const rows = await supabaseRest(`/rest/v1/payos_orders?${params}`);
  return Array.isArray(rows) ? rows[0] : null;
}

async function printWalletSnapshot(userId) {
  if (!userId) return;
  const profileParams = new URLSearchParams({
    select: 'user_id,display_name,email,phone,status,created_at,updated_at',
    user_id: `eq.${userId}`,
    limit: '1',
  });
  const walletParams = new URLSearchParams({
    select: 'user_id,balance,total_earned,total_spent,updated_at',
    user_id: `eq.${userId}`,
    limit: '1',
  });
  const ledgerParams = new URLSearchParams({
    select: 'id,amount,balance_after,transaction_type,description,related_table,related_id,created_at',
    wallet_user_id: `eq.${userId}`,
    order: 'created_at.desc',
    limit: '3',
  });
  const [profileRows, walletRows, ledgerRows] = await Promise.all([
    supabaseRest(`/rest/v1/user_profiles?${profileParams}`),
    supabaseRest(`/rest/v1/wallets?${walletParams}`),
    supabaseRest(`/rest/v1/wallet_ledger?${ledgerParams}`),
  ]);
  console.log('\nUser profile:');
  console.log(JSON.stringify(profileRows?.[0] || null, null, 2));
  console.log('\nWallet snapshot:');
  console.log(JSON.stringify(walletRows?.[0] || null, null, 2));
  console.log('\nLatest wallet ledger rows:');
  console.log(JSON.stringify(ledgerRows || [], null, 2));
}

async function supabaseRest(pathname) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Supabase REST failed: ${response.status}`);
    error.details = data;
    throw error;
  }
  return data;
}

function loadEnvFile(file) {
  const envPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(envPath)) return;
  const source = fs.readFileSync(envPath, 'utf8');
  source.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return;
    const [, key, rawValue] = match;
    if (process.env[key]) return;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  });
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') {
      result.execute = true;
    } else if (arg === '--inspect') {
      result.inspect = true;
    } else if (arg === '--order-code') {
      result.orderCode = argv[++index];
    } else if (arg === '--purpose') {
      result.purpose = argv[++index];
    } else if (arg === '--env') {
      result.env = argv[++index];
    } else if (arg === '--reference') {
      result.reference = argv[++index];
    } else if (arg === '--account-number') {
      result.accountNumber = argv[++index];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function printHelp() {
  console.log(`Usage:
  node scripts/simulate-payos-webhook.cjs [--purpose wallet_topup|crm_payment]
  node scripts/simulate-payos-webhook.cjs --order-code 123456 --execute

Options:
  --execute          Actually invoke api/payos/webhook and mutate Supabase.
  --inspect          Only print the matched order plus wallet/ledger snapshot.
  --order-code N    Use a specific PayOS order_code instead of latest pending.
  --purpose VALUE   Pending order purpose to auto-pick. Default: wallet_topup.
  --env FILE        Env file to load. Default: .env.local.
  --reference TEXT  Webhook bank reference. Default: generated SIM timestamp.
`);
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing env ${name}`);
  return process.env[name];
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
