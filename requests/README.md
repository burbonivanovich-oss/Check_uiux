# Fetch requests

Drop a JSON file here — `requests/<id>.json` — and the GitHub Actions relay
will fetch the URL via Playwright headless Chromium and commit the result to
`samples/<slug>/`.

## Minimum example

```json
{
  "url": "https://kontur.ru/market",
  "slug": "kontur-market"
}
```

## Full schema

```json
{
  "url": "https://example.com/signup",
  "slug": "example-signup",

  "engine": "playwright",          // "playwright" (default) or "stealth"
  "user_agent": "Mozilla/5.0 ...",
  "accept_language": "ru-RU,ru;q=0.9,en;q=0.8",
  "locale": "ru-RU",
  "timezone": "Europe/Moscow",

  "captures": ["desktop", "mobile"],   // omit "mobile" to skip mobile pass
  "collect_vitals": true,              // LCP, CLS, FCP, TTFB

  "cookies": [                         // optional — pre-seed auth cookies
    {"name": "session", "value": "...", "domain": ".example.com", "path": "/"}
  ],
  "storage_state": null,               // optional — paste a previously saved
                                       // storageState JSON object
  "save_storage_state": false,         // save storage_state.json after run
                                       // (auto-enabled when steps are present)

  "steps": [                           // optional — multi-step scenario
    {"action": "click",  "selector": "[data-testid=email-cta]"},
    {"action": "wait_for_selector", "selector": "input[name=email]"},
    {"action": "fill",   "selector": "input[name=email]", "value": "test@example.com"},
    {"action": "fill",   "selector": "input[name=password]", "value": "Test1234!"},
    {"action": "screenshot", "name": "filled-form", "full_page": false},
    {"action": "click",  "selector": "button[type=submit]"},
    {"action": "wait_for_navigation", "timeout": 20000},
    {"action": "screenshot", "name": "post-submit"}
  ]
}
```

## Supported step actions

| `action` | Required | What it does |
|---|---|---|
| `click` | `selector` | Click an element |
| `fill` | `selector`, `value` | Fill a form field |
| `press` | `key` | Press a key (e.g. `"Enter"`, `"Tab"`) |
| `wait_for_selector` | `selector` | Wait until an element appears (default 10s) |
| `wait_for_navigation` | — | Wait for URL change (optional `url` regex) |
| `wait_for_load` | — | Wait for `networkidle` (or `state` override) |
| `wait_timeout` | `ms` | Sleep for N ms |
| `navigate` | `url` | Go to a new URL within the same session |
| `screenshot` | — | Save a screenshot. Optional `name` + `full_page: true` |
| `scroll` | `y` | Scroll to absolute Y |
| `scroll_to_bottom` | — | Slow scroll to bottom (triggers lazy-loaded content) |
| `eval` | `script` | Run a JS expression in the page (result lands in step log) |

Every step gets an auto-screenshot after it runs (suppress with
`"screenshot": false` on the step). Add `"continue_on_error": true` if you
want the scenario to keep running after a failed step.

Per-step `"timeout"` overrides the default (10–15s).

## Output

The workflow writes to `samples/<slug>/`:

```
samples/<slug>/
├── page.html                       # final rendered DOM
├── status.json                     # http status, size, challenged, vitals, step log, ok
├── desktop-above-fold.png          # 1440×900 first viewport
├── desktop-full.png                # full page
├── mobile-above-fold.png           # iPhone 14 first viewport (skipped when steps present)
├── mobile-full.png                 # iPhone 14 full page (skipped when steps present)
├── step-00-initial.png             # snapshot before scenario runs (only when steps present)
├── step-NN-<name-or-action>.png    # one per executed step (uses `name` if set)
└── storage_state.json              # saved auth state (when save_storage_state or steps used)
```

`status.json.steps[]` shape: `{ step, action, selector?, name?, duration_ms,
error, url_after, ... }`. The first entry is always the initial `goto`
(`step: 0`). A step succeeded if `error === null`.

## Concurrency

Multiple request files are processed in parallel. The default is 3 in flight;
override by setting the repository variable `FETCH_CONCURRENCY` in
`Settings → Secrets and variables → Actions → Variables`.

## Trigger

Pushing a `requests/*.json` file triggers the workflow automatically. Manual
runs work via `Actions → fetch-page → Run workflow` with `url` + `slug`
inputs (the workflow materializes them as a request file).

## Why

Cloud Claude Code's outbound allowlist blocks arbitrary domains. GitHub IS
on the allowlist, so we use it as the relay. See `CAPTURE-GUIDE.md` for the
full architecture and patterns.
