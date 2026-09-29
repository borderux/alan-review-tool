import type { MutableRefObject } from "react";
import { Button, Group, Menu, Stack } from "@recursica/adapter-mantine-v8";
import type { ReviewComment } from "../lib/types";
import type { FormLayout } from "../ReviewPanel";
import type { ReviewSession } from "../useReviewSession";
import { CommentItem } from "./CommentItem";
import { useManagedMenu } from "./useManagedMenu";

// What is being captured right now: a new screenshot or element comment,
// or a screenshot for an existing comment (by id).
export type CaptureTarget = "screenshot" | "element" | number | null;

interface CommentListProps {
  review: ReviewSession;
  pageKey: string;
  comments: ReviewComment[];
  formLayout: FormLayout;
  focusId: number | null;
  onFocused: () => void;
  capturing: MutableRefObject<boolean>;
  captureTarget: CaptureTarget;
  onAddComment: () => void;
  onAddScreenshot: () => void;
  onAddElement: () => void;
  onAddScreenshotTo: (comment: ReviewComment) => void;
  onDuplicate: (comment: ReviewComment) => void;
  onRequestDelete: (comment: ReviewComment) => void;
  onAnnotate: (comment: ReviewComment) => void;
}

// The panel's one view: a pinned toolbar with the single Add menu, and the
// comment list beneath it, newest first. Only the list scrolls. An empty
// list shows nothing.
export function CommentList({
  review,
  pageKey,
  comments,
  formLayout,
  focusId,
  onFocused,
  capturing,
  captureTarget,
  onAddComment,
  onAddScreenshot,
  onAddElement,
  onAddScreenshotTo,
  onDuplicate,
  onRequestDelete,
  onAnnotate,
}: CommentListProps) {
  const {
    opened: addMenuOpened,
    setOpened: setAddMenuOpened,
    triggerRef: addMenuTriggerRef,
    firstItemRef: addMenuFirstItemRef,
    onDropdownKeyDown: onAddMenuKeyDown,
  } = useManagedMenu();
  const busy = captureTarget === "screenshot" || captureTarget === "element";

  return (
    <Stack gap="rec-default">
      {/* One add control: each item creates a new numbered comment at the
          top of the list, with focus in its text box. Screenshot and
          Element start their capture first; a cancelled capture adds
          nothing. */}
      <div className="art-pinned art-pinned-top">
        <Group gap="rec-sm" pb="rec-default">
          <Menu
            trapFocus={false}
            opened={addMenuOpened}
            onChange={setAddMenuOpened}
          >
            <Menu.Target>
              <Button
                ref={addMenuTriggerRef}
                variant="outline"
                size="small"
                loading={busy}
                data-add-menu="true"
              >
                Add
              </Button>
            </Menu.Target>
            <Menu.Dropdown onKeyDown={onAddMenuKeyDown}>
              <Menu.Item ref={addMenuFirstItemRef} onClick={onAddComment}>
                Comment
              </Menu.Item>
              <Menu.Item onClick={onAddScreenshot}>Screenshot</Menu.Item>
              <Menu.Item onClick={onAddElement}>Element</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </div>

      {comments.length > 0 && (
        <Stack
          component="ol"
          className="art-list"
          aria-label="Comments on this page"
          gap="rec-lg"
        >
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              formLayout={formLayout}
              capturingScreenshot={captureTarget === comment.id}
              autoFocus={focusId === comment.id}
              onFocused={onFocused}
              capturing={capturing}
              onTextChange={(text) =>
                review.updateComment(pageKey, comment.id, { text }, "typing")
              }
              onLeftEmpty={() => review.deleteComment(pageKey, comment.id)}
              onDelete={() => onRequestDelete(comment)}
              onDuplicate={() => onDuplicate(comment)}
              onAddScreenshot={() => onAddScreenshotTo(comment)}
              onAnnotate={() => onAnnotate(comment)}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
