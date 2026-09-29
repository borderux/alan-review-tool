import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button, Group, Panel, Toast } from "@recursica/adapter-mantine-v8";
import { AddMenu } from "./components/AddMenu";
import { AnnotationEditor } from "./components/AnnotationEditor";
import { CommentList, type CaptureTarget } from "./components/CommentList";
import { ConfirmModal } from "./components/ConfirmModal";
import { DownloadModal, type ReportDetails } from "./components/DownloadModal";
import { ResizeHandle } from "./components/ResizeHandle";
import { captureElement, captureRegion } from "./lib/capture";
import { commentName } from "./lib/ids";
import { detectRecursica } from "./lib/recursica";
import {
  CLOSE_EVENT,
  currentPageKey,
  findInPanel,
  makeBehindModalInert,
  markPanelNonModal,
  setHostWidth,
} from "./lib/page";
import { downloadReport, totalCommentCount } from "./lib/report";
import { savePenColor, type PenColor, type StoredState } from "./lib/storage";
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
  const { session, flush } = review;

  const [opened, setOpened] = useState(false);
  const [width, setWidth] = useState(stored.width);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [annotateId, setAnnotateId] = useState<number | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  // Where the Add menu renders: a slot at the start of the panel header,
  // before the title (see below).
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [penColor, setPenColor] = useState<PenColor>(stored.penColor);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget>(null);
  const closedRef = useRef(false);
  // True while a screenshot is being selected: the panel is hidden, so
  // its text loses focus, and that blur must not clean up the comment the
  // screenshot is for.
  const capturing = useRef(false);

  const pageKey = usePageKey();
  const pageComments = session?.pages[pageKey]?.comments ?? [];
  const total = totalCommentCount(session);
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

  // The Add menu sits in the panel header, left of the title. The kit's
  // panel header has a title and a close button and no slot for anything
  // else, and putting a button inside the title would make the panel's
  // accessible name "Add Snippy". So a slot element is placed first in the
  // header and the menu is rendered into it (a reported gap: no header
  // actions slot on Panel).
  useEffect(() => {
    const header = findInPanel(host, ".mantine-Drawer-header");
    if (!header) return;
    const slot = document.createElement("div");
    slot.className = "art-header-slot";
    header.prepend(slot);
    const frame = requestAnimationFrame(() => setHeaderSlot(slot));
    return () => {
      cancelAnimationFrame(frame);
      slot.remove();
    };
  }, [host]);

  // While a modal is open, everything behind it is inert - the host page
  // and the panel itself - so a screen reader's reading cursor can't wander
  // out of the modal either. The page's own setting is put back after.
  const modalOpen = confirmation != null || annotateId != null || downloadOpen;
  useEffect(() => {
    if (!modalOpen) return;
    return makeBehindModalInert(host);
  }, [host, modalOpen]);

  const finishClose = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClosed();
  }, [onClosed]);

  const requestClose = useCallback(() => {
    flush();
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
    if (confirmation || annotateComment || downloadOpen) return;
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
  // Where focus goes when the control that had it is gone: the Add menu,
  // the one control that is always there.
  const ADD_MENU = "[data-add-menu]";

  const showCaptureError = (reason: string) =>
    setToast(`Screenshot not captured: ${reason}`);

  // Once a page has a comment, check whether it is built with Recursica
  // (and which versions) for the report - again on later comments while
  // nothing has been found yet. Runs in the background after the comment
  // exists; never blocks or throws (see lib/recursica.ts).
  const detectPage = (key: string) => {
    const known = review.session?.pages[key]?.recursica;
    if (known?.recursica) return;
    void detectRecursica().then((result) => {
      if (currentPageKey() === key) review.setPageRecursica(key, result);
    });
  };

  // Each Add menu item creates a new comment at the top with focus in its
  // text box. An empty one vanishes when left, as before.
  const handleAddComment = () => {
    setToast(null);
    setFocusId(review.addComment(pageKey));
    detectPage(pageKey);
  };

  const handleAddScreenshot = async () => {
    setToast(null);
    setCaptureTarget("screenshot");
    const result = await captureRegion(host);
    setCaptureTarget(null);
    // Cancelled or failed: no comment, and focus goes back to Add rather
    // than being left nowhere.
    if (!result || "error" in result) {
      if (result) showCaptureError(result.error);
      returnFocus(ADD_MENU);
      return;
    }
    setFocusId(review.addComment(pageKey, "", result.dataUrl));
    detectPage(pageKey);
  };

  const handleAddElement = async () => {
    setToast(null);
    setCaptureTarget("element");
    const result = await captureElement(host);
    setCaptureTarget(null);
    if (!result || "error" in result) {
      if (result) setToast(`Element not captured: ${result.error}`);
      returnFocus(ADD_MENU);
      return;
    }
    setFocusId(review.addComment(pageKey, "", result.dataUrl, result.element));
    detectPage(pageKey);
  };

  const handleAddScreenshotTo = async (comment: ReviewComment) => {
    setToast(null);
    capturing.current = true;
    setCaptureTarget(comment.id);
    const result = await captureRegion(host);
    capturing.current = false;
    setCaptureTarget(null);
    // Cancelled or failed: focus goes back to this row's Add screenshot
    // button, which is still there.
    if (!result || "error" in result) {
      if (result) showCaptureError(result.error);
      returnFocus(`[data-shot-add="${comment.id}"]`, ADD_MENU);
      return;
    }
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

  // Download report: save what the reviewer entered (name and email under
  // their own keys, session details in the session, as before), then build
  // the report from exactly those values.
  const downloadWith = (values: ReportDetails) => {
    review.setUserName(values.userName);
    review.setUserEmail(values.userEmail);
    if (session && values.details !== session.details)
      review.setDetails(values.details);
    downloadReport({
      session: session ? { ...session, details: values.details } : session,
      userName: values.userName,
      userEmail: values.userEmail,
    });
    setDownloadOpen(false);
    returnFocus("[data-download]", ADD_MENU);
  };

  const closeEditor = (id: number) => {
    setAnnotateId(null);
    returnFocus(`[data-shot-edit="${id}"]`, ADD_MENU);
  };

  const cancelConfirmation = () => {
    const current = confirmation;
    setConfirmation(null);
    if (current?.kind === "delete-comment")
      returnFocus(`[data-row-menu="${current.comment.id}"]`, ADD_MENU);
    else if (current?.kind === "delete-screenshot")
      returnFocus(`[data-shot-edit="${current.comment.id}"]`, ADD_MENU);
    else returnFocus("[data-start-over]", ADD_MENU);
  };

  const confirm = () => {
    const current = confirmation;
    setConfirmation(null);
    if (!current) return;
    if (current.kind === "delete-comment") {
      review.deleteComment(pageKey, current.comment.id);
      // The comment and its menu are gone; the add field is the nearest
      // place to continue.
      returnFocus(ADD_MENU);
    } else if (current.kind === "delete-screenshot") {
      review.updateComment(
        pageKey,
        current.comment.id,
        { screenshot: null },
        "now",
      );
      returnFocus(`[data-shot-add="${current.comment.id}"]`, ADD_MENU);
    } else {
      review.startOver();
      // Start over is disabled now there is no session.
      returnFocus(ADD_MENU);
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
    const id = commentName(confirmation.comment.commentNumber);
    const Id = commentName(confirmation.comment.commentNumber, true);
    if (confirmation.kind === "delete-comment")
      return {
        title: `Delete ${id}`,
        consequence: confirmation.comment.screenshot
          ? `${Id} and its screenshot will be deleted. This can't be undone.`
          : `${Id} will be deleted. This can't be undone.`,
        confirmLabel: "Delete comment",
      };
    return {
      title: `Delete screenshot from ${id}`,
      consequence: `Deletes the screenshot and its annotations from ${id}. The comment text stays. This can't be undone.`,
      confirmLabel: "Delete screenshot",
    };
  })();

  return (
    <div className="art-panel" onKeyDown={onKeyDown}>
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
        // The product name, in sentence case. The version is not shown in
        // the panel (the browser's extension details show it); it is in the
        // report's hidden metadata.
        title="Snippy"
        closeButtonProps={{ "aria-label": "Close Snippy" }}
        onEnterTransitionEnd={() => findInPanel(host, ADD_MENU)?.focus()}
        onExitTransitionEnd={finishClose}
      >
        <CommentList
          review={review}
          pageKey={pageKey}
          comments={pageComments}
          formLayout={formLayout}
          focusId={focusId}
          onFocused={() => setFocusId(null)}
          capturing={capturing}
          captureTarget={captureTarget}
          onAddScreenshotTo={handleAddScreenshotTo}
          onDuplicate={handleDuplicate}
          onRequestDelete={(comment) =>
            setConfirmation({ kind: "delete-comment", comment })
          }
          onAnnotate={(comment) => setAnnotateId(comment.id)}
        />

        {/*
          No save-status text (an approved exception to the autosave
          status rule): saving is silent, and only a failure is reported,
          as a toast.
        */}
        {/* Buttons only, no text (owner decision). */}
        <Panel.Footer>
          <Group justify="space-between" wrap="nowrap" gap="rec-sm" w="100%">
            <Button
              variant="text"
              size="small"
              disabled={!session}
              data-start-over="true"
              onClick={() => setConfirmation({ kind: "start-over" })}
            >
              Start over
            </Button>
            <Button
              variant="solid"
              size="small"
              disabled={total === 0}
              data-download="true"
              onClick={() => setDownloadOpen(true)}
            >
              Download report
            </Button>
          </Group>
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
      {headerSlot &&
        createPortal(
          <AddMenu
            busy={captureTarget === "screenshot" || captureTarget === "element"}
            onAddComment={handleAddComment}
            onAddScreenshot={handleAddScreenshot}
            onAddElement={handleAddElement}
          />,
          headerSlot,
        )}

      {downloadOpen && (
        <DownloadModal
          initial={{
            userName: review.userName,
            userEmail: review.userEmail,
            details: session?.details ?? "",
          }}
          onCancel={() => {
            setDownloadOpen(false);
            returnFocus("[data-download]", ADD_MENU);
          }}
          onDownload={downloadWith}
        />
      )}
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
