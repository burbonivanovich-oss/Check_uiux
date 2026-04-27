#!/usr/bin/env node
// Playwright-based fetcher used by .github/workflows/fetch-page.yml.
//
// Reads pending request files from requests/*.json, captures pages via
// headless Chromium with realistic headers/locale, optionally runs a
// scenario of steps, collects Web Vitals, and saves the rendered HTML +
// screenshots + status.json to samples/<slug>/.
//
// Features:
// - Web Vitals (LCP, CLS, FCP, TTFB) collected by default
// - Multi-step scenarios: click / fill / wait / navigate / screenshot / press
// - Authenticated browsing via cookies or storage_state
// - Optional stealth mode (engine: "stealth") via playwright-extra
// - Parallel processing controlled by FETCH_CONCURRENCY env var (default 1)
//
// See CAPTURE-GUIDE.md and requests/README.md for the full request schema.

import { chromium as plainChromium, devices } from "playwright";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { join, basename } from "node:path";

const REQUESTS_DIR = "requests";
const PROCESSED_DIR = join(REQUESTS_DIR, "processed");
const SAMPLES_DIR = "samples";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const CONCURRENCY = Math.max(1, parseInt(process.env.FETCH_CONCURRENCY || "1", 10));

// Lazily load stealth — install is optional. If missing, engine: "stealth"
// degrades to plain Playwright with a warning.
let stealthChromium = null;
async function getStealthChromium() {
  if (stealthChromium) return stealthChromium;
  try {
    const extra = await import("playwright-extra");
    const { default: stealth } = await import("puppeteer-extra-plugin-stealth");
    extra.chromium.use(stealth());
    stealthChromium = extra.chromium;
    return stealthChromium;
  } catch (e) {
    console.warn(`[stealth] playwright-extra not available, falling back to plain Playwright: ${e.message}`);
    return null;
  }
}

function readPendingRequests() {
  return readdirSync(REQUESTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(REQUESTS_DIR, f));
}

async function pageLooksLikeChallenge(page) {
  const html = await page.content();
  const lower = html.toLowerCase();
  if (lower.includes("captcha_frame") || lower.includes("datadome")) return true;
  if (lower.includes("challenge-platform") && lower.includes("cloudflare")) return true;
  if (/<noscript>\s*<meta[^>]+refresh/i.test(html) && html.length < 5000) return true;
  return false;
}

async function collectWebVitals(page) {
  try {
    return await page.evaluate(() => {
      return new Promise((resolve) => {
        const v = { lcp: null, cls: 0, fcp: null, ttfb: null, dom_content_loaded: null, load: null };
        try {
          const nav = performance.getEntriesByType("navigation")[0];
          if (nav) {
            v.ttfb = nav.responseStart - nav.requestStart;
            v.dom_content_loaded = nav.domContentLoadedEventEnd - nav.startTime;
            v.load = nav.loadEventEnd - nav.startTime;
          }
        } catch {}
        try {
          const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
          if (fcp) v.fcp = fcp.startTime;
        } catch {}
        let lcpObs, clsObs;
        try {
          lcpObs = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length) v.lcp = entries[entries.length - 1].startTime;
          });
          lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
        } catch {}
        try {
          clsObs = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              if (!e.hadRecentInput) v.cls += e.value;
            }
          });
          clsObs.observe({ type: "layout-shift", buffered: true });
        } catch {}
        setTimeout(() => {
          try { lcpObs && lcpObs.disconnect(); } catch {}
          try { clsObs && clsObs.disconnect(); } catch {}
          // Round to integers / 4 decimals to keep status.json clean.
          if (v.lcp != null) v.lcp = Math.round(v.lcp);
          if (v.fcp != null) v.fcp = Math.round(v.fcp);
          if (v.ttfb != null) v.ttfb = Math.round(v.ttfb);
          if (v.dom_content_loaded != null) v.dom_content_loaded = Math.round(v.dom_content_loaded);
          if (v.load != null) v.load = Math.round(v.load);
          v.cls = Math.round(v.cls * 10000) / 10000;
          resolve(v);
        }, 1500);
      });
    });
  } catch (e) {
    return { error: e.message };
  }
}

function stepFilename(slug, idx, action, name) {
  const tag = name || action;
  const safeTag = String(tag).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
  return join(SAMPLES_DIR, slug, `step-${String(idx).padStart(2, "0")}-${safeTag}.png`);
}

