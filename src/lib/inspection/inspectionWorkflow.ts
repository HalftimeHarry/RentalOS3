export type InspectionWorkflowStatus = 'draft' | 'admin-complete' | 'tenant-reviewed' | 'repair-needed' | 'admin-approved' | 'checkout-approved';

export const repairRequiredAdminNote = 'Damage must be addressed before deposit release.';

export function getInspectionStageMeta(status?: InspectionWorkflowStatus | null) {
  const stageMap: Record<InspectionWorkflowStatus, { label: string; description: string; nextAction: string }> = {
    draft: {
      label: 'Draft',
      description: 'Start the inspection and record the tenant, property, and condition notes.',
      nextAction: 'Complete the checklist and move to the admin review stage.'
    },
    'admin-complete': {
      label: 'Admin inspection complete',
      description: 'The admin has finished the inspection and documented the report.',
      nextAction: 'Send the inspection to the tenant for review and confirmation.'
    },
    'tenant-reviewed': {
      label: 'Tenant reviewed',
      description: 'The tenant has reviewed the report and added any notes or response.',
      nextAction: 'Check for final issues and approve or flag anything that still needs repair.'
    },
    'repair-needed': {
      label: 'Fix required',
      description: repairRequiredAdminNote,
      nextAction: 'Resolve the item(s), then re-submit the inspection for final review.'
    },
    'admin-approved': {
      label: 'Admin approved',
      description: 'The inspection is acceptable after review and any required fixes have been addressed.',
      nextAction: 'Move to the checkout approval stage to finalize the deposit decision.'
    },
    'checkout-approved': {
      label: 'Checkout approved',
      description: 'The final checkout review is complete and the deposit process can proceed.',
      nextAction: 'The case is closed and the deposit can be released or adjusted.'
    }
  };

  return stageMap[status ?? 'draft'];
}

export function canEditInspectionStatus(status?: InspectionWorkflowStatus | null) {
  return status === 'draft' || status === 'admin-complete' || status === 'tenant-reviewed' || status === 'repair-needed';
}

export function canEditInspectionRecord({
  isAdmin,
  userId,
  currentTenantId,
  record
}: {
  isAdmin: boolean;
  userId?: string | null;
  currentTenantId?: string | null;
  record?: {
    tenant?: string | null;
    created_by?: string | null;
  } | null;
}): boolean {
  if (isAdmin) return true;

  if (!userId) return false;

  const recordTenantId = record?.tenant?.trim() ?? '';
  const recordCreatedBy = record?.created_by?.trim() ?? '';

  if (currentTenantId) {
    if (!recordTenantId || recordTenantId === currentTenantId) {
      return true;
    }
  }

  if (recordCreatedBy && recordCreatedBy === userId) {
    return true;
  }

  return false;
}

export function canReopenInspectionForRepair(status?: InspectionWorkflowStatus | null) {
  return status === 'admin-approved' || status === 'checkout-approved';
}

export function reopenInspectionForRepairStatus(status?: InspectionWorkflowStatus | null): InspectionWorkflowStatus {
  return canReopenInspectionForRepair(status) ? 'repair-needed' : (status ?? 'draft');
}

export function isAutoCancelError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'AbortError' ||
    error.message?.toLowerCase().includes('aborted') ||
    error.message?.toLowerCase().includes('autocancelled')
  );
}

export function isMissingResourceError(error: unknown): boolean {
  if (!error) return false;

  const record = error as { status?: number; name?: string; message?: string };
  const status = typeof record?.status === 'number' ? record.status : undefined;
  const name = typeof record?.name === 'string' ? record.name : error instanceof Error ? error.name : '';
  const message = typeof record?.message === 'string' ? record.message.toLowerCase() : error instanceof Error ? error.message.toLowerCase() : '';

  return (
    status === 404 ||
    name === 'ClientResponseError' && status === 404 ||
    message.includes('wasn\'t found') ||
    message.includes('not found') ||
    message.includes('404')
  );
}

