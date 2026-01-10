import { useRef, useState, useEffect, 
  Dispatch, SetStateAction, RefObject,
  useMemo, useCallback
} from "react";

import { VARS_CONFIG_KEY, VARS_CONFIG_PATH_KEY, LAYOUT_KEY, GAP, PAD } from "../constants";

import { getNeu, safeGetData, safeSetData } from "../system";
import { useSerialState } from "../variableStore";

import { WidgetCard } from "./WidgetCard";
import { 
  Widget, WidgetSpec, WidgetSpecBase,
  WidgetBase, isNonEmptyString, rand, 
  clamp
} from "./widget-common";
import {
  ResizeDir, DragState, ResizeState,
  Size, getWidgetSizeLimits, moveWithPush, 
  computeWidgetWH, clampToBounds, withRelativeCenters,
  rect, overlaps, overlapAmount,
  resizeWithPush
} from './widget-operations'
import { NumericWidget, parseNumeric } from "./NumericWidget";
import { parseAccelerometer } from "./AccelerometerWidget";

type PersistedWidget<K extends string> = {
  id: string;
  mw: number;
  mh: number;
  rx: number;
  ry: number;
  z?: number;
  kind?: K;
};

type PersistedLayoutV1<K extends string> = {
  version: 1;
  savedAt: number;
  widgets: PersistedWidget<K>[];
};

// Runtime shape used by widget spawning
type WidgetDef<K extends string, T extends object, U extends object> = WidgetSpec<K, T, U> & {
  value: number;    // stable null session value
};

type WidgetDefFromSpec<K extends string, T extends object, U extends object> = WidgetSpec<K, T, U> & { value: number };

type StateFunc<T> = Dispatch<SetStateAction<T>>;

export function withPlaceholderFallback<T extends WidgetSpecBase[]>(s: T): T | WidgetSpec<'numeric', { }, { }>[] {
  return s.length
    ? s
    : [{ 
        specs: { id: "0", label: "placeholder" }, 
        kind: 'numeric', Component: NumericWidget, loadSpecificProps: ()=>({ })
      }];
}

export function parseVarSpecs<
  M extends { [K: string]: (input: Record<string, unknown>)=>WidgetSpec<typeof K, object, object> }
>(text: string, kindParseMapping: M) {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: (ReturnType<M[keyof M]>)[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const widgetKind = isNonEmptyString(obj.widget) ? obj.widget.trim().toLowerCase() : 'numeric';
    const parsingFn = kindParseMapping[widgetKind as keyof M];
    if(!parsingFn) continue;
    const widgetInfo = parsingFn(obj);

    seen.add(widgetInfo.specs.id);
    out.push(widgetInfo as (ReturnType<M[keyof M]>));
  }

  return out;
}

function parseLayout<K extends string>(raw: string | null): PersistedLayoutV1<K> | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj?.version !== 1 || !Array.isArray(obj.widgets)) return null;
    return obj as PersistedLayoutV1<K>;
  } catch {
    return null;
  }
}

