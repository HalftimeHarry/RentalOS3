export type InspectionWorkflowStatus = 'draft' | 'admin-complete' | 'tenant-reviewed' | 'admin-approved' | 'checkout-approved';

export function canEditInspectionStatus(status?: InspectionWorkflowStatus | null) {
  return status === 'draft' || status === 'admin-complete' || status === 'tenant-reviewed';
}

export function isAutoCancelError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'AbortError' ||
    error.message?.toLowerCase().includes('aborted') ||
    error.message?.toLowerCase().includes('autocancelled')
  );
}

export function isMissingResourceError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const record = error as { status?: number; name?: string; message?: string };
  return (
    record.status === 404 ||
    record.name === 'ClientResponseError' && record.status === 404 ||
    typeof record.message === 'string' && record.message.toLowerCase().includes('wasn\'t found') ||
    typeof record.message === 'string' && record.message.toLowerCase().includes('not found')
  );
}

export function deriveNextWorkflowStatus({
  currentStatus,
  tenantApproved,
  hasTenantChanges
}: {
  currentStatus?: InspectionWorkflowStatus | null;
  tenantApproved: boolean;
  hasTenantChanges: boolean;
}): InspectionWorkflowStatus {
  if (currentStatus === 'draft' && tenantApproved && hasTenantChanges) {
    return 'tenant-reviewed';
  }

  if (currentStatus === 'draft' && tenantApproved) {
    return 'draft';
  }

  return currentStatus ?? 'draft';
}
