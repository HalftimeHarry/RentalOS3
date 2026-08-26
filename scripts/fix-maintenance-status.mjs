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
const email = process.env.PUBLIC_POCKETBASE_LOGIN || env.PUBLIC_POCKETBASE_LOGIN || process.env.PB_EMAIL || env.PB_EMAIL || process.argv[2];
const password = process.env.PUBLIC_POCKETBASE_PASS || env.PUBLIC_POCKETBASE_PASS || process.env.PB_PASSWORD || env.PB_PASSWORD || process.argv[3];

if (!email || !password) {
  console.error('Missing PocketBase admin credentials.');
  process.exit(1);
}

const pb = new PocketBase(baseUrl);

const patchMaintenanceStatusField = async () => {
  const collections = await pb.collections.getFullList({ sort: 'name' });
  const collection = collections.find((item) => item.name === 'maintenance');

  if (!collection) {
    throw new Error('Collection "maintenance" was not found. Create it in PocketBase first.');
  }

  const statusField = {
    name: 'status',
    type: 'select',
    required: false,
    presentable: false,
    hidden: false,
    values: ['new', 'in_progress', 'scheduled', 'resolved', 'closed'],
    maxSelect: 1,
    minSelect: 0
  };

  const fields = collection.fields.some((field) => field.name === 'status')
    ? collection.fields.map((field) => field.name === 'status' ? { ...field, ...statusField } : field)
    : [...collection.fields, statusField];

  const updated = await pb.collections.update(collection.id, {
    ...collection,
    fields
  });

  console.log('Updated maintenance status field:');
  console.log(JSON.stringify({
    id: updated.id,
    name: updated.name,
    statusField: updated.fields?.find((field) => field.name === 'status') ?? null
  }, null, 2));
};

const main = async () => {
  try {
    await pb.admins.authWithPassword(email, password);
    console.log(`Authenticated as PocketBase admin: ${email}`);
  } catch (error) {
    throw new Error(`Failed to authenticate as admin. ${JSON.stringify(error?.response?.data || error?.message || error)}`);
  }

  await patchMaintenanceStatusField();
  console.log('PocketBase maintenance status field updated successfully.');
};

main().catch((error) => {
  console.error('PocketBase maintenance status field fix failed.');
  console.error(error?.response?.data || error?.message || error);
  process.exit(1);
});
