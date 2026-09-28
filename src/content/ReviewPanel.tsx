import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
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
import { ClearSessionModal } from "./components/ClearSessionModal";
import { CommentsTab } from "./components/CommentsTab";
import { HelpTab } from "./components/HelpTab";
import { LightboxModal } from "./components/LightboxModal";
import { PanelTitle } from "./components/PanelTitle";
import { ResizeHandle } from "./components/ResizeHandle";
import { SessionTab } from "./components/SessionTab";
import { captureRegion } from "./lib/capture";
import { formatTime } from "./lib/format";
import {
  CLOSE_EVENT,
  currentPageKey,
  findInPanel,
  markPanelNonModal,
  setHostWidth,
} from "./lib/page";
import { downloadReport, totalCommentCount } from "./lib/report";
import type { StoredState } from "./lib/storage";
import type { ReviewComment } from "./lib/types";
import { useReviewSession, type SaveStatus } from "./useReviewSession";

// If the panel's close transition never reports that it finished (for
// example with reduced motion), tear down anyway after this long.
const CLOSE_FALLBACK_MS = 600;

// Labels sit beside their fields once the panel is wide enough to hold
// both, and stack above them when it is not. The test is the form's
// container (the panel), not the viewport, and it is applied once to
// every field in the panel.
const SIDE_BY_SIDE_MIN_WIDTH = 480;

export type FormLayout = "stacked" | "side-by-side";

// Label placement and alignment for every field, decided together: beside
// the field means right-aligned against it.
export function fieldLayout(formLayout: FormLayout) {
  return {
    formLayout,
    labelAlignment: formLayout === "side-by-side" ? "right" : "left",
  } as const;
}

function saveStatusText(status: SaveStatus, savedAt: number | null): string {
  switch (status) {
    case "no-session":
      return "No session yet";
    case "saving":
      return "Saving changes";
    case "failed":
      return "Changes not saved";
    case "saved":
      return savedAt
        ? `All changes saved at ${formatTime(savedAt)}`
        : "All changes saved";
  }
}

// What is being captured right now: a new screenshot comment, or a
// screenshot for an existing comment (by id).
type CaptureTarget = "new" | number | null;

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
  const [tab, setTab] = useState<string | null>("comments");
  const [clearOpen, setClearOpen] = useState(false);
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget>(null);
  const addCommentRef = useRef<HTMLButtonElement>(null);
  const closedRef = useRef(false);
  // True while a screenshot is being selected: the panel is hidden, so
  // its text loses focus, and that blur must not clean up the comment the
  // screenshot is for.
  const capturing = useRef(false);

  const pageKey = currentPageKey();
  const pageComments = session?.pages[pageKey]?.comments ?? [];
  const total = totalCommentCount(session);
  const lightboxComment =
    lightboxId == null
      ? null
      : (pageComments.find((c) => c.id === lightboxId) ?? null);
  const formLayout: FormLayout =
    width >= SIDE_BY_SIDE_MIN_WIDTH ? "side-by-side" : "stacked";

  // Slide in after the first paint, so the open is a transition.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpened(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (opened) markPanelNonModal(host);
  }, [host, opened]);

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
  // modal is open, which uses Escape for itself.
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (clearOpen || lightboxComment) return;
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

  const showCaptureError = (reason: string) =>
    setToast(`Screenshot not captured: ${reason}`);

  const handleAddComment = () => {
    setToast(null);
    setFocusId(review.addComment(pageKey));
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

  const handleDuplicate = (comment: ReviewComment) => {
    setToast(null);
    setFocusId(review.duplicateComment(pageKey, comment));
  };

  const closeLightbox = (id: number) => {
    setLightboxId(null);
    returnFocus(
      `[data-shot-edit="${id}"]`,
      `[data-shot-undo="${id}"]`,
      '[role="tab"][aria-selected="true"]',
    );
  };

  return (
    <div onKeyDown={onKeyDown}>
      <ResizeHandle width={width} onChange={onWidthChange} visible={opened} />
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
        placement="right"
        withOverlay={false}
        closeOnClickOutside={false}
        trapFocus={false}
        lockScroll={false}
        closeOnEscape={false}
        withinPortal={false}
        returnFocus={false}
        title={<PanelTitle />}
        // The title wraps rather than truncating, so the version stays
        // visible at narrow widths.
        wrapHeaderText={false}
        closeButtonProps={{ "aria-label": "Close review panel" }}
        onEnterTransitionEnd={() => addCommentRef.current?.focus()}
        onExitTransitionEnd={finishClose}
      >
        <Tabs value={tab} onChange={setTab}>
          <Tabs.List>
            <Tabs.Tab value="comments">Comments</Tabs.Tab>
            <Tabs.Tab value="session">Session</Tabs.Tab>
            <Tabs.Tab value="help">Help</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="comments">
            <CommentsTab
              review={review}
              pageKey={pageKey}
              comments={pageComments}
              formLayout={formLayout}
              addCommentRef={addCommentRef}
              focusId={focusId}
              onFocused={() => setFocusId(null)}
              capturing={capturing}
              captureTarget={captureTarget}
              onAddComment={handleAddComment}
              onAddScreenshot={handleAddScreenshot}
              onAddScreenshotTo={handleAddScreenshotTo}
              onDuplicate={handleDuplicate}
              onEditScreenshot={(comment) => setLightboxId(comment.id)}
            />
          </Tabs.Panel>
          <Tabs.Panel value="session">
            <SessionTab review={review} total={total} formLayout={formLayout} />
          </Tabs.Panel>
          <Tabs.Panel value="help">
            <HelpTab />
          </Tabs.Panel>
        </Tabs>

        <Panel.Footer>
          <Stack gap="rec-sm" w="100%">
            <Text variant="caption" emphasis="low" role="status">
              {saveStatusText(review.saveStatus, review.savedAt)}
            </Text>
            <Group justify="space-between" wrap="nowrap" gap="rec-sm">
              <Button
                variant="text"
                disabled={!session}
                data-clear-session="true"
                onClick={() => setClearOpen(true)}
              >
                Clear session
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

      <ClearSessionModal
        opened={clearOpen}
        onCancel={() => {
          setClearOpen(false);
          returnFocus('[data-clear-session="true"]');
        }}
        onConfirm={() => {
          review.clearSession();
          setClearOpen(false);
          // Clear session is disabled now there is no session.
          returnFocus('[role="tab"][aria-selected="true"]');
        }}
      />
      {lightboxComment?.screenshot && (
        <LightboxModal
          comment={{
            ...lightboxComment,
            screenshot: lightboxComment.screenshot,
          }}
          onCancel={() => closeLightbox(lightboxComment.id)}
          onSave={(dataUrl) => {
            review.updateComment(
              pageKey,
              lightboxComment.id,
              { screenshot: dataUrl },
              "now",
            );
            closeLightbox(lightboxComment.id);
          }}
          onDelete={() => {
            review.deleteScreenshot(pageKey, lightboxComment);
            closeLightbox(lightboxComment.id);
          }}
        />
      )}
    </div>
  );
}
