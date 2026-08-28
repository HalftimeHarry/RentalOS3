import PocketBase from 'pocketbase';
import fs from 'node:fs';
import path from 'node:path';

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
  console.error('Missing PocketBase credentials.');
  console.error('Usage: PUBLIC_POCKETBASE_LOGIN=you@example.com PUBLIC_POCKETBASE_PASS=secret PUBLIC_POCKETBASE_URL=https://... npm run fix:inspections');
  process.exit(1);
}

const pb = new PocketBase(baseUrl);

const fieldConfigs = [
  { name: 'type', type: 'select', required: false, values: ['move-in', 'move-out'], maxSelect: 1, minSelect: 0 },
  { name: 'property_address', type: 'text', required: false },
  { name: 'unit_no', type: 'text', required: false },
  { name: 'tenant', type: 'relation', required: false, maxSelect: 1, minSelect: 0, collectionId: '', cascadeDelete: false },
  { name: 'tenants', type: 'text', required: false },
  { name: 'move_in_date', type: 'date', required: false },
  { name: 'move_out_date', type: 'date', required: false },
  { name: 'other_condition_summary', type: 'bool', required: false },
  { name: 'notes', type: 'text', required: false },
  { name: 'checkout_notes', type: 'text', required: false },
  { name: 'workflow_status', type: 'select', required: false, values: ['draft', 'admin-complete', 'tenant-reviewed', 'repair-needed', 'admin-approved', 'checkout-approved'], maxSelect: 1, minSelect: 0 },
  { name: 'checklist', type: 'json', required: false },
  { name: 'created_by', type: 'relation', required: false, maxSelect: 1, minSelect: 0, collectionId: '_pb_users_auth_', cascadeDelete: false }
];

const main = async () => {
  try {
    await pb.admins.authWithPassword(email, password);
  } catch (error) {
    throw new Error(`Failed to authenticate as a PocketBase admin. Details: ${JSON.stringify(error?.response?.data || error?.message || error)}`);
  }

  const collections = await pb.collections.getFullList({ sort: 'name' });
  const existing = collections.find((collection) => collection.name === 'inspections');
  const tenantsCollection = collections.find((collection) => collection.name === 'tenants');

  const normalizedFields = fieldConfigs.map((field) => {
    if (field.name === 'tenant') {
      return { ...field, collectionId: tenantsCollection?.id ?? '_pb_users_auth_' };
    }
    if (field.name === 'created_by') {
      return { ...field, collectionId: '_pb_users_auth_' };
    }
    return field;
  });

  const base = {
    name: 'inspections',
    type: 'base',
    system: false,
    listRule: '@request.auth.role = "admin"',
    viewRule: '@request.auth.role = "admin"',
    createRule: '@request.auth.role = "admin"',
    updateRule: '@request.auth.role = "admin"',
    deleteRule: '@request.auth.role = "admin"',
    fields: normalizedFields
  };

  try {
    if (!existing) {
      const created = await pb.collections.create(base);
      console.log('Created inspections collection successfully.');
      console.log(JSON.stringify({ id: created.id, name: created.name }, null, 2));
      return;
    }

    const updated = await pb.collections.update(existing.id, {
      name: 'inspections',
      type: 'base',
      system: false,
      listRule: '@request.auth.role = "admin"',
      viewRule: '@request.auth.role = "admin"',
      createRule: '@request.auth.role = "admin"',
      updateRule: '@request.auth.role = "admin"',
      deleteRule: '@request.auth.role = "admin"',
      fields: normalizedFields
    });
    console.log('Updated inspections collection successfully.');
    console.log(JSON.stringify({ id: updated.id, name: updated.name }, null, 2));
  } catch (error) {
    console.error('Failed to create/update inspections collection.');
    console.error(error?.response?.data || error?.message || error);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('Unable to configure inspections collection.');
  console.error(error?.response?.data || error?.message || error);
  process.exit(1);
});
