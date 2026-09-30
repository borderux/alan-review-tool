import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Group,
  Panel,
  Stack,
  Text,
  Toast,
} from "@recursica/adapter-mantine-v8";
import { AddMenu } from "./components/AddMenu";
import { AnnotationEditor } from "./components/AnnotationEditor";
import {
  CommentList,
  type CaptureTarget,
  type PageGroup,
} from "./components/CommentList";
import { ConfirmModal } from "./components/ConfirmModal";
import { DownloadModal, type ReportDetails } from "./components/DownloadModal";
import { ResizeHandle } from "./components/ResizeHandle";
import { ViewOptions } from "./components/ViewOptions";
import { captureElement, captureRegion } from "./lib/capture";
import { formatCount, plural } from "./lib/format";
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
import {
  savePageOnly,
  savePenColor,
  saveShowImages,
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

// The one panel confirmation that can be open, if any. (The annotation
// editor asks its own questions, stacked on the editor.)
type Confirmation =
  | { kind: "delete-comment"; pageKey: string; comment: ReviewComment }
  | { kind: "start-over" };

// The id of the element holding the failed-load message, which is also
// the disabled Add button's description.
const LOAD_ERROR_ID = "art-load-error";

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
  // The comment whose screenshot is open in the annotation editor.
  const [annotating, setAnnotating] = useState<{
    pageKey: string;
    id: number;
  } | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  // Where the Add menu renders: a slot at the start of the panel header,
  // before the title (see below).
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [pageOnly, setPageOnly] = useState(stored.pageOnly);
  const [showImages, setShowImages] = useState(stored.showImages);
  const loadFailed = Boolean(stored.loadFailed);
  const [penColor, setPenColor] = useState<PenColor>(stored.penColor);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget>(null);
  const closedRef = useRef(false);
  // True while a screenshot is being selected: the panel is hidden, so
  // its text loses focus, and that blur must not clean up the comment the
  // screenshot is for.
  const capturing = useRef(false);

  const pageKey = usePageKey();
  const total = totalCommentCount(session);
  const annotateComment =
    annotating == null
      ? null
      : (session?.pages[annotating.pageKey]?.comments.find(
          (c) => c.id === annotating.id,
        ) ?? null);

  // What the list shows. This page only: the current page's comments.
  // Otherwise every page's, grouped by page: the current page first, then
  // the others, most recently commented first (a comment's id is its
  // creation time).
  const currentGroup: PageGroup = {
    pageKey,
    title: session?.pages[pageKey]?.title ?? document.title,
    comments: session?.pages[pageKey]?.comments ?? [],
    current: true,
  };
  const groups: PageGroup[] = pageOnly
    ? [currentGroup]
    : [
        currentGroup,
        ...Object.entries(session?.pages ?? {})
          .filter(([key, page]) => key !== pageKey && page.comments.length > 0)
          .map(([key, page]) => ({
            pageKey: key,
            title: page.title,
            comments: page.comments,
            current: false,
          }))
          .sort(
            (a, b) =>
              Math.max(...b.comments.map((c) => c.id)) -
              Math.max(...a.comments.map((c) => c.id)),
          ),
      ];
  const formLayout: FormLayout = "stacked";

  // Slide in after the first paint, so the open is a transition.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpened(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (opened) markPanelNonModal(host);
  }, [host, opened]);

  // Workaround (adapter gap): the kit's panel header has a title and a
  // close button and no slot for actions, and its compound parts
  // (Panel.Header, Panel.Title) carry none of the panel's styling, so a
  // custom header can't be composed either. Putting the button inside the
  // title would make the panel's accessible name "Add Snippy". So a slot
  // element is placed first in the header and the Add menu is rendered
  // into it. Header order: Add, title, Close.
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
  const modalOpen = confirmation != null || annotating != null || downloadOpen;
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

  const handleAddScreenshotTo = async (
    commentPage: string,
    comment: ReviewComment,
  ) => {
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
      commentPage,
      comment.id,
      { screenshot: result.dataUrl },
      "now",
    );
    setFocusId(comment.id);
  };

  // From the row menu: focus goes back to the menu's trigger, not into
  // the new comment (the menu rule).
  // A duplicate belongs to the same page as the comment it copies.
  const handleDuplicate = (commentPage: string, comment: ReviewComment) => {
    setToast(null);
    review.duplicateComment(commentPage, comment);
  };

  // Download comments: save what the reviewer entered (name and email under
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
    setAnnotating(null);
    returnFocus(`[data-shot-edit="${id}"]`, ADD_MENU);
  };

  const cancelConfirmation = () => {
    const current = confirmation;
    setConfirmation(null);
    if (current?.kind === "delete-comment")
      returnFocus(`[data-row-menu="${current.comment.id}"]`, ADD_MENU);
    else returnFocus("[data-start-over]", ADD_MENU);
  };

  const confirm = () => {
    const current = confirmation;
    setConfirmation(null);
    if (!current) return;
    if (current.kind === "delete-comment") {
      review.deleteComment(current.pageKey, current.comment.id);
      // The comment and its menu are gone; the Add menu is the nearest
      // place to continue.
      returnFocus(ADD_MENU);
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
        title: "Delete all comments?",
        consequence: `All ${plural(total, "comment", "comments")} and their screenshots, on every page, will be deleted. This can't be undone.`,
        confirmLabel: "Delete all comments",
      };
    const id = commentName(confirmation.comment.commentNumber);
    const Id = commentName(confirmation.comment.commentNumber, true);
    return {
      title: `Delete ${id}?`,
      consequence: confirmation.comment.screenshot
        ? `${Id} and its screenshot will be deleted. This can't be undone.`
        : `${Id} will be deleted. This can't be undone.`,
      confirmLabel: "Delete comment",
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
        // Focus starts on Add - or on the close button when Add is
        // disabled because saved data could not be loaded.
        onEnterTransitionEnd={() =>
          returnFocus(ADD_MENU, ".mantine-Drawer-close")
        }
        onExitTransitionEnd={finishClose}
      >
        {/* Storage could not be read: say so where the list would be. The
            one text in the panel body, and the reason Add is disabled. */}
        {loadFailed ? (
          <Text id={LOAD_ERROR_ID} role="alert">
            Your saved comments could not be loaded, so adding comments is
            turned off. Close Snippy and open it again to try again.
          </Text>
        ) : (
          // The comment list, then the view options at the very end of the
          // scrolling area, so they scroll with the comments. The whole
          // block ends with space of its own (a spacing token, as its
          // bottom margin), so at the end of the scroll it clears the
          // pinned footer: the panel body's own bottom padding sits below
          // the footer, not above it.
          <Stack gap="rec-lg" mb="rec-lg">
            <CommentList
              review={review}
              grouped={!pageOnly}
              groups={groups}
              showImages={showImages}
              formLayout={formLayout}
              focusId={focusId}
              onFocused={() => setFocusId(null)}
              capturing={capturing}
              captureTarget={captureTarget}
              onAddScreenshotTo={handleAddScreenshotTo}
              onDuplicate={handleDuplicate}
              onRequestDelete={(commentPage, comment) =>
                setConfirmation({
                  kind: "delete-comment",
                  pageKey: commentPage,
                  comment,
                })
              }
              onAnnotate={(comment) =>
                setAnnotating({
                  pageKey:
                    groups.find((g) => g.comments.includes(comment))?.pageKey ??
                    pageKey,
                  id: comment.id,
                })
              }
            />
            <ViewOptions
              pageOnly={pageOnly}
              showImages={showImages}
              onPageOnlyChange={(next) => {
                setPageOnly(next);
                review.track(savePageOnly(next));
              }}
              onShowImagesChange={(next) => {
                setShowImages(next);
                review.track(saveShowImages(next));
              }}
            />
          </Stack>
        )}

        {/*
          No save-status text (an approved exception to the autosave
          status rule): saving is silent, and only a failure is reported,
          as a toast.
        */}
        {/* Buttons only, no text (owner decision). */}
        <Panel.Footer>
          <Group justify="space-between" wrap="nowrap" gap="rec-sm" w="100%">
            {/* The footer's two buttons are the default size; every other
                button in the panel is small (owner decision). */}
            <Button
              variant="text"
              disabled={!session}
              data-start-over="true"
              onClick={() => setConfirmation({ kind: "start-over" })}
            >
              Start over
            </Button>
            {/* The count is every comment in the report, on every page -
                not only the ones showing. In parentheses after a label
                that doesn't change, left out at zero; the accessible name
                spells it out. */}
            <Button
              variant="solid"
              disabled={total === 0}
              data-download="true"
              aria-label={
                total > 0
                  ? `Download ${plural(total, "comment", "comments")}`
                  : undefined
              }
              onClick={() => setDownloadOpen(true)}
            >
              {total > 0
                ? `Download comments (${formatCount(total)})`
                : "Download comments"}
            </Button>
          </Group>
        </Panel.Footer>
      </Panel>

      {/*
        The toast's live region is always in the DOM, so a message inserted
        into it is announced; a region created together with its message
        often is not (a MUST in the toast rules). It renders in the layer-0
        portal. The kit's Toast has no placement of its own, so it shows
        wherever that container is - the top-left corner of the viewport;
        the hand-set position it used to have was removed in the adapter
        workaround audit.
      */}
      {createPortal(
        <div aria-live="assertive" aria-atomic>
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
            disabled={loadFailed}
            describedBy={loadFailed ? LOAD_ERROR_ID : undefined}
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
      {annotating && annotateComment?.screenshot && (
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
              annotating.pageKey,
              annotateComment.id,
              { screenshot: dataUrl },
              "now",
            );
            closeEditor(annotateComment.id);
          }}
          // Confirmed in the editor, which asks first.
          onDeleteScreenshot={() => {
            review.updateComment(
              annotating.pageKey,
              annotateComment.id,
              { screenshot: null },
              "now",
            );
            setAnnotating(null);
            returnFocus(`[data-shot-add="${annotateComment.id}"]`, ADD_MENU);
          }}
        />
      )}
    </div>
  );
}
