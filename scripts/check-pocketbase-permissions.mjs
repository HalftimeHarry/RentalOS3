import fs from 'node:fs';
import path from 'node:path';
import PocketBase from 'pocketbase';

const rootDir = process.cwd();
const envPath = path.join(rootDir, '.env');

const readEnv = () => {
  if (!fs.existsSync(envPath)) return {};

  return fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .reduce((acc, line) => {
      const idx = line.indexOf('=');
      if (idx === -1) return acc;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      acc[key] = value.replace(/^['"]|['"]$/g, '');
      return acc;
    }, {});
};

const env = readEnv();
const baseUrl = process.env.PUBLIC_POCKETBASE_URL || env.PUBLIC_POCKETBASE_URL || process.env.POCKETBASE_URL || env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const email = process.env.PB_EMAIL || env.PB_EMAIL || process.argv[2];
const password = process.env.PB_PASSWORD || env.PB_PASSWORD || process.argv[3];

if (!email || !password) {
  console.log('PocketBase permission check');
  console.log('');
  console.log('Required env vars or args:');
  console.log('  PB_EMAIL=you@example.com');
  console.log('  PB_PASSWORD=your-password');
  console.log('  PUBLIC_POCKETBASE_URL=https://your-pocketbase-url');
  console.log('');
  console.log('Example:');
  console.log('  PB_EMAIL=admin@example.com PB_PASSWORD=secret PUBLIC_POCKETBASE_URL=https://... npm run verify:pb');
  process.exit(1);
}

const pb = new PocketBase(baseUrl);

try {
  const authRecord = await pb.collection('users').authWithPassword(email, password);
  console.log('Authenticated as:', authRecord.record.email);
  console.log('Role:', authRecord.record.role || 'unknown');
  console.log('Base URL:', baseUrl);
  console.log('');
} catch (error) {
  console.error('Authentication failed.');
  console.error(error?.response?.data || error?.message || error);
  process.exit(1);
}

for (const collection of ['rental', 'bill']) {
  try {
    const records = await pb.collection(collection).getFullList({ sort: '-created' });
    console.log(`✅ ${collection}: allowed (${records.length} record(s))`);
  } catch (error) {
    console.log(`❌ ${collection}: denied`);
    console.log(error?.response?.data || error?.message || error);
  }
}

console.log('');
console.log('If you see a 403 on rental or bill, the PocketBase collection rules are blocking the logged-in user.');
console.log('Use rules like:');
console.log('  rental -> list/view: @request.auth.id != ""');
console.log('  rental -> create/update/delete: @request.auth.role = "admin"');
console.log('  bill -> list/view: @request.auth.id != ""');
console.log('  bill -> create/update/delete: @request.auth.role = "admin"');
