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
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#d33" });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
  }
});
