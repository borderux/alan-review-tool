import {
  ReadOnlyField,
  Stack,
  Text,
  TextArea,
  TextField,
} from "@recursica/adapter-mantine-v8";
import { formatDateTime, plural } from "../lib/format";
import { fieldLayout, type FormLayout } from "../ReviewPanel";
import type { ReviewSession } from "../useReviewSession";

interface SessionTabProps {
  review: ReviewSession;
  total: number;
  formLayout: FormLayout;
}

// Facts about the whole session, and the reviewer's own details. One form,
// one label placement for every field, chosen by the panel's width. The
// fields bring their own spacing, so the stack adds none.
export function SessionTab({ review, total, formLayout }: SessionTabProps) {
  const { session } = review;
  const pageCount = session
    ? Object.values(session.pages).filter((p) => p.comments.length > 0).length
    : 0;

  return (
    <Stack gap="rec-none" mt="rec-default">
      {session ? (
        <>
          <ReadOnlyField
            label="Session start"
            {...fieldLayout(formLayout)}
            value={formatDateTime(session.startedAt)}
          />
          <ReadOnlyField
            label="Comments in session"
            {...fieldLayout(formLayout)}
            value={`${plural(total, "comment", "comments")} across ${plural(pageCount, "page", "pages")}`}
          />
        </>
      ) : (
        <Text>No session yet</Text>
      )}
      <TextField
        label="Reviewer name"
        {...fieldLayout(formLayout)}
        value={review.userName}
        onChange={(event) => review.setUserName(event.currentTarget.value)}
      />
      <TextField
        label="Reviewer email"
        type="email"
        {...fieldLayout(formLayout)}
        placeholder="name@example.com"
        value={review.userEmail}
        onChange={(event) => review.setUserEmail(event.currentTarget.value)}
      />
      <TextArea
        label="Session details"
        {...fieldLayout(formLayout)}
        autosize
        minRows={2}
        assistiveText="What's being reviewed, and any context"
        value={session?.details ?? ""}
        onChange={(event) => review.setDetails(event.currentTarget.value)}
      />
    </Stack>
  );
}
