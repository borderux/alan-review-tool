import { useEffect, useId, useRef, useState } from "react";
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
import { ConfirmModal } from "./ConfirmModal";

interface AnnotationEditorProps {
  comment: ReviewComment & { screenshot: string };
  penColor: PenColor;
  onPenColorChange: (color: PenColor) => void;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
  onDeleteScreenshot: () => void;
}

// The editor's own confirmations. Each one stacks on the editor instead of
// replacing it, so cancelling returns to the editor with the drawing still
// there. Every action here that can't be undone asks first (owner rule).
type EditorConfirmation = "discard" | "clear" | "delete";

// Where focus is inside the panel's shadow root (document.activeElement is
// the shadow host there).
function activeElement(): HTMLElement | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el instanceof HTMLElement ? el : null;
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
// reviewer chooses Save annotations. Cancel, Escape and the close button
// close the editor - asking first when there is an unsaved drawing - and a
// click on the backdrop does nothing at all.
export function AnnotationEditor({
  comment,
  penColor,
  onPenColorChange,
  onCancel,
  onSave,
  onDeleteScreenshot,
}: AnnotationEditorProps) {
  const id = commentName(comment.commentNumber);
  const target = useModalPortal();
  const imgRef = useRef<HTMLImageElement>(null);
  const outlineRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);
  const saveReasonId = useId();
  // While the pen color list is open, Escape belongs to the list: it closes
  // the list, not the whole editor (which would throw the drawing away).
  // Mantine closes the modal from a capture listener on window, before the
  // list sees the key, so the modal must be told not to.
  const [penListOpen, setPenListOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<EditorConfirmation | null>(
    null,
  );
  // What had focus when a confirmation opened, to go back to on Cancel.
  const confirmTrigger = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // While a confirmation is open over the editor, the editor itself is
  // inert, like everything else behind a modal.
  useEffect(() => {
    if (!confirmation) return;
    const root = bodyRef.current?.closest<HTMLElement>(".mantine-Modal-root");
    if (!root) return;
    const previous = root.inert;
    root.inert = true;
    return () => {
      root.inert = previous;
    };
  }, [confirmation]);

  const ask = (kind: EditorConfirmation) => {
    confirmTrigger.current = activeElement();
    setConfirmation(kind);
  };

  const cancelConfirmation = () => {
    setConfirmation(null);
    const trigger = confirmTrigger.current;
    requestAnimationFrame(() => trigger?.focus());
  };

  // Cancel, Escape and the close button: straight out when nothing was
  // drawn, otherwise ask before the drawing is thrown away.
  const requestClose = () => {
    if (hasDrawing) ask("discard");
    else onCancel();
  };

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

  const confirmationCopy = {
    discard: {
      title: "Discard drawing?",
      consequence:
        "What you drew on this screenshot will be lost. This can't be undone.",
      confirmLabel: "Discard drawing",
    },
    clear: {
      title: "Clear annotations?",
      consequence:
        "Everything you drew since opening this screenshot will be removed. This can't be undone.",
      confirmLabel: "Clear annotations",
    },
    delete: {
      title: `Delete the screenshot from ${id}?`,
      consequence: `The screenshot and its annotations will be deleted from ${id}. The comment text stays. This can't be undone.`,
      confirmLabel: "Delete screenshot",
    },
  } as const;

  const confirm = () => {
    const kind = confirmation;
    setConfirmation(null);
    if (kind === "discard") onCancel();
    else if (kind === "delete") onDeleteScreenshot();
    else if (kind === "clear") {
      clearDrawing();
      // Clear annotations stays; focus goes back to it.
      const trigger = confirmTrigger.current;
      requestAnimationFrame(() => trigger?.focus());
    }
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
      onClose={requestClose}
      title={`Screenshot for ${id}`}
      portalProps={{ target }}
      // A click on the backdrop must never throw away a drawing.
      closeOnClickOutside={false}
      // Every open modal hears Escape (Mantine listens on window), so while
      // a confirmation is open over the editor, Escape is the
      // confirmation's alone: it cancels the confirmation, nothing more.
      closeOnEscape={!penListOpen && confirmation == null}
      // Focus return is done by the panel: inside a shadow root, Mantine
      // records the host element as the trigger.
      returnFocus={false}
      closeButtonProps={{ "aria-label": "Close screenshot without saving" }}
    >
      <Stack gap="rec-default" ref={bodyRef}>
        {/* The toolbar stays put; only the image area beneath it scrolls. */}
        <Group justify="space-between" align="flex-end" gap="rec-default">
          <Dropdown
            label="Pen color"
            formLayout="stacked"
            data-autofocus
            allowDeselect={false}
            onDropdownOpen={() => setPenListOpen(true)}
            onDropdownClose={() => setPenListOpen(false)}
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
          {/* Nothing drawn means nothing to lose: no question then. */}
          <Button
            variant="outline"
            size="small"
            onClick={() => hasDrawing && ask("clear")}
          >
            Clear annotations
          </Button>
        </Group>
        {/* A bordered container, so the image's edge shows against the
            modal; the image scrolls inside it. */}
        <div className="art-shot-well">
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
        <Button variant="text" onClick={() => ask("delete")}>
          Delete screenshot
        </Button>
        <Group flex={1} aria-hidden />
        <Button variant="outline" onClick={requestClose}>
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
      <ConfirmModal
        opened={confirmation != null}
        title={confirmation ? confirmationCopy[confirmation].title : ""}
        consequence={
          confirmation ? confirmationCopy[confirmation].consequence : ""
        }
        confirmLabel={
          confirmation ? confirmationCopy[confirmation].confirmLabel : ""
        }
        onCancel={cancelConfirmation}
        onConfirm={confirm}
      />
    </Modal>
  );
}