function resolveAllOverlaps<T extends WidgetBase>(
  widgets: T[],
  bounds: Size,
  lockedIds: Set<string> = new Set()
) {
  let next = widgets.map((w) => clampToBounds(w, bounds));

  for (let iter = 0; iter < 40; iter++) {
    let changed = false;

    for (let i = 0; i < next.length; i++) {
      for (let j = i + 1; j < next.length; j++) {
        const a = next[i];
        const b = next[j];
        if (!overlaps(a, b)) continue;

        const { ox, oy } = overlapAmount(a, b);
        if (ox <= 0 || oy <= 0) continue;

        const ra = rect(a);
        const rb = rect(b);
        const moveX = ox < oy;

        const aLocked = lockedIds.has(a.id);
        const bLocked = lockedIds.has(b.id);

        if (aLocked && bLocked) continue;

        if (moveX) {
          const dir = ra.cx < rb.cx ? -1 : 1;
          const dx = ox + PAD;

          if (aLocked) {
            const nb = clampToBounds({ ...b, x: b.x - dir * dx }, bounds);
            next[j] = nb;
          } else if (bLocked) {
            const na = clampToBounds({ ...a, x: a.x + dir * dx }, bounds);
            next[i] = na;
          } else {
            const split = dx / 2;
            const na = clampToBounds({ ...a, x: a.x + dir * split }, bounds);
            const nb = clampToBounds({ ...b, x: b.x - dir * split }, bounds);
            next[i] = na;
            next[j] = nb;
          }
        } else {
          const dir = ra.cy < rb.cy ? -1 : 1;
          const dy = oy + PAD;

          if (aLocked) {
            const nb = clampToBounds({ ...b, y: b.y - dir * dy }, bounds);
            next[j] = nb;
          } else if (bLocked) {
            const na = clampToBounds({ ...a, y: a.y + dir * dy }, bounds);
            next[i] = na;
          } else {
            const split = dy / 2;
            const na = clampToBounds({ ...a, y: a.y + dir * split }, bounds);
            const nb = clampToBounds({ ...b, y: b.y - dir * split }, bounds);
            next[i] = na;
            next[j] = nb;
          }
        }

        changed = true;
      }
    }

    if (!changed) break;
  }

  return next;
}

function makeInitialWidgets<K extends string, T extends object, U extends object>(defs: WidgetDef<K, T, U>[], bounds: Size): Widget<K, U>[] {
  const n = defs.length;
  const { w: baseW, h: baseH, cols } = computeWidgetWH(n, bounds);

  const widgets: Widget<K, U>[] = defs.map((d, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;

    const baseX = GAP + col * (baseW + GAP);
    const baseY = GAP + row * (baseH + GAP);
    const x = baseX + rand(-12, 12);
    const y = baseY + rand(-12, 12);
    const w: Widget<K, U> = {
      id: d.specs.id,
      name: d.specs.label,
      unit: d.specs.unit,             // <-- from config
      value: d.value,
      kind: d.kind,                   // <-- from config (default already applied)
      highlight: d.specs.highlight,   // <-- from config
      x,
      y,
      w: baseW,
      h: baseH,
      mw: 1,
      mh: 1,
      rx: 0.5,
      ry: 0.5,
      z: i,
      specificProps: d.loadSpecificProps(d.specs), 
      Component: d.Component
    };

    return clampToBounds(w, bounds);
  });

  return withRelativeCenters(resolveAllOverlaps(widgets, bounds), bounds);
}

function buildWidgetsFromLayout<
  K extends string, T extends object, U extends object>(defs: WidgetDef<K, T, U>[], bounds: Size, layout: PersistedLayoutV1<K> | null)
{
  const base = computeWidgetWH(defs.length, bounds);
  const baseW = base.w;
  const baseH = base.h;

  const defaults = makeInitialWidgets(defs, bounds);

  if (!layout) {
    const ws = defaults.map((w) => ({ ...w, w: baseW * w.mw, h: baseH * w.mh }));
    return withRelativeCenters(resolveAllOverlaps(ws, bounds), bounds);
  }

  const persisted = new Map(layout.widgets.map((pw) => [pw.id, pw]));
  const { minMW, minMH, maxMW, maxMH } = getWidgetSizeLimits(bounds, baseW, baseH);

  const merged = defaults.map((w) => {
    const p = persisted.get(w.id);

    const mw = clamp(p?.mw ?? w.mw, minMW, maxMW);
    const mh = clamp(p?.mh ?? w.mh, minMH, maxMH);
    const rx = clamp(p?.rx ?? w.rx, 0, 1);
    const ry = clamp(p?.ry ?? w.ry, 0, 1);

    const newW = baseW * mw;
    const newH = baseH * mh;

    const cx = rx * bounds.width;
    const cy = ry * bounds.height;

    // NOTE: kind/name/unit come from config via defaults (w),
    // not from persisted layout.
    return clampToBounds(
      {
        ...w,
        mw,
        mh,
        rx,
        ry,
        z: p?.z ?? w.z,
        w: newW,
        h: newH,
        x: cx - newW / 2,
        y: cy - newH / 2,
      },
      bounds
    );
  });

  return withRelativeCenters(resolveAllOverlaps(merged, bounds), bounds);
}

