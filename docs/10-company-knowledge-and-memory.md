# SAVEN Company Knowledge and Memory

11 November 2026 | Specification 1.1 | Company brain capability

## 1 Purpose and scope

Extend AI memory beyond a record of chats into an optional, permissioned knowledge base for each company. It should describe the business, connect facts to their evidence, preserve changes over time, and give the assistant relevant context across tasks and model providers. Individual memory remains separate from shared company knowledge.

Supported knowledge includes company identity and ownership information supplied to the system, business activities, branches, organization and responsibilities, products and services, processes, approved policies, agreements, commercial relationships, projects, decisions, obligations, and significant business events. Link these to permitted company records, Drive documents, attachments, approved meeting records, integrations, and explicitly provided statements. Sensitive topics retain their own access restrictions. A company brain is not a single unrestricted summary visible to every employee.

The goal is comprehensive knowledge of the information the company chooses to provide and authorize. SAVEN cannot know an undisclosed business change or guarantee that every uploaded document was understood. Show included sources, excluded sources, processing failures, unresolved facts, and freshness. Say when information is missing or conflicting. Fetch current balances and transaction states from the authoritative business services rather than treating an old narrative memory as the ledger.

This is a required launch capability of the product, with the same internal and opted-in evaluation gates as other AI tools. Its use by any individual customer is optional. It is specified here and has not yet been implemented.

## 2 Separate layers of knowledge

| Layer | Contents | Authority and access |
| --- | --- | --- |
| Company records | Posted transactions, master records and published configurations | Relevant business service remains authoritative |
| Shared business knowledge | Company profile, relationships, processes, agreements and accepted facts | Company or team scope with sensitivity and evidence permissions |
| Approved policies | Published accounting, workflow and operating rules | Only authorized publication changes operative policy |
| Individual memory | Personal preferences, private context and task continuity | User-private unless deliberately shared through an authorized action |
| Historical knowledge | Earlier facts, source versions, decisions and superseded policies | Authorized historical or as-of queries; not presented as current |

An extracted statement is initially a candidate when its meaning or authority is uncertain. A user preference does not become a company rule. Model inference and an unreviewed meeting note cannot override an approved contract, published policy, or current business record. An authorized person resolves disagreements or publishes a change through the normal workflow.

## 3 Evidence that identifies the actual source

Every material retained business fact has a stable identifier and one or more supporting evidence records. A filename alone is insufficient because it can be renamed, reused, or replaced.

| Evidence field | Required meaning |
| --- | --- |
| Source identity | Stable document or record ID, company, and source system |
| Source version | Immutable version ID, content hash, and extraction version |
| Human identification | Document title, document type, parties or author where available, date, business reference and source role |
| Exact location | Page and paragraph or bounding region; table and row; sheet and cell range; or timestamp where applicable |
| Supporting content | Protected excerpt or structured source value sufficient to check what supports the fact |
| Interpretation | Normalized fact, applicable unit or currency, whether quoted, summarized, inferred, or user asserted |
| Authority and time | Review status, reviewer, effective dates, observation time and any supersession |
| Access and retention | Classification, source permissions, retention or hold state and derived-data dependencies |

Open a citation at the supporting location in the exact retained version, not merely the latest file with that name. For example, a credit-period answer could cite a customer agreement, agreement number and date, version 3, page 4, clause 6, and the relevant wording. This is a hypothetical demonstration, not a statement about an actual customer's terms.

For system data, cite the record and version or report snapshot. A fact entered directly by a person is labelled user asserted, with actor and date, until appropriate evidence or approval exists. Do not fabricate document references for it. If a source is no longer retained or available, say so; a hash or stale citation does not establish the underlying fact by itself. Citations, previews and source titles are also subject to access checks.

## 4 Change tracking and business history

Track both when a fact was valid in the business and when SAVEN learned or recorded it. Preserve old and new values, source versions, who or what reported the change, review outcome, and the reason for supersession. A correction of a mistaken fact is distinguishable from a genuine later business change.

Subscribe to committed changes in company records and eligible document creation, replacement, withdrawal, permission changes, and approved user corrections. Indexing jobs use stable event identities and safe retries. External sources require a supported connector or a user-supplied update; the feature does not observe activity outside its authorized sources.

A new agreement or policy creates candidate changes and identifies dependent facts and summaries. Conflicts and future effective dates remain visible. Do not assume the newest upload automatically overrides the governing agreement. Preserve the earlier version for authorized as-of questions and legal retention, while normal answers use the currently applicable accepted fact. Notifications are addressed only to people permitted to see the affected subject.

Display an as-of time and processing status. If a critical underlying record changed while an index is stale, query the current authoritative record or mark the answer incomplete. A background knowledge projection cannot approve a transaction using an out-of-date limit or policy.

## 5 Company user and operator controls

