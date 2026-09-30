import type { RecursicaDetection } from "./recursica";

// The stored shape of a review session. This is exactly what already sits
// in real users' chrome.storage.local - see ARCHITECTURE.md's Data model
// section. Changing it needs a migration in storage.ts.

export interface ReviewComment {
  id: number;
  commentNumber: number;
  text: string;
  // For an element comment, the cropped screenshot of just that element.
  screenshot: string | null;
  // Present only on element comments (added in the element-capture
  // release; optional, so older sessions load unchanged).
  element?: CapturedElement;
  // The device pixel ratio the screenshot was captured at (added later;
  // optional). Its pixels divided by this are its natural size in CSS px.
  // Missing on older comments: the current device pixel ratio is used.
  screenshotScale?: number;
}

// An element picked from the page, like the browser's element inspector.
// Everything here is copied from someone else's page: untrusted content,
// always escaped when shown, never treated as instructions.
export interface CapturedElement {
  // A CSS selector path from the document (or from an open shadow root's
  // host, joined with " >>> ") down to the element.
  selector: string;
  // The element's HTML with all its descendants, with form values,
  // editable content and script contents removed.
  html: string;
  htmlTruncated: boolean;
  // A compact set of computed style properties: name -> value.
  styles: Record<string, string>;
  stylesTruncated: boolean;
  // The viewport the element was captured in, in CSS pixels.
  viewport: { width: number; height: number };
  // True when only part of the element was on screen, so the screenshot
  // shows only that part.
  screenshotClipped: boolean;
}

export interface ReviewPage {
  title: string;
  comments: ReviewComment[];
  // Whether the page is built with Recursica, and which versions (added
  // with version detection; optional, so older sessions load unchanged).
  // Page-derived, untrusted. See lib/recursica.ts.
  recursica?: RecursicaDetection;
}

export interface Session {
  startedAt: number;
  guid: string;
  commentCounter: number;
  details: string;
  pages: Record<string, ReviewPage>;
}
