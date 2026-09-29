import type { MutableRefObject } from "react";
import { Stack } from "@recursica/adapter-mantine-v8";
import type { ReviewComment } from "../lib/types";
import type { FormLayout } from "../ReviewPanel";
import type { ReviewSession } from "../useReviewSession";
import { CommentItem } from "./CommentItem";

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
  onAddScreenshotTo: (comment: ReviewComment) => void;
  onDuplicate: (comment: ReviewComment) => void;
  onRequestDelete: (comment: ReviewComment) => void;
  onAnnotate: (comment: ReviewComment) => void;
}

// The panel's one view: the comment list, newest first. The Add menu that
// creates comments lives in the panel header (AddMenu). An empty list shows
// nothing.
export function CommentList({
  review,
  pageKey,
  comments,
  formLayout,
  focusId,
  onFocused,
  capturing,
  captureTarget,
  onAddScreenshotTo,
  onDuplicate,
  onRequestDelete,
  onAnnotate,
}: CommentListProps) {
  return (
    <Stack gap="rec-default">
      {comments.length > 0 && (
        <Stack
          component="ol"
          className="art-list"
          aria-label="Comments on this page"
          gap="rec-xl"
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
