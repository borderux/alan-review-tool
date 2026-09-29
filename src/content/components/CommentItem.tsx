import { useEffect, useRef, useState } from "react";
import type { FocusEvent, MutableRefObject } from "react";
import { Camera, DotsThree } from "@phosphor-icons/react";
import {
  Button,
  Group,
  Heading,
  Menu,
  ReadOnlyField,
  Stack,
  Text,
  TextArea,
  Tooltip,
} from "@recursica/adapter-mantine-v8";
import { formatCount } from "../lib/format";
import { HTML_CAP } from "../lib/element";
import { formatCommentId } from "../lib/ids";
import type { ReviewComment } from "../lib/types";
import { fieldLayout, type FormLayout } from "../ReviewPanel";

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

// One comment. Every comment is the same stored record - text, plus an
// optional screenshot - shown as one of two kinds of row:
//
// - a quick comment: one line of text that grows only as the text does,
//   with a visible Add screenshot action;
// - a screenshot comment: the thumbnail, Add annotations, and the text.
//
// Each row is a group: its CM-<n> heading, then its parts, with a divider
// line between groups (see panel.css). No card: a form control never goes
// inside one.
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
  const id = formatCommentId(comment.commentNumber);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWasOpen = useRef(false);

  // Menu focus is managed here rather than by the library, whose own focus
  // handling does not work inside a shadow root. Focus moves onto the
  // first item once the items have rendered, and back to the trigger when
  // the menu closes - unless an item opened a modal, which then owns
  // focus. Tab leaves the menu.
  useEffect(() => {
    if (menuOpen) {
      menuWasOpen.current = true;
      const frame = requestAnimationFrame(() =>
        firstMenuItemRef.current?.focus(),
      );
      return () => cancelAnimationFrame(frame);
    }
    if (!menuWasOpen.current) return;
    menuWasOpen.current = false;
    const frame = requestAnimationFrame(() => {
      const trigger = menuTriggerRef.current;
      const root = trigger?.getRootNode() as ShadowRoot | undefined;
      const inModal = root?.activeElement?.closest(".mantine-Modal-content");
      if (trigger && !inModal) trigger.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [menuOpen]);
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
      <Stack gap="rec-sm">
        <Group justify="space-between" wrap="nowrap" gap="rec-sm">
          <Heading order={3}>{id}</Heading>
          <Group gap="rec-sm" wrap="nowrap">
            {!hasShot && (
              <Tooltip label="Add screenshot">
                <Button
                  variant="outline"
                  size="small"
                  icon={<Camera />}
                  loading={capturingScreenshot}
                  aria-label={`Add screenshot to ${id}`}
                  data-shot-add={comment.id}
                  onClick={onAddScreenshot}
                />
              </Tooltip>
            )}
            <Menu trapFocus={false} opened={menuOpen} onChange={setMenuOpen}>
              <Tooltip label="More actions">
                <Menu.Target>
                  <Button
                    variant="outline"
                    size="small"
                    icon={<DotsThree />}
                    ref={menuTriggerRef}
                    aria-label={`More actions for ${id}`}
                    data-row-menu={comment.id}
                  />
                </Menu.Target>
              </Tooltip>
              {/* Tab leaves the menu: it closes, and focus goes back to
                  the trigger like every other way of closing it. */}
              <Menu.Dropdown
                onKeyDown={(event) => {
                  if (event.key !== "Tab") return;
                  event.preventDefault();
                  setMenuOpen(false);
                }}
              >
                <Menu.Item ref={firstMenuItemRef} onClick={onDuplicate}>
                  Duplicate comment
                </Menu.Item>
                <Menu.Item onClick={onDelete}>Delete comment</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>

        {hasShot && (
          <Group gap="rec-sm" wrap="nowrap">
            <img
              className="art-thumb"
              src={comment.screenshot ?? undefined}
              alt={
                comment.element
                  ? `Screenshot of the element in ${id}`
                  : `Screenshot attached to ${id}`
              }
            />
            <Button
              variant="outline"
              size="small"
              aria-label={`Add annotations to ${id}`}
              data-shot-edit={comment.id}
              onClick={onAnnotate}
            >
              Add annotations
            </Button>
          </Group>
        )}

        {/* The row's fields bring their own spacing, so this stack adds
            none between them. */}
        <Stack gap="rec-none">
          {/* An element comment: which element, and anything cut short. The
            full HTML and styles are in the downloaded report. */}
          {comment.element && (
            <>
              <ReadOnlyField
                label={`Element in ${id}`}
                formLayout="stacked"
                value={comment.element.selector}
              />
              {(comment.element.htmlTruncated ||
                comment.element.stylesTruncated ||
                comment.element.screenshotClipped) && (
                <Stack maw={320}>
                  <Text variant="caption" emphasis="low">
                    {[
                      comment.element.htmlTruncated &&
                        `HTML truncated to ${formatCount(HTML_CAP)} characters`,
                      comment.element.stylesTruncated && "Styles truncated",
                      comment.element.screenshotClipped &&
                        "Screenshot shows only the part that was on screen",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </Stack>
              )}
            </>
          )}

          <TextArea
            ref={textRef}
            // The label names the comment on its own, id included: the
            // adapter labels the field by its visible label, so an
            // aria-label cannot add the id.
            label={`Comment ${id}`}
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
      </Stack>
    </li>
  );
}
