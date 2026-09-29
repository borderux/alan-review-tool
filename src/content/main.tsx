// Entry point, re-run from scratch on every toolbar click. If a panel is
// already open this click closes it; otherwise it opens one.
import { mountPanel } from "./mount";
import {
  CLOSE_EVENT,
  HOST_ID,
  LEGACY_HOST_ID,
  restoreLegacyPage,
  restorePage,
} from "./lib/page";

void (async () => {
  // A panel left open by the version before the rename to Tagger: close it
  // like its own second click would have, and stop there.
  const legacy = document.getElementById(LEGACY_HOST_ID);
  if (legacy) {
    legacy.remove();
    restoreLegacyPage();
    return;
  }
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    // The script instance that owns the open panel listens for this and
    // calls preventDefault(), then saves and closes the panel itself. If
    // nothing answers (the owning instance is gone - for example the
    // extension was reloaded), fall back to removing it directly.
    const event = new CustomEvent(CLOSE_EVENT, { cancelable: true });
    existing.dispatchEvent(event);
    if (!event.defaultPrevented) {
      existing.remove();
      restorePage();
    }
    return;
  }
  await mountPanel();
})();
