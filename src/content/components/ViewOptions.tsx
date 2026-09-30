import { Checkbox } from "@recursica/adapter-mantine-v8";

interface ViewOptionsProps {
  pageOnly: boolean;
  showImages: boolean;
  onPageOnlyChange: (pageOnly: boolean) => void;
  onShowImagesChange: (showImages: boolean) => void;
}

const PAGE_ONLY = "page-only";
const SHOW_IMAGES = "show-images";

// The two view preferences, as a checkbox group in the panel's pinned
// footer, above its buttons: "Only view comments for this url" (checked:
// the current page's comments; unchecked: every page's, grouped by page)
// and "Show screenshot thumbnails" (unchecked hides screenshots in the
// panel only, never in the report). Each is saved the moment it changes,
// under its own key, and never cleared by Start over.
//
// The group has a visible label ("View"): the checkbox rules require a
// real group label, and the label rules forbid a visually hidden one.
export function ViewOptions({
  pageOnly,
  showImages,
  onPageOnlyChange,
  onShowImagesChange,
}: ViewOptionsProps) {
  const value = [
    ...(pageOnly ? [PAGE_ONLY] : []),
    ...(showImages ? [SHOW_IMAGES] : []),
  ];
  return (
    <Checkbox.Group
      label="View"
      formLayout="stacked"
      value={value}
      onChange={(next: string[]) => {
        const nextPageOnly = next.includes(PAGE_ONLY);
        const nextShowImages = next.includes(SHOW_IMAGES);
        if (nextPageOnly !== pageOnly) onPageOnlyChange(nextPageOnly);
        if (nextShowImages !== showImages) onShowImagesChange(nextShowImages);
      }}
    >
      <Checkbox value={PAGE_ONLY} label="Only view comments for this url" />
      <Checkbox value={SHOW_IMAGES} label="Show screenshot thumbnails" />
    </Checkbox.Group>
  );
}
