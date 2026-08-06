let client = null;

export function getSupabaseStatus() {
  const config = readSupabaseConfig();
  const hasUrl = typeof config.supabaseUrl === 'string' && config.supabaseUrl.length > 0;
  const hasAnonKey = typeof config.supabaseAnonKey === 'string' && config.supabaseAnonKey.length > 0;
  const hasSdk = Boolean(window.supabase?.createClient);

  return {
    configured: hasUrl && hasAnonKey && hasSdk,
    hasUrl,
    hasAnonKey,
    hasSdk,
  };
}

export function getSupabaseClient() {
  const status = getSupabaseStatus();
  if (!status.configured) return null;

  if (!client) {
    const config = readSupabaseConfig();
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  }

  return client;
}

function readSupabaseConfig() {
  return window.DHL_CONFIG || {};
}

