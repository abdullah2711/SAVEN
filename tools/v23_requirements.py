"""v2.3 supersedes storage choices; preserve all existing IDs and Apps scope."""
ADDITIONS={'OPS': '''
Monthly private certificates|SAVEN-only asymmetric issuer and private public-key verification with installation binding monotonic sequence and offline challenge/import/receipt|Forged expired replayed and foreign-installation licences fail safely while lawful historical access and pending evidence survive; grace and monthly cutoffs remain explicit policy decisions
Private package composition|Customer ERP identity business admin support and verifier are packaged without vendor billing issuer global registry signing keys or hidden accounts|A private artifact allowlist and runtime checks exclude vendor-only components and work without mandatory SAVEN connectivity
Local-first development and QA|Native SQLite control tenant jobs and local objects start reproducibly without D1 PostgreSQL SSH or external cloud dependencies; optional authorized authenticated remote preview|Fresh local boot works offline and no database secret debug or unrestricted operator endpoint is publicly exposed
Durable command receipt and recovery|Owning-tenant inbox approval posting audit and outbox states have explicit commit-before-ack and lease retry semantics|Crash before receipt yields no acceptance and commit-before-ACK replay cannot duplicate a journal; changed permissions period or entitlement are rechecked
'''}
OVERRIDES={
 'OPS-008':'Exactly Cloud and Fully Private with native SQLite stores; private customer ERP and local administration exclude SAVEN commercial operator and licence issuer services; offline is a companion',
 'OPS-016':'Local-first native SQLite control and tenant store providers with local objects; optional future Cloudflare or S3 adapters are not development dependencies',
 'OPS-019':'Purpose-separated native SQLite identity commerce and fleet aggregates with durable owning-domain outboxes and explicit cross-file provisioning sagas; D1 is not a selected target',
 'FND-011':'Exactly one immutable ultimate_business_admin role definition and one active ultimate-owner principal per subscribed business; atomic protected transfer and recovery; arbitrary custom role names cannot clone authority',
 'FND-007':'Business-defined custom role types with module action row field branch company amount approval and AI conditions; explicit denies enforced consistently by a shared scoped-query and command service',
 'APP-009':'Local developer sandbox typed SDK examples manifest validation and install/revoke/uninstall fixtures for Cloud Private and declared offline compatibility',
 'APP-010':'Versioned App contract and isolated storage migrations install/update/disable/uninstall lifecycle; no direct core schema access and required financial evidence retained'
}
TITLES={'OPS-019':'Native SQLite control aggregates'}
PARENTS={'OPS-023':['OPS-008','OPS-014'],'OPS-024':['OPS-008','SEC-005'],'OPS-025':['OPS-016','OPS-017'],'OPS-026':['ACC-004','APP-006','OPS-018']}

# Newest direct owner UI/domain feedback, retained against the same requirement IDs.
OVERRIDES.update({
 'UX-001':'Muted warm ivory charcoal and restrained plum; layered charcoal dark surfaces with Economic Systems deep plum fills 24151c/38212b and readable low-saturation accent text; coherent readable layouts with few borders and no bright white cards or pink primary buttons',
 'UX-003':'SA7EN visible display brand pronounced seven across application and account areas without a clarity tagline; theme-adaptive original mark; preserve existing repository domain protocol certificate and database identifiers',
 'UX-007':'Complete UI and UX module by module before backend feature expansion; coherent registers documents configuration evidence states exports and accessibility; screen coverage is not completion',
 'UX-009':'New frontend at main testing root replaces old public UI while retained financial source/data stay intact; synthetic states and local sample drafts cannot masquerade as actual posting',
 'PRJ-001':'Separate CRM module for contacts leads activities opportunities and explicit quote/project handoff; project delivery tasks time budgets and billing remain in Projects',
 'OPS-003':'Separate administration origin ops.economicsystems.cc hosts commercial subscription management and separately authorized platform operations; customer app remains app.economicsystems.cc; private uses distinct configured app/admin origins without vendor issuer/global billing',
 'OPS-018':'Offline companion implementation follows main infrastructure while frontend and backend contracts retain versioned canonical commands device scope policy entitlement bounds immutable operation IDs pending evidence conflicts and duplicate-free bidirectional synchronization'
})
