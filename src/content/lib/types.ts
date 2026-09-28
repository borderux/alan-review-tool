// The stored shape of a review session. This is exactly what already sits
// in real users' chrome.storage.local - see ARCHITECTURE.md's Data model
// section. Changing it needs a migration in storage.ts.

export interface ReviewComment {
  id: number;
  commentNumber: number;
  text: string;
  screenshot: string | null;
}

export interface ReviewPage {
  title: string;
  comments: ReviewComment[];
}

export interface Session {
  startedAt: number;
  guid: string;
  commentCounter: number;
  details: string;
  pages: Record<string, ReviewPage>;
}
