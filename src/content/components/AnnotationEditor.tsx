import { useEffect, useId, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  Button,
  Dropdown,
  Group,
  Modal,
  SegmentedControl,
  Stack,
} from "@recursica/adapter-mantine-v8";
import {
  ARROW_LENGTH_PX,
  DOT_RADIUS_PX,
  arrowGeometry,
  bounds,
  dotNumbers,
  moveAnnotation,
  renderAnnotated,
  type Annotation,
} from "../lib/annotations";
import { commentName } from "../lib/ids";
import {
  OUTLINE_PX,
  PEN,
  PEN_COLORS,
  STROKE_PX,
  type PenColor,
} from "../lib/pen";
import { isMac } from "../lib/shortcuts";
import type { ReviewComment } from "../lib/types";
import type { CommentFields } from "../useReviewSession";
import { useModalPortal } from "../modalPortal";
import { ConfirmModal } from "./ConfirmModal";

interface AnnotationEditorProps {
  comment: ReviewComment & { screenshot: string };
  penColor: PenColor;
  onPenColorChange: (color: PenColor) => void;
  onCancel: () => void;
  // The fields to store: the annotated image, the clean image and the
  // objects - or, with every annotation removed, the clean image alone.
  onSave: (fields: CommentFields) => void;
  onDeleteScreenshot: () => void;
}

// The editor's own confirmations. Each one stacks on the editor instead of
// replacing it, so cancelling returns to the editor with the drawing still
// there. Every action here that can't be undone asks first (owner rule).
type EditorConfirmation = "discard" | "clear" | "delete";

type Tool = "select" | "pen" | "arrow" | "dot";
const TOOLS: { value: Tool; label: string }[] = [
  { value: "select", label: "Select" },
  { value: "pen", label: "Pen" },
  { value: "arrow", label: "Arrow" },
  { value: "dot", label: "Numbered dot" },
];
const KIND_NAME: Record<Annotation["kind"], string> = {
  stroke: "Pen stroke",
  arrow: "Arrow",
  dot: "Numbered dot",
};

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

// One annotation drawn in the editor's SVG layer, in image px - the same
// shapes drawAnnotations paints into the saved image.
function AnnotationShape({
  a,
  w,
  h,
  number,
}: {
  a: Annotation;
  w: number;
  h: number;
  number?: number;
}) {
  const pen = PEN[a.color];
  if (a.kind === "stroke") {
    const width = a.size * w;
    const pts = a.points.map(([x, y]) => `${x * w},${y * h}`).join(" ");
    return (
      <>
        <polyline
          points={pts}
          className="art-ann-hit"
          strokeWidth={Math.max(width * 3, 16)}
        />
        <polyline
          points={pts}
          stroke={pen.outline}
          strokeWidth={width + (2 * OUTLINE_PX * width) / STROKE_PX}
        />
        <polyline points={pts} stroke={pen.stroke} strokeWidth={width} />
      </>
    );
  }
  if (a.kind === "arrow") {
    const g = arrowGeometry(a, w, h);
    const d = `M${g.tail.x},${g.tail.y} L${g.tip.x},${g.tip.y} M${g.b1.x},${g.b1.y} L${g.tip.x},${g.tip.y} L${g.b2.x},${g.b2.y}`;
    return (
      <>
        <path d={d} className="art-ann-hit" strokeWidth={g.width * 5} />
        <path
          d={d}
          stroke={pen.outline}
          strokeWidth={g.width + 2 * Math.max(1, g.width / 3)}
        />
        <path d={d} stroke={pen.stroke} strokeWidth={g.width} />
      </>
    );
  }
  const r = a.size * w;
  return (
    <>
      <circle
        cx={a.x * w}
        cy={a.y * h}
        r={r}
        fill={pen.stroke}
        stroke={pen.outline}
        strokeWidth={Math.max(1.5, r / 7)}
      />
      <text
        x={a.x * w}
        y={a.y * h + r * 0.05}
        fill={pen.outline}
        fontSize={Math.round(r * 1.15)}
        className="art-ann-number"
      >
        {number}
      </text>
    </>
  );
}

