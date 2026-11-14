# Frozen SA7EN testing frontend

Archived by the owner on 14 November 2026. This is the synthetic HTML/JavaScript review frontend formerly kept in public/ui. It is a reference for the working application's design, not a second ERP implementation to maintain.

The existing deployment at https://saventesting.economicsystems.cc remains running on the owner's server. Its container, image, port 8792, tunnel route and DNS were not changed. The retained container image is sha256:5b47a19a1cc3464c03b57c83a83c5bf167a4213090c300803eb9e91c152c8d38. The public HTML SHA-256 before archival is f050acdd3586cbb89dc1fa1e0126f3f2c979d201eed7f3310f6815f3bce0038a.

The archived source, old UI tests and Docker recipe preserve their original relative layout. The manifest records original paths and normalized source hashes. These files are excluded from active UI development, automatic catalog regeneration and preview-image CI builds. Requirements, workflow contracts and the complete product scope remain active in docs and contracts; archiving the mockup removes no requirement.

For an exact historical reproduction, check out commit 0d462956e98d8f1e58ec91bc439fb44a0d844eee in a separate directory. The archived Docker/test recipes refer to the original repository layout. The lightweight local reference server can still read this snapshot with npm run ui; it does not write or rebuild the archived frontend. Never copy this mockup over the live operational application or route app/ops to its synthetic records.

Active application source is public/live; native business logic is src/local. Development continues on testing-1. Main records reviewed deployed increments.
