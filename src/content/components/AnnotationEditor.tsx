import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Button,
  Group,
  Modal,
  Radio,
  RadioGroup,
  Stack,
  Text,
} from "@recursica/adapter-mantine-v8";
import { formatCommentId } from "../lib/ids";
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
  const id = formatCommentId(comment.commentNumber);
  const target = useModalPortal();
  const imgRef = useRef<HTMLImageElement>(null);
  const outlineRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);

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
      title={`Screenshot ${id}`}
      portalProps={{ target }}
      // A click on the backdrop must never throw away a drawing.
      closeOnClickOutside={false}
      // Focus return is done by the panel: inside a shadow root, Mantine
      // records the host element as the trigger.
      returnFocus={false}
      closeButtonProps={{ "aria-label": "Close screenshot without saving" }}
    >
      <Group align="flex-start" gap="rec-lg" wrap="wrap">
        <Stack gap="rec-sm">
          {/* The reason Save annotations and Clear annotations start
              disabled, in text. */}
          <Text variant="body-small">Drag on the screenshot to draw</Text>
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
              aria-label="Drawing area. Drag to draw on the screenshot."
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={stopDrawing}
              onPointerCancel={stopDrawing}
            />
          </div>
        </Stack>
        {/* A choice of one from six: a radio group, stacked vertically. */}
        <RadioGroup
          label="Pen color"
          formLayout="stacked"
          value={penColor}
          onChange={(value) => onPenColorChange(value as PenColor)}
        >
          {PEN_COLORS.map((color) => (
            <Radio
              key={color}
              value={color}
              label={
                <>
                  <span
                    className="art-swatch"
                    // The one inline colour: the pen colour itself, which
                    // is baked into screenshots and cannot be a theme token.
                    style={{ backgroundColor: PEN[color].stroke }}
                    aria-hidden
                  />
                  {PEN[color].name}
                </>
              }
            />
          ))}
        </RadioGroup>
      </Group>
      {/* Every button is a direct child of the footer, so the modal's own
          button gap applies throughout. The rarely used functions sit at the
          bottom left, pushed apart from Cancel and Save by the flexible
          spacer. */}
      <Modal.Footer>
        <Button variant="text" onClick={onRequestDeleteScreenshot}>
          Delete screenshot
        </Button>
        <Button variant="text" disabled={!hasDrawing} onClick={clearDrawing}>
          Clear annotations
        </Button>
        <Group flex={1} aria-hidden />
        <Button variant="outline" data-autofocus onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="solid" disabled={!hasDrawing} onClick={save}>
          Save annotations
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
