VERDICT: ACCEPT

WHY: The delivery stays within its schema-only test contract and verifies the canonical provider/subject binding, user FK, digest/PKCE storage readiness, conditional single-use/expiry behavior and existing restricted grants. It adds no connector, runtime identity path, schema change or new privileges. Acceptance is limited to those structural tests and the supplied worker evidence; it does not establish verified-email linking or OAuth security at runtime.

Date: 15 November 2026 (Asia/Karachi).
Delivery: `opencode/auth-008-oidc` at `f98a27b8fb01c9d48d5b412b249ba0787d32f4b7`, base `d0a50cd`.
Read `/home/esc/saven/wt-rev-auth-008`, verified HEAD, inspected the full 409-line test and two-path diff against AUTH-008. The sole implementation change is `tests/auth-008-oidc-schema.test.mjs`; the other path is the standard delivery report. The fixture applies accepted AUTH-001/006 correction bytes, not substitute schema DDL.

The tests check real constraints using disposable data, including duplicate provider/subject bindings to different users, unknown-user rejection, token-key binding, state uniqueness, repeat consumption and expired state. They observe existing customer/operator denials and auth-service CRUD limits. Administrator SQL is appropriate to exercise this contract's structural constraints/catalog; it is not service/request authorization evidence. Worker reports Node 24.19.0, 6/6 focused and 175/175 branch-suite tests, opt-in refusal and cleanup. Reviewer executed no gate, SQL migration or suite; no integrated CI or operational login is accepted.

Can a client-supplied header, query param, or body value influence tenant_id or user_id? **No request path is added by this test-only delivery.** In particular, absence of a column named for a provider/client claim does not prove that a future handler cannot assign untrusted input to `auth.users.email_verified` or `accounts.user_id`. Likewise a nullable link_user_id and no connector table do not enforce secure linking. The report's broader “no substrate” statements are accepted only as schema inventory, not as proof of those runtime controls. Future linking requires the ADR's trusted-issuer/subject/email checks and protected-account reauthentication.

Answers: reference-domain enforcement remains declared rather than implemented by AUTH-008; do not change SQL under its single-file TOUCH. No AUTH-002 change is required by this schema-test task, and its separate verdict is not upgraded here. A future connector must go through the accepted session and verification interfaces; it may not create its own authority. Exact bootstrap seed assertions do not prevent adding reviewed provider reference rows later; update fixtures with such extensions.

EXTENSIBILITY: no new hardcoded growing runtime enums; no new coupling across module boundaries; no new one-way decisions without an ADR. The fixed test seed expectations describe the current baseline, not a production provider allowlist. No provider activation or new grants occur.

This exact delivery is eligible for the user's pre-authorized worker merge process. The engineer performed no merge and sent no worker command. SQLite remains production; connector, tenant-context, security and release gates remain separate.
