import { useCallback, useEffect, useRef, useState } from "react";
import { generateGuid } from "./lib/ids";
import { saveReviewer, saveSession } from "./lib/storage";
import type { ReviewComment, Session } from "./lib/types";

// Structural changes (a new, deleted or duplicated comment, a capture, a
// clear) save immediately. Plain typing saves after a pause instead, so
// chrome.storage.local isn't written on every keystroke. Same timing as
// the pre-React panel.
const TYPING_SAVE_DELAY_MS = 400;

export type SaveStatus = "no-session" | "saving" | "saved" | "failed";

// A comment deleted in this panel instance, kept in memory so its delete
// control can turn into an Undo in the same place. Storage is updated at
// once; the undo re-inserts it. Nothing here is persisted, so the stored
// session shape is unchanged.
export interface DeletedComment {
  comment: ReviewComment;
  pageKey: string;
  // The id of the comment that followed it when it was deleted, or null
  // if it was last. The placeholder and any undo return it to that spot.
  beforeId: number | null;
}

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
  // Called when a write to storage fails, with the browser's reason.
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
  // Session and reviewer details save on separate timers; either one
  // pending means changes are still being saved.
  const [sessionSaving, setSessionSaving] = useState(false);
  const [reviewerSaving, setReviewerSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // When the last write finished, for the "saved at" status. Null until
  // this panel has saved something.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [deletedComments, setDeletedComments] = useState<DeletedComment[]>([]);
  // Screenshots deleted from a comment in this panel instance, by comment
  // id, so the slot can offer Undo.
  const [deletedScreenshots, setDeletedScreenshots] = useState<
    Record<number, string>
  >({});

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

  // Every write goes through here, so success and failure are reported
  // the same way whichever key was written.
  const track = useCallback((write: Promise<void>) => {
    write.then(
      () => {
        setSaveFailed(false);
        setSavedAt(Date.now());
      },
      (err: unknown) => {
        console.error("Alan Review Tool: could not save.", err);
        setSaveFailed(true);
        onSaveErrorRef.current(
          String(err instanceof Error ? err.message : err),
        );
      },
    );
  }, []);

  const commit = useCallback(
    (next: Session | null, mode: "now" | "typing") => {
      latest.current = next;
      setSessionState(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (mode === "now") {
        saveTimer.current = null;
        track(saveSession(next));
        setSessionSaving(false);
        return;
      }
      setSessionSaving(true);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        track(saveSession(latest.current));
        setSessionSaving(false);
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

  const nextNumber = (s: Session): [Session, number] => {
    const n = s.commentCounter + 1;
    return [{ ...s, commentCounter: n }, n];
  };

  // Creates a comment at the top of the page's list (newest first) and
  // returns its id. The CM-<n> counter only ever goes up, even across
  // deletes: CM-<n> plus the session guid is a permanent id.
  const addComment = useCallback(
    (pageKey: string, text = "", screenshot: string | null = null) => {
      const [numbered, commentNumber] = nextNumber(
        latest.current ?? newSession(),
      );
      const comment: ReviewComment = {
        id: Date.now(),
        commentNumber,
        text,
        screenshot,
      };
      commit(
        withPageComments(numbered, pageKey, (list) => [comment, ...list]),
        "now",
      );
      return comment.id;
    },
    [commit],
  );

  const duplicateComment = useCallback(
    (pageKey: string, source: ReviewComment) =>
      addComment(pageKey, source.text, source.screenshot),
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

  // Removes a comment. `withUndo: false` is for the silent cleanup of a
  // comment that was started and left empty - there is nothing to undo.
  const deleteComment = useCallback(
    (pageKey: string, id: number, withUndo: boolean) => {
      const current = latest.current;
      const list = current?.pages[pageKey]?.comments;
      if (!current || !list) return;
      const index = list.findIndex((c) => c.id === id);
      if (index === -1) return;
      if (withUndo) {
        const deleted: DeletedComment = {
          comment: list[index],
          pageKey,
          beforeId: list[index + 1]?.id ?? null,
        };
        setDeletedComments((all) => [...all, deleted]);
      }
      commit(
        withPageComments(current, pageKey, (comments) =>
          comments.filter((c) => c.id !== id),
        ),
        "now",
      );
    },
    [commit],
  );

  const undoDeleteComment = useCallback(
    (id: number) => {
      const entry = deletedComments.find((d) => d.comment.id === id);
      setDeletedComments((all) => all.filter((d) => d.comment.id !== id));
      if (!entry) return;
      commit(
        withPageComments(
          latest.current ?? newSession(),
          entry.pageKey,
          (comments) => {
            const at =
              entry.beforeId == null
                ? comments.length
                : comments.findIndex((c) => c.id === entry.beforeId);
            const next = [...comments];
            next.splice(at === -1 ? 0 : at, 0, entry.comment);
            return next;
          },
        ),
        "now",
      );
    },
    [commit, deletedComments],
  );

  const deleteScreenshot = useCallback(
    (pageKey: string, comment: ReviewComment) => {
      if (!comment.screenshot) return;
      const shot = comment.screenshot;
      setDeletedScreenshots((all) => ({ ...all, [comment.id]: shot }));
      updateComment(pageKey, comment.id, { screenshot: null }, "now");
    },
    [updateComment],
  );

  const undoDeleteScreenshot = useCallback(
    (pageKey: string, commentId: number) => {
      const shot = deletedScreenshots[commentId];
      setDeletedScreenshots((all) => {
        const rest = { ...all };
        delete rest[commentId];
        return rest;
      });
      if (shot) updateComment(pageKey, commentId, { screenshot: shot }, "now");
    },
    [updateComment, deletedScreenshots],
  );

  // The first keystroke into session details with no session yet starts
  // one, exactly as before.
  const setDetails = useCallback(
    (details: string) => {
      commit({ ...(latest.current ?? newSession()), details }, "typing");
    },
    [commit],
  );

  const clearSession = useCallback(() => {
    setDeletedComments([]);
    setDeletedScreenshots({});
    commit(null, "now");
  }, [commit]);

  const scheduleReviewerSave = useCallback(() => {
    if (reviewerTimer.current) clearTimeout(reviewerTimer.current);
    setReviewerSaving(true);
    reviewerTimer.current = setTimeout(() => {
      reviewerTimer.current = null;
      track(
        saveReviewer(reviewer.current.userName, reviewer.current.userEmail),
      );
      setReviewerSaving(false);
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

  const saveStatus: SaveStatus =
    sessionSaving || reviewerSaving
      ? "saving"
      : saveFailed
        ? "failed"
        : !session
          ? "no-session"
          : "saved";

  return {
    session,
    userName,
    userEmail,
    saveStatus,
    savedAt,
    deletedComments,
    deletedScreenshots,
    addComment,
    duplicateComment,
    updateComment,
    deleteComment,
    undoDeleteComment,
    deleteScreenshot,
    undoDeleteScreenshot,
    setDetails,
    clearSession,
    setUserName,
    setUserEmail,
    flush,
  };
}

export type ReviewSession = ReturnType<typeof useReviewSession>;
