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
const email = process.env.PUBLIC_POCKETBASE_LOGIN || process.env.PB_EMAIL || env.PUBLIC_POCKETBASE_LOGIN || env.PB_EMAIL;
const password = process.env.PUBLIC_POCKETBASE_PASS || process.env.PB_PASSWORD || env.PUBLIC_POCKETBASE_PASS || env.PB_PASSWORD;

if (!email || !password) {
  console.error('Missing PocketBase credentials. Set PUBLIC_POCKETBASE_LOGIN / PUBLIC_POCKETBASE_PASS or PB_EMAIL / PB_PASSWORD in .env.');
  process.exit(1);
}

const pb = new PocketBase(baseUrl);

const authAsAdmin = async () => {
  const candidates = ['_superusers', 'users'];

  for (const collectionName of candidates) {
    try {
      const result = await pb.collection(collectionName).authWithPassword(email, password);
      console.log(`Authenticated as ${result.record?.email ?? email} on ${collectionName}`);
      return;
    } catch (error) {
      console.warn(`Auth failed for ${collectionName}:`, error?.response?.data || error?.message || error);
    }
  }

  throw new Error('Unable to authenticate with the configured PocketBase credentials.');
};

const normalizeRules = () => ({
  listRule: '@request.auth.id != "" || @request.auth.id = ""',
  viewRule: '@request.auth.id != "" || @request.auth.id = ""',
  createRule: '@request.auth.role = "admin"',
  updateRule: '@request.auth.role = "admin"',
  deleteRule: '@request.auth.role = "admin"'
});

const rentalSchema = {
  name: 'rental',
  type: 'base',
  system: false,
  listRule: '@request.auth.id != "" || @request.auth.id = ""',
  viewRule: '@request.auth.id != "" || @request.auth.id = ""',
  createRule: '@request.auth.role = "admin"',
  updateRule: '@request.auth.role = "admin"',
  deleteRule: '@request.auth.role = "admin"',
  fields: [
    {
      name: 'address',
      type: 'editor',
      required: false,
      presentable: false,
      hidden: false,
      options: { convertUrls: false }
    },
    {
      name: 'rent',
      type: 'number',
      required: false,
      presentable: false,
      hidden: false,
      onlyInt: false,
      min: null,
      max: null
    },
    {
      name: 'photos',
      type: 'file',
      required: false,
      presentable: false,
      hidden: false,
      maxSelect: 10,
      maxSize: 10485760,
      mimeTypes: ['image/jpeg', 'image/png'],
      thumbs: null,
      protected: false
    },
    {
      name: 'renter',
      type: 'relation',
      required: false,
      presentable: false,
      hidden: false,
      maxSelect: 1,
      minSelect: 0,
      collectionId: '_pb_users_auth_',
      cascadeDelete: false
    }
  ]
};

const billSchema = {
  name: 'bill',
  type: 'base',
  system: false,
  listRule: '@request.auth.id != "" || @request.auth.id = ""',
  viewRule: '@request.auth.id != "" || @request.auth.id = ""',
  createRule: '@request.auth.role = "admin"',
  updateRule: '@request.auth.role = "admin"',
  deleteRule: '@request.auth.role = "admin"',
  fields: [
    {
      name: 'rental',
      type: 'relation',
      required: true,
      presentable: false,
      hidden: false,
      maxSelect: 1,
      minSelect: 0,
      collectionId: '',
      cascadeDelete: false
    },
    {
      name: 'rent',
      type: 'number',
      required: false,
      presentable: false,
      hidden: false,
      onlyInt: false,
      min: null,
      max: null
    },
    {
      name: 'sdge',
      type: 'number',
      required: false,
      presentable: false,
      hidden: false,
      onlyInt: false,
      min: null,
      max: null
    },
    {
      name: 'att',
      type: 'number',
      required: false,
      presentable: false,
      hidden: false,
      onlyInt: false,
      min: null,
      max: null
    },
    {
      name: 'total',
      type: 'number',
      required: false,
      presentable: false,
      hidden: false,
      onlyInt: false,
      min: null,
      max: null
    },
    {
      name: 'dueDate',
      type: 'date',
      required: false,
      presentable: false,
      hidden: false
    },
    {
      name: 'status',
      type: 'select',
      required: false,
      presentable: false,
      hidden: false,
      values: ['open', 'paid', 'overdue', 'void'],
      maxSelect: 1,
      minSelect: 0
    },
    {
      name: 'paid',
      type: 'bool',
      required: false,
      presentable: false,
      hidden: false
    },
    {
      name: 'paidDate',
      type: 'date',
      required: false,
      presentable: false,
      hidden: false
    },
    {
      name: 'notes',
      type: 'text',
      required: false,
      presentable: false,
      hidden: false
    }
  ]
};

