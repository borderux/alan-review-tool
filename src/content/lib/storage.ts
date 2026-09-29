import { generateGuid } from "./ids";
import type {
  CapturedElement,
  ReviewComment,
  ReviewPage,
  Session,
} from "./types";

export const WIDTH_STORAGE_KEY = "snippyPanelWidth";
export const SESSION_STORAGE_KEY = "snippySession";
export const USER_STORAGE_KEY = "snippyUser";
export const EMAIL_STORAGE_KEY = "snippyEmail";
// The annotation pen's last colour: a preference, like the width, so it is
// never cleared by Start over.
export const PEN_COLOR_STORAGE_KEY = "snippyPenColor";
// Keys no current version reads: the New comment field's draft, from
// before the panel had a single Add menu. Deleted on load.
const OBSOLETE_KEYS = ["snippyDraft", "taggerDraft"];

// The same values under the names of earlier generations of the product,
// newest first: Tagger (a working name, only ever on the development
// branch), then the original Alan Review Tool. Real users' storage still
// holds data under the old keys (see migrateStorageKeys).
const LEGACY_KEYS: Record<string, string[]> = {
  [WIDTH_STORAGE_KEY]: ["taggerPanelWidth", "alanReviewToolPanelWidth"],
  [SESSION_STORAGE_KEY]: ["taggerSession", "alanReviewToolSession"],
  [USER_STORAGE_KEY]: ["taggerUser", "alanReviewToolUser"],
  [EMAIL_STORAGE_KEY]: ["taggerEmail", "alanReviewToolEmail"],
  [PEN_COLOR_STORAGE_KEY]: ["taggerPenColor"],
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
// tabs existed; a stored width below the new minimum is clamped up. The
// owner approved this range (336-720, default 360) with the resize strip.
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
}

// The storage keys were renamed with the product, twice: alanReviewTool*
// to tagger* to snippy*. For each current key that is missing, the value is
// taken from the newest older generation that has it - the Tagger key, else
// the Alan key. Then every older key is deleted. A current key that already
// exists always wins, so running this twice, or after the user has already
// used this version, never overwrites newer data. Runs before anything
// reads storage; a copied session still goes through migrateSession, so an
// old array-shaped session is normalized as well.
export async function migrateStorageKeys(): Promise<void> {
  const olderKeys = [...Object.values(LEGACY_KEYS).flat(), ...OBSOLETE_KEYS];
  const stored = await chrome.storage.local.get([
    ...Object.keys(LEGACY_KEYS),
    ...olderKeys,
  ]);
  const copies: Record<string, unknown> = {};
  for (const [key, older] of Object.entries(LEGACY_KEYS)) {
    if (key in stored) continue;
    const source = older.find((oldKey) => oldKey in stored);
    if (source) copies[key] = stored[source];
  }
  const toRemove = olderKeys.filter((oldKey) => oldKey in stored);
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
  // A session with no usable pages object can't be read at all; start its
  // pages over rather than crash the panel on load.
  if (!session.pages || typeof session.pages !== "object") session.pages = {};
  // Sessions saved before pages gained a `title` (back when
  // session.pages[key] was just a comments array) - normalize them to the
  // { title, comments } shape.
  for (const key of Object.keys(session.pages)) {
    const page = session.pages[key] as ReviewPage | ReviewComment[];
    if (Array.isArray(page)) {
      session.pages[key] = { title: key, comments: page };
    }
  }
  // Sessions saved before the guid and the comment counter existed have
  // neither. Backfill a guid, and number every existing comment oldest
  // first (each page's array is newest-first, from unshift), so numbering
  // approximates real creation order.
  // Element comments (added later) carry an optional `element` field. Old
  // sessions simply don't have it; a malformed one - anything without a
  // selector and HTML - is dropped rather than reaching the UI.
  for (const page of Object.values(session.pages)) {
    for (const comment of page.comments) {
      const el = comment.element as Partial<CapturedElement> | undefined;
      if (el === undefined) continue;
      if (
        !el ||
        typeof el !== "object" ||
        typeof el.selector !== "string" ||
        typeof el.html !== "string"
      ) {
        delete comment.element;
        continue;
      }
      el.htmlTruncated = Boolean(el.htmlTruncated);
      el.stylesTruncated = Boolean(el.stylesTruncated);
      el.screenshotClipped = Boolean(el.screenshotClipped);
      if (!el.styles || typeof el.styles !== "object") el.styles = {};
      if (!el.viewport || typeof el.viewport !== "object")
        el.viewport = { width: 0, height: 0 };
    }
  }
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
  };
}

// One object under one key: chrome.storage.local is shared across every
// origin this extension runs on, which is what makes "any site, one
// session" work at all.
//
// Writes return their promise so a failure can be reported. The
// unlimitedStorage permission lifts the quota that screenshots would
// otherwise fill, but a write can still fail.
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

export function saveWidth(width: number): Promise<void> {
  return chrome.storage.local.set({ [WIDTH_STORAGE_KEY]: width });
}

export function savePenColor(color: PenColor): Promise<void> {
  return chrome.storage.local.set({ [PEN_COLOR_STORAGE_KEY]: color });
}
