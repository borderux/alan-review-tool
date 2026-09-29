import { useEffect, useRef } from "react";
import type { FocusEvent, MutableRefObject } from "react";
import { Camera, DotsThree } from "@phosphor-icons/react";
import {
  Button,
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

// One comment. Each row is one comment - a single field labelled
// "Comment" - and a screenshot or a captured element is supporting
// material attached to it, shown in its own bordered frame (the image and
// its Add annotations button only; never the text box).
//
// Each row is a group: its number as a heading, then its parts, with a
// divider line between groups (see panel.css). No card: a form control
// never goes inside one.
export function CommentItem({
  comment,
  formLayout,
  capturingScreenshot,
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

  return (
    <li className="art-row" onBlur={onBlur}>
      <Stack gap="rec-lg">
        <Group justify="space-between" wrap="nowrap" gap="rec-sm">
          <Heading
            order={3}
            aria-label={commentName(comment.commentNumber, true)}
          >
            {number}
          </Heading>
          <Group gap="rec-sm" wrap="nowrap">
            {!hasShot && (
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
                    icon={<DotsThree />}
                    ref={menuTriggerRef}
                    aria-label={`More actions for ${name}`}
                    data-row-menu={comment.id}
                  />
                </Menu.Target>
              </Tooltip>
              <Menu.Dropdown onKeyDown={onMenuKeyDown}>
                <Menu.Item ref={menuFirstItemRef} onClick={onDuplicate}>
                  Duplicate comment
                </Menu.Item>
                <Menu.Item onClick={onDelete}>Delete comment</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>

        {/* The supporting material, framed on its own: the image, a short
            summary for an element, and the button that acts on the image.
            The full selector, HTML and styles are in the report. */}
        {hasShot && (
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
            {comment.element && (
              <Text variant="caption" emphasis="low" truncate>
                {elementSummary(comment.element)}
              </Text>
            )}
            <Button
              variant="outline"
              size="small"
              aria-label={`Add annotations to ${name}`}
              data-shot-edit={comment.id}
              onClick={onAnnotate}
            >
              Add annotations
            </Button>
          </div>
        )}
        {!hasShot && comment.element && (
          <Text variant="caption" emphasis="low" truncate>
            {elementSummary(comment.element)}
          </Text>
        )}

        <TextArea
          ref={textRef}
          label="Comment"
          {...fieldLayout(formLayout)}
          autosize
          minRows={1}
          placeholder={
            comment.element
              ? "Describe what's wrong with this element"
              : hasShot
                ? "Describe what the screenshot shows"
                : "Describe the issue or change"
          }
          value={comment.text}
          onChange={(event) => onTextChange(event.currentTarget.value)}
        />
      </Stack>
    </li>
  );
}