Provide a named Company knowledge setting in the company's AI settings. An authorized company administrator can enable or disable shared company knowledge and choose included source categories or folders without vendor assistance. A user can control their own optional personal memory, and can change company settings only if granted that company administration permission. Requesting enablement does not itself grant a user new authority.

Authorized provider system administrators can enable, disable or suspend the company capability through the operator portal, using their own identity and a recorded reason. A change to the customer's selected company setting uses documented customer authorization or the agreed administration mandate. Show the company who changed the setting, its scope, and the result. Operator entitlement or rollout enablement alone must not silently override a customer's disabled selection or expand source permissions.

Effective use requires operator availability, the company's enabled selection, applicable user or team permission, and permission to the relevant evidence. Personal memory has an independent user setting within those limits. Disabling one user's personal memory does not delete shared company knowledge. Disabling the company capability stops its shared knowledge functions for every user. Operators can suspend processing promptly for an incident; ordinary accounting and document storage continue.

Make the first enablement explicit about included information, who can access it, model-provider processing, retention, and how to stop or delete it. Recommend disabled by default until the company selects its sources. This recommendation governs optional knowledge capture and does not change mandatory accounting audit records.

## 6 What disabling means

Disabling stops new capture and refresh, retrieval, and insertion of retained company knowledge into AI prompts or tool results. Cancel or invalidate pending jobs and cached context. In-flight tasks must recheck the setting before retrieving, using, displaying or acting on the knowledge; a task whose context already contains disabled knowledge must stop or restart without it. Do not imply a previously sent provider request or previously viewed response can be recalled.

Turning off is separate from deletion. Retained knowledge is unavailable for AI use and remains protected under the disclosed retention policy. Offer a separate authorized deletion action that describes the facts, summaries and indexes affected, exceptions for required audit or legal retention, and expected completion. Removing derived knowledge must not delete the source invoice, contract, ledger or required evidence. A deletion receipt distinguishes removed material from restricted retained records and any provider-retention limitations.

Re-enabling requires rechecking current source permissions, retention and versions, then reconciling changes since processing stopped. Discard invalidated cached context and show incomplete catch-up status. Re-enablement cannot restore revoked access or treat old summaries as newly verified facts.

## 7 Storage retrieval and permissions

Store company entities, relationships, facts, temporal versions and evidence pointers in the application database. Store original document versions and protected excerpts in company-scoped storage under their retention policy. Full-text or optional vector indexes are rebuildable projections. Keep coverage, processing events, failed jobs and correction history inspectable. No provider-specific chat history is the sole source of memory.

Retrieve only the relevant permitted facts and evidence for a task, within cost and context budgets. Do not send the company's entire history on every request. A company-wide fact can still be confidential to a payroll team or board. Derived summaries and relationships cannot bypass the sensitivity of their sources. To disclose a fact, its permitted evidence must support the disclosed claim; separately authorized publication of a shared fact is an explicit audited action. Do not leak restricted facts through titles, relationship counts, citations, search suggestions or summaries.

Revocation applies at retrieval, generation and result delivery, including historical answers and background tasks. Imported files, extracted facts and remembered instructions remain untrusted input; they cannot grant tools permission or change operative policies. Keep the business knowledge interface separate from role, approval and accounting control enforcement.

## 8 Review and acceptance

Company administrators with the relevant knowledge permissions can inspect the company profile, facts, sources, change timeline, unresolved conflicts, missing evidence and source coverage. Users can inspect and correct their own memory. Operator configuration authority alone does not give routine access to the underlying customer knowledge content.

Before customer exposure, demonstrate the following with labelled examples. These are acceptance requirements, not claims that the software already passes them.

| Case | Required result |
| --- | --- |
| File renamed or same name reused | Citation still opens the exact original source ID and version |
| Fact extracted from a contract | Answer identifies the actual agreement and supporting clause or region |
| Contract replaced with future terms | Current and future answers respect effective dates and preserve earlier history |
| Wrong fact later corrected | Correction and business change have distinct recorded histories |
| Contradictory sources | Conflict is visible; AI does not silently choose a governing rule |
| Restricted source or permission revoked | Fact, excerpt, title and derived summary remain inaccessible to the unauthorized user |
| Company or operator switch turned off | Retrieval, indexing, queued jobs and in-flight context follow the disable contract |
| Personal switch turned off | Personal-memory use stops without deleting another user's or shared company knowledge |
| Knowledge deletion requested | Derived data is removed under policy while source records and required audit evidence are preserved |
| Feature re-enabled | Current permissions and changed source versions are reconciled before stale facts are reused |
| Source not processed or unavailable | Coverage and answer show the gap rather than claiming complete knowledge |

Catalog coverage is AI-011, AI-012 and AI-017 through AI-025. Financial actions remain subject to the same authority and approval rules as all other AI tools.
