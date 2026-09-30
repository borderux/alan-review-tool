import { CheckSquare, Eye, Square } from "@phosphor-icons/react";
import { Button, Menu, Tooltip } from "@recursica/adapter-mantine-v8";
import { useManagedMenu } from "./useManagedMenu";

interface ViewMenuProps {
  pageOnly: boolean;
  showImages: boolean;
  onPageOnlyChange: (pageOnly: boolean) => void;
  onShowImagesChange: (showImages: boolean) => void;
}

// The two view preferences, in a small icon-only menu in the panel header
// (between the title and Close), so they take no room in the panel:
// "This page only" (on: the current page's comments; off: every page's,
// grouped by page) and "Show images" (off hides screenshots in the panel
// only, never in the report). Each is saved the moment it changes, under
// its own key, and never cleared by Start over.
//
// Owner decision: checkable (multi-select) items in a menu. The menu rules
// list multi-select menus as uncovered, and the kit has no checkable item.
// Each item shows the kit's selected state and a checked or empty box icon
// (two visual channels), and carries aria-checked. Activating one toggles
// it and closes the menu; focus goes back to the View button.
//
// Workaround (adapter defect): Menu.Item always renders role="menuitem",
// overriding a role passed to it, and aria-checked means nothing on a
// menuitem - so the state would not be in code, which the menu rules
// require (MUST). The role is set to menuitemcheckbox on the element once
// it mounts. Remove when the adapter offers a checkable item.
const asCheckbox = (el: HTMLButtonElement | null) =>
  el?.setAttribute("role", "menuitemcheckbox");
export function ViewMenu({
  pageOnly,
  showImages,
  onPageOnlyChange,
  onShowImagesChange,
}: ViewMenuProps) {
  const { opened, setOpened, triggerRef, firstItemRef, onDropdownKeyDown } =
    useManagedMenu();
  const item = (checked: boolean) => ({
    "aria-checked": checked,
    "data-selected": checked || undefined,
    leftSection: checked ? <CheckSquare aria-hidden /> : <Square aria-hidden />,
  });
  return (
    <Menu trapFocus={false} opened={opened} onChange={setOpened}>
      <Tooltip label="View">
        <Menu.Target>
          <Button
            ref={triggerRef}
            variant="outline"
            size="small"
            icon={<Eye />}
            aria-label="View"
            data-view-menu="true"
          />
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown onKeyDown={onDropdownKeyDown}>
        <Menu.Item
          ref={(el: HTMLButtonElement | null) => {
            firstItemRef.current = el;
            asCheckbox(el);
          }}
          {...item(pageOnly)}
          onClick={() => onPageOnlyChange(!pageOnly)}
        >
          This page only
        </Menu.Item>
        <Menu.Item
          ref={asCheckbox}
          {...item(showImages)}
          onClick={() => onShowImagesChange(!showImages)}
        >
          Show images
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
