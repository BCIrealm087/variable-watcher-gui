import React, { useEffect, useRef, useState, useCallback } from "react";
import { WINDOW_KEY, LAYOUT_KEY, VARS_CONFIG_KEY, VARS_CONFIG_PATH_KEY } from "./constants";
import { getNeu, hasNeuWindow, safeGetData, safeSetData, safeRemoveData } from "./system";
import { WidgetBoard, VarSpec, withPlaceholderFallback, parseVarSpecs} from "./components/WidgetBoard";
import { initSerialBridge, startSerial, stopSerial, checkSerialHealth } from "./serialBridge";
import { useSerialState } from "./variableStore";

/**
 * Draggable + resizable widgets dashboard with persistent layout.
 *
 * Persistence:
 * - Uses Neutralino.storage when available (preferred in Neutralino apps)
 * - Falls back to browser localStorage when running as a plain web app
 *
 * Layout scaling:
 * - Base widget size is computed from the current board size ("game UI" scaling)
 * - Each widget also has per-widget multipliers (mw/mh) that the user controls via resizing
 * - Positions are stored as relative centers (rx/ry) so the layout stays proportional
 */

type WidgetKind = "number" | "accelerometer";

type Widget = {
  id: string;
  name: string;
  unit?: string;
  value: number;
  kind: WidgetKind;
  x: number;
  y: number;
  w: number;
  h: number;
  mw: number;
  mh: number;
  rx: number;
  ry: number;
  z: number;
};

type Size = { width: number; height: number };

