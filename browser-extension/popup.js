const bookingIdInput = document.querySelector("#bookingId");
const endpointInput = document.querySelector("#endpoint");
const importButton = document.querySelector("#importButton");
const statusBox = document.querySelector("#status");

chrome.storage.local.get(["bookingId", "endpoint"], (stored) => {
  bookingIdInput.value = stored.bookingId || "";
  endpointInput.value = stored.endpoint || "http://localhost:3000";
});

bookingIdInput.addEventListener("input", saveSettings);
endpointInput.addEventListener("input", saveSettings);
importButton.addEventListener("click", importCurrentPage);

function saveSettings() {
  chrome.storage.local.set({
    bookingId: bookingIdInput.value.trim(),
    endpoint: endpointInput.value.trim()
  });
}

async function importCurrentPage() {
  const bookingId = bookingIdInput.value.trim();
  const endpoint = endpointInput.value.trim().replace(/\/+$/, "");
  if (!bookingId) {
    setStatus("Booking ID is required.");
    return;
  }
  if (!endpoint.startsWith("http://localhost:") && !endpoint.startsWith("http://127.0.0.1:")) {
    setStatus("Use a local TripBuddy endpoint.");
    return;
  }

  importButton.disabled = true;
  setStatus("Reading current page...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab was found.");
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectTripBuddyPageEvidence
    });

    const evidence = injection?.result;
    if (!evidence) {
      throw new Error("No page evidence was returned.");
    }

    setStatus("Sending page evidence for TripBuddy parsing...");
    const response = await fetch(`${endpoint}/api/browser-evidence`, {
      body: JSON.stringify({
        ...evidence,
        bookingId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Import failed with status ${response.status}.`);
    }

    setStatus(`Imported ${result.candidatesImported} candidate rate${result.candidatesImported === 1 ? "" : "s"}.\nRun: ${result.runId}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Import failed.");
  } finally {
    importButton.disabled = false;
  }
}

function setStatus(message) {
  statusBox.textContent = message;
}

function collectTripBuddyPageEvidence() {
  const pageText = document.body?.innerText?.replace(/\s+/g, " ").trim() || "";
  const sourceUrl = location.href;

  return {
    candidates: [],
    capturedAt: new Date().toISOString(),
    hotelGroup: location.hostname.includes("hyatt.com") ? "Hyatt" : null,
    pageText,
    pageTitle: document.title,
    sourceUrl
  };

  function parseHyattCandidates(text, url) {
    const output = [];
    const nights = parseStayNights(url);
    const finalTotal = extractFinalTotal(text);
    const finalTaxes = extractTaxesAndFees(text);
    if (finalTotal) {
      output.push({
        cancellationPolicyRaw: extractPolicyText(text),
        currency: finalTotal.currency,
        inventoryType: "cash",
        roomTypeRaw: extractRoomName(text),
        taxes: finalTaxes?.currency === finalTotal.currency ? finalTaxes.amount : null,
        taxesIncluded: true,
        totalPrice: finalTotal.amount
      });
    }

    if (!finalTotal) {
      for (const rate of extractNightlyRates(text)) {
        output.push({
          basePrice: rate.amount,
          cancellationPolicyRaw: extractPolicyText(rate.context),
          currency: rate.currency,
          inventoryType: "cash",
          ratePlanName: extractRateName(rate.context),
          roomTypeRaw: extractRoomName(rate.context),
          taxesIncluded: false,
          totalPrice: rate.amount * nights
        });
      }
    }

    for (const award of extractAwardRates(text)) {
      output.push({
        cancellationPolicyRaw: extractPolicyText(award.context),
        currency: finalTotal?.currency || "USD",
        inventoryType: "award",
        pointsPrice: award.points,
        ratePlanName: extractRateName(award.context),
        roomTypeRaw: extractRoomName(award.context),
        taxesIncluded: false,
        totalPrice: 0
      });
    }

    return dedupe(output).slice(0, 12);
  }

  function parseStayNights(url) {
    try {
      const parsed = new URL(url);
      const checkIn = parsed.searchParams.get("checkinDate");
      const checkOut = parsed.searchParams.get("checkoutDate");
      if (!checkIn || !checkOut) {
        return 1;
      }
      const nights = Math.round((new Date(`${checkOut}T00:00:00.000Z`) - new Date(`${checkIn}T00:00:00.000Z`)) / 86400000);
      return nights > 0 ? nights : 1;
    } catch {
      return 1;
    }
  }

  function extractFinalTotal(text) {
    const currencyPattern = "MYR|RM|USD|JPY|SGD|HKD|EUR|GBP|THB|KRW|CNY";
    const patterns = [
      new RegExp(`(?:Total Cash|Stay Total|Total for Stay|Grand Total|Amount Due|Total Including Taxes[^A-Z]{0,20})\\s*(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)`, "i"),
      new RegExp(`(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)\\s*(?:Total Cash|Stay Total|Total for Stay|Grand Total|Amount Due)`, "i")
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return { amount: parseAmount(match[2]), currency: normalizeCurrency(match[1]) };
      }
    }
    return null;
  }

  function extractTaxesAndFees(text) {
    const match = text.match(/(?:Taxes? (?:&|and) Fees?|Fees? (?:&|and) Taxes?)\s*(MYR|RM|USD|JPY|SGD|HKD|EUR|GBP|THB|KRW|CNY)\s*([0-9][0-9,]*(?:\.\d{2})?)/i);
    return match ? { amount: parseAmount(match[2]), currency: normalizeCurrency(match[1]) } : null;
  }

  function extractNightlyRates(text) {
    const pattern = /(MYR|RM|USD|JPY|SGD|HKD|EUR|GBP|THB|KRW|CNY)\s*([0-9][0-9,]*(?:\.\d{2})?)\s*(?:Avg\s*\/\s*Night|Average\s*\/\s*Night|per\s*night|\/\s*night)/gi;
    const rates = [];
    for (const match of text.matchAll(pattern)) {
      const index = match.index || 0;
      rates.push({
        amount: parseAmount(match[2]),
        context: text.slice(Math.max(0, index - 700), Math.min(text.length, index + 900)),
        currency: normalizeCurrency(match[1])
      });
    }
    return rates;
  }

  function extractAwardRates(text) {
    const rates = [];
    for (const match of text.matchAll(/([0-9][0-9,]{3,8})\s*(?:points|pts)(?:\s*(?:Avg\s*\/\s*Night|point\s*\/\s*night|points\s*\/\s*night|pts\s*\/\s*night))?/gi)) {
      const index = match.index || 0;
      rates.push({
        context: text.slice(Math.max(0, index - 700), Math.min(text.length, index + 900)),
        points: Math.round(parseAmount(match[1]))
      });
    }
    return rates;
  }

  function extractRoomName(text) {
    const patterns = [
      /(?:Room|Suite)\s+([A-Z][A-Za-z0-9 ,/-]{4,90})/,
      /([A-Z][A-Za-z0-9 ,/-]{4,90}(?:Room|Suite|King|Queen|Twin|Bed))/,
      /(Standard [A-Za-z0-9 ,/-]{3,80})/
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return cleanLabel(match[1]);
      }
    }
    return "Hyatt room";
  }

  function extractRateName(text) {
    const patterns = [/(Member Rate[^.]{0,80})/i, /(Standard Rate[^.]{0,80})/i, /(Advance Purchase[^.]{0,80})/i, /(Flexible Rate[^.]{0,80})/i];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return cleanLabel(match[1]);
      }
    }
    return null;
  }

  function extractPolicyText(text) {
    const match = text.match(/((?:Cancellation|Cancel|Deposit|Refund)[^.]{0,260})/i);
    return match ? cleanLabel(match[1]) : "Policy not captured";
  }

  function cleanLabel(value) {
    return value.replace(/\s+/g, " ").replace(/\s+\|.*$/, "").trim().slice(0, 180);
  }

  function parseAmount(value) {
    return Number(String(value).replace(/,/g, ""));
  }

  function normalizeCurrency(value) {
    const normalized = String(value || "").toUpperCase();
    return normalized === "RM" ? "MYR" : normalized;
  }

  function dedupe(candidates) {
    const seen = new Set();
    const output = [];
    for (const candidate of candidates) {
      const key = [candidate.inventoryType || "cash", candidate.currency, candidate.totalPrice || "", candidate.pointsPrice || "", candidate.basePrice || "", candidate.roomTypeRaw || ""].join("|");
      if (!seen.has(key)) {
        seen.add(key);
        output.push(candidate);
      }
    }
    return output;
  }
}
