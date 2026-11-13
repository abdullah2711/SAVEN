# Turnkey release and installation acceptance

> Historical v2 target where conflicting. [v2.3](sources/SAVEN-mandate-v2.3.md) now selects native SQLite for all stores, local-first QA, and a private package excluding vendor commercial/issuer services. See [current reconciliation](35-native-sqlite-local-first-v2.3.md).

Profiles: private-local (self-contained control/tenant SQLite, objects, frontend/gateway/business/operator/workers/backup/licensing); private-cloudflare (customer-owned Cloudflare dependencies); saven-cloud (internal SAVEN-operated profile). Only Cloud and Fully Private are commercial offerings. No customer attaches a database host to shared SaaS.

Release contract: signed versioned prebuilt images/offline bundle, digests/SBOM, Compose or equivalent, automated secret generation, initial-admin wizard, TLS/domain validation, control/tenant DB initialization, compatible migration lock, dependency health/readiness, bounded workers, object/backup configuration, structured diagnostics, backup schedule, verified restore and safe upgrade/forward repair. No proprietary-source access, manual SQL, test hostname, personal server path or SAVEN Cloudflare account is required for private-local.

Installer asks only necessary domain/admin/licence/storage/backup and optional integration information. Secrets never enter Git/images/logs. Private ordinary use remains available without continuous SAVEN Cloud connectivity; external services may be unavailable. Signed entitlement expiry/grace/renewal does not delete historical or pending financial evidence. Offline licence periods and supported Linux/hardware matrix require explicit evidence/policy decisions.

Gates before claiming turnkey: fresh supported machine install; first admin and tenant/company provisioning; accounting transaction; multiple tenant migration; interrupted installation recovery; signed app/schema upgrade preserving records; tenant/node/full-platform restore including files/keys; independent private-local operation with external network blocked; customer-Cloudflare profile; licence expiry/recovery and no second writer. Existing PostgreSQL/testing scripts are preserved reference operations, not this installer.

Current state: specified contracts only. No signed release, private installer, D1 control deployment, tenant fleet migration or offline synchronizer is claimed delivered by this design increment.
