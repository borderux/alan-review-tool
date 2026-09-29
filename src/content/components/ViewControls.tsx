import { Switch } from "@recursica/adapter-mantine-v8";

interface ViewControlsProps {
  pageOnly: boolean;
  showImages: boolean;
  onPageOnlyChange: (pageOnly: boolean) => void;
  onShowImagesChange: (showImages: boolean) => void;
}

const PAGE_ONLY = "page-only";
const SHOW_IMAGES = "show-images";

// The two view switches, pinned above the comment list: "This page only"
// (on: the current page's comments; off: every page's, grouped by page)
// and "Show images" (off hides screenshots in the panel only, never in
// the report). One group, stacked one per row, as the switch rules ask.
// Each is a preference saved the moment it changes, under its own key,
// and never cleared by Start over.
//
// Open with the owner: the selection-controls rule says a switch appears
// only inside a form, and a toggle anywhere else is a segmented control.
// These are view settings above a list, not form fields. Built as switches
// because the owner asked for switches; see the pull request.
export function ViewControls({
  pageOnly,
  showImages,
  onPageOnlyChange,
  onShowImagesChange,
}: ViewControlsProps) {
  const value = [
    ...(pageOnly ? [PAGE_ONLY] : []),
    ...(showImages ? [SHOW_IMAGES] : []),
  ];
  return (
    <Switch.Group
      label="View"
      value={value}
      onChange={(next: string[]) => {
        const nextPageOnly = next.includes(PAGE_ONLY);
        const nextShowImages = next.includes(SHOW_IMAGES);
        if (nextPageOnly !== pageOnly) onPageOnlyChange(nextPageOnly);
        if (nextShowImages !== showImages) onShowImagesChange(nextShowImages);
      }}
    >
      <Switch value={PAGE_ONLY} label="This page only" />
      <Switch value={SHOW_IMAGES} label="Show images" />
    </Switch.Group>
  );
}
