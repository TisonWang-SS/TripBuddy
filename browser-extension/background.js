chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "tripbuddy:browser-request") {
    return false;
  }
  runBrowserRequest(message, sender)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({
      body: { error: error instanceof Error ? error.message : "Browser Companion request failed." },
      ok: false,
      status: 0
    }));
  return true;
});

async function runBrowserRequest(message, sender) {
  if (!sender.tab?.url || !/^https:\/\/(?:www\.)?hyatt\.com\//i.test(sender.tab.url)) {
    throw new Error("Browser task requests are accepted only from a Hyatt task tab.");
  }
  const endpoint = localEndpoint(message.endpoint);
  const taskId = String(message.taskId ?? "").trim();
  if (!/^[A-Za-z0-9-]{8,100}$/.test(taskId)) {
    throw new Error("Browser task identifier is invalid.");
  }
  const method = message.method === "POST" ? "POST" : "GET";
  const response = await fetch(`${endpoint}/api/browser-tasks/${encodeURIComponent(taskId)}`, {
    ...(method === "POST" ? {
      body: JSON.stringify(message.payload ?? {}),
      headers: { "Content-Type": "application/json" }
    } : { cache: "no-store" }),
    method
  });
  const body = await response.json().catch(() => ({ error: `TripBuddy returned ${response.status}.` }));
  return { body, ok: response.ok, status: response.status };
}

function localEndpoint(value) {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "http:" || (url.hostname !== "localhost" && url.hostname !== "127.0.0.1")) {
    throw new Error("TripBuddy endpoint must be a local HTTP origin.");
  }
  return url.origin;
}
