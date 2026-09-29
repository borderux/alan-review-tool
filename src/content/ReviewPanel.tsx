import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Group,
  Panel,
  Stack,
  Tabs,
  Text,
  Toast,
} from "@recursica/adapter-mantine-v8";
import { plural } from "./lib/format";
import { AnnotationEditor } from "./components/AnnotationEditor";
import { CommentsTab } from "./components/CommentsTab";
import { ConfirmModal } from "./components/ConfirmModal";
import { HelpTab } from "./components/HelpTab";
import { ResizeHandle } from "./components/ResizeHandle";
import { ReviewerTab } from "./components/ReviewerTab";
import { captureElement, captureRegion } from "./lib/capture";
import { formatCommentId } from "./lib/ids";
import {
  CLOSE_EVENT,
  findInPanel,
  makeBehindModalInert,
  markPanelNonModal,
  setHostWidth,
} from "./lib/page";
import { downloadReport, totalCommentCount } from "./lib/report";
import {
  saveDraft,
  savePenColor,
  type PenColor,
  type StoredState,
} from "./lib/storage";
import type { ReviewComment } from "./lib/types";
import { usePageKey } from "./usePageKey";
import { useReviewSession } from "./useReviewSession";

// If the panel's close transition never reports that it finished (for
// example with reduced motion), tear down anyway after this long.
const CLOSE_FALLBACK_MS = 600;

// Every form in a panel stacks its labels above its fields, at every
// panel width: the panels rule names this surface, so it outranks the
// general container-width test in the forms rule. One placement for every
// field in the panel.
export type FormLayout = "stacked";

export function fieldLayout(formLayout: FormLayout) {
  return { formLayout, labelAlignment: "left" } as const;
}

// What is being captured right now: a new screenshot comment, or a
// screenshot for an existing comment (by id).
type CaptureTarget = "new" | "element" | number | null;

// The one confirmation that can be open, if any.
type Confirmation =
  | { kind: "delete-comment"; comment: ReviewComment }
  | { kind: "delete-screenshot"; comment: ReviewComment }
  | { kind: "start-over" };

interface ReviewPanelProps {
  host: HTMLElement;
  portalEl: HTMLElement;
  stored: StoredState;
  onClosed: () => void;
}

