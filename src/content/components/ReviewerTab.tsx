import { useState } from "react";
import { Stack, TextArea, TextField } from "@recursica/adapter-mantine-v8";
import { fieldLayout, type FormLayout } from "../ReviewPanel";
import type { ReviewSession } from "../useReviewSession";

interface ReviewerTabProps {
  review: ReviewSession;
  formLayout: FormLayout;
}

// Deliberately loose: something@something.something. The field is
// optional, so an empty value is never an error.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The reviewer's details for the report: name, email, and notes about the
// session. One form, one label placement for every field. The fields
// bring their own spacing, so the stack adds none. The read-only session
// facts (start time, counts) are not repeated here: they are about the
// session rather than the reviewer, and the report carries them.
export function ReviewerTab({ review, formLayout }: ReviewerTabProps) {
  const layout = fieldLayout(formLayout);
  // Checked when the reviewer leaves the field, never while typing.
  const [emailInvalid, setEmailInvalid] = useState(false);
  return (
    <Stack gap="rec-none" mt="rec-default">
      <TextField
        label="Reviewer name"
        {...layout}
        placeholder="First and last name"
        value={review.userName}
        onChange={(event) => review.setUserName(event.currentTarget.value)}
      />
      <TextField
        label="Reviewer email"
        type="email"
        {...layout}
        placeholder="name@example.com"
        error={
          emailInvalid
            ? "Enter an email address like name@example.com"
            : undefined
        }
        value={review.userEmail}
        onChange={(event) => {
          review.setUserEmail(event.currentTarget.value);
          if (
            emailInvalid &&
            EMAIL_SHAPE.test(event.currentTarget.value.trim())
          )
            setEmailInvalid(false);
        }}
        onBlur={(event) => {
          const value = event.currentTarget.value.trim();
          setEmailInvalid(value !== "" && !EMAIL_SHAPE.test(value));
        }}
      />
      <TextArea
        label="Session details"
        {...layout}
        autosize
        minRows={2}
        // The guidance is help text, which stays; the placeholder is only an
        // example of the shape of an answer.
        assistiveText="What's being reviewed, and any context"
        placeholder="Checkout flow on desktop"
        value={review.session?.details ?? ""}
        onChange={(event) => review.setDetails(event.currentTarget.value)}
      />
    </Stack>
  );
}