function layoutFromWidgets<K extends string>(ws: Widget<K>[]): PersistedLayoutV1<K> {
  return {
    version: 1,
    savedAt: Date.now(),
    widgets: ws.map((w) => ({
      id: w.id,
      mw: w.mw,
      mh: w.mh,
      rx: w.rx,
      ry: w.ry,
      z: w.z,
      kind: w.kind,
    })),
  };
}

const bringToFront = <K extends string>(id: string, Component: { setWidgets: StateFunc<Widget<K>[]> }) => {
  Component.setWidgets((prev) => {
    const maxZ = prev.reduce((m, w) => Math.max(m, w.z), 0);
    return prev.map((w) => (w.id === id ? { ...w, z: maxZ + 1 } : w));
  });
};

const onDragPointerDown = <K extends string>(e: React.PointerEvent, id: string, 
  Component: {
    containerRef: RefObject<HTMLDivElement | null>, 
    widgets: Widget<K>[], 
    dragRef: RefObject<DragState>, 
    setWidgets: StateFunc<Widget<K>[]>
  }
) => {
  const el = Component.containerRef.current;
  if (!el) return;

  const w = Component.widgets.find((x) => x.id === id);
  if (!w) return;

  bringToFront(id, Component);
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

  const containerRect = el.getBoundingClientRect();
  const pointerX = e.clientX - containerRect.left;
  const pointerY = e.clientY - containerRect.top;

  Component.dragRef.current = {
    id,
    offsetX: pointerX - w.x,
    offsetY: pointerY - w.y,
  };
};

const onResizePointerDown = <K extends string>(e: React.PointerEvent, id: string, dirX: ResizeDir, dirY: ResizeDir, 
  Component: {
    containerRef: RefObject<HTMLDivElement | null>, 
    widgets: Widget<K>[], 
    resizeRef: RefObject<ResizeState>, 
    setWidgets: StateFunc<Widget<K>[]>
  }
) => {
  const el = Component.containerRef.current;
  if (!el) return;
  const w = Component.widgets.find((x) => x.id === id);
  if (!w) return;
  bringToFront(id, Component);
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

  const containerRect = el.getBoundingClientRect();
  const pointerX = e.clientX - containerRect.left;
  const pointerY = e.clientY - containerRect.top;

  Component.resizeRef.current = {
    id,
    dirX,
    dirY,
    startPX: pointerX,
    startPY: pointerY,
    anchorLeft: w.x,
    anchorTop: w.y,
    anchorRight: w.x + w.w,
    anchorBottom: w.y + w.h,
  };
};

