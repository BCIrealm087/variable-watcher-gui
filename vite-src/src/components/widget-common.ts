import { MIN_WIDGET_W, MIN_WIDGET_H, MIN_MULT, MAX_MULT, PAD, GAP } from '../constants';
import { ReactNode } from 'react';

type WidgetComponent<Props extends object> = (props: Props & { 
    availableWidth: number, availableHeight: number, value: number, 
    highlight: string, unit?: string
  }) => ReactNode

export type WidgetKind<K extends string, Specs extends object, Props extends object = { }> = {
  Component: WidgetComponent<Props>
  kind: K, 
  specs: Specs & { id: string, label: string, unit?: string, highlight?: HighlightConditions },
  loadSpecificProps: (specs: Specs) => Props
};

type HighlightRange = { start: number } | { end: number } | { start: number, end: number }
export type HighlightConditions = Record<string, (number | HighlightRange)[]>

export type Widget<K extends string, Props extends object = { }> = {
  id: string;
  name: string;
  unit?: string;
  value: number;
  kind: K;
  highlight?: HighlightConditions;
  x: number;
  y: number;
  w: number;
  h: number;
  mw: number;
  mh: number;
  rx: number;
  ry: number;
  z: number;
  specificProps: Props;
  Component: WidgetComponent<Props>;
};

type WidgetBase = Widget<any, any>;

export type DragState = {
  id: string;
  offsetX: number;
  offsetY: number;
} | null;

export type ResizeState = {
  id: string;
  dirX: ResizeDir;
  dirY: ResizeDir;
  startPX: number;
  startPY: number;
  anchorLeft: number;
  anchorTop: number;
  anchorRight: number;
  anchorBottom: number;
} | null;

export type ResizeDir = -1 | 0 | 1;

export type Size = { width: number; height: number };

export const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export function getWidgetSizeLimits(bounds: Size, baseW: number, baseH: number) {
  // Minimums are primarily relative (MIN_MULT) + small absolute floor for usability.
  const relMinW = baseW * MIN_MULT;
  const relMinH = baseH * MIN_MULT;

  const minW = Math.max(MIN_WIDGET_W, relMinW);
  const minH = Math.max(MIN_WIDGET_H, relMinH);

  // Maximums: don't exceed container.
  const maxW = Math.max(minW, Math.min(baseW * MAX_MULT, bounds.width - 1));
  const maxH = Math.max(minH, Math.min(baseH * MAX_MULT, bounds.height - 1));

  const minMW = clamp(minW / Math.max(1, baseW), MIN_MULT, MAX_MULT);
  const minMH = clamp(minH / Math.max(1, baseH), MIN_MULT, MAX_MULT);

  const maxMW = clamp(maxW / Math.max(1, baseW), MIN_MULT, MAX_MULT);
  const maxMH = clamp(maxH / Math.max(1, baseH), MIN_MULT, MAX_MULT);

  return { minW, minH, maxW, maxH, minMW, minMH, maxMW, maxMH };
}

export function clampToBounds<T extends WidgetBase>(w: T, bounds: Size): T {
  const x = clamp(w.x, 0, Math.max(0, bounds.width - w.w));
  const y = clamp(w.y, 0, Math.max(0, bounds.height - w.h));
  return { ...w, x, y };
}

