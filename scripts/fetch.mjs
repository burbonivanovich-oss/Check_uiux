#!/usr/bin/env node
// Playwright-based fetcher used by .github/workflows/fetch-page.yml.
//
// Reads pending request files from requests/*.json, opens each URL in headless
// Chromium with realistic headers/locale, waits for JS challenges to settle,
// saves the rendered HTML + desktop & mobile screenshots + status.json to
// samples/<slug>/, then archives the request file under requests/processed/.

import { chromium, devices } from "playwright";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const REQUESTS_DIR = "requests";
const PROCESSED_DIR = join(REQUESTS_DIR, "processed");
const SAMPLES_DIR = "samples";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function readPendingRequests() {
  return readdirSync(REQUESTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(REQUESTS_DIR, f));
}

async function pageLooksLikeChallenge(page) {
  // Heuristic: bot-protection challenge pages typically have a captcha frame,
  // a refresh meta tag, or a tiny body with just a spinner.
  const html = await page.content();
  const lower = html.toLowerCase();
  if (lower.includes("captcha_frame") || lower.includes("datadome")) return true;
  if (/<noscript>\s*<meta[^>]+refresh/i.test(html) && html.length < 5000) return true;
  return false;
}

async function fetchOne(req, reqPath) {
  const slug = req.slug;
  const url = req.url;
  if (!slug || !url) {
    console.error(`[skip] ${reqPath}: missing url or slug`);
    renameSync(reqPath, join(PROCESSED_DIR, basename(reqPath)));
    return;
  }

  const outDir = join(SAMPLES_DIR, slug);
  mkdirSync(outDir, { recursive: true });

  const ua = req.user_agent || DEFAULT_UA;
  const acceptLanguage = req.accept_language || "ru-RU,ru;q=0.9,en;q=0.8";
  const locale = req.locale || "ru-RU";
  const timezone = req.timezone || "Europe/Moscow";

  const startedAt = new Date().toISOString();
  let httpStatus = 0;
  let errorMsg = null;
  let challenged = false;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: ua,
      locale,
      timezoneId: timezone,
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: { "Accept-Language": acceptLanguage },
    });
    const page = await context.newPage();

    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    httpStatus = resp ? resp.status() : 0;

    // Give JS challenges (DataDome/Cloudflare/Akamai) time to settle and any
    // redirects to complete.
    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {
      // networkidle can time out on chatty analytics — that's fine.
    }
    await page.waitForTimeout(2000);

    challenged = await pageLooksLikeChallenge(page);
    if (challenged) {
      // One more wait — some challenges resolve after a few extra seconds.
      await page.waitForTimeout(5000);
      challenged = await pageLooksLikeChallenge(page);
    }

    // Save desktop full HTML + screenshots.
    const html = await page.content();
    writeFileSync(join(outDir, "page.html"), html, "utf8");
    await page.screenshot({ path: join(outDir, "desktop-full.png"), fullPage: true });
    await page.screenshot({ path: join(outDir, "desktop-above-fold.png"), fullPage: false });

    // Mobile pass — same URL, smaller viewport.
    const mobileContext = await browser.newContext({
      ...devices["iPhone 14"],
      locale,
      timezoneId: timezone,
      extraHTTPHeaders: { "Accept-Language": acceptLanguage },
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    try {
      await mobilePage.waitForLoadState("networkidle", { timeout: 10000 });
    } catch {}
    await mobilePage.waitForTimeout(1500);
    await mobilePage.screenshot({ path: join(outDir, "mobile-full.png"), fullPage: true });
    await mobilePage.screenshot({ path: join(outDir, "mobile-above-fold.png"), fullPage: false });
    await mobileContext.close();

    await context.close();
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
    console.error(`[error] ${url}: ${errorMsg}`);
  } finally {
    await browser.close();
  }

  let sizeBytes = 0;
  try {
    sizeBytes = statSync(join(outDir, "page.html")).size;
  } catch {}

  const ok = httpStatus === 200 && sizeBytes > 1000 && !errorMsg && !challenged;

  writeFileSync(
    join(outDir, "status.json"),
    JSON.stringify(
      {
        url,
        slug,
        engine: "playwright",
        fetched_at: startedAt,
        http_status: httpStatus,
        size_bytes: sizeBytes,
        challenged,
        error: errorMsg,
        ok,
      },
      null,
      2,
    ),
  );

  console.log(`[done] ${slug}: http=${httpStatus} size=${sizeBytes} challenged=${challenged} ok=${ok}`);

  renameSync(reqPath, join(PROCESSED_DIR, basename(reqPath)));
}

async function main() {
  mkdirSync(PROCESSED_DIR, { recursive: true });
  mkdirSync(SAMPLES_DIR, { recursive: true });

  const pending = readPendingRequests();
  if (pending.length === 0) {
    console.log("No pending requests.");
    return;
  }

  for (const reqPath of pending) {
    let req;
    try {
      req = JSON.parse(readFileSync(reqPath, "utf8"));
    } catch (e) {
      console.error(`[skip] ${reqPath}: invalid JSON`);
      renameSync(reqPath, join(PROCESSED_DIR, basename(reqPath)));
      continue;
    }
    await fetchOne(req, reqPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
