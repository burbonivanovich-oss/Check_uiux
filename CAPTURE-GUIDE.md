# CAPTURE-GUIDE.md

How to audit a landing page or user flow on **any site** from Claude Code,
including from the cloud sandbox where outbound network is restricted.

This file is the contract between the agents (`landing-page-analyst`,
`user-journey-analyst`) and the capture infrastructure. If you're an LLM
picking this repo up cold — read this first.

---

## TL;DR — pick a path

| Path | When to use | What you need |
|---|---|---|
| **A. Local `agent-browser`** | You run Claude Code locally and the target site is reachable from your IP | `npm i -g agent-browser` |
| **B. Browserbase MCP** | You need a clean residential IP, RU geo, or you're stuck behind a corp proxy | `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` |
| **C. GitHub Actions relay** | You're in the **cloud Claude Code sandbox** (claude.ai/code) — outbound is blocked except for github.com / npm / api.anthropic.com | Just this repo + Actions enabled |

If unsure: try A → fall back to C. B is for the geo-blocked case only.

---

## The problem Path C solves

Cloud Claude Code's runtime denies arbitrary outbound HTTP. A `curl https://kontur.ru`
from inside the sandbox returns:

```
HTTP/1.1 403 Forbidden
x-deny-reason: host_not_allowed
```

Only three hosts are reachable: `github.com`, `registry.npmjs.org`, `api.anthropic.com`.

**Trick**: `github.com` is allowlisted, and GitHub Actions runners sit *outside*
the sandbox on normal internet. So we use github.com as a relay:

```
Claude Code (sandbox)              GitHub                     Actions runner (open net)
        │                            │                                  │
        │  commit requests/X.json    │                                  │
        ├──────────────────────────► │  push triggers workflow          │
        │                            ├─────────────────────────────────►│
        │                            │                                  │  Playwright
        │                            │                                  │  fetches URL
        │                            │  workflow commits samples/X/     │
        │                            │◄─────────────────────────────────┤
        │  poll samples/X/status.json│                                  │
        │  via mcp__github__get_*    │                                  │
        │◄──────────────────────────►│                                  │
```

Loop protection: workflow commits include `[skip ci]` so pushing the result
does not re-trigger the workflow.

---

## Path C — the request schema

Drop a JSON file at `requests/<id>.json` and push it. The workflow processes it
and writes results to `samples/<slug>/`.

### Minimum

```json
{
  "url": "https://example.com/pricing",
  "slug": "example-pricing"
}
```

### Full schema

```json
{
  "url": "https://example.com/signup",
  "slug": "example-signup",

  "engine": "playwright",          // "playwright" (default) or "stealth"
  "user_agent": "Mozilla/5.0 ...", // override UA string
  "accept_language": "ru-RU,ru;q=0.9,en;q=0.8",
  "locale": "ru-RU",
  "timezone": "Europe/Moscow",

  "captures": ["desktop", "mobile"],   // omit "mobile" to skip mobile pass
  "collect_vitals": true,              // LCP, CLS, FCP, TTFB

  "cookies": [                         // optional — pre-seed auth cookies
    {"name": "session", "value": "...", "domain": ".example.com", "path": "/"}
  ],
  "storage_state": null,               // optional — paste a previously saved
                                       // storageState JSON (cookies + localStorage)
  "save_storage_state": false,         // save storage_state.json after run

  "steps": [                           // optional — multi-step scenario
    {"action": "click",  "selector": "[data-testid=email-cta]"},
    {"action": "wait_for_selector", "selector": "input[name=email]"},
    {"action": "fill",   "selector": "input[name=email]", "value": "test@example.com"},
    {"action": "fill",   "selector": "input[name=password]", "value": "Test1234!"},
    {"action": "screenshot", "name": "filled-form"},
    {"action": "click",  "selector": "button[type=submit]"},
    {"action": "wait_for_navigation", "timeout": 20000},
    {"action": "screenshot", "name": "post-submit"}
  ]
}
```

### Step actions

