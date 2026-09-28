import { Group, Text } from "@recursica/adapter-mantine-v8";

const LOGO_URL = chrome.runtime.getURL("alan-logo.png");

// The panel header's title, which is also the panel's accessible name.
export function PanelTitle() {
  return (
    <Group gap="rec-sm" wrap="nowrap">
      {/* Decorative: the title text beside it names the panel. */}
      <img src={LOGO_URL} alt="" className="art-logo" />
      <span>ALAN Review Tool</span>
      <Text component="span" variant="caption" emphasis="low">
        v{__APP_VERSION__}
      </Text>
    </Group>
  );
}
