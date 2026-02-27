/**
 * HIPAA DATA RETENTION CONFIGURATION - WEB DASHBOARD
 * 
 * Defines retention periods for web dashboard data in compliance with HIPAA requirements.
 * Mirrors mobile app retention policies for consistency.
 */

export interface DataRetentionPolicy {
  entityType: string;
  retentionPeriod: {
    years: number;
    months: number;
  };
  description: string;
  legalBasis: string;
  autoDelete: boolean;
}

export const WEB_DATA_RETENTION_POLICIES: DataRetentionPolicy[] = [
  {
    entityType: 'audit_logs',
    retentionPeriod: { years: 6, months: 0 },
    description: 'HIPAA audit logs and web dashboard access records',
    legalBasis: '45 CFR 164.316(b)(2)(i) - HIPAA Security Rule',
    autoDelete: false,
  },
  {
    entityType: 'admin_sessions',
    retentionPeriod: { years: 1, months: 0 },
    description: 'Hospital admin web session logs',
    legalBasis: 'Access control and monitoring requirements',
    autoDelete: false,
  },
  {
    entityType: 'dashboard_exports',
    retentionPeriod: { years: 2, months: 0 },
    description: 'Exported reports and data downloads from web dashboard',
    legalBasis: 'PHI access tracking requirements',
    autoDelete: false,
  },
  {
    entityType: 'web_activity_logs',
    retentionPeriod: { years: 1, months: 0 },
    description: 'Web dashboard user activity and page access logs',
    legalBasis: 'Security monitoring requirements',
    autoDelete: false,
  },
  {
    entityType: 'api_access_logs',
    retentionPeriod: { years: 6, months: 0 },
    description: 'API calls from web dashboard containing PHI access',
    legalBasis: 'HIPAA audit trail requirements',
    autoDelete: false,
  }
];

/**
 * Get retention policy for a specific entity type
 */
export function getWebRetentionPolicy(entityType: string): DataRetentionPolicy | null {
  return WEB_DATA_RETENTION_POLICIES.find(policy => policy.entityType === entityType) || null;
}

/**
 * Calculate expiration date for web dashboard data
 */
export function calculateWebExpirationDate(entityType: string, createdAt: Date): Date | null {
  const policy = getWebRetentionPolicy(entityType);
  if (!policy) return null;

  const expirationDate = new Date(createdAt);
  expirationDate.setFullYear(
    expirationDate.getFullYear() + policy.retentionPeriod.years
  );
  expirationDate.setMonth(
    expirationDate.getMonth() + policy.retentionPeriod.months
  );

  return expirationDate;
}

/**
 * Web dashboard specific retention requirements
 */
export const WEB_RETENTION_REQUIREMENTS = {
  auditLogExportAccess: '6 years minimum',
  adminSessionTracking: '1 year minimum',
  dataExportRecords: '2 years minimum',
  complianceReportAccess: '6 years minimum'
};

export default WEB_DATA_RETENTION_POLICIES;