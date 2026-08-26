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
  console.error('Usage: PUBLIC_POCKETBASE_LOGIN=admin@example.com PUBLIC_POCKETBASE_PASS=secret PUBLIC_POCKETBASE_URL=https://... npm run fix:maintenance-collection');
  process.exit(1);
}

const pb = new PocketBase(baseUrl);

const main = async () => {
  await pb.admins.authWithPassword(email, password);

  const collections = await pb.collections.getFullList({ sort: 'name' });
  const existing = collections.find((collection) => collection.name === 'maintenance');

  const tenantField = {
    name: 'tenant',
    type: 'relation',
    required: false,
    presentable: false,
    hidden: false,
    maxSelect: 1,
    minSelect: 0,
    collectionId: '',
    cascadeDelete: false
  };

  const fields = [
    tenantField,
    {
      name: 'problem',
      type: 'editor',
      required: false,
      presentable: false,
      hidden: false,
      options: { convertUrls: false }
    },
    {
      name: 'image',
      type: 'file',
      required: false,
      presentable: false,
      hidden: false,
      maxSelect: 10,
      maxSize: 10485760,
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      thumbs: null,
      protected: false
    },
    {
      name: 'status',
      type: 'select',
      required: false,
      presentable: false,
      hidden: false,
      values: ['reported', 'active', 'closed', 're-opend'],
      maxSelect: 1,
      minSelect: 0
    },
    {
      name: 'created_by',
      type: 'relation',
      required: false,
      presentable: false,
      hidden: false,
      maxSelect: 1,
      minSelect: 0,
      collectionId: '_pb_users_auth_',
      cascadeDelete: false
    }
  ];

  const collectionPayload = {
    name: 'maintenance',
    type: 'base',
    system: false,
    listRule: '@request.auth.role = "admin" || tenant.user = @request.auth.id',
    viewRule: '@request.auth.role = "admin" || tenant.user = @request.auth.id',
    createRule: '@request.auth.role = "admin" || (@request.auth.id != "" && tenant.user = @request.auth.id && tenant.status = "active")',
    updateRule: '@request.auth.role = "admin" || (tenant.user = @request.auth.id && @request.auth.id != "")',
    deleteRule: '@request.auth.role = "admin"',
    fields
  };

  const tenantsCollection = collections.find((collection) => collection.name === 'tenants');
  if (!tenantsCollection) {
    throw new Error('Collection "tenants" was not found. Create the tenants collection first.');
  }

  const relationField = (field) => (
    field.name === 'tenant'
      ? { ...field, collectionId: tenantsCollection.id }
      : field
  );

  const finalFields = fields.map(relationField);

  try {
    if (!existing) {
      const created = await pb.collections.create({ ...collectionPayload, fields: finalFields });
      console.log('Created maintenance collection successfully.');
      console.log(JSON.stringify({ id: created.id, name: created.name, tenantField: created.fields?.find((field) => field.name === 'tenant') ?? null }, null, 2));
      return;
    }

    const nextFields = existing.fields?.length
      ? existing.fields.map((field) => field.name === 'tenant' ? { ...field, type: 'relation', collectionId: tenantsCollection.id } : field)
      : finalFields;

    const updated = await pb.collections.update(existing.id, {
      ...existing,
      ...collectionPayload,
      fields: nextFields
    });

    console.log('Updated maintenance collection successfully.');
    console.log(JSON.stringify({ id: updated.id, name: updated.name, tenantField: updated.fields?.find((field) => field.name === 'tenant') ?? null }, null, 2));
  } catch (error) {
    console.error('Failed to create/update maintenance collection.');
    console.error(error?.response?.data || error?.message || error);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('Unable to configure maintenance collection.');
  console.error(error?.response?.data || error?.message || error);
  process.exit(1);
});
