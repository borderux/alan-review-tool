import { Heading, Stack, Text } from "@recursica/adapter-mantine-v8";

// The in-panel help. Replaces src/help.html: the same content, rewritten
// for the panel's current labels and behaviour, and built from Recursica
// type components instead of raw HTML.
export function HelpTab() {
  return (
    // Line length: at the panel's widest (720px) body text would run to
    // about 95 characters. 560px holds it near 70, inside the readable
    // range.
    <Stack gap="rec-default" mt="rec-default" maw={560}>
      <Heading order={3}>Using ALAN Review Tool</Heading>
      <Text>
        Click the toolbar icon on any site to open or close this panel. The
        panel pushes the page over to make room. It never covers content.
      </Text>

      <Heading order={4}>Comments and screenshots</Heading>
      <Text>
        <strong>Add comment</strong> starts a text comment on the current page.{" "}
        <strong>Add screenshot</strong> lets you drag a rectangle anywhere on
        the page to capture that region. Releasing outside the browser window
        works too. Press Escape to cancel.
      </Text>
      <Text>
        Each comment has its own camera button to add a screenshot,{" "}
        <strong>Duplicate</strong> to copy it, and a trash button to delete it.
        After a delete, <strong>Undo</strong> brings the comment back.
      </Text>
      <Text>
        <strong>Edit screenshot</strong> opens it full size. Draw on the image
        (cyan, freehand) to point at the thing you mean.{" "}
        <strong>Save annotations</strong> adds the drawing to the screenshot for
        good. <strong>Cancel</strong> or Escape throws the drawing away.
      </Text>

      <Heading order={4}>Sessions</Heading>
      <Text>
        Every comment and screenshot you add, on any page of any site, belongs
        to one review session. Fill in your name, email and session details on
        the <strong>Session</strong> tab. They stay with you on every page.
        Changes save as you type.
      </Text>
      <Text>
        <strong>Clear session</strong> deletes every comment on every page in
        the current session, after you confirm. This can't be undone.
      </Text>

      <Heading order={4}>The report</Heading>
      <Text>
        <strong>Download report</strong> exports the whole session as one HTML
        file: a section per page, a table of contents, and each screenshot as a
        click-to-enlarge thumbnail. The file has no JavaScript in it, so it
        opens anywhere.
      </Text>

      <Heading order={4}>Resizing</Heading>
      <Text>
        Drag the thin strip at the panel&apos;s left edge to resize it. You can
        also focus the strip and use the arrow keys. The panel remembers its
        width.
      </Text>
    </Stack>
  );
}
