import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();

const missing = [
  !supabaseUrl && 'SUPABASE_URL',
  !supabaseAnonKey && 'SUPABASE_ANON_KEY',
].filter(Boolean);

if (missing.length) {
  console.error(`Build configuration error: missing required environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  console.error('Build configuration error: SUPABASE_URL must be a valid HTTPS URL.');
  process.exit(1);
}

if (parsedUrl.protocol !== 'https:') {
  console.error('Build configuration error: SUPABASE_URL must be a valid HTTPS URL.');
  process.exit(1);
}

const publicConfig = {
  supabaseUrl,
  supabaseAnonKey,
};

const source = `// Generated at build time. Do not edit or commit.\nwindow.DHL_CONFIG = ${JSON.stringify(publicConfig, null, 2)};\n`;
const outputPath = resolve(process.cwd(), 'config.js');

await writeFile(outputPath, source, { encoding: 'utf8', mode: 0o644 });
console.log('Generated browser configuration: config.js');