const ensureCollectionShape = async (collectionName, schema, relationTargetId) => {
  const collections = await pb.collections.getFullList({ sort: 'name' });
  const existing = collections.find((collection) => collection.name === collectionName);

  if (!existing) {
    const payload = { ...schema };
    if (collectionName === 'bill' && relationTargetId) {
      payload.fields = payload.fields.map((field) => field.name === 'rental' ? { ...field, collectionId: relationTargetId } : field);
    }

    const created = await pb.collections.create(payload);
    console.log(`Created missing collection: ${collectionName}`);
    return created;
  }

  const sanitizedFields = existing.fields.filter((field) => !(collectionName === 'rental' && field.name === 'bills'));
  const byName = new Map(sanitizedFields.map((field) => [field.name, field]));
  const nextFields = sanitizedFields.map((field) => {
    const template = schema.fields.find((candidate) => candidate.name === field.name);
    if (!template) return field;
    return {
      ...field,
      ...template,
      ...(template.name === 'photos' ? { maxSize: 10485760, mimeTypes: ['image/jpeg', 'image/png'] } : {}),
      collectionId: field.name === 'rental' && relationTargetId ? relationTargetId : field.collectionId ?? template.collectionId
    };
  });

  for (const template of schema.fields) {
    if (!byName.has(template.name)) {
      nextFields.push({ ...template, ...(template.name === 'rental' && relationTargetId ? { collectionId: relationTargetId } : {}) });
    }
  }

  const nextCollection = {
    ...existing,
    ...normalizeRules(),
    fields: nextFields
  };

  const updated = await pb.collections.update(existing.id, nextCollection);
  console.log(`Updated collection: ${collectionName}`);
  return updated;
};

const migrate = async () => {
  await authAsAdmin();

  const collections = await pb.collections.getFullList({ sort: 'name' });
  const rentalCollection = collections.find((collection) => collection.name === 'rental');
  const billCollection = collections.find((collection) => collection.name === 'bill');

  const resolvedRentalCollection = await ensureCollectionShape('rental', rentalSchema);
  const resolvedRentalId = resolvedRentalCollection.id;

  if (!billCollection) {
    await ensureCollectionShape('bill', { ...billSchema, fields: billSchema.fields.map((field) => field.name === 'rental' ? { ...field, collectionId: resolvedRentalId } : field) });
  } else {
    await ensureCollectionShape('bill', { ...billSchema, fields: billSchema.fields.map((field) => field.name === 'rental' ? { ...field, collectionId: resolvedRentalId } : field) }, resolvedRentalId);
  }

  const targetRental = await pb.collection('rental').getFullList();
  const fixedRentalId = targetRental[0]?.id || resolvedRentalId;
  const changedBills = [];

  for (const bill of await pb.collection('bill').getFullList()) {
    const currentRental = typeof bill.rental === 'string' ? bill.rental : Array.isArray(bill.rental) ? bill.rental[0] : '';
    if (!currentRental && fixedRentalId) {
      const updated = await pb.collection('bill').update(bill.id, { rental: fixedRentalId });
      changedBills.push({ id: bill.id, rental: updated.rental });
    }
  }

  console.log('PocketBase schema updated successfully.');
  console.log('Rental collection present:', !!(await pb.collection('rental').getFullList()).length || !!resolvedRentalId);
  console.log('Bill collection present:', !!(await pb.collection('bill').getFullList()).length);
  console.log('Bills backfilled:', changedBills.length ? JSON.stringify(changedBills) : 'none');
};

migrate().catch((error) => {
  console.error('PocketBase migration failed.');
  console.error(error?.response?.data || error?.message || error);
  process.exit(1);
});
