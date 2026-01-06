import { getNeu } from "./system";
import { updateConnection, updateValue } from "./variableStore";

type DispatchResult = { ok?: boolean; error?: { code?: string; message?: string }; status?: any; data?: any };

const EXTENSION_ID = "serial-input-python";
const UPDATE_EVENT = "serial:update";
const STATUS_EVENT = "serial:status";

let listenersRegistered = false;

function extractDetail(ev: CustomEvent) {
  return (ev as CustomEvent).detail?.data ?? (ev as CustomEvent).detail;
}

function safeOn(event: string, handler: (ev: CustomEvent) => void) {
  const neu = getNeu();
  if (!neu?.events?.on) return;
  void neu.events.on(event, handler);
}

export function initSerialBridge() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  safeOn(UPDATE_EVENT, (ev) => {
    const payload = extractDetail(ev) as { id?: string; value?: number; timestamp?: number };
    if (!payload?.id || typeof payload.value !== "number") return;
    updateValue(payload.id, payload.value, payload.timestamp ? payload.timestamp * 1000 : undefined);
  });

  safeOn(STATUS_EVENT, (ev) => {
    const payload = extractDetail(ev) as any;
    if (!payload) return;
    updateConnection({
      status: payload.status ?? "idle",
      port: payload.port ?? "",
      baudrate: payload.baudrate ?? 115200,
      lastError: payload.lastError,
      lastUpdate: payload.lastSeen ? payload.lastSeen * 1000 : undefined,
    });
  });
}

async function dispatch(event: string, data?: any): Promise<DispatchResult> {
  const neu = getNeu();
  if (!neu?.extensions?.dispatch) {
    return { ok: false, error: { code: "no_neutralino", message: "Neutralino extensions are unavailable" } };
  }

  try {
    const res: DispatchResult = (await neu.extensions.dispatch(EXTENSION_ID, event, data)) as any;
    if (res?.status) {
      updateConnection({
        status: res.status.status ?? res.status.state ?? "idle",
        port: res.status.port ?? "",
        baudrate: res.status.baudrate ?? 115200,
        lastError: res.status.lastError,
        lastUpdate: res.status.lastSeen ? res.status.lastSeen * 1000 : undefined,
      });
    }
    return res ?? { ok: true };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    updateConnection({ status: "error", lastError: message });
    return { ok: false, error: { code: "dispatch_failed", message } };
  }
}

export async function startSerial(data?: { port?: string; baudrate?: number }) {
  return dispatch("start", data);
}

export async function stopSerial() {
  return dispatch("stop");
}

export async function configureSerial(data: { port?: string; baudrate?: number }) {
  return dispatch("configure", data);
}

export async function readSerialOnce(data?: { port?: string; baudrate?: number }) {
  return dispatch("read", data);
}

export async function checkSerialHealth() {
  return dispatch("health");
}
