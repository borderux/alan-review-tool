import type { MutableRefObject } from "react";
import { Heading, Stack, Text } from "@recursica/adapter-mantine-v8";
import type { ReviewComment } from "../lib/types";
import type { FormLayout } from "../ReviewPanel";
import type { ReviewSession } from "../useReviewSession";
import { CommentItem } from "./CommentItem";

// What is being captured right now: a new screenshot or element comment,
// or a screenshot for an existing comment (by id).
export type CaptureTarget = "screenshot" | "element" | number | null;

// One page's comments, newest first.
export interface PageGroup {
  pageKey: string;
  title: string;
  comments: ReviewComment[];
  // The page the panel is on right now.
  current: boolean;
}

interface CommentListProps {
  review: ReviewSession;
  // "This page only" on: the current page's comments, with no page
  // heading. Off: every page's comments, each page under its own heading.
  grouped: boolean;
  groups: PageGroup[];
  showImages: boolean;
  formLayout: FormLayout;
  focusId: number | null;
  onFocused: () => void;
  capturing: MutableRefObject<boolean>;
  captureTarget: CaptureTarget;
  onAddScreenshotTo: (pageKey: string, comment: ReviewComment) => void;
  onDuplicate: (pageKey: string, comment: ReviewComment) => void;
  onRequestDelete: (pageKey: string, comment: ReviewComment) => void;
  onAnnotate: (comment: ReviewComment) => void;
}

// The page's address without the origin's scheme, for the line under a
// page heading: titles are often the same across a site's pages.
function shortUrl(pageKey: string): string {
  return pageKey.replace(/^https?:\/\//, "");
}

// The panel's one view: the comment list, one card per comment, newest
// first. The Add menu that creates comments lives in the panel header
// (AddMenu); the view switches sit pinned above this list. An empty list
// shows nothing.
export function CommentList({
  review,
  grouped,
  groups,
  showImages,
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
  const list = (group: PageGroup, label: string) => (
    <Stack component="ol" className="art-list" aria-label={label} gap="rec-sm">
      {group.comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          formLayout={formLayout}
          headingOrder={grouped ? 4 : 3}
          showImages={showImages}
          canAddScreenshot={group.current}
          capturingScreenshot={captureTarget === comment.id}
          autoFocus={focusId === comment.id}
          onFocused={onFocused}
          capturing={capturing}
          onTextChange={(text) =>
            review.updateComment(group.pageKey, comment.id, { text }, "typing")
          }
          onLeftEmpty={() => review.deleteComment(group.pageKey, comment.id)}
          onDelete={() => onRequestDelete(group.pageKey, comment)}
          onDuplicate={() => onDuplicate(group.pageKey, comment)}
          onAddScreenshot={() => onAddScreenshotTo(group.pageKey, comment)}
          onAnnotate={() => onAnnotate(comment)}
        />
      ))}
    </Stack>
  );

  const visible = groups.filter((g) => g.comments.length > 0);
  if (visible.length === 0) return null;

  if (!grouped) return list(visible[0], "Comments on this page");

  return (
    <Stack gap="rec-lg">
      {visible.map((group) => (
        <Stack key={group.pageKey} gap="rec-sm" component="section">
          <Stack gap="rec-none">
            <Heading order={3}>
              {group.title || shortUrl(group.pageKey)}
            </Heading>
            <Text variant="caption" emphasis="low" truncate>
              {shortUrl(group.pageKey)}
            </Text>
          </Stack>
          {list(group, `Comments on ${group.title || shortUrl(group.pageKey)}`)}
        </Stack>
      ))}
    </Stack>
  );
}
