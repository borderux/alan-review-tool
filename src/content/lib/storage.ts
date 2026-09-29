import { generateGuid } from "./ids";
import type { ReviewComment, ReviewPage, Session } from "./types";

export const WIDTH_STORAGE_KEY = "taggerPanelWidth";
export const SESSION_STORAGE_KEY = "taggerSession";
export const USER_STORAGE_KEY = "taggerUser";
export const EMAIL_STORAGE_KEY = "taggerEmail";
// The annotation pen's last colour: a preference, like the width, so it is
// never cleared by Start over.
export const PEN_COLOR_STORAGE_KEY = "taggerPenColor";
// The unsent text in the New comment field. Kept so closing the panel
// never throws it away; cleared once the comment is added.
export const DRAFT_STORAGE_KEY = "taggerDraft";

// Keys from before the rename to Tagger, mapped to their new names. Real
// users' storage still holds data under the old keys (see
// migrateStorageKeys).
const LEGACY_KEYS: Record<string, string> = {
  alanReviewToolPanelWidth: WIDTH_STORAGE_KEY,
  alanReviewToolSession: SESSION_STORAGE_KEY,
  alanReviewToolUser: USER_STORAGE_KEY,
  alanReviewToolEmail: EMAIL_STORAGE_KEY,
};

export const PEN_COLORS = [
  "red",
  "white",
  "black",
  "green",
  "blue",
  "yellow",
] as const;
export type PenColor = (typeof PEN_COLORS)[number];
export const DEFAULT_PEN_COLOR: PenColor = "red";

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
  penColor: PenColor;
  draft: string;
}

// The storage keys were renamed with the product (alanReviewTool* to
// tagger*). For each old key: if it exists and its new key does not, copy
// the value across, then delete the old key. A new key that already exists
// always wins, so running this twice, or after the user has already used
// the new version, never overwrites newer data. Runs before anything reads
// storage; the session value it copies still goes through migrateSession.
export async function migrateStorageKeys(): Promise<void> {
  const oldKeys = Object.keys(LEGACY_KEYS);
  const stored = await chrome.storage.local.get([
    ...oldKeys,
    ...Object.values(LEGACY_KEYS),
  ]);
  const copies: Record<string, unknown> = {};
  const toRemove: string[] = [];
  for (const oldKey of oldKeys) {
    if (!(oldKey in stored)) continue;
    const newKey = LEGACY_KEYS[oldKey];
    if (!(newKey in stored)) copies[newKey] = stored[oldKey];
    toRemove.push(oldKey);
  }
  if (Object.keys(copies).length > 0) await chrome.storage.local.set(copies);
  if (toRemove.length > 0) await chrome.storage.local.remove(toRemove);
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
  await migrateStorageKeys();
  const stored = await chrome.storage.local.get([
    WIDTH_STORAGE_KEY,
    SESSION_STORAGE_KEY,
    USER_STORAGE_KEY,
    EMAIL_STORAGE_KEY,
    PEN_COLOR_STORAGE_KEY,
    DRAFT_STORAGE_KEY,
  ]);
  const storedPen = stored[PEN_COLOR_STORAGE_KEY] as PenColor | undefined;
  return {
    width: clamp(
      (stored[WIDTH_STORAGE_KEY] as number | undefined) ?? DEFAULT_WIDTH,
      MIN_WIDTH,
      MAX_WIDTH,
    ),
    session: migrateSession(stored[SESSION_STORAGE_KEY]),
    // Reviewer identity lives under its own keys and is never cleared by
    // Start over - it is an identity fact, not session data.
    userName: (stored[USER_STORAGE_KEY] as string | undefined) || "",
    userEmail: (stored[EMAIL_STORAGE_KEY] as string | undefined) || "",
    penColor:
      storedPen && PEN_COLORS.includes(storedPen)
        ? storedPen
        : DEFAULT_PEN_COLOR,
    draft: (stored[DRAFT_STORAGE_KEY] as string | undefined) || "",
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

export function saveDraft(draft: string): void {
  if (draft) void chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: draft });
  else void chrome.storage.local.remove(DRAFT_STORAGE_KEY);
}

export function savePenColor(color: PenColor): void {
  void chrome.storage.local.set({ [PEN_COLOR_STORAGE_KEY]: color });
}
