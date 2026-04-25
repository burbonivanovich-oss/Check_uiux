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

## Setup the agent-browser CLI (required for any audit)

The `agent-browser` skill is a discovery stub — it expects the CLI to be
installed on the machine running Claude Code:

```bash
npm i -g agent-browser
agent-browser install
```

Verify with `agent-browser skills list`.

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
