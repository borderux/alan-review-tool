import { Plus, X } from "@phosphor-icons/react";
import { Button, Menu, Tooltip } from "@recursica/adapter-mantine-v8";
import { useManagedMenu } from "./useManagedMenu";

interface AddMenuProps {
  busy: boolean;
  // Off when saved data could not be loaded; describedBy then points at
  // the message in the panel body that says why.
  disabled: boolean;
  describedBy?: string;
  onAddComment: () => void;
  onAddScreenshot: () => void;
  onAddElement: () => void;
}

// The one add control, in the panel header to the left of the title: a
// small, icon-only, outline button that opens a menu - Comment,
// Screenshot, Element. Each
// item creates a new numbered comment at the top of the list, with focus in
// its text box; a cancelled capture returns focus here.
export function AddMenu({
  busy,
  disabled,
  describedBy,
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
            size="small"
            // While the menu is open the icon is an X (owner decision); the
            // name stays "Add" and aria-expanded carries the open state.
            icon={opened ? <X /> : <Plus />}
            aria-label="Add"
            aria-describedby={describedBy}
            disabled={disabled}
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
