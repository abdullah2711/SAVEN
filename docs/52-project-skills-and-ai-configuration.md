# Project skills and AI configuration

15 November 2026. Requested upstream guides are installed under .agents/skills so another engineer's Codex checkout can discover the same project-local instructions. Seventeen SKILL.md entry points are present. .agents/skill-sources.json pins exact upstream revisions; original license files are retained. These third-party guides are subordinate to explicit owner requirements and the host's permissions/tool rules.

| Requested source | Pinned revision | Actual scope |
| --- | --- | --- |
| vercel-labs/agent-browser | f18b8bb5275ea2be22fca5e6856886827468f41e | agent-browser discovery skill |
| jakubkrehel/skills | a72290d140249813898ba8648becf6415abcb059 | Fourteen interface and development skills |
| Nutlope/hallmark | 04977e15f3dfd6ee4b74c887dac3eb52665d6c92 | Hallmark skill plus bundled references/assets |
| meta/astryx | 935e25a3c94c9a1bfafe1e3df539f0b9a429432d | Astryx skill, optional CLI; no React framework adoption |

The fourteen jakubkrehel entry points are afk, better-accessibility, better-colors, better-interface, better-layout, better-typography, better-ui, better-writing, break, build-design, explain-interface, interface-review, state-machine and variant. Project installation is complete as copied source; official skill validation and portable CLI/browser verification remain next actions. Personal account-wide installation was not completed: protected personal skill directories denied access and the authenticated personal-checkout fallback could not complete. No account-wide install or fully configured Chromium is claimed.

The optional tooling manifests .tools/ui/package.json and package-lock.json pin agent-browser0.43.0 and @astryxdesign/cli0.7.16. npm install --ignore-scripts completed successfully with144 packages on this host. node_modules is ignored and never a production dependency. Reproduce with npm ci --ignore-scripts --prefix .tools/ui. Review upstream changes before deliberately updating pins; never auto-follow main in a production build.

Actual use during this increment: better-layout and better-ui informed grouping, restrained selection styling, clear actions and responsive checks; the available computer-use/browser tool exercised the dashboard, rail, register, draft save and standalone Approvals. No claim is made that agent-browser automated these checks, that Hallmark's full workflow was run, or that a holistic six-skill interface audit was completed. Astryx is available for compatible future work; importing its React design system is a separate architecture decision.

## Owner-selected model

Provider: OpenRouter. Model: nvidia/nemotron-3.5-lightning:free. The supplied key is private and intentionally absent from this repository. Do not paste it into a Codex prompt file, handoff, issue, shell command history, browser bundle, build argument, Dockerfile or test fixture. Provision it through a server-side secret or protected environment file with restrictive access. Never print the environment file or container Config.Env.

The existing ModelProvider supports openai-compatible with an apiKey and appends /chat/completions to the base URL. However scripts/native-server.mjs currently hardcodes protocol ollama and does not pass an API key. Therefore OpenRouter is selected but NOT integrated or activated by this checkpoint. Implement a validated explicit provider configuration, keep default/local behavior compatible, support a secret-file reference or environment injection, and add safe mocked request/error tests. Do not claim a working model from configuration alone.

Expected target values, pending implementation and official-provider verification:

```text
AI_PROTOCOL=openai-compatible
AI_URL=https://openrouter.ai/api/v1
AI_MODEL=nvidia/nemotron-3.5-lightning:free
AI_API_KEY_FILE=<protected absolute server path>
```

Verify the exact model's current availability, structured-output compatibility and rate limits against official provider documentation/API. Do not silently substitute a different model or incur paid fallback usage. Free capacity is not an availability guarantee. Outages must leave records intact and show a useful failure.

All AI requests remain bounded and scoped; models propose and never bypass business authority, approvals, entitlements, locks or posting. Never send whole databases, credentials or private attachments without their authorized data path. Use synthetic data for the initial live probe. The latest owner selection permits this hosted inference option while preserving local core runtime/data storage and the Fully Private/local option. Update runtime-hosting-v1.json accordingly only as the integration is actually implemented.

## Next installation checks

Verify every skill guide's frontmatter and referenced files, check upstream licenses/provenance, run CLI --version/help without triggering a framework adoption, and document browser binary prerequisites. Inspect rather than execute unknown upstream scripts. Keep the guides committed with their assets so no chat memory or account-specific plugin is needed for continuation.