async function runStep(page, step, slug, idx) {
  const start = Date.now();
  let error = null;
  let extra = {};
  try {
    switch (step.action) {
      case "click":
        await page.click(step.selector, { timeout: step.timeout || 10000 });
        break;
      case "fill":
        await page.fill(step.selector, step.value, { timeout: step.timeout || 10000 });
        break;
      case "press":
        await page.keyboard.press(step.key);
        break;
      case "wait_for_selector":
        await page.waitForSelector(step.selector, { timeout: step.timeout || 10000, state: step.state || "visible" });
        break;
      case "wait_for_navigation":
        await page.waitForURL(step.url ? new RegExp(step.url) : /.*/, { timeout: step.timeout || 15000 });
        break;
      case "wait_for_load":
        await page.waitForLoadState(step.state || "networkidle", { timeout: step.timeout || 15000 });
        break;
      case "wait_timeout":
        await page.waitForTimeout(step.ms || 1000);
        break;
      case "navigate":
        await page.goto(step.url, { waitUntil: step.wait_until || "domcontentloaded", timeout: step.timeout || 45000 });
        break;
      case "screenshot":
        // explicit named screenshot
        await page.screenshot({ path: stepFilename(slug, idx, "screenshot", step.name), fullPage: !!step.full_page });
        break;
      case "scroll":
        await page.evaluate((y) => window.scrollTo(0, y), step.y || 0);
        break;
      case "scroll_to_bottom":
        await page.evaluate(async () => {
          await new Promise((res) => {
            let total = 0;
            const dist = 400;
            const tm = setInterval(() => {
              window.scrollBy(0, dist);
              total += dist;
              if (total >= document.body.scrollHeight) {
                clearInterval(tm);
                res();
              }
            }, 200);
          });
        });
        break;
      case "eval": {
        const result = await page.evaluate(step.script);
        extra.result = result;
        break;
      }
      default:
        error = `unknown action: ${step.action}`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Auto-screenshot after each non-screenshot step unless suppressed.
  if (step.action !== "screenshot" && step.screenshot !== false && !error) {
    try {
      await page.screenshot({ path: stepFilename(slug, idx, step.action, step.name), fullPage: false });
    } catch {}
  }

  return {
    step: idx,
    action: step.action,
    selector: step.selector,
    name: step.name,
    duration_ms: Date.now() - start,
    error,
    url_after: page.url(),
    ...extra,
  };
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
  const engine = req.engine || "playwright";
  const collectVitals = req.collect_vitals !== false;
  const captures = Array.isArray(req.captures) ? req.captures : ["desktop", "mobile"];
  const steps = Array.isArray(req.steps) ? req.steps : [];
  const cookies = Array.isArray(req.cookies) ? req.cookies : null;
  const storageState = req.storage_state || null;
  const wantSaveStorage = req.save_storage_state === true || steps.length > 0;

  const startedAt = new Date().toISOString();
  let httpStatus = 0;
  let errorMsg = null;
  let challenged = false;
  let vitals = null;
  const stepLog = [];

  // Pick launcher
  let launcher = plainChromium;
  let launcherUsed = "playwright";
  if (engine === "stealth") {
    const s = await getStealthChromium();
    if (s) {
      launcher = s;
      launcherUsed = "stealth";
    } else {
      launcherUsed = "playwright (stealth requested but unavailable)";
    }
  }

  const browser = await launcher.launch({ headless: true });
  try {
    const contextOptions = {
      userAgent: ua,
      locale,
      timezoneId: timezone,
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: { "Accept-Language": acceptLanguage },
    };
    if (storageState) {
      // accept either inline object or path
      contextOptions.storageState = typeof storageState === "string" ? storageState : storageState;
    }

    const context = await browser.newContext(contextOptions);
    if (cookies) await context.addCookies(cookies);

    const page = await context.newPage();

    const navStart = Date.now();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    httpStatus = resp ? resp.status() : 0;

    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {}
    await page.waitForTimeout(2000);

    challenged = await pageLooksLikeChallenge(page);
    if (challenged) {
      await page.waitForTimeout(5000);
      challenged = await pageLooksLikeChallenge(page);
    }

    stepLog.push({
      step: 0,
      action: "goto",
      url,
      duration_ms: Date.now() - navStart,
      http_status: httpStatus,
      challenged,
    });

    if (collectVitals && !challenged) {
      vitals = await collectWebVitals(page);
    }

    // Initial snapshot (before steps run) — useful even when steps are present.
    if (steps.length > 0) {
      try {
        await page.screenshot({ path: join(outDir, "step-00-initial.png"), fullPage: false });
      } catch {}
    }

    // Run scenario steps.
    for (let i = 0; i < steps.length; i++) {
      const result = await runStep(page, steps[i], slug, i + 1);
      stepLog.push(result);
      if (result.error && steps[i].continue_on_error !== true) {
        errorMsg = errorMsg || `step ${i + 1} (${steps[i].action}) failed: ${result.error}`;
        break;
      }
    }

    // Final state — always saved as page.html + desktop screenshots.
    const html = await page.content();
    writeFileSync(join(outDir, "page.html"), html, "utf8");
    if (captures.includes("desktop")) {
      await page.screenshot({ path: join(outDir, "desktop-full.png"), fullPage: true });
      await page.screenshot({ path: join(outDir, "desktop-above-fold.png"), fullPage: false });
    }

    if (wantSaveStorage) {
      try {
        const ss = await context.storageState();
        writeFileSync(join(outDir, "storage_state.json"), JSON.stringify(ss, null, 2));
      } catch {}
    }

    // Mobile pass — only when no scenario steps. With steps, mobile would
    // need its own replay, which is a different feature.
    if (steps.length === 0 && captures.includes("mobile")) {
      const mobileContext = await browser.newContext({
        ...devices["iPhone 14"],
        locale,
        timezoneId: timezone,
        extraHTTPHeaders: { "Accept-Language": acceptLanguage },
      });
      if (cookies) await mobileContext.addCookies(cookies);
      const mobilePage = await mobileContext.newPage();
      try {
        await mobilePage.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        try {
          await mobilePage.waitForLoadState("networkidle", { timeout: 10000 });
        } catch {}
        await mobilePage.waitForTimeout(1500);
        await mobilePage.screenshot({ path: join(outDir, "mobile-full.png"), fullPage: true });
        await mobilePage.screenshot({ path: join(outDir, "mobile-above-fold.png"), fullPage: false });
      } catch (e) {
        console.warn(`[mobile] capture failed for ${slug}: ${e.message}`);
      }
      await mobileContext.close();
    }

    await context.close();
  } catch (e) {
    errorMsg = errorMsg || (e instanceof Error ? e.message : String(e));
    console.error(`[error] ${url}: ${errorMsg}`);
  } finally {
    await browser.close();
  }

  let sizeBytes = 0;
  try {
    sizeBytes = statSync(join(outDir, "page.html")).size;
  } catch {}

  const stepsFailed = stepLog.some((s) => s.error);
  const ok = httpStatus === 200 && sizeBytes > 1000 && !errorMsg && !challenged && !stepsFailed;

  writeFileSync(
    join(outDir, "status.json"),
    JSON.stringify(
      {
        url,
        slug,
        engine: launcherUsed,
        fetched_at: startedAt,
        http_status: httpStatus,
        size_bytes: sizeBytes,
        challenged,
        error: errorMsg,
        ok,
        vitals,
        steps: stepLog,
      },
      null,
      2,
    ),
  );

  console.log(
    `[done] ${slug}: http=${httpStatus} size=${sizeBytes} challenged=${challenged} steps=${stepLog.length} ok=${ok}`,
  );

  renameSync(reqPath, join(PROCESSED_DIR, basename(reqPath)));
}

async function processWithConcurrency(paths, limit) {
  const queue = [...paths];
  const inFlight = new Set();
  while (queue.length > 0 || inFlight.size > 0) {
    while (inFlight.size < limit && queue.length > 0) {
      const reqPath = queue.shift();
      const task = (async () => {
        let req;
        try {
          req = JSON.parse(readFileSync(reqPath, "utf8"));
        } catch {
          console.error(`[skip] ${reqPath}: invalid JSON`);
          renameSync(reqPath, join(PROCESSED_DIR, basename(reqPath)));
          return;
        }
        await fetchOne(req, reqPath);
      })();
      inFlight.add(task);
      task.finally(() => inFlight.delete(task));
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }
}

async function main() {
  mkdirSync(PROCESSED_DIR, { recursive: true });
  mkdirSync(SAMPLES_DIR, { recursive: true });

  const pending = readPendingRequests();
  if (pending.length === 0) {
    console.log("No pending requests.");
    return;
  }
  console.log(`Processing ${pending.length} request(s) with concurrency=${CONCURRENCY}`);
  await processWithConcurrency(pending, CONCURRENCY);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
