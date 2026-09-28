import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { setPageWidth } from "../lib/page";
import { MAX_WIDTH, MIN_WIDTH, clamp, saveWidth } from "../lib/storage";

// How far one arrow-key press resizes the panel.
const KEY_STEP = 16;

interface ResizeHandleProps {
  width: number;
  onChange: (width: number) => void;
  visible: boolean;
}

// Approved exception: the kit's panel has no resize affordance, so this
// strip on the panel's left edge is hand-built. Dragging is the main way
// to use it; arrow keys (and Home/End) are the required non-drag way. The
// width is remembered across sessions.
export function ResizeHandle({ width, onChange, visible }: ResizeHandleProps) {
  const apply = (next: number, animate: boolean) => {
    const clamped = clamp(next, MIN_WIDTH, MAX_WIDTH);
    onChange(clamped);
    setPageWidth(clamped, animate);
    return clamped;
  };

  const onMouseDown = (down: ReactMouseEvent) => {
    down.preventDefault();
    const startX = down.clientX;
    const startWidth = width;
    let latest = startWidth;
    const onMove = (move: MouseEvent) => {
      latest = apply(startWidth + (startX - move.clientX), false);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      saveWidth(latest);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowLeft: width + KEY_STEP,
      ArrowRight: width - KEY_STEP,
      Home: MIN_WIDTH,
      End: MAX_WIDTH,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    saveWidth(apply(steps[event.key], true));
  };

  if (!visible) return null;
  return (
    <div
      className="art-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize review panel"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
    />
  );
}
