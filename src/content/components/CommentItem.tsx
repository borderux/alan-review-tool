import { useEffect, useRef } from "react";
import type { FocusEvent, MutableRefObject } from "react";
import { Camera, Copy, DotsThree, Trash, X } from "@phosphor-icons/react";
import {
  Button,
  Card,
  Group,
  Heading,
  Menu,
  Stack,
  Text,
  TextArea,
  Tooltip,
} from "@recursica/adapter-mantine-v8";
import { elementSummary } from "../lib/element";
import { commentName, formatCommentId } from "../lib/ids";
import type { ReviewComment } from "../lib/types";
import { fieldLayout, type FormLayout } from "../ReviewPanel";
import { useManagedMenu } from "./useManagedMenu";

interface CommentItemProps {
  comment: ReviewComment;
  formLayout: FormLayout;
  capturingScreenshot: boolean;
  // Heading level for the comment's number: one below the page headings
  // when the list is grouped by page.
  headingOrder: 3 | 4;
  // Whether the screenshot or element image shows in the panel ("Show
  // images"). Off, the element summary and Add annotations stay.
  showImages: boolean;
  // Add screenshot captures the page on screen, so it is only offered on
  // comments about that page.
  canAddScreenshot: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  capturing: MutableRefObject<boolean>;
  onTextChange: (text: string) => void;
  onLeftEmpty: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddScreenshot: () => void;
  onAnnotate: () => void;
}

// One comment, as one card (the kit's Card): its number as the card's
// heading with the row actions beside it, then the screenshot or captured
// element in its own bordered frame (the image and its Add annotations
// button only), then the single field labelled "Comment".
//
// Approved exception (owner decision): the card holds a form control. The
// card rule forbids any form control in a card; the owner wants each
// comment, text box included, on one card.
export function CommentItem({
  comment,
  formLayout,
  capturingScreenshot,
  headingOrder,
  showImages,
  canAddScreenshot,
  autoFocus,
  onFocused,
  capturing,
  onTextChange,
  onLeftEmpty,
  onDelete,
  onDuplicate,
  onAddScreenshot,
  onAnnotate,
}: CommentItemProps) {
  const number = formatCommentId(comment.commentNumber);
  const name = commentName(comment.commentNumber);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const {
    opened: menuOpened,
    setOpened: setMenuOpened,
    triggerRef: menuTriggerRef,
    firstItemRef: menuFirstItemRef,
    onDropdownKeyDown: onMenuKeyDown,
  } = useManagedMenu();
  const hasShot = Boolean(comment.screenshot);

  // A comment that was just created (or duplicated, or had a screenshot
  // added) takes focus, with the cursor at the end of its text.
  useEffect(() => {
    if (!autoFocus || !textRef.current) return;
    const el = textRef.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    onFocused();
  }, [autoFocus, onFocused]);

  // A comment left with no text and no screenshot vanishes silently.
  // Focus moving to this comment's own controls isn't leaving it, and
  // neither is the panel hiding itself for a screenshot.
  const onBlur = (event: FocusEvent<HTMLLIElement>) => {
    if (capturing.current) return;
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    if (!comment.text.trim() && !comment.screenshot) onLeftEmpty();
  };

  const summary = comment.element && (
    <Text variant="caption" emphasis="low" truncate>
      {elementSummary(comment.element)}
    </Text>
  );
  const annotate = (
    <Button
      variant="outline"
      size="small"
      aria-label={`Add annotations to ${name}`}
      data-shot-edit={comment.id}
      onClick={onAnnotate}
    >
      Add annotations
    </Button>
  );

  return (
    <li className="art-row" onBlur={onBlur}>
      {/* The number and the actions share the first row inside the card's
          content, rather than a Card.Header, whose own padding and divider
          make every card much taller. Then the Comment field, then the
          screenshot or element beneath it. The parts are spaced by the
          theme's general small dimension (rec-sm, 4px), and so is the
          card's padding (owner-requested token remap in panel.css). */}
      <Card>
        <Card.Content>
          <Stack gap="rec-sm">
            <Group justify="space-between" wrap="nowrap" gap="rec-sm">
              <Heading
                order={headingOrder}
                aria-label={commentName(comment.commentNumber, true)}
              >
                {number}
              </Heading>
              <Group gap="rec-sm" wrap="nowrap">
                {!hasShot && canAddScreenshot && (
                  <Tooltip label="Add screenshot">
                    <Button
                      variant="outline"
                      size="small"
                      icon={<Camera />}
                      loading={capturingScreenshot}
                      aria-label={`Add screenshot to ${name}`}
                      data-shot-add={comment.id}
                      onClick={onAddScreenshot}
                    />
                  </Tooltip>
                )}
                <Menu
                  trapFocus={false}
                  opened={menuOpened}
                  onChange={setMenuOpened}
                >
                  <Tooltip label="More actions">
                    <Menu.Target>
                      <Button
                        variant="outline"
                        size="small"
                        // An X while the menu is open (owner decision).
                        icon={menuOpened ? <X /> : <DotsThree />}
                        ref={menuTriggerRef}
                        aria-label={`More actions for ${name}`}
                        data-row-menu={comment.id}
                      />
                    </Menu.Target>
                  </Tooltip>
                  <Menu.Dropdown onKeyDown={onMenuKeyDown}>
                    {/* Leading icons are decorative; the text is the name. */}
                    <Menu.Item
                      ref={menuFirstItemRef}
                      leftSection={<Copy aria-hidden />}
                      onClick={onDuplicate}
                    >
                      Duplicate comment
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<Trash aria-hidden />}
                      onClick={onDelete}
                    >
                      Delete comment
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>
            <TextArea
              ref={textRef}
              label="Comment"
              {...fieldLayout(formLayout)}
              autosize
              minRows={1}
              placeholder={
                comment.element
                  ? "Describe the change or feedback for this element"
                  : hasShot
                    ? "Describe the change or feedback for this screenshot"
                    : "Describe the change or feedback"
              }
              value={comment.text}
              onChange={(event) => onTextChange(event.currentTarget.value)}
            />

            {/* Below the Comment field, the supporting material, framed on its own: the image, a
                short summary for an element, and the button that acts on
                the image. The full selector, HTML and styles are in the
                report. With images hidden there is no frame: the summary
                and the button stay, so annotating still works. */}
            {hasShot && showImages && (
              <div className="art-shot-frame">
                <img
                  className="art-thumb"
                  src={comment.screenshot ?? undefined}
                  alt={
                    comment.element
                      ? `Screenshot of the element in ${name}`
                      : `Screenshot attached to ${name}`
                  }
                />
                {summary}
                {annotate}
              </div>
            )}
            {hasShot && !showImages && (
              <Stack gap="rec-sm" align="flex-start">
                {summary}
                {annotate}
              </Stack>
            )}
            {!hasShot && summary}
          </Stack>
        </Card.Content>
      </Card>
    </li>
  );
}
