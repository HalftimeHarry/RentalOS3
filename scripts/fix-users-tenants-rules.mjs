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
  console.error('Usage: PUBLIC_POCKETBASE_LOGIN=admin@example.com PUBLIC_POCKETBASE_PASS=secret PUBLIC_POCKETBASE_URL=https://... npm run fix:tenant-rules');
  process.exit(1);
}

const pb = new PocketBase(baseUrl);

const patchCollectionRules = async (collectionName, rules) => {
  const collections = await pb.collections.getFullList({ sort: 'name' });
  const collection = collections.find((item) => item.name === collectionName);

  if (!collection) {
    throw new Error(`Collection "${collectionName}" was not found. Create it in PocketBase first.`);
  }

  const updated = await pb.collections.update(collection.id, {
    ...collection,
    ...rules
  });

  console.log(`Updated ${collectionName} rules:`);
  console.log(JSON.stringify({
    id: updated.id,
    name: updated.name,
    listRule: updated.listRule,
    viewRule: updated.viewRule,
    createRule: updated.createRule,
    updateRule: updated.updateRule,
    deleteRule: updated.deleteRule
  }, null, 2));
};

const ensureTenantFileSizes = async () => {
  const collections = await pb.collections.getFullList({ sort: 'name' });
  const tenants = collections.find((item) => item.name === 'tenants');

  if (!tenants) {
    console.warn('No tenants collection found; skipping file size patch.');
    return;
  }

  const nextFields = (tenants.fields ?? []).map((field) => {
    if (['creditData', 'appData', 'damageData'].includes(field.name) && field.type === 'file') {
      return {
        ...field,
        maxSize: 5242880,
        maxSelect: 10,
        mimeTypes: field.mimeTypes ?? null
      };
    }

    return field;
  });

  await pb.collections.update(tenants.id, {
    ...tenants,
    fields: nextFields
  });

  console.log('Updated tenants file field maxSize to 5242880 bytes for creditData, appData, and damageData.');
};

const backfillTenantUserDetails = async () => {
  const collections = await pb.collections.getFullList({ sort: 'name' });
  const tenants = collections.find((item) => item.name === 'tenants');

  if (!tenants) {
    console.warn('No tenants collection found; skipping tenant backfill.');
    return;
  }

  const tenantRecords = await pb.collection('tenants').getFullList({ sort: '-created' });

  for (const tenant of tenantRecords) {
    if (!tenant.user) continue;

    try {
      const linkedUser = await pb.collection('users').getOne(tenant.user);
      const nextValues = {
        tenant_name: tenant.tenant_name || linkedUser.name || '',
        tenant_email: tenant.tenant_email || linkedUser.email || ''
      };

      if (nextValues.tenant_name || nextValues.tenant_email) {
        await pb.collection('tenants').update(tenant.id, nextValues);
      }
    } catch (error) {
      console.warn(`Skipping tenant ${tenant.id}: unable to resolve user ${tenant.user}`, error?.response?.data || error?.message || error);
    }
  }

  console.log('Backfilled missing tenant_name and tenant_email values from their linked user records.');
};

const main = async () => {
  try {
    await pb.admins.authWithPassword(email, password);
    console.log(`Authenticated as PocketBase admin: ${email}`);
  } catch (error) {
    throw new Error(`Failed to authenticate as admin. ${JSON.stringify(error?.response?.data || error?.message || error)}`);
  }

  await patchCollectionRules('users', {
    listRule: '@request.auth.role = "admin" || id = @request.auth.id',
    viewRule: '@request.auth.role = "admin" || id = @request.auth.id',
    createRule: 'true',
    updateRule: '@request.auth.role = "admin" || id = @request.auth.id',
    deleteRule: '@request.auth.role = "admin"'
  });

  await patchCollectionRules('tenants', {
    listRule: '@request.auth.role = "admin" || user = @request.auth.id',
    viewRule: '@request.auth.role = "admin" || user = @request.auth.id',
    createRule: '@request.auth.role = "admin" || user = @request.auth.id',
    updateRule: '@request.auth.role = "admin" || user = @request.auth.id',
    deleteRule: '@request.auth.role = "admin"'
  });

  await ensureTenantFileSizes();
  await backfillTenantUserDetails();
  console.log('PocketBase migration completed successfully.');
};

main().catch((error) => {
  console.error('PocketBase migration failed.');
  console.error(error?.response?.data || error?.message || error);
  process.exit(1);
});
