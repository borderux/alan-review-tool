import { Button, Modal, Text } from "@recursica/adapter-mantine-v8";

interface ClearSessionModalProps {
  opened: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

// Clearing destroys every comment on every page and can't be undone, which
// is the one case that earns a confirmation.
export function ClearSessionModal({
  opened,
  onCancel,
  onConfirm,
}: ClearSessionModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title="Clear session"
      // Focus return is done by the panel: inside a shadow root, Mantine
      // records the host element as the trigger.
      returnFocus={false}
      closeButtonProps={{ "aria-label": "Cancel clearing session" }}
    >
      <Text>
        Deletes every comment and screenshot on every page. This can&apos;t be
        undone.
      </Text>
      <Modal.Footer>
        {/* Initial focus: the safe choice, not the header's close button. */}
        <Button variant="outline" data-autofocus onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="solid" onClick={onConfirm}>
          Clear session
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
