import { generateGuid } from "./ids";
import type { ReviewComment, ReviewPage, Session } from "./types";

export const WIDTH_STORAGE_KEY = "alanReviewToolPanelWidth";
export const SESSION_STORAGE_KEY = "alanReviewToolSession";
export const USER_STORAGE_KEY = "alanReviewToolUser";
export const EMAIL_STORAGE_KEY = "alanReviewToolEmail";

// The panel's three tabs need about 330px before they wrap onto a second
// row, and navigation must never wrap. The minimum was 240px before the
// tabs existed; a stored width below the new minimum is clamped up. This
// range is an interim choice awaiting the owner's decision.
export const DEFAULT_WIDTH = 360;
export const MIN_WIDTH = 336;
export const MAX_WIDTH = 720;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export interface StoredState {
  width: number;
  session: Session | null;
  userName: string;
  userEmail: string;
}

// Normalizes a session read from storage, in place, before anything else
// touches it. Real users' storage holds sessions from every version of
// this extension they have had installed, and old-shape data reaching new
// code has already crashed the panel on load once. Unchanged from the
// pre-React panel: the stored shape itself has not changed.
export function migrateSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== "object") return null;
  const session = raw as Session;
  // Sessions saved before pages gained a `title` (back when
  // session.pages[key] was just a comments array) - normalize them to the
  // { title, comments } shape.
  for (const key of Object.keys(session.pages)) {
    const page = session.pages[key] as ReviewPage | ReviewComment[];
    if (Array.isArray(page)) {
      session.pages[key] = { title: key, comments: page };
    }
  }
  // Sessions saved before the guid and the CM-<n> counter existed have
  // neither. Backfill a guid, and number every existing comment oldest
  // first (each page's array is newest-first, from unshift), so numbering
  // approximates real creation order.
  if (!session.guid) session.guid = generateGuid();
  if (typeof session.commentCounter !== "number") session.commentCounter = 0;
  for (const page of Object.values(session.pages)) {
    for (const comment of [...page.comments].reverse()) {
      if (comment.commentNumber == null) {
        session.commentCounter += 1;
        comment.commentNumber = session.commentCounter;
      }
    }
  }
  return session;
}

export async function loadStoredState(): Promise<StoredState> {
  const stored = await chrome.storage.local.get([
    WIDTH_STORAGE_KEY,
    SESSION_STORAGE_KEY,
    USER_STORAGE_KEY,
    EMAIL_STORAGE_KEY,
  ]);
  return {
    width: clamp(
      (stored[WIDTH_STORAGE_KEY] as number | undefined) ?? DEFAULT_WIDTH,
      MIN_WIDTH,
      MAX_WIDTH,
    ),
    session: migrateSession(stored[SESSION_STORAGE_KEY]),
    // Reviewer identity lives under its own keys and is never cleared by
    // Clear session - it is an identity fact, not session data.
    userName: (stored[USER_STORAGE_KEY] as string | undefined) || "",
    userEmail: (stored[EMAIL_STORAGE_KEY] as string | undefined) || "",
  };
}

// One object under one key: chrome.storage.local is shared across every
// origin this extension runs on, which is what makes "any site, one
// session" work at all.
//
// Writes return their promise so a failure can be reported: screenshots
// live in the session, and without the unlimitedStorage permission the
// storage quota is reachable.
export function saveSession(session: Session | null): Promise<void> {
  if (session)
    return chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
  return chrome.storage.local.remove(SESSION_STORAGE_KEY);
}

export function saveReviewer(
  userName: string,
  userEmail: string,
): Promise<void> {
  return chrome.storage.local.set({
    [USER_STORAGE_KEY]: userName,
    [EMAIL_STORAGE_KEY]: userEmail,
  });
}

export function saveWidth(width: number): void {
  void chrome.storage.local.set({ [WIDTH_STORAGE_KEY]: width });
}
