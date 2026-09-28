import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Button,
  Group,
  Modal,
  Stack,
  Text,
} from "@recursica/adapter-mantine-v8";
import { formatCommentId } from "../lib/ids";
import type { ReviewComment } from "../lib/types";

// The annotation pen: cyan, 3 visual px regardless of how much smaller
// the image displays than its natural size.
const STROKE_COLOR = "#00ffff";
const STROKE_PX = 3;

interface LightboxModalProps {
  comment: ReviewComment & { screenshot: string };
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
  onDelete: () => void;
}

// A comment's screenshot, full size, with freehand drawing on top.
// Drawing happens on a transparent canvas laid exactly over the image, in
// the image's natural-resolution coordinates, so strokes stay crisp once
// merged into the full-resolution screenshot. Nothing is saved unless the
// reviewer chooses Save annotations; closing any other way discards the
// drawing.
export function LightboxModal({
  comment,
  onCancel,
  onSave,
  onDelete,
}: LightboxModalProps) {
  const id = formatCommentId(comment.commentNumber);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);

  const sizeCanvas = () => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
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

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = toCanvasPoint(event);
    last.current = { x: p.x, y: p.y };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const ctx = event.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = toCanvasPoint(event);
    ctx.strokeStyle = STROKE_COLOR;
    ctx.lineWidth = STROKE_PX * p.scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = { x: p.x, y: p.y };
    if (!hasDrawing) setHasDrawing(true);
  };

  const stopDrawing = () => {
    last.current = null;
  };

  const clearDrawing = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawing(false);
  };

  // Merges the drawing into the image. From then on it is just pixels.
  const save = () => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const merged = document.createElement("canvas");
    merged.width = img.naturalWidth;
    merged.height = img.naturalHeight;
    const ctx = merged.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    ctx.drawImage(canvas, 0, 0);
    onSave(merged.toDataURL("image/jpeg", 0.9));
  };

  return (
    <Modal
      opened
      onClose={onCancel}
      title={`Screenshot ${id}`}
      // Focus return is done by the panel: inside a shadow root, Mantine
      // records the host element as the trigger.
      returnFocus={false}
      closeButtonProps={{ "aria-label": "Close screenshot without saving" }}
    >
      <Stack gap="rec-sm">
        {/* The reason Save annotations and Clear annotations start
          disabled, in text. */}
        <Text variant="body-small">Drag on the screenshot to draw</Text>
        <div className="art-shot">
          <img
            ref={imgRef}
            src={comment.screenshot}
            alt={`Screenshot attached to ${id}`}
            onLoad={sizeCanvas}
          />
          <canvas
            ref={canvasRef}
            aria-label="Drawing area. Drag to draw on the screenshot."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
          />
        </div>
      </Stack>
      {/* Every button is a direct child of the footer, so the modal's own
          button gap applies throughout. The rarely used functions sit at the
          bottom left, pushed apart from Cancel and Save by the flexible
          spacer. */}
      <Modal.Footer>
        <Button variant="text" onClick={onDelete}>
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
