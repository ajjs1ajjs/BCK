# API Reference

## REST API

Base URL: `http://<host>:9440/api/v1` — authentication via `POST /auth/login`
(JWT bearer token).

```
POST   /api/v1/auth/login
GET    /api/v1/dashboard/stats

GET    /api/v1/jobs
POST   /api/v1/jobs
GET    /api/v1/jobs/:id
PUT    /api/v1/jobs/:id
DELETE /api/v1/jobs/:id
POST   /api/v1/jobs/:id/run
POST   /api/v1/jobs/:id/cancel

GET    /api/v1/repositories
POST   /api/v1/repositories
GET    /api/v1/snapshots
GET    /api/v1/snapshots/:id
DELETE /api/v1/snapshots/:id

POST   /api/v1/restore/file
POST   /api/v1/restore/vm
POST   /api/v1/restore/instant
POST   /api/v1/restore/instant/vm
GET    /api/v1/restore/instant
POST   /api/v1/restore/instant/:id/stop
GET    /api/v1/restore/explore/:snapshot_id
GET    /api/v1/restore/explore/:snapshot_id/file
POST   /api/v1/restore/surebackup
GET    /api/v1/restore/surebackup
GET    /api/v1/restore/session/:id

GET    /api/v1/hypervisors
POST   /api/v1/hypervisors
GET    /api/v1/hypervisors/:id
DELETE /api/v1/hypervisors/:id
POST   /api/v1/hypervisors/:id/test
GET    /api/v1/hypervisors/:id/vms
POST   /api/v1/hypervisors/:id/vms/:vm_ref/backup

GET    /api/v1/sobr
POST   /api/v1/sobr/tiers
GET    /api/v1/sobr/policies
POST   /api/v1/sobr/policies
POST   /api/v1/sobr/policies/:id/execute

GET    /api/v1/cloud
POST   /api/v1/cloud
GET    /api/v1/cloud/:id
DELETE /api/v1/cloud/:id
GET    /api/v1/cloud/:id/restorable
POST   /api/v1/cloud/:id/restore
GET    /api/v1/cloud/:id/restores
GET    /api/v1/cloud/restores
GET    /api/v1/cloud/restores/:rid

GET    /api/v1/m365/tenants
POST   /api/v1/m365/tenants
GET    /api/v1/m365/jobs
POST   /api/v1/m365/jobs

GET    /api/v1/tape/drives
POST   /api/v1/tape/drives
GET    /api/v1/tape/media
POST   /api/v1/tape/media
POST   /api/v1/tape/retention

GET    /api/v1/cdp/policies
POST   /api/v1/cdp/policies
POST   /api/v1/cdp/policies/:id/start
GET    /api/v1/cdp/sessions
POST   /api/v1/cdp/sessions/:id/stop

GET    /api/v1/dr/status
GET    /api/v1/dr/sites
POST   /api/v1/dr/sites
GET    /api/v1/dr/plans
POST   /api/v1/dr/plans
POST   /api/v1/dr/plans/:id/failover
POST   /api/v1/dr/plans/:id/failback
POST   /api/v1/dr/plans/:id/test

GET    /api/v1/tenants
POST   /api/v1/tenants
GET    /api/v1/tenants/:id
DELETE /api/v1/tenants/:id
POST   /api/v1/tenants/:id/suspend
PUT    /api/v1/tenants/:id/quota
PUT    /api/v1/tenants/:id/settings
GET    /api/v1/tenants/:id/usage

GET    /api/v1/portal/me
GET    /api/v1/portal/restore-requests
POST   /api/v1/portal/restore-requests
POST   /api/v1/portal/restore-requests/:id/cancel
GET    /api/v1/portal/admin/restore-requests
POST   /api/v1/portal/admin/restore-requests/:id/approve
POST   /api/v1/portal/admin/restore-requests/:id/reject
POST   /api/v1/portal/admin/restore-requests/:id/complete

GET    /api/v1/events
GET    /api/v1/agents
POST   /api/v1/agents/:id/tasks

GET    /api/v1/healthz
GET    /api/v1/metrics
POST   /api/v1/auth/logout
```

## gRPC (port 9441)

| Service | Methods |
|---------|---------|
| `BackupEngine` | StartJob, CancelJob, StreamProgress, ListSnapshots, ValidateConfig, Restore, RestoreFile, InstantRecovery, GetStats, CheckHealth, GetRepositoryStats |
| `SobrService` | ListTiers, AddTier, ListPolicies, CreatePolicy, GetTierStats |
| `CloudService` | ListAccounts, RegisterAccount, RemoveAccount, GetAccount, ListRestorableKinds, SubmitRestore, ListRestores |
| `M365Service` | ListTenants, RegisterTenant, ListBackupJobs, StartBackup |
| `Agent` | Heartbeat, StartBackup, StartRestore, ExecuteScript, GetStatus, UpdateAgent |

Proto definition: [`core/proto/bck.proto`](../core/proto/bck.proto).
