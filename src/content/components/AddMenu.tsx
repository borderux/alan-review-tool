import { Plus } from "@phosphor-icons/react";
import { Button, Menu, Tooltip } from "@recursica/adapter-mantine-v8";
import { useManagedMenu } from "./useManagedMenu";

interface AddMenuProps {
  busy: boolean;
  onAddComment: () => void;
  onAddScreenshot: () => void;
  onAddElement: () => void;
}

// The one add control, in the panel header to the left of the title: a
// large, icon-only, outline button (an approved exception to "every panel
// button is small") that opens a menu - Comment, Screenshot, Element. Each
// item creates a new numbered comment at the top of the list, with focus in
// its text box; a cancelled capture returns focus here.
export function AddMenu({
  busy,
  onAddComment,
  onAddScreenshot,
  onAddElement,
}: AddMenuProps) {
  const { opened, setOpened, triggerRef, firstItemRef, onDropdownKeyDown } =
    useManagedMenu();
  return (
    <Menu trapFocus={false} opened={opened} onChange={setOpened}>
      <Tooltip label="Add">
        <Menu.Target>
          <Button
            ref={triggerRef}
            variant="outline"
            icon={<Plus />}
            aria-label="Add"
            loading={busy}
            data-add-menu="true"
          />
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown onKeyDown={onDropdownKeyDown}>
        <Menu.Item ref={firstItemRef} onClick={onAddComment}>
          Comment
        </Menu.Item>
        <Menu.Item onClick={onAddScreenshot}>Screenshot</Menu.Item>
        <Menu.Item onClick={onAddElement}>Element</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