export function ReviewPanel({
  host,
  portalEl,
  stored,
  onClosed,
}: ReviewPanelProps) {
  const [toast, setToast] = useState<string | null>(null);
  const review = useReviewSession({
    initialSession: stored.session,
    initialUserName: stored.userName,
    initialUserEmail: stored.userEmail,
    // One message at a time: a repeat replaces the one already showing.
    onSaveError: (reason) => setToast(`Changes not saved: ${reason}`),
  });
  const { session, flush, track } = review;

  const [opened, setOpened] = useState(false);
  const [width, setWidth] = useState(stored.width);
  const [tab, setTab] = useState<string | null>("comments");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [annotateId, setAnnotateId] = useState<number | null>(null);
  const [penColor, setPenColor] = useState<PenColor>(stored.penColor);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget>(null);
  const [tabsBarHeight, setTabsBarHeight] = useState(0);
  // The New comment field's text, saved as a draft (see storage.ts).
  const [draft, setDraft] = useState(stored.draft);
  const draftRef = useRef(stored.draft);
  const newCommentRef = useRef<HTMLInputElement>(null);
  const tabsBarRef = useRef<HTMLDivElement>(null);
  const closedRef = useRef(false);
  // True while a screenshot is being selected: the panel is hidden, so
  // its text loses focus, and that blur must not clean up the comment the
  // screenshot is for.
  const capturing = useRef(false);

  const pageKey = usePageKey();
  const pageComments = session?.pages[pageKey]?.comments ?? [];
  const total = totalCommentCount(session);
  const pageCount = session
    ? Object.values(session.pages).filter((p) => p.comments.length > 0).length
    : 0;
  const annotateComment =
    annotateId == null
      ? null
      : (pageComments.find((c) => c.id === annotateId) ?? null);
  const formLayout: FormLayout = "stacked";

  // Slide in after the first paint, so the open is a transition.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpened(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (opened) markPanelNonModal(host);
  }, [host, opened]);

  // While a modal is open, everything behind it is inert - the host page
  // and the panel itself - so a screen reader's reading cursor can't wander
  // out of the modal either. The page's own setting is put back after.
  const modalOpen = confirmation != null || annotateId != null;
  useEffect(() => {
    if (!modalOpen) return;
    return makeBehindModalInert(host);
  }, [host, modalOpen]);

  // The Comments tab's add controls pin just below the tab bar, so they
  // need its height.
  useEffect(() => {
    const bar = tabsBarRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() =>
      setTabsBarHeight(bar.getBoundingClientRect().height),
    );
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const finishClose = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClosed();
  }, [onClosed]);

  // Save the draft after a pause in typing, like everything else.
  useEffect(() => {
    draftRef.current = draft;
    const timer = setTimeout(() => track(saveDraft(draft)), 400);
    return () => clearTimeout(timer);
  }, [draft, track]);

  const requestClose = useCallback(() => {
    flush();
    void saveDraft(draftRef.current);
    setOpened(false);
    setTimeout(finishClose, CLOSE_FALLBACK_MS);
  }, [flush, finishClose]);

  // The next toolbar click asks this instance to close its panel.
  useEffect(() => {
    const onCloseRequest = (event: Event) => {
      event.preventDefault();
      requestClose();
    };
    host.addEventListener(CLOSE_EVENT, onCloseRequest);
    return () => host.removeEventListener(CLOSE_EVENT, onCloseRequest);
  }, [host, requestClose]);

  // Escape closes the panel when focus is inside it - except while a
  // modal is open, or when it comes from an open menu (portaled, but its
  // key events still bubble here through React), which use Escape for
  // themselves.
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (confirmation || annotateComment) return;
    // Judged by where the key came from, not only by state: Mantine closes
    // a modal on Escape in a capture listener on window, before this runs,
    // so by now the modal's state may already say it is closed.
    const from = event.target as Element;
    if (from.closest?.('[role="menu"], [role="dialog"], .mantine-Modal-root'))
      return;
    requestClose();
  };

  const onWidthChange = useCallback(
    (next: number) => {
      setWidth(next);
      setHostWidth(host, next);
    },
    [host],
  );

  // Focus goes back to whatever opened a modal once it closes. Mantine's
  // own focus return records document.activeElement, which inside a
  // shadow root is the host element, so it is switched off and done here.
  // When the trigger is gone or disabled, focus goes to the control that
  // replaced it (the first selector that matches).
  const returnFocus = (...selectors: string[]) => {
    requestAnimationFrame(() => {
      for (const selector of selectors) {
        const el = findInPanel(host, selector);
        if (el && !el.hasAttribute("disabled")) {
          el.focus();
          return;
        }
      }
    });
  };
  const NEW_COMMENT = "[data-new-comment]";
  const ACTIVE_TAB = '[role="tab"][aria-selected="true"]';

  const showCaptureError = (reason: string) =>
    setToast(`Screenshot not captured: ${reason}`);

  const handleAddComment = (text: string) => {
    setToast(null);
    review.addComment(pageKey, text);
  };

  const handleAddScreenshot = async () => {
    setToast(null);
    setCaptureTarget("new");
    const result = await captureRegion(host);
    setCaptureTarget(null);
    if (!result) return;
    if ("error" in result) {
      showCaptureError(result.error);
      return;
    }
    setFocusId(review.addComment(pageKey, "", result.dataUrl));
  };

  const handleAddElement = async () => {
    setToast(null);
    setCaptureTarget("element");
    const result = await captureElement(host);
    setCaptureTarget(null);
    if (!result) return;
    if ("error" in result) {
      setToast(`Element not captured: ${result.error}`);
      return;
    }
    setFocusId(review.addComment(pageKey, "", result.dataUrl, result.element));
  };

  const handleAddScreenshotTo = async (comment: ReviewComment) => {
    setToast(null);
    capturing.current = true;
    setCaptureTarget(comment.id);
    const result = await captureRegion(host);
    capturing.current = false;
    setCaptureTarget(null);
    if (result && "error" in result) showCaptureError(result.error);
    else if (result)
      review.updateComment(
        pageKey,
        comment.id,
        { screenshot: result.dataUrl },
        "now",
      );
    setFocusId(comment.id);
  };

  // From the row menu: focus goes back to the menu's trigger, not into
  // the new comment (the menu rule).
  const handleDuplicate = (comment: ReviewComment) => {
    setToast(null);
    review.duplicateComment(pageKey, comment);
  };

  const closeEditor = (id: number) => {
    setAnnotateId(null);
    returnFocus(`[data-shot-edit="${id}"]`, ACTIVE_TAB);
  };

  const cancelConfirmation = () => {
    const current = confirmation;
    setConfirmation(null);
    if (current?.kind === "delete-comment")
      returnFocus(`[data-row-menu="${current.comment.id}"]`, NEW_COMMENT);
    else if (current?.kind === "delete-screenshot")
      returnFocus(`[data-shot-edit="${current.comment.id}"]`, NEW_COMMENT);
    else returnFocus("[data-start-over]", ACTIVE_TAB);
  };

  const confirm = () => {
    const current = confirmation;
    setConfirmation(null);
    if (!current) return;
    if (current.kind === "delete-comment") {
      review.deleteComment(pageKey, current.comment.id);
      // The comment and its menu are gone; the add field is the nearest
      // place to continue.
      returnFocus(NEW_COMMENT, ACTIVE_TAB);
    } else if (current.kind === "delete-screenshot") {
      review.updateComment(
        pageKey,
        current.comment.id,
        { screenshot: null },
        "now",
      );
      returnFocus(`[data-shot-add="${current.comment.id}"]`, NEW_COMMENT);
    } else {
      review.startOver();
      // Start over is disabled now there is no session.
      returnFocus(NEW_COMMENT, ACTIVE_TAB);
    }
  };

  const confirmationCopy = (() => {
    if (!confirmation) return null;
    if (confirmation.kind === "start-over")
      return {
        title: "Start over",
        consequence:
          "Deletes every comment and screenshot on every page. The reviewer's name and email stay. This can't be undone.",
        confirmLabel: "Start over",
      };
    const id = formatCommentId(confirmation.comment.commentNumber);
    if (confirmation.kind === "delete-comment")
      return {
        title: `Delete ${id}`,
        consequence: confirmation.comment.screenshot
          ? `Deletes ${id} and its screenshot. This can't be undone.`
          : `Deletes ${id}. This can't be undone.`,
        confirmLabel: "Delete comment",
      };
    return {
      title: `Delete screenshot from ${id}`,
      consequence: `Deletes the screenshot and its annotations from ${id}. The comment text stays. This can't be undone.`,
      confirmLabel: "Delete screenshot",
    };
  })();

  return (
    <div
      className="art-panel"
      onKeyDown={onKeyDown}
      style={{ "--art-pinned-top": `${tabsBarHeight}px` } as CSSProperties}
    >
      <ResizeHandle
        width={width}
        onChange={onWidthChange}
        visible={opened}
        track={review.track}
      />
      {/*
        Non-modal by design: the page behind stays usable, so the four
        modal defaults the adapter inherits from Mantine's Drawer are
        switched off explicitly. Escape is handled above, only while focus
        is inside the panel.

        overStyled is the approved exception for the user-resizable width
        (the owner approved keeping the resize strip). The kit's panel has
        no size prop, so the width is passed straight to the underlying
        Drawer; it stays inside the panel's token min and max width.
      */}
      <Panel
        overStyled
        {...({ size: width } as object)}
        opened={opened}
        onClose={requestClose}
        withOverlay={false}
        closeOnClickOutside={false}
        trapFocus={false}
        lockScroll={false}
        closeOnEscape={false}
        withinPortal={false}
        returnFocus={false}
        // The product name, in sentence case. The version lives at the
        // bottom of the Help tab.
        title="Snippy"
        closeButtonProps={{ "aria-label": "Close Snippy" }}
        onEnterTransitionEnd={() => newCommentRef.current?.focus()}
        onExitTransitionEnd={finishClose}
      >
        <Tabs value={tab} onChange={setTab}>
          {/* The tab bar stays pinned while the tab content scrolls. */}
          <div className="art-pinned art-pinned-tabs" ref={tabsBarRef}>
            <Tabs.List>
              <Tabs.Tab value="comments">Comments</Tabs.Tab>
              <Tabs.Tab value="reviewer">Reviewer</Tabs.Tab>
              <Tabs.Tab value="help">Help</Tabs.Tab>
            </Tabs.List>
          </div>
          <Tabs.Panel value="comments">
            <CommentsTab
              review={review}
              pageKey={pageKey}
              comments={pageComments}
              formLayout={formLayout}
              newCommentRef={newCommentRef}
              draft={draft}
              onDraftChange={setDraft}
              totalCount={total}
              focusId={focusId}
              onFocused={() => setFocusId(null)}
              capturing={capturing}
              captureTarget={captureTarget}
              onAddComment={handleAddComment}
              onAddScreenshot={handleAddScreenshot}
              onAddElement={handleAddElement}
              onAddScreenshotTo={handleAddScreenshotTo}
              onDuplicate={handleDuplicate}
              onRequestDelete={(comment) =>
                setConfirmation({ kind: "delete-comment", comment })
              }
              onAnnotate={(comment) => setAnnotateId(comment.id)}
            />
          </Tabs.Panel>
          <Tabs.Panel value="reviewer">
            <ReviewerTab review={review} formLayout={formLayout} />
          </Tabs.Panel>
          <Tabs.Panel value="help">
            <HelpTab />
          </Tabs.Panel>
        </Tabs>

        {/*
          No save-status text (an approved exception to the autosave
          status rule): saving is silent, and only a failure is reported,
          as a toast.
        */}
        <Panel.Footer>
          <Stack gap="rec-sm" w="100%">
            {/* Always present, so it never changes the footer's height: what
              the report and Start over act on, which is also why they are
              disabled when there is nothing yet. */}
            <Stack maw={300}>
              <Text variant="caption" emphasis="low">
                {total === 0
                  ? session
                    ? "Report: no comments yet"
                    : "Add a comment to start a session"
                  : `Report and Start over: ${plural(total, "comment", "comments")} across ${plural(pageCount, "page", "pages")}`}
              </Text>
            </Stack>
            <Group justify="space-between" wrap="nowrap" gap="rec-sm" w="100%">
              <Button
                variant="text"
                disabled={!session}
                data-start-over="true"
                onClick={() => setConfirmation({ kind: "start-over" })}
              >
                Start over
              </Button>
              <Button
                variant="solid"
                disabled={total === 0}
                onClick={() =>
                  downloadReport({
                    session,
                    userName: review.userName,
                    userEmail: review.userEmail,
                  })
                }
              >
                Download report
              </Button>
            </Group>
          </Stack>
        </Panel.Footer>
      </Panel>

      {/*
        The toast's live region is always in the DOM, so a message inserted
        into it is announced; a region created together with its message
        often is not. It sits over the page, not in the panel: the theme's
        toast min-width is wider than the panel.
      */}
      {createPortal(
        <div className="art-toast-anchor" aria-live="assertive" aria-atomic>
          {toast && (
            <Toast
              variant="error"
              withCloseButton
              closeButtonProps={{ "aria-label": "Dismiss message" }}
              onClose={() => setToast(null)}
              // The wrapper is the live region; a second one here would
              // announce the message twice.
              role="group"
              aria-label="Message"
            >
              {toast}
            </Toast>
          )}
        </div>,
        portalEl,
      )}

      <ConfirmModal
        opened={confirmationCopy != null}
        title={confirmationCopy?.title ?? ""}
        consequence={confirmationCopy?.consequence ?? ""}
        confirmLabel={confirmationCopy?.confirmLabel ?? ""}
        onCancel={cancelConfirmation}
        onConfirm={confirm}
      />
      {annotateComment?.screenshot && (
        <AnnotationEditor
          comment={{
            ...annotateComment,
            screenshot: annotateComment.screenshot,
          }}
          penColor={penColor}
          onPenColorChange={(color) => {
            setPenColor(color);
            review.track(savePenColor(color));
          }}
          onCancel={() => closeEditor(annotateComment.id)}
          onSave={(dataUrl) => {
            review.updateComment(
              pageKey,
              annotateComment.id,
              { screenshot: dataUrl },
              "now",
            );
            closeEditor(annotateComment.id);
          }}
          // A confirmation replaces the editor rather than stacking on it:
          // the editor closes (discarding any unsaved drawing) and the
          // delete confirmation opens in its place.
          onRequestDeleteScreenshot={() => {
            setAnnotateId(null);
            setConfirmation({
              kind: "delete-screenshot",
              comment: annotateComment,
            });
          }}
        />
      )}
    </div>
  );
}
