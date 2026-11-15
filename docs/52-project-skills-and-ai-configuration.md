# Project skills and AI configuration

15 November 2026. Requested upstream guides are installed under .agents/skills so another engineer's Codex checkout can discover the same project-local instructions. Seventeen SKILL.md entry points are present. .agents/skill-sources.json pins exact upstream revisions; original license files are retained. These third-party guides are subordinate to explicit owner requirements and the host's permissions/tool rules.

| Requested source | Pinned revision | Actual scope |
| --- | --- | --- |
| vercel-labs/agent-browser | f18b8bb5275ea2be22fca5e6856886827468f41e | agent-browser discovery skill |
| jakubkrehel/skills | a72290d140249813898ba8648becf6415abcb059 | Fourteen interface and development skills |
| Nutlope/hallmark | 04977e15f3dfd6ee4b74c887dac3eb52665d6c92 | Hallmark skill plus bundled references/assets |
| meta/astryx | 935e25a3c94c9a1bfafe1e3df539f0b9a429432d | Astryx skill, optional CLI; no React framework adoption |

The fourteen jakubkrehel entry points are afk, better-accessibility, better-colors, better-interface, better-layout, better-typography, better-ui, better-writing, break, build-design, explain-interface, interface-review, state-machine and variant. Project installation is complete as copied source. tools/validate_project_skills.py verifies17 entry points,271 exact file hashes, local linked guide files, licenses and four pins; it is not the official upstream validator or a complete code/visual audit. Personal account-wide installation was not completed: protected personal skill directories denied access and the authenticated personal-checkout fallback could not complete. No account-wide install or fully configured Chromium is claimed.

The optional tooling manifests .tools/ui/package.json and package-lock.json pin agent-browser0.43.0 and @astryxdesign/cli0.7.16. npm install --ignore-scripts completed successfully with144 packages on this host. node_modules is ignored and never a production dependency. Reproduce with npm ci --ignore-scripts --prefix .tools/ui. Review upstream changes before deliberately updating pins; never auto-follow main in a production build.

Actual use during this increment: better-layout and better-ui informed grouping, restrained selection styling, clear actions and responsive checks; the available computer-use/browser tool exercised the dashboard, rail, register, draft save and standalone Approvals. agent-browser0.43.0 reports its version and its core workflow was retrieved; CUA performed the browser checks. Astryx0.7.16 version/search/navigation docs were read, supporting the side navigation choice; matching Core/component registry installation was unavailable. A Hallmark source-only lint reports existing token/stamp/typography/spacing findings; no clean or rendered Hallmark pass is claimed. Its full redesign workflow and the holistic six-skill interface audit were not run. Astryx is available for compatible future work; importing its React design system is a separate architecture decision.

## Owner-selected model

Provider: OpenRouter. Model: nvidia/nemotron-3.5-lightning:free. The supplied key is private and intentionally absent from this repository. Do not paste it into a Codex prompt file, handoff, issue, shell command history, browser bundle, build argument, Dockerfile or test fixture. Provision it through a server-side secret or protected environment file with restrictive access. Never print the environment file or container Config.Env.

src/local/model-config.mjs now creates the explicit server-only provider. It preserves local Ollama defaults and permits a protected AI_API_KEY_FILE or AI_API_KEY, rejecting conflicting/malformed secrets. OpenRouter pins the exact requested free model and base URL. ModelProvider uses a required saven_response tool envelope for this endpoint, validating the same allowed response contract; this is an output envelope, not permission to execute arbitrary tools. Routing requires supported parameters, denies data collection, disables provider fallback and caps prompt/completion prices at zero. Three new source tests cover configuration, exact request shape and malformed/error/context rejection. No live production activation is claimed.

Implemented server configuration (the secret path is supplied privately):

```text
AI_PROTOCOL=openai-compatible
AI_URL=https://openrouter.ai/api/v1
AI_MODEL=nvidia/nemotron-3.5-lightning:free
AI_API_KEY_FILE=<protected absolute server path>
```

Verify the exact model's current availability, structured-output compatibility and rate limits against official provider documentation/API. Do not silently substitute a different model or incur paid fallback usage. Free capacity is not an availability guarantee. Outages must leave records intact and show a useful failure.

All AI requests remain bounded and scoped; models propose and never bypass business authority, approvals, entitlements, locks or posting. Never send whole databases, credentials or private attachments without their authorized data path. Use synthetic data for the initial live probe. The latest owner selection permits this hosted inference option while preserving local core runtime/data storage and the Fully Private/local option. Update runtime-hosting-v1.json accordingly only as the integration is actually implemented.

## Installation continuation

Entry points, local guide references, licenses, source pins and file hashes are validated. CLI versions and read-only documentation commands were verified. Chromium provisioning, matching Astryx Core availability and a full design/a11y review remain separate follow-up work. Keep guides committed with their assets so no chat memory or account-specific plugin is needed for continuation.


## Observed provider gate and official sources

On15 November2026, the official endpoint metadata lists tools/tool_choice and max_tokens, but not response_format/structured_outputs for this free endpoint. This is why the adapter uses a validated tool envelope. Synthetic requests using the supplied key and no business records returned404: no endpoints matching the data policy (free model training). The integration fails closed. No privacy setting or account policy was changed, no paid/model fallback was selected, and no production AI was switched. The key exists only in ignored var/secrets/openrouter.key on this workstation with a restricted Windows ACL; another host needs secure secret provisioning.

Provider policy changes require an explicit owner decision about the real data implications. Do not interpret the initial model choice as permission to expose client books to a training endpoint. This is the current blocker for working hosted inference, separate from Accounting/UI source readiness.

Official references checked: [model endpoint metadata](https://openrouter.ai/api/v1/models/nvidia/nemotron-3.5-lightning:free/endpoints), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [free model limits](https://openrouter.ai/collections/free-models). Availability and quotas can change; recheck before enabling production. Do not promise reliable free capacity.

## Actual tooling verification limits

The local-link/hash checker and CLI version/read commands pass. Chromium is not provisioned by the ignored-scripts install. Astryx React/Core is not adopted. Hallmark source lint reports findings and no full rendered/reviewer pass is claimed. The compatible migration/design cleanup is recorded in the small-action queue. Keep these limits when handing work to another account.
