document.getElementById("toggleOverlay").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: () => {
      window.dispatchEvent(new CustomEvent("toggle-extension-overlay"));
    }
  });
});
