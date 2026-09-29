import { Heading, Stack, Text } from "@recursica/adapter-mantine-v8";

// Short how-to, with the version at the bottom.
export function HelpTab() {
  return (
    // Line length: at the panel's widest (720px) body text would run to
    // about 95 characters. 560px holds it near 70, inside the readable
    // range.
    <Stack gap="rec-default" mt="rec-default" maw={560}>
      <Heading order={3}>How to use Tagger</Heading>
      <Stack component="ul" className="art-bullets" gap="rec-sm">
        <Text component="li">
          Type in New comment and press Enter to add it. Each comment gets a
          number, like CM-3.
        </Text>
        <Text component="li">
          Add screenshot lets you drag a box on the page. Escape cancels.
        </Text>
        <Text component="li">
          Add annotations lets you draw on a screenshot in a color you pick.
          Save annotations keeps the drawing.
        </Text>
        <Text component="li">
          Comments on every page and site go into one session. The
          reviewer&apos;s name, email and session details go on the Reviewer
          tab.
        </Text>
        <Text component="li">
          Download report saves the session as one HTML file. Start over deletes
          every comment and can&apos;t be undone.
        </Text>
      </Stack>
      <Text variant="caption" emphasis="low">
        Version {__APP_VERSION__}
      </Text>
    </Stack>
  );
}
