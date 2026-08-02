const importButton = document.querySelector("#importButton");
const statusBox = document.querySelector("#status");

importButton.addEventListener("click", retryCurrentTask);

async function retryCurrentTask() {
  importButton.disabled = true;
  statusBox.textContent = "Contacting the current Hyatt tab...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/https:\/\/(?:www\.)?hyatt\.com\//i.test(tab.url || "")) {
      throw new Error("Open the Hyatt tab launched by TripBuddy first.");
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "tripbuddy:import-current-task" });
    if (!response?.ok) {
      throw new Error(response?.error || "The current tab has no active TripBuddy task.");
    }
    const result = response.result;
    statusBox.textContent = result?.errorMessage || `Task status: ${result?.status || "running"}.`;
  } catch (error) {
    statusBox.textContent = error instanceof Error ? error.message : "The task could not be retried.";
  } finally {
    importButton.disabled = false;
  }
}