const onPointerMove = <K extends string>(e: React.PointerEvent, 
  Component: {
    containerRef: RefObject<HTMLDivElement | null>, 
    resizeRef: RefObject<ResizeState>, 
    baseRef: React.RefObject<{
      w: number;
      h: number;
    }>, 
    bounds: Size, 
    setWidgets: StateFunc<Widget<K>[]>, 
    dragRef: RefObject<DragState>
  }
) => {
  const el = Component.containerRef.current;
  if (!el) return;

  const containerRect = el.getBoundingClientRect();
  const pointerX = e.clientX - containerRect.left;
  const pointerY = e.clientY - containerRect.top;

  const resizeState = Component.resizeRef.current;
  if (resizeState) {
    const dx = pointerX - resizeState.startPX;
    const dy = pointerY - resizeState.startPY;

    const base = Component.baseRef.current;
    if (base.w <= 0 || base.h <= 0) return;

    const { minW, minH, maxW, maxH } = getWidgetSizeLimits(Component.bounds, base.w, base.h);

    let left = resizeState.anchorLeft;
    let right = resizeState.anchorRight;
    let top = resizeState.anchorTop;
    let bottom = resizeState.anchorBottom;

    if (resizeState.dirX === 1) {
      right = clamp(resizeState.anchorRight + dx, left + minW, left + maxW);
      right = Math.min(right, Component.bounds.width);
    } else if (resizeState.dirX === -1) {
      left = clamp(resizeState.anchorLeft + dx, right - maxW, right - minW);
      left = Math.max(left, 0);
    }

    if (resizeState.dirY === 1) {
      bottom = clamp(resizeState.anchorBottom + dy, top + minH, top + maxH);
      bottom = Math.min(bottom, Component.bounds.height);
    } else if (resizeState.dirY === -1) {
      top = clamp(resizeState.anchorTop + dy, bottom - maxH, bottom - minH);
      top = Math.max(top, 0);
    }

    const desired = { x: left, y: top, w: right - left, h: bottom - top };

    Component.setWidgets((prev) => resizeWithPush(prev, resizeState, desired, Component.bounds, base));
    return;
  }

  const drag = Component.dragRef.current;
  if (!drag) return;

  const desiredX = pointerX - drag.offsetX;
  const desiredY = pointerY - drag.offsetY;

  Component.setWidgets((prev) => {
    if (Component.bounds.width <= 0 || Component.bounds.height <= 0) return prev;
    return moveWithPush(prev, drag.id, desiredX, desiredY, Component.bounds);
  });
};

const onPointerUpOrCancel = (Component: { resizeRef: RefObject<ResizeState>, dragRef: RefObject<DragState> }) => {
  Component.dragRef.current = null;
  Component.resizeRef.current = null;
};

type MergedKeysOf<T extends object> = Exclude<keyof T, number | symbol> | 'numeric' | 'accelerometer';

export const baseParseMapping = {
  'numeric': parseNumeric,
  'accelerometer': parseAccelerometer
}

export function useBoardState<
M extends { [K: string]: (input: Record<string, unknown>)=>WidgetSpec<MergedKeysOf<M>, any, any> }
>(widgetKindParseMapping: M = baseParseMapping as M & typeof baseParseMapping) {
  const [initialized, setInitialized] = useState(false);
  const [varSpecs, setVarSpecs] = useState<
    (WidgetSpec<'numeric', {}> | WidgetSpec<'accelerometer', {}> | ReturnType<M[keyof M]>)[]
  >(() =>
    withPlaceholderFallback([])
  );
  const [widgets, setWidgets] = useState<Widget<MergedKeysOf<M>>[]>([]);
  const _parseVarSpecs = (text: string) => withPlaceholderFallback(parseVarSpecs(text, widgetKindParseMapping));
  return {
    initialized, setInitialized, initializedState: [initialized, setInitialized],
    widgets, setWidgets, widgetsState: [widgets, setWidgets],
    varSpecs, setVarSpecs, varSpecsState: [varSpecs, setVarSpecs],
    kindParseMapping: widgetKindParseMapping, 
    parseVarSpecs: _parseVarSpecs
  } as const
}

export function WidgetBoard<
  M extends { [K: string]: (input: Record<string, unknown>)=>WidgetSpec<MergedKeysOf<M>, any, any> }