export function overlaps(a: WidgetBase, b: WidgetBase) {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

export function rect(w: WidgetBase) {
  const left = w.x;
  const top = w.y;
  const right = w.x + w.w;
  const bottom = w.y + w.h;
  return {
    left,
    top,
    right,
    bottom,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
  };
}

export function overlapAmount(a: WidgetBase, b: WidgetBase) {
  const ra = rect(a);
  const rb = rect(b);
  const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
  const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
  return { ox, oy };
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

export function withRelativeCenters<T extends Widget<any, any>>(widgets: T[], bounds: Size): T[] {
  if (bounds.width <= 0 || bounds.height <= 0) return widgets;
  return widgets.map((w) => {
    const cx = w.x + w.w / 2;
    const cy = w.y + w.h / 2;
    return {
      ...w,
      rx: clamp(cx / bounds.width, 0, 1),
      ry: clamp(cy / bounds.height, 0, 1),
    };
  });
}

export function resizeWithPush<T extends WidgetBase>(
  widgets: T[],
  state: Exclude<ResizeState, null>,
  desiredRect: { x: number; y: number; w: number; h: number },
  bounds: Size,
  base: { w: number; h: number }
) {
  const byId = new Map(widgets.map((w) => [w.id, { ...w }]));
  const active = byId.get(state.id);
  if (!active) return widgets;

  const { minW, minH, maxW, maxH } = getWidgetSizeLimits(bounds, base.w, base.h);

  active.x = desiredRect.x;
  active.y = desiredRect.y;
  active.w = clamp(desiredRect.w, minW, maxW);
  active.h = clamp(desiredRect.h, minH, maxH);

  if (active.x < 0) {
    if (state.dirX === -1) {
      active.x = 0;
      active.w = clamp(state.anchorRight - active.x, minW, maxW);
    } else {
      active.x = 0;
    }
  }
  if (active.y < 0) {
    if (state.dirY === -1) {
      active.y = 0;
      active.h = clamp(state.anchorBottom - active.y, minH, maxH);
    } else {
      active.y = 0;
    }
  }

  if (active.x + active.w > bounds.width) {
    if (state.dirX === 1) {
      active.w = clamp(bounds.width - active.x, minW, maxW);
    } else if (state.dirX === -1) {
      active.x = clamp(bounds.width - active.w, 0, bounds.width);
      active.w = clamp(state.anchorRight - active.x, minW, maxW);
    } else {
      active.x = clamp(bounds.width - active.w, 0, bounds.width);
    }
  }

  if (active.y + active.h > bounds.height) {
    if (state.dirY === 1) {
      active.h = clamp(bounds.height - active.y, minH, maxH);
    } else if (state.dirY === -1) {
      active.y = clamp(bounds.height - active.h, 0, bounds.height);
      active.h = clamp(state.anchorBottom - active.y, minH, maxH);
    } else {
      active.y = clamp(bounds.height - active.h, 0, bounds.height);
    }
  }

  Object.assign(active, clampToBounds(active, bounds));

  for (let iter = 0; iter < 50; iter++) {
    let changed = false;

    for (const other of byId.values()) {
      if (other.id === active.id) continue;
      if (!overlaps(active, other)) continue;

      const { ox, oy } = overlapAmount(active, other);
      if (ox <= 0 || oy <= 0) continue;

      const ra = rect(active);
      const rb = rect(other);

      const resolveOnX = state.dirX !== 0 ? true : state.dirY !== 0 ? false : ox < oy;

      if (resolveOnX) {
        const dir: ResizeDir = state.dirX !== 0 ? state.dirX : ra.cx < rb.cx ? 1 : -1;
        const shift = ox + PAD;

        const targetX = other.x + dir * shift;
        const clampedX = clamp(targetX, 0, Math.max(0, bounds.width - other.w));

        if (clampedX === targetX) {
          other.x = clampedX;
        } else {
          if (dir === 1) {
            const maxRight = other.x - PAD;
            if (state.dirX === 1) {
              active.w = clamp(maxRight - active.x, minW, maxW);
            } else {
              active.x = maxRight - active.w;
            }
          } else {
            const minLeft = other.x + other.w + PAD;
            if (state.dirX === -1) {
              active.x = clamp(minLeft, 0, state.anchorRight - minW);
              active.w = clamp(state.anchorRight - active.x, minW, maxW);
            } else {
              active.x = minLeft;
            }
          }
          Object.assign(active, clampToBounds(active, bounds));
        }
      } else {
        const dir: ResizeDir = state.dirY !== 0 ? state.dirY : ra.cy < rb.cy ? 1 : -1;
        const shift = oy + PAD;

        const targetY = other.y + dir * shift;
        const clampedY = clamp(targetY, 0, Math.max(0, bounds.height - other.h));

        if (clampedY === targetY) {
          other.y = clampedY;
        } else {
          if (dir === 1) {
            const maxBottom = other.y - PAD;
            if (state.dirY === 1) {
              active.h = clamp(maxBottom - active.y, minH, maxH);
            } else {
              active.y = maxBottom - active.h;
            }
          } else {
            const minTop = other.y + other.h + PAD;
            if (state.dirY === -1) {
              active.y = clamp(minTop, 0, state.anchorBottom - minH);
              active.h = clamp(state.anchorBottom - active.y, minH, maxH);
            } else {
              active.y = minTop;
            }
          }
          Object.assign(active, clampToBounds(active, bounds));
        }
      }

      changed = true;
    }

    const resolved = resolveAllOverlaps([...byId.values()], bounds, new Set([active.id]));
    byId.clear();
    for (const w of resolved) byId.set(w.id, w);

    if (!changed) break;
  }

  const refreshed = byId.get(active.id);
  if (refreshed) {
    const { minMW, minMH, maxMW, maxMH } = getWidgetSizeLimits(bounds, base.w, base.h);
    refreshed.mw = clamp(refreshed.w / Math.max(1, base.w), minMW, maxMW);
    refreshed.mh = clamp(refreshed.h / Math.max(1, base.h), minMH, maxMH);
  }

  return withRelativeCenters(
    widgets.map((w) => byId.get(w.id)!).map((w) => clampToBounds(w, bounds)),
    bounds
  );
}

export function moveWithPush<T extends WidgetBase>(widgets: T[], activeId: string, desiredX: number, desiredY: number, bounds: Size) {
  const byId = new Map(widgets.map((w) => [w.id, { ...w }]));
  const active = byId.get(activeId);
  if (!active) return widgets;

  active.x = desiredX;
  active.y = desiredY;
  Object.assign(active, clampToBounds(active, bounds));

  for (let iter = 0; iter < 40; iter++) {
    let changed = false;

    for (const other of byId.values()) {
      if (other.id === active.id) continue;
      if (!overlaps(active, other)) continue;

      const { ox, oy } = overlapAmount(active, other);
      if (ox <= 0 || oy <= 0) continue;

      const ra = rect(active);
      const rb = rect(other);
      const resolveOnX = ox < oy;

      if (resolveOnX) {
        const pushingRight = ra.cx < rb.cx;
        const shift = ox + PAD;

        const targetX = other.x + (pushingRight ? shift : -shift);
        const clampedX = clamp(targetX, 0, Math.max(0, bounds.width - other.w));

        if (clampedX === targetX) {
          other.x = clampedX;
        } else {
          if (pushingRight) {
            active.x = other.x - active.w - PAD;
          } else {
            active.x = other.x + other.w + PAD;
          }
          Object.assign(active, clampToBounds(active, bounds));
        }
      } else {
        const pushingDown = ra.cy < rb.cy;
        const shift = oy + PAD;

        const targetY = other.y + (pushingDown ? shift : -shift);
        const clampedY = clamp(targetY, 0, Math.max(0, bounds.height - other.h));

        if (clampedY === targetY) {
          other.y = clampedY;
        } else {
          if (pushingDown) {
            active.y = other.y - active.h - PAD;
          } else {
            active.y = other.y + other.h + PAD;
          }
          Object.assign(active, clampToBounds(active, bounds));
        }
      }

      changed = true;
    }

    const resolved = resolveAllOverlaps([...byId.values()], bounds, new Set([activeId]));
    byId.clear();
    for (const w of resolved) byId.set(w.id, w);

    if (!changed) break;
  }

  return withRelativeCenters(
    widgets.map((w) => byId.get(w.id)!).map((w) => clampToBounds(w, bounds)),
    bounds
  );
}

export function computeWidgetWH(n: number, bounds: Size) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));

  const cellW = (bounds.width - GAP * (cols + 1)) / cols;
  const cellH = (bounds.height - GAP * (rows + 1)) / rows;

  const maxW = Math.max(120, bounds.width - GAP * 2);
  const maxH = Math.max(120, bounds.height - GAP * 2);

  const w = clamp(Math.floor(cellW), 180, maxW);
  const h = clamp(Math.floor(cellH), 120, maxH);

  return { w, h, cols, rows };
}