import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildHyattCitySearchUrl,
  parseHyattCitySearchCards,
  type HyattCitySearchQuery,
  type HyattCitySearchRun
} from "@/lib/hyattCitySearch";

const execFileAsync = promisify(execFile);

export type ChromeProfileConfig = {
  profileName: string;
  profileDirectory?: string | null;
  userDataDir?: string | null;
  debugPort: number;
};

export type ExtractedPageText = {
  text: string;
  title: string;
  url: string;
};

export type RateDetailExtraction = {
  detail: ExtractedPageText | null;
  detailSelection: {
    amount: number | null;
    clicked: boolean;
    reason: string | null;
    snippet: string | null;
  } | null;
  list: ExtractedPageText;
  selectedRate: {
    amount: number | null;
    clicked: boolean;
    reason: string | null;
    snippet: string | null;
  };
};

export type PageReadinessDiagnostics = {
  htmlSample: string;
  textLength: number;
  title: string;
  url: string;
};

type HyattCitySearchPageSnapshot = {
  pageText: string;
  title: string;
  url: string;
};

type ChromeTarget = {
  id: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl: string;
};

type CdpResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

export function chromeLocalStatePath() {
  return path.join(homedir(), "Library", "Application Support", "Google", "Chrome", "Local State");
}

export function standardChromeUserDataDir() {
  return path.dirname(chromeLocalStatePath());
}

export function defaultChromeUserDataDir() {
  return path.join(process.cwd(), "data", "chrome-cdp-profile");
}

export function normalizeDebugPort(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isInteger(value) && value >= 0 && value < 65536 ? value : 0;
}

export async function resolveChromeProfileDirectory(profileName: string, localStatePath = chromeLocalStatePath()) {
  const raw = await readFile(localStatePath, "utf8");
  const localState = JSON.parse(raw) as {
    profile?: {
      info_cache?: Record<string, { name?: string }>;
    };
  };
  const infoCache = localState.profile?.info_cache ?? {};
  const profile = Object.entries(infoCache).find(([directory, info]) => {
    return info.name === profileName || directory === profileName;
  });

  return profile?.[0] ?? null;
}

async function chromeDebugEndpoint(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { webSocketDebuggerUrl?: string };
    return data.webSocketDebuggerUrl ? `http://127.0.0.1:${port}` : null;
  } catch {
    return null;
  }
}

