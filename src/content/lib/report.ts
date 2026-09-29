// Builds the downloaded report: a single self-contained HTML file with no
// external requests and zero JavaScript (the screenshot lightbox is pure
// CSS, using :target). report.css and the AI instructions are inlined at
// build time because a downloaded standalone file cannot fetch a sibling
// file. Dates and counts use the panel's shared formatters.
import REPORT_CSS from "../../report.css?raw";
import AI_INSTRUCTIONS from "../../ai-report-instructions.txt?raw";
import { formatDateTimeWithZone, plural } from "./format";
import { formatCommentId } from "./ids";
import type { Session } from "./types";

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function totalCommentCount(session: Session | null): number {
  if (!session) return 0;
  return Object.values(session.pages).reduce(
    (sum, page) => sum + page.comments.length,
    0,
  );
}

interface ReportInput {
  session: Session | null;
  userName: string;
  userEmail: string;
}

export function buildReportHtml({
  session,
  userName,
  userEmail,
}: ReportInput): string {
  const pages = Object.entries(session?.pages || {}).filter(
    ([, page]) => page.comments.length > 0,
  );
  const totalCount = totalCommentCount(session);
  const pageCount = pages.length;

  // Global across the whole report, not per-page, so two different
  // pages' anchors can never collide.
  let shotIndex = 0;
  const lightboxTargets: string[] = [];

  const tocHtml = pages
    .map(
      ([url], i) =>
        `<li><a href="#page-${i}">${escapeHtml(url.split("?")[0])}</a></li>`,
    )
    .join("\n");

  const pagesHtml = pages
    .map(([url, page], i) => {
      const commentsHtml = page.comments
        .map((comment) => {
          let shotsHtml = "";
          // The lightbox target lives at the end of the document; :target
          // matching doesn't care where in the DOM it sits.
          if (comment.screenshot) {
            const shotId = `shot-${shotIndex}`;
            shotIndex += 1;
            shotsHtml = `<div class="comment-shots"><a href="#${shotId}" class="shot-thumb-link"><img class="shot-thumb" src="${comment.screenshot}" alt="Screenshot" /></a></div>`;
            lightboxTargets.push(
              `<a href="#_" id="${shotId}" class="lightbox"><img src="${comment.screenshot}" alt="Screenshot" /></a>`,
            );
          }
          // The visible CM-<n> id plus the hidden session guid (in the
          // head, once) together make a globally unique id per comment.
          const commentId =
            comment.commentNumber != null
              ? formatCommentId(comment.commentNumber)
              : "";
          return `<div class="comment" data-comment-id="${escapeHtml(commentId)}"><div class="comment-body">${commentId ? `<p class="comment-id">${escapeHtml(commentId)}</p>` : ""}<p class="comment-text">${escapeHtml(comment.text).replace(/\n/g, "<br>")}</p></div>${shotsHtml}</div>`;
        })
        .join("\n");

      // url is the full page key (origin + pathname + search) - that's
      // what the report links to, but the visible text drops the search
      // params so the link doesn't read as a wall of query-string noise.
      const urlWithoutSearch = url.split("?")[0];
      return `<div class="page-section" id="page-${i}">
<p class="page-url"><a href="${escapeHtml(url)}">${escapeHtml(urlWithoutSearch)}</a></p>
${commentsHtml}
</div>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Tagger feedback session</title>
${session?.guid ? `<meta name="tagger-session-id" content="${escapeHtml(session.guid)}">` : ""}
<meta name="ai-report-instructions" content="${escapeHtml(AI_INSTRUCTIONS)}">
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="report-header">
<h1>Tagger feedback session</h1>
<p class="report-meta">Started ${session ? formatDateTimeWithZone(session.startedAt) : "-"} — ${plural(totalCount, "comment", "comments")} across ${plural(pageCount, "page", "pages")}</p>
${userName ? `<p class="report-meta">Reviewer: ${escapeHtml(userName)}</p>` : ""}
${userEmail ? `<p class="report-meta">Email: ${escapeHtml(userEmail)}</p>` : ""}
${session?.details ? `<p class="report-meta">Details: ${escapeHtml(session.details)}</p>` : ""}
</div>
<nav class="toc">
<h2>Pages reviewed</h2>
<ol>
${tocHtml}
</ol>
</nav>
${pagesHtml}
${lightboxTargets.join("\n")}
</body>
</html>
`;
}

export function downloadReport(input: ReportInput): void {
  const blob = new Blob([buildReportHtml(input)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tagger-session-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
