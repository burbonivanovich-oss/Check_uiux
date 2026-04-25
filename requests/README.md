# Fetch requests

Drop a JSON file here to ask the GitHub Actions relay to fetch a URL.

## Format

`requests/<timestamp>-<slug>.json`:

```json
{
  "url": "https://kontur.ru/market",
  "slug": "kontur-market",
  "engine": "curl",
  "user_agent": "Mozilla/5.0 (...)",
  "accept_language": "ru-RU,ru;q=0.9"
}
```

Required: `url`, `slug`. Everything else has defaults.

## What happens next

1. Push to the repo triggers `.github/workflows/fetch-page.yml`.
2. The Action runs `curl` against the URL from a normal datacenter IP.
3. Result lands in `samples/<slug>/page.html` plus `samples/<slug>/status.json`.
4. The processed request file is moved to `requests/processed/`.

Pull the repo and read `samples/<slug>/page.html`.

## Why

Cloud Claude Code's outbound allowlist blocks arbitrary domains. GitHub IS on the allowlist, so we use it as the relay.
