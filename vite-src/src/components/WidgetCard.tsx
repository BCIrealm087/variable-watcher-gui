import React, { useState, useEffect } from "react";
import { Widget, ResizeDir } from "./widget-common";

const HEADER_H = 44;

export function WidgetCard<K extends string, Props extends object>({
  w,
  isDragging,
  isResizing,
  onDragPointerDown,
  onResizePointerDown
}: {
  w: Widget<K, Props>;
  isDragging: boolean;
  isResizing: boolean;
  onDragPointerDown: (e: React.PointerEvent, id: string) => void;
  onResizePointerDown: (e: React.PointerEvent, id: string, dirX: ResizeDir, dirY: ResizeDir) => void;
}) {
  const [highlight, setHighlight] = useState("");

  useEffect(()=>{
    if (!w.highlight) return;
    Object.entries(w.highlight).some(([color, ranges])=>{
      if (ranges.some(range=>{
        if (typeof range === "number") {
          return w.value === range;
        }
        let contained = true;
        if ('start' in range)
          contained = contained && w.value >= range.start;
        if ('end' in range)
           contained = contained && w.value <= range.end;
        return contained;
      })) {
        setHighlight(color);
      } else {
        setHighlight("");
      }
    });
  }, [w.value, w.highlight]);

  const edge = 8;
  const corner = 14;

  const bodyPadding = w.kind === "accelerometer" ? 0 : 14;
  const innerW = Math.max(0, w.w - bodyPadding * 2);
  const innerH = Math.max(0, w.h - HEADER_H - bodyPadding * 2);

  const handleCommon: React.CSSProperties = {
    position: "absolute",
    background: "transparent",
    opacity: 1,
    touchAction: "none",
  };

  const Handle = ({
    style,
    cursor,
    dirX,
    dirY,
  }: {
    style: React.CSSProperties;
    cursor: React.CSSProperties["cursor"];
    dirX: ResizeDir;
    dirY: ResizeDir;
  }) => (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        onResizePointerDown(e, w.id, dirX, dirY);
      }}
      style={{ ...handleCommon, ...style, cursor }}
    />
  );

  return (
    <div
      role="group"
      style={{
        position: "absolute",
        left: w.x,
        top: w.y,
        width: w.w,
        height: w.h,
        zIndex: w.z,
        borderRadius: 18,
        background: "rgba(255,255,255,0.10)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.22)",
        border: "1px solid rgba(255,255,255,0.18)",
        backdropFilter: "blur(10px)",
        userSelect: "none",
        transform: isDragging || isResizing ? "scale(1.01)" : "scale(1)",
        transition: isDragging || isResizing ? "none" : "transform 120ms ease",
        overflow: "hidden"
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 18,
          background: highlight || "transparent",
          // mixBlendMode: "screen",  // or "overlay", "soft-light"
          pointerEvents: "none",
          transition: "background 160ms ease",
          zIndex: 0,
          opacity: 0.125
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          border: `1px solid ${highlight || "rgba(255,255,255,0.18)"}`,
          borderRadius: 18,
          background: "transparent",
          // mixBlendMode: "screen",  // or "overlay", "soft-light"
          pointerEvents: "none",
          transition: "background 160ms ease",
          zIndex: 0,
        }}
      />
      <div
        onPointerDown={(e) => onDragPointerDown(e, w.id)}
        style={{
          height: HEADER_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 14px",
          borderBottom: "1px solid rgba(255,255,255,0.14)",
          cursor: "grab",
          touchAction: "none",
        }}
        aria-label={`Drag ${w.name} widget`}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={{ fontSize: 14, letterSpacing: 0.4, opacity: 0.95, fontWeight: 700 }}>{w.name}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>watch</div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>drag / resize</div>
      </div>

      <div
        style={{
          height: w.h - HEADER_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: bodyPadding,
        }}
      >
        {
          <w.Component
            unit={w.unit} value={w.value} availableWidth={innerW} availableHeight={innerH}
            highlight={highlight} {...w.specificProps}
          />
        }
      </div>

      {/* Resize handles */}
      <Handle style={{ top: 0, left: corner, right: corner, height: edge }} cursor="ns-resize" dirX={0} dirY={-1} />
      <Handle style={{ bottom: 0, left: corner, right: corner, height: edge }} cursor="ns-resize" dirX={0} dirY={1} />
      <Handle style={{ left: 0, top: corner, bottom: corner, width: edge }} cursor="ew-resize" dirX={-1} dirY={0} />
      <Handle style={{ right: 0, top: corner, bottom: corner, width: edge }} cursor="ew-resize" dirX={1} dirY={0} />

      <Handle style={{ top: 0, left: 0, width: corner, height: corner }} cursor="nwse-resize" dirX={-1} dirY={-1} />
      <Handle style={{ top: 0, right: 0, width: corner, height: corner }} cursor="nesw-resize" dirX={1} dirY={-1} />
      <Handle style={{ bottom: 0, left: 0, width: corner, height: corner }} cursor="nesw-resize" dirX={-1} dirY={1} />
      <Handle style={{ bottom: 0, right: 0, width: corner, height: corner }} cursor="nwse-resize" dirX={1} dirY={1} />
    </div>
  );
}