async function waitForChromeDebugEndpoint(port: number, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const endpoint = await chromeDebugEndpoint(port);
    if (endpoint) {
      return endpoint;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

async function waitForDynamicChromeDebugEndpoint(userDataDir: string, timeoutMs: number) {
  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const raw = await readFile(activePortPath, "utf8");
      const [portText] = raw.trim().split(/\r?\n/);
      const port = Number(portText);
      if (Number.isInteger(port) && port > 0) {
        const endpoint = await chromeDebugEndpoint(port);
        if (endpoint) {
          return endpoint;
        }
      }
    } catch {
      // Chrome creates this file after the debugging endpoint starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

async function activePortChromeDebugEndpoint(userDataDir: string) {
  try {
    const raw = await readFile(path.join(userDataDir, "DevToolsActivePort"), "utf8");
    const [portText] = raw.trim().split(/\r?\n/);
    const port = Number(portText);
    return Number.isInteger(port) && port > 0 ? await chromeDebugEndpoint(port) : null;
  } catch {
    return null;
  }
}

export async function ensureChromeDebugEndpoint(config: ChromeProfileConfig) {
  const port = normalizeDebugPort(config.debugPort);
  if (port > 0) {
    const existingEndpoint = await chromeDebugEndpoint(port);
    if (existingEndpoint) {
      return existingEndpoint;
    }
  }

  const userDataDir = config.userDataDir || defaultChromeUserDataDir();
  if (port === 0) {
    const existingDynamicEndpoint = await activePortChromeDebugEndpoint(userDataDir);
    if (existingDynamicEndpoint) {
      return existingDynamicEndpoint;
    }
    await unlink(path.join(userDataDir, "DevToolsActivePort")).catch(() => undefined);
  }

  const args = [
    "-na",
    "Google Chrome",
    "--args",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check"
  ];

  if (config.profileDirectory) {
    args.push(`--profile-directory=${config.profileDirectory}`);
  }

  args.push("about:blank");
  await execFileAsync("open", args);

  const endpoint = port > 0 ? await waitForChromeDebugEndpoint(port, 15000) : await waitForDynamicChromeDebugEndpoint(userDataDir, 15000);
  if (!endpoint) {
    throw new Error(port > 0 ? `Chrome debugging endpoint did not start on port ${port}.` : "Chrome debugging endpoint did not start on an automatic port.");
  }

  return endpoint;
}

async function listChromeTargets(endpoint: string) {
  const response = await fetch(`${endpoint}/json/list`, { cache: "no-store" });
  if (!response.ok) {
    return [];
  }

  const targets = (await response.json()) as Partial<ChromeTarget>[];
  return targets.filter((target): target is ChromeTarget => Boolean(target.id && target.webSocketDebuggerUrl));
}

async function createChromeTarget(endpoint: string, url = "about:blank") {
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) {
    throw new Error(`Chrome target creation failed with status ${response.status}.`);
  }

  const target = (await response.json()) as Partial<ChromeTarget>;
  if (!target.id || !target.webSocketDebuggerUrl) {
    throw new Error("Chrome target did not expose a debugging websocket.");
  }

  return target as ChromeTarget;
}

async function getOrCreateChromeTarget(endpoint: string) {
  const targets = await listChromeTargets(endpoint);
  const reusableBlankTarget = targets.find((target) => {
    const targetUrl = target.url ?? "";
    return target.type === "page" && (targetUrl === "" || targetUrl === "about:blank" || targetUrl === "chrome://newtab/");
  });

  return reusableBlankTarget ?? (await createChromeTarget(endpoint));
}

async function closeChromeTarget(endpoint: string, targetId: string) {
  await fetch(`${endpoint}/json/close/${targetId}`).catch(() => undefined);
}

class CdpPageClient {
  private nextId = 1;
  private pending = new Map<number, { reject: (reason?: unknown) => void; resolve: (value: unknown) => void }>();

  constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpResponse;
      if (!message.id) {
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "Chrome DevTools Protocol command failed."));
      } else {
        pending.resolve(message.result);
      }
    });

    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Chrome DevTools Protocol socket closed."));
      }
      this.pending.clear();
    });
  }

  static connect(url: string) {
    return new Promise<CdpPageClient>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new CdpPageClient(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error("Chrome DevTools Protocol socket failed.")), { once: true });
    });
  }

  send(method: string, params?: Record<string, unknown>) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params: params ?? {} });
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(payload);
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForReadablePage(client: CdpPageClient, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = (await client.send("Runtime.evaluate", {
      expression:
        "(() => { const text = document.body?.innerText?.replace(/\\s+/g, ' ').trim() ?? ''; return { readyState: document.readyState, textLength: text.length, hasRateSignal: /Avg\\/Night|Select & Book|[0-9][0-9,]{3,7}\\s*(?:points?|pts)|(?:MYR|USD|JPY|SGD|HKD|EUR|GBP|THB|KRW)\\s+[0-9][0-9,]{1,8}\\s+Avg\\/Night/i.test(text) }; })()",
      returnByValue: true
    })) as { result?: { value?: { hasRateSignal?: boolean; readyState?: string; textLength?: number } } };

    const value = result.result?.value;
    if (
      (value?.readyState === "interactive" || value?.readyState === "complete") &&
      (value.textLength ?? 0) > 1000 &&
      value.hasRateSignal
    ) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function readPageText(client: CdpPageClient) {
  const result = (await client.send("Runtime.evaluate", {
    expression:
      "JSON.stringify({ text: document.body?.innerText ?? '', title: document.title, url: location.href })",
    returnByValue: true
  })) as { result?: { value?: string } };

  const value = result.result?.value;
  if (!value) {
    throw new Error("Chrome page text extraction returned no value.");
  }

  return JSON.parse(value) as ExtractedPageText;
}

async function collectHyattCitySearchSnapshot(client: CdpPageClient): Promise<HyattCitySearchPageSnapshot> {
  const result = (await client.send("Runtime.evaluate", {
    expression: `(async () => {
      await scrollResults();
      return JSON.stringify({
        pageText: document.body?.innerText?.replace(/\\s+/g, ' ').trim() || '',
        title: document.title,
        url: location.href
      });

      async function scrollResults() {
        let previousHeight = 0;
        for (let index = 0; index < 8; index += 1) {
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise((resolve) => setTimeout(resolve, 900));
          const currentHeight = document.body.scrollHeight;
          if (currentHeight === previousHeight) {
            break;
          }
          previousHeight = currentHeight;
        }
        window.scrollTo(0, 0);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })) as { result?: { value?: string } };

  const value = result.result?.value;
  if (!value) {
    return { pageText: "", title: "", url: "" };
  }

  return JSON.parse(value) as HyattCitySearchPageSnapshot;
}

async function selectHyattCitySearchCurrency(client: CdpPageClient, currency: string) {
  const result = (await client.send("Runtime.evaluate", {
    expression: `(async () => {
      const requestedCurrency = ${JSON.stringify(currency)};
      const selects = Array.from(document.querySelectorAll('select')).filter((select) =>
        /currency/i.test(select.innerText || select.textContent || '')
      );
      const select = selects.find((candidate) =>
        Array.from(candidate.options).some((option) => option.value.toUpperCase() === requestedCurrency)
      );
      if (!select) {
        return { changed: false, found: false };
      }
      const option = Array.from(select.options).find((candidate) => candidate.value.toUpperCase() === requestedCurrency);
      if (!option) {
        return { changed: false, found: false };
      }
      if (select.value.toUpperCase() === requestedCurrency) {
        await waitForRequestedCurrencyText();
        return { changed: false, found: true };
      }
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await waitForRequestedCurrencyText();
      return { changed: true, found: true };

      async function waitForRequestedCurrencyText() {
        const tokenPattern = currencyPattern(requestedCurrency);
        const startedAt = Date.now();
        while (Date.now() - startedAt < 10000) {
          const text = document.body?.innerText || '';
          if (tokenPattern.test(text)) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }

      function currencyPattern(code) {
        const symbols = {
          AUD: 'A\\\\$',
          CAD: 'CA\\\\$',
          CNY: 'CNY|RMB|¥|￥',
          EUR: 'EUR|€',
          GBP: 'GBP|£',
          HKD: 'HK\\\\$',
          JPY: 'JPY|¥|￥',
          KRW: 'KRW|₩',
          MYR: 'MYR|RM',
          SGD: 'S\\\\$',
          THB: 'THB|฿',
          USD: 'US\\\\$|USD|\\\\$'
        };
        return new RegExp('(?:' + (symbols[code] || code) + ')\\\\s?[0-9][0-9,]{1,8}\\\\s*(?:Avg\\\\s*\\\\/\\\\s*Night|Average\\\\s*\\\\/\\\\s*Night|per\\\\s*night|\\\\/\\\\s*night)', 'i');
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })) as { result?: { value?: { changed?: boolean; found?: boolean } } };

  return Boolean(result.result?.value?.found);
}

async function waitForHyattCitySearchPage(client: CdpPageClient, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = (await client.send("Runtime.evaluate", {
      expression:
        "(() => { const text = document.body?.innerText?.replace(/\\s+/g, ' ').trim() ?? ''; return { isNotFound: /Page Not Found|link you followed may be broken/i.test(text), length: text.length, hasHotelSignal: /Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|Hyatt|Andaz|Alila|Thompson|Dream/i.test(text), title: document.title, url: location.href }; })()",
      returnByValue: true
    })) as { result?: { value?: { hasHotelSignal?: boolean; isNotFound?: boolean; length?: number } } };

    const value = result.result?.value;
    if ((value?.length ?? 0) > 500 && value?.hasHotelSignal && !value.isNotFound) {
      return true;
    }
    if (value?.isNotFound) {
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  return false;
}

async function readPageReadinessDiagnostics(client: CdpPageClient) {
  const result = (await client.send("Runtime.evaluate", {
    expression:
      "JSON.stringify({ htmlSample: document.documentElement?.outerHTML?.slice(0, 500) ?? '', textLength: document.body?.innerText?.length ?? 0, title: document.title, url: location.href })",
    returnByValue: true
  })) as { result?: { value?: string } };

  const value = result.result?.value;
  if (!value) {
    return {
      htmlSample: "",
      textLength: 0,
      title: "",
      url: ""
    };
  }

  return JSON.parse(value) as PageReadinessDiagnostics;
}

export function isEmptyHyattDocument(diagnostics: PageReadinessDiagnostics) {
  const normalizedHtml = diagnostics.htmlSample.replace(/\s+/g, "").toLowerCase();
  return (
    diagnostics.url.includes("hyatt.com") &&
    diagnostics.textLength === 0 &&
    diagnostics.title === "" &&
    (normalizedHtml === "<html><head></head><body></body></html>" || normalizedHtml.startsWith("<html><head></head><body></body>"))
  );
}

async function createUnreadablePageError(client: CdpPageClient) {
  const diagnostics = await readPageReadinessDiagnostics(client);
  if (isEmptyHyattDocument(diagnostics)) {
    return new Error("Hyatt returned an empty document to the Chrome profile automation session. This is likely an automation block, not a valid no-rate result.");
  }

  return new Error("Chrome page did not expose readable hotel rates.");
}

function hasFinalTotalSignal(text: string) {
  return /(?:grand total|amount due|due now|due at hotel|stay total|total for stay|total including|taxes and fees)/i.test(text);
}

async function waitForTextPattern(client: CdpPageClient, patternSource: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = (await client.send("Runtime.evaluate", {
      expression: `(() => { const text = document.body?.innerText?.replace(/\\s+/g, ' ').trim() ?? ''; return { length: text.length, matched: new RegExp(${JSON.stringify(patternSource)}, 'i').test(text), url: location.href }; })()`,
      returnByValue: true
    })) as { result?: { value?: { length?: number; matched?: boolean; url?: string } } };

    const value = result.result?.value;
    if ((value?.length ?? 0) > 1000 && value?.matched) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function currentPageSignature(client: CdpPageClient) {
  const result = (await client.send("Runtime.evaluate", {
    expression:
      "(() => { const text = document.body?.innerText?.replace(/\\s+/g, ' ').trim() ?? ''; return { url: location.href, length: text.length, sample: text.slice(0, 5000) }; })()",
    returnByValue: true
  })) as { result?: { value?: { length?: number; sample?: string; url?: string } } };

  return {
    length: result.result?.value?.length ?? 0,
    sample: result.result?.value?.sample ?? "",
    url: result.result?.value?.url ?? ""
  };
}

async function waitForPageChange(client: CdpPageClient, previous: { length: number; sample: string; url: string }, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await currentPageSignature(client);
    const textChanged = current.sample !== previous.sample || Math.abs(current.length - previous.length) > 300;
    if (current.url !== previous.url || textChanged) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function clickLowestVisibleRate(client: CdpPageClient) {
  const candidateResult = (await client.send("Runtime.evaluate", {
    expression: `(() => {
      const amountPattern = /(?:MYR|USD|JPY|SGD|HKD|EUR|GBP|THB|KRW|RM|\\$|€|£|¥|฿|₩)\\s?([0-9][0-9,]{1,8})(?:\\.\\d{2})?\\s*Avg\\/Night/i;
      const controls = Array.from(document.querySelectorAll('button,a,[role="button"]'))
        .filter((element) => {
          const label = (element.textContent || '').replace(/\\s+/g, ' ').trim();
          return /^(select|select\\s*&\\s*book|book)$/i.test(label) && !/(payment|pay|confirm|purchase|place order|complete reservation|book now)/i.test(label);
        });
      const candidates = controls.map((control) => {
        let container = control;
        let bestText = '';
        for (let i = 0; i < 8 && container; i += 1) {
          const text = container.innerText || container.textContent || '';
          if (amountPattern.test(text)) {
            bestText = text.replace(/\\s+/g, ' ').trim();
            break;
          }
          container = container.parentElement;
        }
        const match = bestText.match(amountPattern);
        return match ? { control, amount: Number(match[1].replace(/,/g, '')), text: bestText } : null;
      }).filter(Boolean).sort((a, b) => a.amount - b.amount);

      if (candidates.length === 0) {
        const pageText = document.body?.innerText?.replace(/\\s+/g, ' ').trim() || '';
        const isRateSelectionPage = /Choose Your Rate/i.test(pageText) && !/(payment|pay now|confirm|purchase|place order|complete reservation)/i.test(pageText);
        const fallbackBook = controls.find((control) => /^(book)$/i.test((control.textContent || '').replace(/\\s+/g, ' ').trim()));
        if (!isRateSelectionPage || !fallbackBook) {
          return { clicked: false, reason: 'No safe rate-selection control was found.' };
        }
        fallbackBook.scrollIntoView({ block: 'center' });
        const rect = fallbackBook.getBoundingClientRect();
        return {
          amount: null,
          clicked: true,
          reason: null,
          snippet: pageText.slice(0, 500),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2)
        };
      }

      const selected = candidates[0];
      selected.control.scrollIntoView({ block: 'center' });
      const rect = selected.control.getBoundingClientRect();
      return {
        amount: selected.amount,
        clicked: true,
        reason: null,
        snippet: selected.text.slice(0, 500),
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };
    })()`,
    returnByValue: true
  })) as {
    result?: { value?: { amount?: number; clicked?: boolean; reason?: string | null; snippet?: string | null; x?: number; y?: number } };
  };

  const candidate = candidateResult.result?.value;
  if (!candidate?.clicked || candidate.x === undefined || candidate.y === undefined) {
    return {
      amount: candidate?.amount ?? null,
      clicked: false,
      reason: candidate?.reason ?? "No clickable rate coordinates were found.",
      snippet: candidate?.snippet ?? null
    };
  }

  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: candidate.x, y: candidate.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: candidate.x, y: candidate.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: candidate.x, y: candidate.y, button: "left", clickCount: 1 });

  return {
    amount: candidate.amount ?? null,
    clicked: true,
    reason: null,
    snippet: candidate.snippet ?? null
  };
}

async function clickHyattRatePageBook(client: CdpPageClient) {
  const candidateResult = (await client.send("Runtime.evaluate", {
    expression: `(() => {
      const pageText = document.body?.innerText?.replace(/\\s+/g, ' ').trim() || '';
      const isRateSelectionPage = /Choose Your Rate/i.test(pageText) && /Cancellation Policy|Deposit Policy/i.test(pageText);
      if (!isRateSelectionPage || /(payment|pay now|confirm|purchase|place order|complete reservation)/i.test(pageText)) {
        return { clicked: false, reason: 'Current page is not a safe Hyatt rate selection page.' };
      }

      const visibleElements = Array.from(document.querySelectorAll('button,a,[role="button"],div,span'))
        .filter((element) => {
          const label = (element.textContent || '').replace(/\\s+/g, ' ').trim();
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return /^BOOK(?:\\s|$)/i.test(label) && rect.width > 20 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none';
        })
        .map((element) => {
          let container = element;
          let context = '';
          for (let i = 0; i < 8 && container; i += 1) {
            const text = (container.innerText || container.textContent || '').replace(/\\s+/g, ' ').trim();
            if (/Cancellation Policy|Deposit Policy|Avg\\/Night|Rate/i.test(text)) {
              context = text;
              break;
            }
            container = container.parentElement;
          }
          const rect = element.getBoundingClientRect();
          return { element, context, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        })
        .filter((candidate) => /Cancellation Policy|Deposit Policy|Avg\\/Night|Rate/i.test(candidate.context))
        .sort((a, b) => a.y - b.y);

      const selected = visibleElements[0];
      if (!selected) {
        const debugLabels = Array.from(document.querySelectorAll('button,a,[role="button"],div,span'))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              aria: element.getAttribute('aria-label') || '',
              role: element.getAttribute('role') || '',
              tag: element.tagName,
              text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
              visible: rect.width > 0 && rect.height > 0,
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2)
            };
          })
          .filter((item) => item.visible && /book|select|rate|policy/i.test(item.text + ' ' + item.aria + ' ' + item.role))
          .slice(0, 30);
        return {
          clicked: false,
          reason: 'No safe Hyatt BOOK control was found on the rate page.',
          snippet: JSON.stringify(debugLabels).slice(0, 1500)
        };
      }

      selected.element.scrollIntoView({ block: 'center' });
      const rect = selected.element.getBoundingClientRect();
      return {
        amount: null,
        clicked: true,
        reason: null,
        snippet: selected.context.slice(0, 500),
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };
    })()`,
    returnByValue: true
  })) as {
    result?: { value?: { amount?: number; clicked?: boolean; reason?: string | null; snippet?: string | null; x?: number; y?: number } };
  };

  const candidate = candidateResult.result?.value;
  if (!candidate?.clicked || candidate.x === undefined || candidate.y === undefined) {
    return {
      amount: null,
      clicked: false,
      reason: candidate?.reason ?? "No clickable Hyatt rate-page book coordinates were found.",
      snippet: candidate?.snippet ?? null
    };
  }

  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: candidate.x, y: candidate.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: candidate.x, y: candidate.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: candidate.x, y: candidate.y, button: "left", clickCount: 1 });

  return {
    amount: null,
    clicked: true,
    reason: null,
    snippet: candidate.snippet ?? null
  };
}

export async function extractTextWithChromeProfile(url: string, config: ChromeProfileConfig): Promise<ExtractedPageText> {
  const endpoint = await ensureChromeDebugEndpoint(config);
  const target = await getOrCreateChromeTarget(endpoint);
  const client = await CdpPageClient.connect(target.webSocketDebuggerUrl);

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.navigate", { url });
    if (!(await waitForReadablePage(client, 20000))) {
      await client.send("Page.navigate", { url });
      if (!(await waitForReadablePage(client, 20000))) {
        throw await createUnreadablePageError(client);
      }
    }
    return await readPageText(client);
  } finally {
    client.close();
    await closeChromeTarget(endpoint, target.id);
  }
}

export async function extractRateDetailWithChromeProfile(url: string, config: ChromeProfileConfig): Promise<RateDetailExtraction> {
  const endpoint = await ensureChromeDebugEndpoint(config);
  const target = await getOrCreateChromeTarget(endpoint);
  const client = await CdpPageClient.connect(target.webSocketDebuggerUrl);

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.navigate", { url });
    if (!(await waitForReadablePage(client, 20000))) {
      await client.send("Page.navigate", { url });
      if (!(await waitForReadablePage(client, 20000))) {
        throw await createUnreadablePageError(client);
      }
    }
    const list = await readPageText(client);
    const listSignature = await currentPageSignature(client);
    let selectedRate = await clickLowestVisibleRate(client);
    if (!selectedRate.clicked) {
      return { detail: null, detailSelection: null, list, selectedRate };
    }

    await waitForPageChange(client, listSignature, 20000);
    await waitForTextPattern(client, "total|tax|fee|due|summary|checkout|payment|cancellation policy|deposit policy", 15000);
    let detail = await readPageText(client);
    let detailSelection: RateDetailExtraction["detailSelection"] = null;
    if (!hasFinalTotalSignal(detail.text)) {
      const detailSignature = await currentPageSignature(client);
      const secondSelection = await clickHyattRatePageBook(client);
      detailSelection = secondSelection;
      if (secondSelection.clicked) {
        await waitForPageChange(client, detailSignature, 20000);
        await waitForTextPattern(client, "price summary|total cash|contact information|payment information|taxes|fees", 30000);
        detail = await readPageText(client);
      }
    }

    return { detail, detailSelection, list, selectedRate };
  } finally {
    client.close();
    await closeChromeTarget(endpoint, target.id);
  }
}

export async function searchHyattCityRatesWithChromeProfile(
  query: HyattCitySearchQuery,
  config: ChromeProfileConfig
): Promise<HyattCitySearchRun> {
  const endpoint = await ensureChromeDebugEndpoint(config);
  const target = await getOrCreateChromeTarget(endpoint);
  const client = await CdpPageClient.connect(target.webSocketDebuggerUrl);
  const searchUrl = buildHyattCitySearchUrl(query);

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.navigate", { url: searchUrl });
    const ready = await waitForHyattCitySearchPage(client, 45000);
    const requestedCurrencyFound = ready ? await selectHyattCitySearchCurrency(client, query.currency) : false;
    const snapshot = ready ? await collectHyattCitySearchSnapshot(client) : { pageText: "", title: "", url: searchUrl };
    const results = parseHyattCitySearchCards([snapshot.pageText].filter(Boolean), snapshot.url || searchUrl);

    return {
      capturedAt: new Date(),
      results,
      searchUrl,
      status: results.length > 0 ? "succeeded" : ready ? "partial" : "failed",
      summary:
        results.length > 0
          ? `Hyatt official search returned ${results.length} visible hotel rate${results.length === 1 ? "" : "s"}.`
          : ready
            ? "Hyatt opened, but no visible Avg/Night hotel results were found."
            : "Hyatt did not expose a readable city-search result page.",
      warning:
        results.length > 0 && !requestedCurrencyFound
          ? `Hyatt did not expose a selectable ${query.currency} currency control; returned the currency shown by Hyatt.`
          : results.length > 0
          ? null
          : "Hyatt may have changed the search page structure, blocked automated extraction, or returned no available hotels for these dates."
    };
  } finally {
    client.close();
    await closeChromeTarget(endpoint, target.id);
  }
}