function useContainerSize(ref: React.RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const bounds = useContainerSize(containerRef);

  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [initialized, setInitialized] = useState(false);

  const serialState = useSerialState();
  const [portInput, setPortInput] = useState("");

  const webFileRef = useRef<HTMLInputElement>(null);

  const [varSpecs, setVarSpecs] = useState<VarSpec[]>(() =>
    withPlaceholderFallback([])
  );

  useEffect(() => {
    initSerialBridge();
  }, []);

  useEffect(() => {
    setPortInput(serialState.port || "");
  }, [serialState.port]);

  const loadConfig = useCallback(async () => {
    const neu = getNeu();
    // Prefer native if available
    if (neu?.os?.showOpenDialog && neu?.filesystem?.readFile) {
      try {
        const entries: string[] = await neu.os.showOpenDialog("Open variables config", {
          filters: [
            { name: "JSON", extensions: ["json"] },
            { name: "All files", extensions: ["*"] },
          ],
        });

        if (!entries?.length) return;

        const path = entries[0];
        const text: string = await neu.filesystem.readFile(path);
        const parsed = withPlaceholderFallback(parseVarSpecs(text));

        setVarSpecs(parsed);
        await safeSetData(VARS_CONFIG_KEY, text);
        await safeSetData(VARS_CONFIG_PATH_KEY, path);
        return;
      } catch { /* native failed → fall back to web picker */ }
    }

    // Web fallback
    webFileRef.current?.click();
  }, [setVarSpecs]);

  const onWebFilePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result ?? "");
      const parsed = withPlaceholderFallback(parseVarSpecs(text));
      setVarSpecs(parsed);
      await safeSetData(VARS_CONFIG_KEY, text);
      await safeSetData(VARS_CONFIG_PATH_KEY, null); // no path in web mode
    };
    reader.readAsText(file);
  }, [setVarSpecs]);

  const onStartSerial = useCallback(async () => {
    await startSerial({ port: portInput || undefined });
    await checkSerialHealth();
  }, [portInput]);

  const onStopSerial = useCallback(async () => {
    await stopSerial();
  }, []);

  const onHealthCheck = useCallback(async () => {
    await checkSerialHealth();
  }, []);

  // Restore native window size (optional). Neutralino can also do this automatically via config.
  useEffect(() => {
    (async () => {
      const neu = getNeu();
      if (!hasNeuWindow(neu)) return;

      const raw = await safeGetData(WINDOW_KEY);
      if (!raw) return;

      try {
        const obj = JSON.parse(raw);
        const width = Number(obj?.width);
        const height = Number(obj?.height);
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        if (width <= 0 || height <= 0) return;

        await neu.window.setSize({ width: Math.floor(width), height: Math.floor(height) });
      } catch {
        // ignore
      }
    })();
  }, []);

  // Persist window size when it changes (debounced). (Only meaningful in Neutralino window mode.)
  useEffect(() => {
    if (!initialized) return;

    const neu = getNeu();
    if (!hasNeuWindow(neu)) return;

    const t = window.setTimeout(async () => {
      try {
        const info = await neu.window.getSize();
        if (!info?.width || !info?.height) return;
        await safeSetData(
          WINDOW_KEY,
          JSON.stringify({ width: info.width, height: info.height, savedAt: Date.now() })
        );
      } catch {
        // ignore
      }
    }, 500);

    return () => window.clearTimeout(t);
  }, [bounds.width, bounds.height, initialized]);

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(1200px 800px at 20% 10%, rgba(109,40,217,0.45), transparent 55%), radial-gradient(1000px 700px at 80% 20%, rgba(59,130,246,0.40), transparent 55%), radial-gradient(1200px 900px at 50% 100%, rgba(16,185,129,0.25), transparent 55%), #0b1020",
        color: "white",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji",
      }}
    >
      <header
        style={{
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontWeight: 800, letterSpacing: 0.2 }}>Widget Board</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Drag the header. Resize from borders/corners. Layout persists.
          </div>
        </div>

        <div style={{ fontSize: 12, opacity: 0.8, textAlign: "right", display: "flex", flexDirection: "column", gap: 6 }}>
          <div>
            Widgets: <b>{widgets.length}</b>
          </div>
          <div>
            Bounds: <b>{bounds.width}</b>×<b>{bounds.height}</b>
          </div>
          <div
            style={{
              marginTop: 6,
              display: "flex",
              gap: 8,
              alignItems: "center",
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                minWidth: 220,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  display: "inline-block",
                  background:
                    serialState.status === "connected"
                      ? "#34d399"
                      : serialState.status === "error"
                        ? "#f87171"
                        : "#fbbf24",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
                <div style={{ fontWeight: 600 }}>Serial: {serialState.status}</div>
                <div style={{ opacity: 0.8 }}>
                  Port: {portInput || "unset"}
                  {serialState.lastUpdate ? ` · Updated ${new Date(serialState.lastUpdate).toLocaleTimeString()}` : ""}
                </div>
                {serialState.lastError ? (
                  <div style={{ color: "#fca5a5" }}>Error: {serialState.lastError}</div>
                ) : null}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                placeholder="/dev/ttyUSB0"
                style={{
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.25)",
                  background: "rgba(255,255,255,0.05)",
                  color: "white",
                  width: 140,
                }}
              />
              <button
                onClick={onStartSerial}
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 10,
                  background: "rgba(52,211,153,0.20)",
                  border: "1px solid rgba(52,211,153,0.60)",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Start / Retry
              </button>
              <button
                onClick={onStopSerial}
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 10,
                  background: "rgba(248,113,113,0.15)",
                  border: "1px solid rgba(248,113,113,0.50)",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Stop
              </button>
              <button
                onClick={onHealthCheck}
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 10,
                  background: "rgba(96,165,250,0.18)",
                  border: "1px solid rgba(96,165,250,0.60)",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Health
              </button>
            </div>
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                void safeRemoveData(LAYOUT_KEY);
                setInitialized(false);
                setWidgets([]);
              }}
              style={{
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.18)",
                color: "white",
                cursor: "pointer",
              }}
              title="Clear saved layout and reinitialize"
            >
              Reset layout
            </button>
            <div>
              <button
                onClick={loadConfig}
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Load variables JSON
              </button>
              <input
                ref={webFileRef}
                type="file"
                accept="application/json"
                onChange={onWebFilePicked}
                style={{ display: "none" }}
              />
          </div>
          </div>
        </div>
      </header>
      <WidgetBoard
        containerRef={containerRef}
        bounds={bounds}
        handledWidgetsState={ [widgets, setWidgets] as const }
        handledVarState={ [varSpecs, setVarSpecs] as const }
        handledInitializedState={ [initialized, setInitialized] as const }
      />
    </div>
  );
}
