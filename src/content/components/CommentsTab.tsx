import type { MutableRefObject, RefObject } from "react";
import { Camera } from "@phosphor-icons/react";
import { Button, Group, Stack, Text } from "@recursica/adapter-mantine-v8";
import type { ReviewComment } from "../lib/types";
import type { FormLayout } from "../ReviewPanel";
import type { DeletedComment, ReviewSession } from "../useReviewSession";
import { CommentItem, DeletedCommentItem } from "./CommentItem";

interface CommentsTabProps {
  review: ReviewSession;
  pageKey: string;
  comments: ReviewComment[];
  formLayout: FormLayout;
  addCommentRef: RefObject<HTMLButtonElement | null>;
  focusId: number | null;
  onFocused: () => void;
  capturing: MutableRefObject<boolean>;
  // What is being captured right now, so its button shows it is busy.
  captureTarget: "new" | number | null;
  onAddComment: () => void;
  onAddScreenshot: () => void;
  onAddScreenshotTo: (comment: ReviewComment) => void;
  onDuplicate: (comment: ReviewComment) => void;
  onEditScreenshot: (comment: ReviewComment) => void;
}

type ListItem =
  | { kind: "comment"; comment: ReviewComment }
  | { kind: "deleted"; deleted: DeletedComment };

// Deleted comments keep their place in the list, as an Undo, until the
// panel closes. Each goes back in front of the comment that followed it.
function withDeletedPlaceholders(
  comments: ReviewComment[],
  deleted: DeletedComment[],
): ListItem[] {
  const items: ListItem[] = comments.map((comment) => ({
    kind: "comment",
    comment,
  }));
  for (const entry of deleted) {
    const at =
      entry.beforeId == null
        ? -1
        : items.findIndex(
            (item) =>
              (item.kind === "comment"
                ? item.comment.id
                : item.deleted.comment.id) === entry.beforeId,
          );
    const placeholder: ListItem = { kind: "deleted", deleted: entry };
    if (at === -1) items.push(placeholder);
    else items.splice(at, 0, placeholder);
  }
  return items;
}

// The Comments tab: what the reviewer came for, and the tab that opens.
export function CommentsTab({
  review,
  pageKey,
  comments,
  formLayout,
  addCommentRef,
  focusId,
  onFocused,
  capturing,
  captureTarget,
  onAddComment,
  onAddScreenshot,
  onAddScreenshotTo,
  onDuplicate,
  onEditScreenshot,
}: CommentsTabProps) {
  const items = withDeletedPlaceholders(
    comments,
    review.deletedComments.filter((d) => d.pageKey === pageKey),
  );

  return (
    <Stack gap="rec-default" mt="rec-default">
      <Group gap="rec-sm">
        <Button variant="outline" ref={addCommentRef} onClick={onAddComment}>
          Add comment
        </Button>
        <Button
          variant="outline"
          icon={<Camera />}
          loading={captureTarget === "new"}
          onClick={() => onAddScreenshot()}
        >
          Add screenshot
        </Button>
      </Group>

      {items.length === 0 ? (
        <Text>No comments on this page yet</Text>
      ) : (
        <Stack
          component="ol"
          className="art-list"
          aria-label="Comments on this page"
          gap="rec-md"
        >
          {items.map((item) =>
            item.kind === "comment" ? (
              <CommentItem
                key={item.comment.id}
                comment={item.comment}
                formLayout={formLayout}
                capturingScreenshot={captureTarget === item.comment.id}
                deletedScreenshot={
                  review.deletedScreenshots[item.comment.id] != null
                }
                autoFocus={focusId === item.comment.id}
                onFocused={onFocused}
                capturing={capturing}
                onTextChange={(text) =>
                  review.updateComment(
                    pageKey,
                    item.comment.id,
                    { text },
                    "typing",
                  )
                }
                onLeftEmpty={() =>
                  review.deleteComment(pageKey, item.comment.id, false)
                }
                onDelete={() =>
                  review.deleteComment(pageKey, item.comment.id, true)
                }
                onDuplicate={() => onDuplicate(item.comment)}
                onAddScreenshot={() => onAddScreenshotTo(item.comment)}
                onEditScreenshot={() => onEditScreenshot(item.comment)}
                onUndoScreenshot={() =>
                  review.undoDeleteScreenshot(pageKey, item.comment.id)
                }
              />
            ) : (
              <DeletedCommentItem
                key={`deleted-${item.deleted.comment.id}`}
                comment={item.deleted.comment}
                onUndo={() => review.undoDeleteComment(item.deleted.comment.id)}
              />
            ),
          )}
        </Stack>
      )}
    </Stack>
  );
}