export function resolveInspectionOwnerFields({
  authUserId,
  authUserName,
  fallbackProviderName,
  adminProviderId,
  isAdmin = false
}: {
  authUserId?: string | null;
  authUserName?: string | null;
  fallbackProviderName?: string | null;
  adminProviderId?: string | null;
  isAdmin?: boolean;
}): { providerId: string | null; providerName: string; createdById: string | null } {
  const safeAuthUserId = authUserId?.trim() ? authUserId : null;
  const safeAuthUserName = authUserName?.trim() || fallbackProviderName?.trim() || 'Dustin Dinsmore';
  const providerId = isAdmin ? (safeAuthUserId ?? adminProviderId ?? null) : (adminProviderId ?? safeAuthUserId ?? null);

  return {
    providerId: providerId ?? null,
    providerName: safeAuthUserName,
    createdById: safeAuthUserId ?? null
  };
}

export function isInspectionRecordStale(record?: { created?: string | null; updated?: string | null; updatedAt?: string | null; lastUpdatedAt?: string | null } | null, options?: { graceDays?: number; now?: Date }) {
  const graceDays = options?.graceDays ?? 30;
  const now = options?.now ?? new Date();
  const thresholdMs = graceDays * 24 * 60 * 60 * 1000;
  const rawTimestamp = record?.updated ?? record?.updatedAt ?? record?.lastUpdatedAt ?? record?.created;

  if (!rawTimestamp) return false;

  const timestamp = new Date(rawTimestamp);
  if (Number.isNaN(timestamp.getTime())) return false;

  return now.getTime() - timestamp.getTime() > thresholdMs;
}

export function validateInspectionSignatureRequirements({
  currentStatus,
  adminSignature,
  adminSignatureDate,
  tenantApproved,
  tenantSignature,
  tenantSignDate
}: {
  currentStatus?: InspectionWorkflowStatus | null;
  adminSignature?: string;
  adminSignatureDate?: string;
  tenantApproved?: boolean;
  tenantSignature?: string;
  tenantSignDate?: string;
}): { isValid: boolean; message: string } {
  return { isValid: true, message: '' };
}

export function deriveNextWorkflowStatus({
  currentStatus,
  tenantApproved,
  hasTenantChanges
}: {
  currentStatus?: InspectionWorkflowStatus | null;
  tenantApproved?: boolean;
  hasTenantChanges?: boolean;
}): InspectionWorkflowStatus {
  if ((currentStatus === 'draft' || currentStatus === 'admin-complete') && Boolean(tenantApproved)) {
    return 'tenant-reviewed';
  }

  if (currentStatus === 'draft' && !tenantApproved && Boolean(hasTenantChanges)) {
    return 'draft';
  }

  return currentStatus ?? 'draft';
}

export function buildInspectionRecordDetailEntries(record: {
  created_by?: string | null;
  created_by_name?: string | null;
  expand?: {
    created_by?: { name?: string | null } | null;
  } | null;
}): Array<{ label: string; value: string }> {
  const createdByValue = record.created_by_name || record.expand?.created_by?.name || record.created_by || '—';

  return [
    { label: 'Created by', value: createdByValue }
  ];
}

export function buildMoveOutPrefillFromMoveIn(record: {
  tenant?: string | null;
  tenants?: string | null;
  property_address?: string | null;
  unit_no?: string | null;
  tenant_name_1?: string | null;
  tenant_name_2?: string | null;
}): {
  tenantId: string;
  tenantName: string;
  propertyAddress: string;
  unitNo: string;
  tenantName1?: string;
  tenantName2?: string;
} {
  return {
    tenantId: record.tenant ?? '',
    tenantName: record.tenants ?? '',
    propertyAddress: record.property_address ?? '',
    unitNo: record.unit_no ?? '',
    tenantName1: record.tenant_name_1 ?? undefined,
    tenantName2: record.tenant_name_2 ?? undefined
  };
}

export function buildInspectionHistoryFilter({
  isAdmin,
  tenantId,
  userId
}: {
  isAdmin: boolean;
  tenantId?: string | null;
  userId?: string | null;
}): string {
  if (isAdmin) return '';

  const tenantClause = tenantId ? `tenant = "${tenantId}"` : '';
  const createdByClause = userId ? `created_by = "${userId}"` : '';

  if (tenantClause && createdByClause) {
    return `${tenantClause} || ${createdByClause}`;
  }

  return tenantClause || createdByClause || '';
}