| `action` | Required fields | Notes |
|---|---|---|
| `click` | `selector` | |
| `fill` | `selector`, `value` | |
| `press` | `key` | `"Enter"`, `"Tab"`, etc. |
| `wait_for_selector` | `selector` | Default 10s, override with `timeout` |
| `wait_for_navigation` | — | Optional `url` regex; default 15s |
| `wait_for_load` | — | `state: "networkidle"` by default |
| `wait_timeout` | `ms` | Sleep |
| `navigate` | `url` | Same browser session |
| `screenshot` | — | Optional `name`, `full_page: true` |
| `scroll` | `y` | Absolute Y offset |
| `scroll_to_bottom` | — | Slow scroll, triggers lazy-load |
| `eval` | `script` | JS expression; result lands in step log |

Per-step modifiers:
- `"screenshot": false` — suppress the auto-screenshot taken after every step.
- `"continue_on_error": true` — keep going if this step fails.
- `"timeout": 20000` — override default 10–15s.

When `steps` is present, the mobile pass is skipped (the steps drive the
session). Add an explicit mobile run with a separate request file if needed.

---

## Path C — output

```
samples/<slug>/
├── page.html                       # final rendered DOM
├── status.json                     # http status, size, challenged, vitals, steps[], ok
├── desktop-above-fold.png          # 1440×900 first viewport
├── desktop-full.png                # full page
├── mobile-above-fold.png           # iPhone 14 (skipped when steps present)
├── mobile-full.png                 # iPhone 14 full page (skipped when steps present)
├── step-NN-<action>.png            # one per executed step
└── storage_state.json              # saved auth state (when requested)
```

`status.json` shape:

```json
{
  "url": "https://...",
  "slug": "...",
  "engine": "playwright",
  "fetched_at": "2026-04-26T04:27:50.818Z",
  "http_status": 200,
  "size_bytes": 292807,
  "challenged": false,            // true = bot wall (DataDome / Cloudflare / Akamai)
  "vitals": {                     // present when collect_vitals: true
    "lcp_ms": 1820,
    "cls": 0.04,
    "fcp_ms": 1100,
    "ttfb_ms": 240
  },
  "steps": [                      // present when steps[] is given
    {"idx": 0, "action": "click", "ok": true, "screenshot": "step-01-click.png"},
    {"idx": 1, "action": "fill",  "ok": true, "screenshot": "step-02-fill.png"}
  ],
  "error": null,
  "ok": true
}
```

**Always check `ok: true` and `challenged: false` before reading `page.html`.**
If `challenged: true`, retry with `"engine": "stealth"`. If still blocked, the
site is hard-protected — fall back to Path B (Browserbase with residential IP).

---

## Path C — how to drive it from inside Claude Code

```text
1. Compose requests/<timestamp>-<slug>.json
2. mcp__github__create_or_update_file → push the request
3. Poll samples/<slug>/status.json every ~10s via mcp__github__get_file_contents
   (workflow run is typically 30–90s)
4. When status.json shows ok: true, fetch page.html and the screenshots
5. Apply page-cro / signup-flow-cro / form-cro skill to the captured evidence
```

Concurrency: multiple request files in one push are processed in parallel
(default 3 workers, override via repo variable `FETCH_CONCURRENCY`). Use this
to capture a competitor matrix in one workflow run.

---

## Recipes

### 1. Simple page audit

```json
{
  "url": "https://kontur.ru/market",
  "slug": "kontur-market",
  "collect_vitals": true
}
```

### 2. Bot-protected site (DataDome / Cloudflare)

```json
{
  "url": "https://kontur.ru/market",
  "slug": "kontur-market-stealth",
  "engine": "stealth",
  "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "locale": "ru-RU",
  "timezone": "Europe/Moscow"
}
```

### 3. Signup flow with friction map

```json
{
  "url": "https://app.example.com/signup",
  "slug": "example-signup-flow",
  "save_storage_state": true,
  "steps": [
    {"action": "screenshot", "name": "landing"},
    {"action": "fill", "selector": "input[type=email]", "value": "qa+1@example.com"},
    {"action": "click", "selector": "button[type=submit]"},
    {"action": "wait_for_selector", "selector": "input[name=password]"},
    {"action": "screenshot", "name": "password-step"},
    {"action": "fill", "selector": "input[name=password]", "value": "Test1234!"},
    {"action": "click", "selector": "button[type=submit]"},
    {"action": "wait_for_navigation", "timeout": 20000},
    {"action": "screenshot", "name": "post-signup", "full_page": true}
  ]
}
```