>({
  containerRef, bounds, handledBoardState
}: {
  containerRef: RefObject<HTMLDivElement | null>, 
  bounds: { width: number, height: number }, 
  handledBoardState?: ReturnType<typeof useBoardState<M>>
}) {
  const valuesRef = useRef<Record<string, number>>({});
  const serialState = useSerialState();
  const baseRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [initialized, setInitialized] = handledBoardState?.initializedState || useState(false);
  const mergedParseMapping = {
    ...baseParseMapping, 
    ...(handledBoardState?.kindParseMapping || baseParseMapping as M & typeof baseParseMapping)
  }
  const [varSpecs, setVarSpecs] = handledBoardState?.varSpecsState
    || useState<
      (WidgetSpec<'numeric', {}> | WidgetSpec<'accelerometer', {}> | ReturnType<M[keyof M]>)[]
    >(() =>
      withPlaceholderFallback([])
    );
  const varDefs = useMemo<(WidgetDefFromSpec<MergedKeysOf<M>, any, any>)[]>(() => {
    const specs = withPlaceholderFallback(varSpecs);

    return specs.map((s) => {
      let v = valuesRef.current[s.specs.id];
      if (v == null) {
        v = 0;
        valuesRef.current[s.specs.id] = v;
      }

      return {
        kind: s.kind, 
        specs: {
          ...s.specs
        }, 
        value: v, 
        Component: s.Component, 
        loadSpecificProps: s.loadSpecificProps
      }
    });
  }, [varSpecs]);
  const [widgets, setWidgets] = handledBoardState?.widgetsState || useState<Widget<MergedKeysOf<M>>[]>([]);
  const latestWidgetsRef = useRef<Widget<MergedKeysOf<M>>[]>([]);
  latestWidgetsRef.current = widgets;
  const dragRef = useRef<DragState>(null);
  const resizeRef = useRef<ResizeState>(null);

  const draggingId = dragRef.current?.id ?? null;
  const resizingId = resizeRef.current?.id ?? null;

  useEffect(() => {
    const values = serialState.values || {};
    setWidgets((prev) =>
      prev.map((w) => {
        const live = values[w.id];
        if (typeof live !== "number" || w.value === live) return w;
        valuesRef.current[w.id] = live;
        return { ...w, value: live };
      })
    );
  }, [serialState.values, setWidgets]);

  useEffect(() => {
    (async () => {
      const neu = getNeu();

      const lastPath = await safeGetData(VARS_CONFIG_PATH_KEY);
      if (lastPath && neu?.filesystem?.readFile) {
        try {
          const text = await neu.filesystem.readFile(lastPath);
          const parsed = withPlaceholderFallback(parseVarSpecs(text, mergedParseMapping));
          setVarSpecs(parsed);
          await safeSetData(VARS_CONFIG_KEY, text);
          return;
        } catch { /* fall back to stored content below */ }
      }

      const stored = await safeGetData(VARS_CONFIG_KEY);
      const parsed = stored ? parseVarSpecs(stored, mergedParseMapping) : [];
      setVarSpecs(withPlaceholderFallback(parsed));
    })();
  }, []);

  // Initial layout load (async) once we have bounds.
  useEffect(() => {
    if (initialized) return;
    if (bounds.width <= 0 || bounds.height <= 0) return;

    (async () => {
      const raw = await safeGetData(LAYOUT_KEY);
      const layout = parseLayout<MergedKeysOf<M>>(raw);
      const built = buildWidgetsFromLayout(varDefs, bounds, layout);
      const { w: baseW, h: baseH } = computeWidgetWH(built.length, bounds);
      baseRef.current = { w: baseW, h: baseH };
      setWidgets(built);
      setInitialized(true);
    })();
  }, [bounds.width, bounds.height, varDefs, initialized]);

  useEffect(() => {
    if (!initialized) return;
    if (bounds.width <= 0 || bounds.height <= 0) return;

    setWidgets((prev) => {
      const layout = layoutFromWidgets(prev); // keep current unsaved layout too
      return buildWidgetsFromLayout(varDefs, bounds, layout);
    });
  }, [varDefs, initialized, bounds.width, bounds.height]);

  // Recompute base sizing + absolute x/y from (rx/ry) whenever the board resizes.
  useEffect(() => {
    if (!initialized) return;
    if (bounds.width <= 0 || bounds.height <= 0) return;

    setWidgets((prev) => {
      const { w: baseW, h: baseH } = computeWidgetWH(prev.length, bounds);
      baseRef.current = { w: baseW, h: baseH };

      const { minMW, minMH, maxMW, maxMH } = getWidgetSizeLimits(bounds, baseW, baseH);

      const next = prev.map((wi) => {
        const mw = clamp(wi.mw ?? 1, minMW, maxMW);
        const mh = clamp(wi.mh ?? 1, minMH, maxMH);

        const rx = clamp(Number.isFinite(wi.rx) ? wi.rx : 0.5, 0, 1);
        const ry = clamp(Number.isFinite(wi.ry) ? wi.ry : 0.5, 0, 1);

        const newW = baseW * mw;
        const newH = baseH * mh;

        const cx = rx * bounds.width;
        const cy = ry * bounds.height;

        return clampToBounds(
          {
            ...wi,
            mw,
            mh,
            rx,
            ry,
            w: newW,
            h: newH,
            x: cx - newW / 2,
            y: cy - newH / 2,
          },
          bounds
        );
      });

      return withRelativeCenters(resolveAllOverlaps(next, bounds), bounds);
    });
  }, [bounds.width, bounds.height, initialized]);

  // Persist layout (debounced) whenever widgets change.
  useEffect(() => {
    if (!initialized) return;

    const t = window.setTimeout(() => {
      const payload: PersistedLayoutV1<MergedKeysOf<M>> = {
        version: 1,
        savedAt: Date.now(),
        widgets: latestWidgetsRef.current.map((w) => ({
          id: w.id,
          mw: w.mw,
          mh: w.mh,
          rx: w.rx,
          ry: w.ry,
          z: w.z,
          kind: w.kind,
        })),
      };
      void safeSetData(LAYOUT_KEY, JSON.stringify(payload));
    }, 300);

    return () => window.clearTimeout(t);
  }, [widgets, initialized]);

  // Best-effort flush on close/unload.
  useEffect(() => {
    const flush = () => {
      const payload: PersistedLayoutV1<MergedKeysOf<M>> = {
        version: 1,
        savedAt: Date.now(),
        widgets: latestWidgetsRef.current.map((w) => ({
          id: w.id,
          mw: w.mw,
          mh: w.mh,
          rx: w.rx,
          ry: w.ry,
          z: w.z,
          kind: w.kind,
        })),
      };
      void safeSetData(LAYOUT_KEY, JSON.stringify(payload));
    };

    window.addEventListener("beforeunload", flush);

    const neu = getNeu();
    let neuHandler: any = null;

    if (neu?.events?.on) {
      neuHandler = () => flush();
      // Neutralino.events.on returns a promise; ignore.
      void neu.events.on("windowClose", neuHandler);
    }

    return () => {
      window.removeEventListener("beforeunload", flush);
      if (neu?.events?.off && neuHandler) {
        void neu.events.off("windowClose", neuHandler);
      }
    };
  }, []);

  const HandleOnPointerMove = useCallback((e: React.PointerEvent) => {
    onPointerMove(e, {
      containerRef, 
      resizeRef, 
      baseRef, 
      bounds, 
      setWidgets, 
      dragRef
    });
  }, [bounds, setWidgets]);

  const HandleOnPointerUpOrCancel = useCallback(() => {
    onPointerUpOrCancel({
      resizeRef, 
      dragRef
    });
  }, []);

  const HandleOnDragPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    onDragPointerDown(e, id, {
      containerRef, 
      widgets, 
      dragRef, 
      setWidgets
    });
  }, [widgets, setWidgets]);

  const HandleOnResizePointerDown = useCallback(
    (e: React.PointerEvent, id: string, dirX: ResizeDir, dirY: ResizeDir) => 
  {
    onResizePointerDown(e, id, dirX, dirY, {
      containerRef, 
      widgets, 
      resizeRef, 
      setWidgets
    });
  }, [widgets, setWidgets]);

  return (
      <div
        ref={containerRef}
        onPointerMove={HandleOnPointerMove}
        onPointerUp={HandleOnPointerUpOrCancel}
        onPointerCancel={HandleOnPointerUpOrCancel}
        style={{
          position: "relative",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {widgets.map((w) => (
          <WidgetCard
            key={w.id}
            w={w}
            isDragging={draggingId === w.id}
            isResizing={resizingId === w.id}
            onDragPointerDown={HandleOnDragPointerDown}
            onResizePointerDown={HandleOnResizePointerDown}
          />
        ))}

        {widgets.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.75,
            }}
          >
            Initializing…
          </div>
        )}
      </div>
  );
}