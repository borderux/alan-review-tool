import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  RefObject,
} from "react";
import { Camera } from "@phosphor-icons/react";
import {
  Button,
  Group,
  Stack,
  Text,
  TextField,
} from "@recursica/adapter-mantine-v8";
import { plural } from "../lib/format";
import type { ReviewComment } from "../lib/types";
import { fieldLayout, type FormLayout } from "../ReviewPanel";
import type { ReviewSession } from "../useReviewSession";
import { CommentItem } from "./CommentItem";

interface CommentsTabProps {
  review: ReviewSession;
  pageKey: string;
  comments: ReviewComment[];
  formLayout: FormLayout;
  newCommentRef: RefObject<HTMLInputElement | null>;
  draft: string;
  onDraftChange: (draft: string) => void;
  // Across the whole session, for the scope note above the list.
  totalCount: number;
  focusId: number | null;
  onFocused: () => void;
  capturing: MutableRefObject<boolean>;
  // What is being captured right now, so its button shows it is busy.
  captureTarget: "new" | "element" | number | null;
  onAddComment: (text: string) => void;
  onAddScreenshot: () => void;
  onAddElement: () => void;
  onAddScreenshotTo: (comment: ReviewComment) => void;
  onDuplicate: (comment: ReviewComment) => void;
  onRequestDelete: (comment: ReviewComment) => void;
  onAnnotate: (comment: ReviewComment) => void;
}

// The Comments tab: what the reviewer came for, and the tab that opens.
// The add controls stay pinned under the tab bar; the list scrolls.
export function CommentsTab({
  review,
  pageKey,
  comments,
  formLayout,
  newCommentRef,
  draft,
  onDraftChange,
  totalCount,
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
}: CommentsTabProps) {
  // The fast typing flow: type, press Enter, and the comment is added with
  // focus still in the field for the next one. A single-line field, so
  // Enter adding is the field's normal behaviour; longer comments are
  // edited in their own row, which grows with the text.
  const addDraft = () => {
    const text = draft.trim();
    if (!text) {
      newCommentRef.current?.focus();
      return;
    }
    onAddComment(text);
    onDraftChange("");
    newCommentRef.current?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    addDraft();
  };

  return (
    <Stack gap="rec-default">
      <div className="art-pinned art-pinned-below-tabs">
        <Stack gap="rec-sm" pt="rec-default">
          <TextField
            ref={newCommentRef}
            data-new-comment="true"
            label="New comment"
            {...fieldLayout(formLayout)}
            placeholder="Describe the issue or change"
            assistiveText="Enter adds it to the list"
            value={draft}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          {/* The field's own action, Add comment, sits at the right; the
              other ways to add sit at the left. */}
          <Group justify="space-between" gap="rec-sm" w="100%">
            <Group gap="rec-sm">
              <Button
                variant="outline"
                icon={<Camera />}
                loading={captureTarget === "new"}
                onClick={() => onAddScreenshot()}
              >
                Add screenshot
              </Button>
              <Button
                variant="outline"
                loading={captureTarget === "element"}
                onClick={() => onAddElement()}
              >
                Add element
              </Button>
            </Group>
            {/* Disabled until there is text; the field above says what it
                needs. */}
            <Button
              variant="outline"
              disabled={!draft.trim()}
              onClick={addDraft}
            >
              Add comment
            </Button>
          </Group>
        </Stack>
      </div>

      {/* The list shows this page only; say so, and what the report
          covers, so the narrowing is never silent. */}
      {totalCount > 0 && (
        <Stack maw={300}>
          <Text variant="caption" emphasis="low">
            {`Showing this page only: ${plural(comments.length, "comment", "comments")}`}
          </Text>
        </Stack>
      )}
      {comments.length === 0 ? (
        <Text>
          {totalCount === 0
            ? "No comments yet. Download report needs at least one."
            : "No comments on this page yet"}
        </Text>
      ) : (
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