### 4. Authenticated page (reuse a saved session)

First run captures `storage_state.json`; second run reuses it:

```json
{
  "url": "https://app.example.com/dashboard",
  "slug": "example-dashboard-authed",
  "storage_state": { "...paste contents of samples/example-signup-flow/storage_state.json..." },
  "collect_vitals": true
}
```

### 5. Competitor matrix in one run

Push 6 request files at once:

```
requests/1714200000-kontur-market.json
requests/1714200000-moysklad-main.json
requests/1714200000-evotor-main.json
requests/1714200000-iiko-main.json
requests/1714200000-1c-roznica.json
requests/1714200000-kontur-roznitsa.json
```

All run in parallel (3 workers default). Results land in `samples/<slug>/`
folders side-by-side.

---

## Path A — local `agent-browser`

```bash
npm i -g agent-browser
agent-browser install --with-deps   # --with-deps only on Linux
agent-browser doctor
```

The `agent-browser` skill handles the rest — see `.claude/skills/agent-browser/`.
Use it directly when you can; it's faster than the relay (no commit + workflow round-trip).

---

## Path B — Browserbase MCP

Required when the local IP is geo-blocked (e.g. testing kontur.ru from a US IP)
or when the site needs a residential fingerprint.

```bash
cp .env.example .env
# fill BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, GOOGLE_API_KEY (Stagehand)
set -a && source .env && set +a
claude
```

In the dashboard: Project → Proxies → set residential pool to the country you
need (e.g. Russia for kontur.ru). Without this, sessions still come out of US/EU
IPs and geo-blocked sites still 403.

Use the `mcp__browserbase__*` tools (`navigate`, `observe`, `act`, `extract`,
`end`). Always call `end` when done — sessions are billed per minute.

---

## How agents pick a path

The two analyst agents (in `.claude/agents/`) walk this decision tree:

```
1. Is `agent-browser` available locally? → Path A
2. Is `mcp__browserbase__*` configured? → Path B
3. Is this repo a git repo with .github/workflows/fetch-page.yml? → Path C
4. None of the above → ask the user to paste the rendered HTML
```

For multi-step user journeys, Path A or Path C with `steps[]` both work. For
visual-only landing audits, all three paths are equivalent.

---

## Limitations of Path C

- **No live interactivity** — every request is a one-shot scenario. You cannot
  iterate clicks based on what the agent sees mid-session. If you need that,
  fall back to A or B.
- **No video / no traces** — only screenshots and HTML. Add `playwright trace`
  wiring to `scripts/fetch.mjs` if you need it.
- **GitHub Actions minutes** — each fetch is 30–90s of runner time. The free
  tier (~2000 min/month for private repos, unlimited for public) is plenty for
  audit work.
- **Captchas** — if the site shows a real visual captcha, no path solves that.
  Stop and report.
- **MFA / payment** — agents never bypass these. Stop and report.

---

## Extending

- **More step actions**: edit `runStep()` in `scripts/fetch.mjs`.
- **Trace recording**: wrap `context.tracing.start({screenshots, snapshots})`
  around the run in `processRequest()`.
- **Different devices**: edit the `MOBILE_DEVICE` constant in `fetch.mjs`.
- **Custom vitals**: extend `collectWebVitals()` — INP, total blocking time,
  long tasks, etc.
- **Network interception**: `page.route()` calls can mock APIs or block
  trackers; add as a top-level `intercept[]` field if useful.

---

## File map

```
.github/workflows/fetch-page.yml    # the relay workflow
scripts/fetch.mjs                   # Playwright runner (all logic)
requests/                           # drop request JSONs here
requests/README.md                  # short reference (this file is the long one)
samples/                            # results land here
.claude/agents/landing-page-analyst.md
.claude/agents/user-journey-analyst.md
.claude/skills/                     # marketing CRO skills + agent-browser
CLAUDE.md                           # project-level orientation
CAPTURE-GUIDE.md                    # this file
```