// A comment's screenshot, with annotations on top: pen strokes, arrows and
// numbered dots, each an object that can be selected (click, or Tab to
// it), moved (drag, or the arrow keys) and deleted (Delete or Backspace),
// with undo and redo. They stay editable after Save: the comment keeps the
// clean image and the objects, and the annotated image is rendered from
// them. Nothing is saved unless the reviewer chooses Save annotations.
// Cancel, Escape and the close button close the editor - asking first when
// there are unsaved changes - and a click on the backdrop does nothing.
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
  // The image the annotations sit on: the clean one when there is one.
  // An older comment's one image (perhaps with a drawing baked in) is the
  // base otherwise.
  const base = comment.screenshotClean ?? comment.screenshot;
  // What was saved before, to tell whether anything changed.
  const [initial] = useState<string>(() =>
    JSON.stringify(comment.annotations ?? []),
  );
  const [list, setList] = useState<Annotation[]>(comment.annotations ?? []);
  const [past, setPast] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [selected, setSelected] = useState<number | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef<[number, number][] | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const drag = useRef<{
    index: number;
    from: { x: number; y: number };
    origin: Annotation;
    moved: boolean;
  } | null>(null);
  const saveReasonId = useId();
  const dirty = JSON.stringify(list) !== initial;
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

  // Cancel, Escape and the close button: straight out when nothing
  // changed, otherwise ask before the changes are thrown away.
  const requestClose = () => {
    if (dirty) ask("discard");
    else onCancel();
  };

  // Every change goes through here, so it can be undone.
  const commit = (next: Annotation[], before: Annotation[] = list) => {
    setPast((p) => [...p, before]);
    setFuture([]);
    setList(next);
  };
  const undo = () => {
    if (past.length === 0) return;
    setFuture((f) => [list, ...f]);
    setList(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setSelected(null);
  };
  const redo = () => {
    if (future.length === 0) return;
    setPast((p) => [...p, list]);
    setList(future[0]);
    setFuture((f) => f.slice(1));
    setSelected(null);
  };
  const remove = (index: number) => {
    commit(list.filter((_, i) => i !== index));
    setSelected(null);
    requestAnimationFrame(() =>
      bodyRef.current?.querySelector<HTMLElement>(".art-shot-scroll")?.focus(),
    );
  };

  // The pointer's position as a fraction of the image, and the image px
  // per CSS px at the current display size.
  const toImage = (event: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      scale: (size?.w ?? rect.width) / rect.width,
    };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!size || event.button !== 0) return;
    const p = toImage(event);
    const hit = (event.target as Element).closest?.("[data-ann]");
    if (tool === "select") {
      if (!hit) {
        setSelected(null);
        return;
      }
      const index = Number(hit.getAttribute("data-ann"));
      setSelected(index);
      svgRef.current!.setPointerCapture(event.pointerId);
      drag.current = { index, from: p, origin: list[index], moved: false };
      return;
    }
    svgRef.current!.setPointerCapture(event.pointerId);
    if (tool === "pen") {
      drawing.current = [[p.x, p.y]];
      setDraft({
        kind: "stroke",
        color: penColor,
        points: drawing.current,
        size: (STROKE_PX * p.scale) / size.w,
      });
      return;
    }
    const placed: Annotation =
      tool === "arrow"
        ? {
            kind: "arrow",
            color: penColor,
            x: p.x,
            y: p.y,
            size: (ARROW_LENGTH_PX * p.scale) / size.w,
          }
        : {
            kind: "dot",
            color: penColor,
            x: p.x,
            y: p.y,
            size: (DOT_RADIUS_PX * p.scale) / size.w,
          };
    commit([...list, placed]);
    setSelected(list.length);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drawing.current && draft?.kind === "stroke") {
      const p = toImage(event);
      drawing.current = [...drawing.current, [p.x, p.y]];
      setDraft({ ...draft, points: drawing.current });
    } else if (drag.current) {
      const p = toImage(event);
      const d = drag.current;
      d.moved = true;
      setList((current) =>
        current.map((a, i) =>
          i === d.index
            ? moveAnnotation(d.origin, p.x - d.from.x, p.y - d.from.y)
            : a,
        ),
      );
    }
  };

  const onPointerUp = () => {
    if (drawing.current && draft) {
      commit([...list, draft]);
      drawing.current = null;
      setDraft(null);
    } else if (drag.current) {
      const d = drag.current;
      drag.current = null;
      if (d.moved) {
        const before = list.map((a, i) => (i === d.index ? d.origin : a));
        setPast((p) => [...p, before]);
        setFuture([]);
      }
    }
  };

  // The editor's own keys. Never while typing in a field (the pen color
  // box), so Delete and the shortcuts there do what they always do.
  const onKeyDown = (event: ReactKeyboardEvent) => {
    const t = event.target as HTMLElement;
    if (t.closest("input, textarea, [contenteditable='true']")) return;
    const mod = isMac() ? event.metaKey : event.ctrlKey;
    if (mod && event.code === "KeyZ") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (!isMac() && event.ctrlKey && event.code === "KeyY") {
      event.preventDefault();
      redo();
      return;
    }
    if (selected == null) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove(selected);
      return;
    }
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (event.key in moves && t.closest("[data-ann]")) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      commit(
        list.map((a, i) =>
          i === selected
            ? moveAnnotation(a, dx, (dy * (size?.w ?? 1)) / (size?.h ?? 1))
            : a,
        ),
      );
    }
  };

  const confirmationCopy = {
    discard: {
      title: "Discard drawing?",
      consequence:
        "Your changes to the annotations on this screenshot will be lost. This can't be undone.",
      confirmLabel: "Discard drawing",
    },
    clear: {
      title: "Clear annotations?",
      consequence:
        "Every annotation on this screenshot will be removed. Undo can bring them back while the editor is open.",
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
      commit([]);
      setSelected(null);
      // Clear annotations stays; focus goes back to it.
      const trigger = confirmTrigger.current;
      requestAnimationFrame(() => trigger?.focus());
    }
  };

  // Keeps two images when there are annotations: the clean one and one
  // rendered with every annotation. With none left, just the clean image.
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (list.length === 0) {
        onSave({
          screenshot: base,
          screenshotClean: undefined,
          annotations: undefined,
        });
        return;
      }
      onSave({
        screenshot: await renderAnnotated(base, list),
        screenshotClean: base,
        annotations: list,
      });
    } finally {
      setSaving(false);
    }
  };

  const numbers = dotNumbers(list);
  const shown = draft ? [...list, draft] : list;

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
      <Stack gap="rec-default" ref={bodyRef} onKeyDown={onKeyDown}>
        {/* The toolbar stays put; only the image area beneath it scrolls.
            The tool is a short exclusive choice laid out in a row, so it is
            the kit's segmented control. */}
        <Group align="flex-end" gap="rec-default" wrap="wrap">
          <SegmentedControl
            aria-label="Tool"
            data={TOOLS}
            value={tool}
            onChange={(value) => {
              setTool(value as Tool);
              if (value !== "select") setSelected(null);
            }}
          />
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
          {/* Nothing to clear means nothing to lose: no question then. */}
          <Button
            variant="outline"
            size="small"
            onClick={() => list.length > 0 && ask("clear")}
          >
            Clear annotations
          </Button>
        </Group>
        {/* A bordered container, so the image's edge shows against the
            modal; the image scrolls inside it. */}
        <div className="art-shot-well">
          <div className="art-shot-scroll" tabIndex={-1}>
            <div className="art-shot">
              <img
                src={base}
                alt={`Screenshot attached to ${id}`}
                onLoad={(event) =>
                  setSize({
                    w: event.currentTarget.naturalWidth,
                    h: event.currentTarget.naturalHeight,
                  })
                }
              />
              {size && (
                <svg
                  ref={svgRef}
                  className="art-ann"
                  data-tool={tool}
                  viewBox={`0 0 ${size.w} ${size.h}`}
                  preserveAspectRatio="none"
                  aria-label={`Annotations on the screenshot for ${id}`}
                  role="group"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  {shown.map((a, i) => {
                    const isDraft = draft != null && i === list.length;
                    const n = list
                      .slice(0, i + 1)
                      .filter((x) => x.kind === a.kind).length;
                    const label = `${KIND_NAME[a.kind]} ${a.kind === "dot" ? numbers.get(i) : n}`;
                    return (
                      <g
                        key={i}
                        data-ann={isDraft ? undefined : i}
                        className="art-ann-item"
                        tabIndex={isDraft ? undefined : 0}
                        role={isDraft ? undefined : "button"}
                        aria-label={isDraft ? undefined : label}
                        aria-pressed={isDraft ? undefined : selected === i}
                        onFocus={() => !isDraft && setSelected(i)}
                      >
                        <AnnotationShape
                          a={a}
                          w={size.w}
                          h={size.h}
                          number={numbers.get(i)}
                        />
                        {selected === i && (
                          <rect
                            className="art-ann-selection"
                            {...(() => {
                              const b = bounds(a, size.w, size.h);
                              return {
                                x: b.x,
                                y: b.y,
                                width: b.w,
                                height: b.h,
                              };
                            })()}
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
          </div>
        </div>
      </Stack>
      {/* The reason Save annotations starts disabled, for screen readers
          only (no visible helper text, by owner decision). */}
      <span id={saveReasonId} className="art-sr-only">
        Change the annotations to enable Save annotations.
      </span>
      {/* Every button is a direct child of the footer, so the modal's own
          button gap applies throughout. OWNER-APPROVED EXCEPTION: the rarely
          used Delete screenshot sits at the bottom left, pushed apart from
          Cancel and Save by a flexible spacer - the kit's modal footer has
          no slot for a rarely used action on the left (a reported gap). */}
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
          disabled={!dirty}
          loading={saving}
          aria-describedby={dirty ? undefined : saveReasonId}
          onClick={() => void save()}
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
