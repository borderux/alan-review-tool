import { useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Button,
  Dropdown,
  Group,
  Modal,
  Stack,
} from "@recursica/adapter-mantine-v8";
import { commentName } from "../lib/ids";
import { OUTLINE_PX, PEN, STROKE_PX } from "../lib/pen";
import { PEN_COLORS, type PenColor } from "../lib/storage";
import type { ReviewComment } from "../lib/types";
import { useModalPortal } from "../modalPortal";

interface AnnotationEditorProps {
  comment: ReviewComment & { screenshot: string };
  penColor: PenColor;
  onPenColorChange: (color: PenColor) => void;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
  onRequestDeleteScreenshot: () => void;
}

// The pen colour's swatch: the one inline colour, since the pen colour is
// baked into screenshots and cannot be a theme token.
function swatch(color: PenColor) {
  return (
    <span
      className="art-swatch"
      style={{ backgroundColor: PEN[color].stroke }}
      aria-hidden
    />
  );
}

// A comment's screenshot, full size, with freehand drawing on top.
// Drawing happens on transparent canvases laid exactly over the image, in
// the image's natural-resolution coordinates, so strokes stay crisp once
// merged into the full-resolution screenshot. Two canvases: the contrasting
// outline underneath, the colour on top, so a stroke never paints its
// outline over an earlier stroke's colour. Nothing is saved unless the
// reviewer chooses Save annotations; Cancel, Escape and the close button
// discard the drawing, and a click on the backdrop does nothing at all.
export function AnnotationEditor({
  comment,
  penColor,
  onPenColorChange,
  onCancel,
  onSave,
  onRequestDeleteScreenshot,
}: AnnotationEditorProps) {
  const id = commentName(comment.commentNumber);
  const target = useModalPortal();
  const imgRef = useRef<HTMLImageElement>(null);
  const outlineRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);
  const saveReasonId = useId();

  const sizeCanvases = () => {
    const img = imgRef.current;
    if (!img) return;
    for (const canvas of [outlineRef.current, strokeRef.current]) {
      if (!canvas) continue;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
  };

  const toCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    return {
      x: (event.clientX - rect.left) * scale,
      y: (event.clientY - rect.top) * scale,
      scale,
    };
  };

  const segment = (
    canvas: HTMLCanvasElement | null,
    color: string,
    width: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = toCanvasPoint(event);
    last.current = { x: p.x, y: p.y };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const p = toCanvasPoint(event);
    const to = { x: p.x, y: p.y };
    const pen = PEN[penColor];
    segment(
      outlineRef.current,
      pen.outline,
      (STROKE_PX + 2 * OUTLINE_PX) * p.scale,
      last.current,
      to,
    );
    segment(
      strokeRef.current,
      pen.stroke,
      STROKE_PX * p.scale,
      last.current,
      to,
    );
    last.current = to;
    if (!hasDrawing) setHasDrawing(true);
  };

  const stopDrawing = () => {
    last.current = null;
  };

  const clearDrawing = () => {
    for (const canvas of [outlineRef.current, strokeRef.current]) {
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasDrawing(false);
  };

  // Merges the drawing into the image. From then on it is just pixels.
  const save = () => {
    const img = imgRef.current;
    if (!img || !outlineRef.current || !strokeRef.current) return;
    const merged = document.createElement("canvas");
    merged.width = img.naturalWidth;
    merged.height = img.naturalHeight;
    const ctx = merged.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    ctx.drawImage(outlineRef.current, 0, 0);
    ctx.drawImage(strokeRef.current, 0, 0);
    onSave(merged.toDataURL("image/jpeg", 0.9));
  };

  return (
    <Modal
      opened
      onClose={onCancel}
      title={`Screenshot for ${id}`}
      portalProps={{ target }}
      // A click on the backdrop must never throw away a drawing.
      closeOnClickOutside={false}
      // Focus return is done by the panel: inside a shadow root, Mantine
      // records the host element as the trigger.
      returnFocus={false}
      closeButtonProps={{ "aria-label": "Close screenshot without saving" }}
    >
      <Stack gap="rec-default">
        {/* The toolbar stays put; only the image area beneath it scrolls. */}
        <Group justify="space-between" align="flex-end" gap="rec-default">
          <Dropdown
            label="Pen color"
            formLayout="stacked"
            data-autofocus
            allowDeselect={false}
            // The option list renders with the modal (layer 1), not in the
            // page-level portal, which is inert and underneath while a modal
            // is open.
            comboboxProps={{ portalProps: { target } }}
            data={PEN_COLORS.map((color) => ({
              value: color,
              label: PEN[color].name,
              leadingIcon: swatch(color),
            }))}
            value={penColor}
            // The closed field shows the chosen colour as well as its name.
            leftSection={swatch(penColor)}
            onChange={(value) => value && onPenColorChange(value as PenColor)}
          />
          <Button variant="text" onClick={clearDrawing}>
            Clear annotations
          </Button>
        </Group>
        <div className="art-shot-scroll">
          <div className="art-shot">
            <img
              ref={imgRef}
              src={comment.screenshot}
              alt={`Screenshot attached to ${id}`}
              onLoad={sizeCanvases}
            />
            <canvas ref={outlineRef} aria-hidden />
            <canvas
              ref={strokeRef}
              role="img"
              aria-label={`Drawing layer on the screenshot for ${id}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={stopDrawing}
              onPointerCancel={stopDrawing}
            />
          </div>
        </div>
      </Stack>
      {/* The reason Save annotations starts disabled, for screen readers
          only (no visible helper text, by owner decision). */}
      <span id={saveReasonId} className="art-sr-only">
        Draw on the screenshot to enable Save annotations.
      </span>
      {/* Every button is a direct child of the footer, so the modal's own
          button gap applies throughout. The rarely used Delete screenshot
          sits at the bottom left, pushed apart from Cancel and Save by the
          flexible spacer. */}
      <Modal.Footer>
        <Button variant="text" onClick={onRequestDeleteScreenshot}>
          Delete screenshot
        </Button>
        <Group flex={1} aria-hidden />
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="solid"
          disabled={!hasDrawing}
          aria-describedby={hasDrawing ? undefined : saveReasonId}
          onClick={save}
        >
          Save annotations
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
