import { useEffect, useRef } from "react";
import type { FocusEvent, MutableRefObject } from "react";
import { Camera, Trash } from "@phosphor-icons/react";
import {
  Button,
  Group,
  Stack,
  Text,
  TextArea,
  Tooltip,
} from "@recursica/adapter-mantine-v8";
import { formatCommentId } from "../lib/ids";
import type { ReviewComment } from "../lib/types";
import { fieldLayout, type FormLayout } from "../ReviewPanel";

interface CommentItemProps {
  comment: ReviewComment;
  formLayout: FormLayout;
  capturingScreenshot: boolean;
  deletedScreenshot: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  capturing: MutableRefObject<boolean>;
  onTextChange: (text: string) => void;
  onLeftEmpty: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddScreenshot: () => void;
  onEditScreenshot: () => void;
  onUndoScreenshot: () => void;
}

// One comment, as a stacked field group: its text, then its screenshot
// and its actions. No card - a form control never goes inside one; space
// separates each comment from the next.
export function CommentItem({
  comment,
  formLayout,
  capturingScreenshot,
  deletedScreenshot,
  autoFocus,
  onFocused,
  capturing,
  onTextChange,
  onLeftEmpty,
  onDelete,
  onDuplicate,
  onAddScreenshot,
  onEditScreenshot,
  onUndoScreenshot,
}: CommentItemProps) {
  const id = formatCommentId(comment.commentNumber);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // A comment that was just created (or duplicated, or had a screenshot
  // added) takes focus, with the cursor at the end of its text.
  useEffect(() => {
    if (!autoFocus || !textRef.current) return;
    const el = textRef.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    onFocused();
  }, [autoFocus, onFocused]);

  // Starting a comment and then leaving it without adding anything
  // shouldn't leave an empty entry behind. Focus moving to this comment's
  // own buttons isn't leaving it, and neither is the panel hiding itself
  // for a screenshot.
  const onBlur = (event: FocusEvent<HTMLLIElement>) => {
    if (capturing.current) return;
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    if (!comment.text.trim() && !comment.screenshot && !deletedScreenshot)
      onLeftEmpty();
  };

  return (
    <li onBlur={onBlur}>
      <Stack gap="rec-sm">
        <TextArea
          ref={textRef}
          label={`Comment ${id}`}
          {...fieldLayout(formLayout)}
          autosize
          minRows={2}
          value={comment.text}
          onChange={(event) => onTextChange(event.currentTarget.value)}
        />
        <Group justify="space-between" wrap="nowrap" gap="rec-sm">
          <Group gap="rec-sm" wrap="nowrap">
            {comment.screenshot ? (
              <>
                {/* Decorative: the button beside it names the screenshot. */}
                <img className="art-thumb" src={comment.screenshot} alt="" />
                {/* Edit, not View: the screenshot opens where it can be
                    drawn on and deleted. */}
                <Button
                  variant="outline"
                  size="small"
                  aria-label={`Edit screenshot for ${id}`}
                  data-shot-edit={comment.id}
                  onClick={onEditScreenshot}
                >
                  Edit screenshot
                </Button>
              </>
            ) : deletedScreenshot ? (
              <>
                <Text variant="body-small">Screenshot deleted</Text>
                <Button
                  variant="text"
                  size="small"
                  aria-label={`Undo screenshot delete for ${id}`}
                  data-shot-undo={comment.id}
                  onClick={onUndoScreenshot}
                >
                  Undo
                </Button>
              </>
            ) : (
              <Tooltip label="Add screenshot">
                <Button
                  variant="outline"
                  size="small"
                  icon={<Camera />}
                  loading={capturingScreenshot}
                  aria-label={`Add screenshot to ${id}`}
                  onClick={onAddScreenshot}
                />
              </Tooltip>
            )}
          </Group>
          <Group gap="rec-sm" wrap="nowrap">
            <Button
              variant="text"
              size="small"
              aria-label={`Duplicate ${id}`}
              onClick={onDuplicate}
            >
              Duplicate
            </Button>
            <Tooltip label="Delete comment">
              <Button
                variant="text"
                size="small"
                icon={<Trash />}
                aria-label={`Delete comment ${id}`}
                onClick={onDelete}
              />
            </Tooltip>
          </Group>
        </Group>
      </Stack>
    </li>
  );
}

interface DeletedCommentItemProps {
  comment: ReviewComment;
  onUndo: () => void;
}

// Where a deleted comment was: its delete control has become an Undo, in
// the same place. Focus moves to the Undo, since the button that had focus
// no longer exists.
export function DeletedCommentItem({
  comment,
  onUndo,
}: DeletedCommentItemProps) {
  const id = formatCommentId(comment.commentNumber);
  const undoRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    undoRef.current?.focus();
  }, []);
  return (
    <li>
      <Group justify="space-between" wrap="nowrap" gap="rec-sm">
        <Text variant="body-small">{id} deleted</Text>
        <Button
          ref={undoRef}
          variant="text"
          size="small"
          aria-label={`Undo delete of ${id}`}
          onClick={onUndo}
        >
          Undo
        </Button>
      </Group>
    </li>
  );
}
