import { AuditLogService } from './AuditLogService.js';

// Compatibility export for callers that still import LogService. All reads now use
// the canonical audit_logs source and its database-side filtering/pagination.
export const LogService = {
  async list({
    searchTerm = '',
    actor = '',
    action = '',
    tableName = '',
    fromTime = null,
    toTime = null,
    pagination,
  } = {}) {
    return AuditLogService.list({
      searchTerm,
      actor,
      action,
      module: tableName,
      fromTime,
      toTime,
      pagination,
    });
  },

  getById(id) {
    return AuditLogService.getById(id);
  },
};
