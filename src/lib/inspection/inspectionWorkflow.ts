export type InspectionWorkflowStatus = 'draft' | 'admin-complete' | 'tenant-reviewed' | 'admin-approved' | 'checkout-approved';

export function canEditInspectionStatus(status?: InspectionWorkflowStatus | null) {
  return status === 'draft' || status === 'admin-complete' || status === 'tenant-reviewed';
}
