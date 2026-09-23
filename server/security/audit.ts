export type SecurityAuditEvent = {
  action: string;
  outcome: "allowed" | "denied" | "failed";
  actorUid?: string;
  actorRole?: string;
  targetId?: string;
  requestId?: string;
  metadata?: Record<string, string | number | boolean>;
};

const clean = (value?: string) => value ? value.slice(0, 160).replace(/[\r\n]/g, " ") : undefined;

export const writeSecurityAudit = (event: SecurityAuditEvent): void => {
  const record = {
    at: new Date().toISOString(),
    action: clean(event.action),
    outcome: event.outcome,
    actorUid: clean(event.actorUid),
    actorRole: clean(event.actorRole),
    targetId: clean(event.targetId),
    requestId: clean(event.requestId),
    metadata: event.metadata,
  };

  // Logging is deliberately local to the existing runtime: no new storage, service or cost.
  console.info("security_audit", JSON.stringify(record));
};
