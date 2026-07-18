// sidepanel-open.js — opens the Tama dashboard side panel.
// Deliberately separate from popup.js so the popup and the dashboard can be
// edited independently. sidePanel.open() needs a user gesture; a click in the
// popup counts as one.
const btn = document.getElementById("openPanel");
if (btn) {
  btn.onclick = async () => {
    try {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
      window.close();
    } catch (e) {
      console.error("[tama] side panel open failed", e);
    }
  };
}
