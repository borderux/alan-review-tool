import { useCallback, useEffect, useRef, useState } from "react";
import { generateGuid } from "./lib/ids";
import { saveReviewer, saveSession } from "./lib/storage";
import type { CapturedElement, ReviewComment, Session } from "./lib/types";

// Structural changes (a new, deleted or duplicated comment, a capture, a
// start over) save immediately. Plain typing saves after a pause instead,
// so chrome.storage.local isn't written on every keystroke.
const TYPING_SAVE_DELAY_MS = 400;

function newSession(): Session {
  return {
    startedAt: Date.now(),
    guid: generateGuid(),
    commentCounter: 0,
    pages: {},
    details: "",
  };
}

function withPageComments(
  session: Session,
  pageKey: string,
  update: (comments: ReviewComment[]) => ReviewComment[],
): Session {
  // Each page entry carries its own title, captured the first time a
  // comment touches that page, while document.title is still accurate.
  const page = session.pages[pageKey] ?? {
    title: document.title,
    comments: [],
  };
  return {
    ...session,
    pages: {
      ...session.pages,
      [pageKey]: { ...page, comments: update(page.comments) },
    },
  };
}

interface Options {
  initialSession: Session | null;
  initialUserName: string;
  initialUserEmail: string;
  // Called when a write to storage fails, with the browser's reason. The
  // panel shows no "saved" status (an approved exception); a failure is
  // the one save outcome it reports.
  onSaveError: (reason: string) => void;
}

export function useReviewSession({
  initialSession,
  initialUserName,
  initialUserEmail,
  onSaveError,
}: Options) {
  const [session, setSessionState] = useState<Session | null>(initialSession);
  const [userName, setUserNameState] = useState(initialUserName);
  const [userEmail, setUserEmailState] = useState(initialUserEmail);

  // Handlers need the latest session synchronously (for example, to hand
  // a new comment's id to focus), so it is mirrored in a ref that only
  // event handlers read.
  const latest = useRef<Session | null>(initialSession);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewer = useRef({
    userName: initialUserName,
    userEmail: initialUserEmail,
  });

  const onSaveErrorRef = useRef(onSaveError);
  useEffect(() => {
    onSaveErrorRef.current = onSaveError;
  }, [onSaveError]);

  // Every write goes through here, so a failure is reported the same way
  // whichever key was written. The unlimitedStorage permission lifts the
  // quota that screenshots would otherwise fill, but a write can still
  // fail.
  const track = useCallback((write: Promise<void>) => {
    write.catch((err: unknown) => {
      console.error("Snippy: could not save.", err);
      onSaveErrorRef.current(String(err instanceof Error ? err.message : err));
    });
  }, []);

  const commit = useCallback(
    (next: Session | null, mode: "now" | "typing") => {
      latest.current = next;
      setSessionState(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (mode === "now") {
        saveTimer.current = null;
        track(saveSession(next));
        return;
      }
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        track(saveSession(latest.current));
      }, TYPING_SAVE_DELAY_MS);
    },
    [track],
  );

  // Writes anything still waiting on the typing delay. Called when the
  // panel closes, so closing mid-sentence never loses the sentence.
  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void saveSession(latest.current);
    }
    if (reviewerTimer.current) {
      clearTimeout(reviewerTimer.current);
      reviewerTimer.current = null;
      void saveReviewer(reviewer.current.userName, reviewer.current.userEmail);
    }
  }, []);

  useEffect(() => flush, [flush]);

  // Creates a comment at the top of the page's list (newest first) and
  // returns its id. The comment number only ever goes up, even across
  // deletes: the number plus the session guid is a permanent id.
  const addComment = useCallback(
    (
      pageKey: string,
      text = "",
      screenshot: string | null = null,
      element?: CapturedElement,
    ) => {
      const base = latest.current ?? newSession();
      const commentNumber = base.commentCounter + 1;
      const comment: ReviewComment = {
        id: Date.now(),
        commentNumber,
        text,
        screenshot,
        ...(element ? { element } : {}),
      };
      commit(
        withPageComments(
          { ...base, commentCounter: commentNumber },
          pageKey,
          (list) => [comment, ...list],
        ),
        "now",
      );
      return comment.id;
    },
    [commit],
  );

  const duplicateComment = useCallback(
    (pageKey: string, source: ReviewComment) =>
      addComment(pageKey, source.text, source.screenshot, source.element),
    [addComment],
  );

  const updateComment = useCallback(
    (
      pageKey: string,
      id: number,
      patch: Partial<Pick<ReviewComment, "text" | "screenshot">>,
      mode: "now" | "typing",
    ) => {
      const current = latest.current;
      if (!current) return;
      commit(
        withPageComments(current, pageKey, (list) =>
          list.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        ),
        mode,
      );
    },
    [commit],
  );

  const deleteComment = useCallback(
    (pageKey: string, id: number) => {
      const current = latest.current;
      if (!current?.pages[pageKey]) return;
      commit(
        withPageComments(current, pageKey, (comments) =>
          comments.filter((c) => c.id !== id),
        ),
        "now",
      );
    },
    [commit],
  );

  // The first keystroke into session details with no session yet starts
  // one.
  const setDetails = useCallback(
    (details: string) => {
      commit({ ...(latest.current ?? newSession()), details }, "typing");
    },
    [commit],
  );

  const startOver = useCallback(() => commit(null, "now"), [commit]);

  const scheduleReviewerSave = useCallback(() => {
    if (reviewerTimer.current) clearTimeout(reviewerTimer.current);
    reviewerTimer.current = setTimeout(() => {
      reviewerTimer.current = null;
      track(
        saveReviewer(reviewer.current.userName, reviewer.current.userEmail),
      );
    }, TYPING_SAVE_DELAY_MS);
  }, [track]);

  const setUserName = useCallback(
    (value: string) => {
      reviewer.current.userName = value;
      setUserNameState(value);
      scheduleReviewerSave();
    },
    [scheduleReviewerSave],
  );

  const setUserEmail = useCallback(
    (value: string) => {
      reviewer.current.userEmail = value;
      setUserEmailState(value);
      scheduleReviewerSave();
    },
    [scheduleReviewerSave],
  );

  // Anything still waiting on the typing delay is written as soon as the
  // page is being hidden or unloaded, so a refresh never loses typing.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  return {
    track,
    session,
    userName,
    userEmail,
    addComment,
    duplicateComment,
    updateComment,
    deleteComment,
    setDetails,
    startOver,
    setUserName,
    setUserEmail,
    flush,
  };
}

export type ReviewSession = ReturnType<typeof useReviewSession>;
