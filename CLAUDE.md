# Check_uiux — Landing Page & User Journey Analysis Toolkit

This repo is a Claude Code workspace pre-loaded with skills and agents for
auditing landing pages, marketing copy, and user flows on live websites.

## Agents

Located in `.claude/agents/`. Invoke via the `Agent` tool with the matching `subagent_type`.

| Agent | Use it for |
|---|---|
| `landing-page-analyst` | Full CRO + copy audit of a single page. Captures desktop + mobile, applies `page-cro` and `copywriting`, returns a prioritized fix list with before/after copy. |
| `user-journey-analyst` | Step-by-step walkthrough of a real flow (signup, onboarding, checkout). Drives the browser via `agent-browser`, scores each step, returns a friction map. |

## Skills

Located in `.claude/skills/`. Activated automatically by Claude when the task matches.

**Conversion (from [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills), MIT):**
- `page-cro` — landing / pricing / feature page conversion audit. This is the "landing-page-optimizer" / "page-cro" / "landing-cro" skill.
- `form-cro` — any standalone form (lead, contact, checkout fields).
- `signup-flow-cro` — registration / signup multi-step flow.
- `onboarding-cro` — post-signup activation and first-value moment.
- `copywriting` — write or rewrite marketing copy (PAS / AIDA / BAB / JTBD).
- `customer-research` — understand the audience before optimizing.
- `marketing-psychology` — persuasion, trust, cognitive load principles.
- `product-marketing-context` — bootstrap a positioning / ICP doc that the other skills reference. Run this first on any new product.

**Browser automation (from [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser), Apache-2.0):**
- `agent-browser` — drive a real Chromium browser to capture screenshots, click through flows, read accessibility trees, measure Core Web Vitals. Required for any audit that needs real evidence.

## Quick start

```text
# Audit a single landing page
> Use the landing-page-analyst to audit https://example.com/pricing

# Walk a signup flow
> Use the user-journey-analyst to analyze the signup flow starting at https://example.com

# Bootstrap product context first (recommended once per product)
> Set up product marketing context for my product
```

## Browser capture: two paths

The agents can capture pages with either of two tools. They pick automatically;
you only need at least one of these working.

### Path A — local `agent-browser` CLI (default, fastest, free)

```bash
npm i -g agent-browser
agent-browser install --with-deps   # `--with-deps` only on Linux
agent-browser doctor                # sanity check
```

Verify with `agent-browser skills list`. Works for any public page that does
**not** geo-block your IP.

### Path B — Browserbase MCP server (cloud browser + proxy / RU geo)

Required when the local IP is blocked (e.g. `kontur.ru` returns 403 outside RU)
or when running Claude Code on the web (claude.ai/code) where the sandbox sits
on US infrastructure.

1. **Get keys** — sign up at [browserbase.com](https://browserbase.com), then:
   - Copy `BROWSERBASE_API_KEY` from Settings → API Keys.
   - Copy `BROWSERBASE_PROJECT_ID` from Settings → Projects.
   - Get a free Gemini key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) — Stagehand (the engine inside Browserbase MCP) uses it by default.
2. **Set country to RU for Russian sites** — in the Browserbase dashboard, open your project → Proxies → set the residential proxy pool to Russia. Without this, sessions still come out of US/EU IPs and `kontur.ru` will keep 403'ing.
3. **Export the env vars** before launching Claude Code:
   ```bash
   cp .env.example .env
   # fill in the three keys
   set -a && source .env && set +a
   claude   # or open the IDE that runs Claude Code
   ```
   `.mcp.json` references these vars via `${BROWSERBASE_API_KEY}` etc., so do
   not paste keys into the file.
4. **Verify** — in a Claude Code session, run a tool from the `mcp__browserbase__*` family (e.g. ask Claude to "open browserbase and navigate to example.com"). Successful navigation = MCP wired up.

**Cost note**: Browserbase sessions are billed per minute. The agents always
end sessions when done. Free tier is enough for testing one or two pages.

## Output convention

Both analyst agents write reports under `./reports/`:

```
reports/
├── landing-page/<slug>/
│   ├── REPORT.md
│   ├── desktop-above-fold.png
│   ├── desktop-full.png
│   ├── mobile-above-fold.png
│   └── mobile-full.png
└── user-journey/<slug>/
    ├── REPORT.md
    └── step-01-landing/, step-02-signup/, ...
```

## Notes

- The `landing-page-optimizer` mentioned in some marketplaces is functionally the `page-cro` skill from the marketingskills repo — do not install both, they overlap.
- All marketing skills expect a `product-marketing-context.md` for best results. Run that skill first for any new product.
- The agents never bypass paywalls, MFA, or captchas. They stop and report what they captured.
