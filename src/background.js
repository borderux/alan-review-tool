chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  } catch (err) {
    // chrome://, the Web Store, and the PDF viewer refuse injection even with
    // activeTab — surface that instead of failing silently on click.
    console.error("Alan Review Tool: could not inject into this tab.", err);
    await chrome.action.setBadgeBackgroundColor({
      tabId: tab.id,
      color: "#d33",
    });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
  }
});

// Only the background/service-worker context can capture pixels - content
// scripts can't call this themselves, hence the round trip. The same
// activeTab grant that let the panel inject in the first place still covers
// this, as long as the tab hasn't navigated since.
//
// Caught explicitly and returned as { error } rather than left to reject:
// a rejected promise crossing the sendMessage channel is exactly the kind of
// failure that vanishes silently on the content-script side otherwise.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    message?.type !== "alan-review-tool:capture" ||
    sender.tab?.windowId == null
  )
    return;
  return chrome.tabs
    .captureVisibleTab(sender.tab.windowId, { format: "png" })
    .then((dataUrl) => ({ dataUrl }))
    .catch((err) => {
      console.error("Alan Review Tool: captureVisibleTab failed.", err);
      return { error: String(err) };
    });
});
