import { getNeu } from "./system";
import { updateConnection, updateValue, SerialState } from "./variableStore";

type DispatchResult = { ok?: boolean; error?: { code?: string; message?: string }  };
type UpdatePayload = { values?: Record<string, number>, timestamp?: number };

const EXTENSION_ID = "serial-input-python";
const UPDATE_EVENT = "serial:update";
const STATUS_EVENT = "serial:status";

let listenersRegistered = false;

function extractDetail(ev: CustomEvent) {
  return ev.detail?.data ?? ev.detail;
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
    const payload: UpdatePayload = extractDetail(ev);
    if (payload.values) {
      Object.entries(payload.values).forEach(([id , value]) => {
        updateValue(id, value, payload.timestamp ? payload.timestamp * 1000 : undefined);
      })
    } else console.warn(`Empty values update event received with timestamp \`${payload.timestamp}\``)
  });

  safeOn(STATUS_EVENT, (ev) => {
    const payload: Partial<SerialState> = extractDetail(ev);
    if (!payload) return;
    updateConnection({
      status: payload.status ?? "idle",
      port: payload.port ?? "",
      baudrate: payload.baudrate ?? 57600,
      lastError: payload.lastError,
      lastUpdate: payload.lastUpdate ? payload.lastUpdate * 1000 : undefined,
    });
  });
}

async function dispatch(event: string, data?: any): Promise<DispatchResult> {
  const neu = getNeu();
  if (!neu?.extensions?.dispatch) {
    return { ok: false, error: { code: "no_neutralino", message: "Neutralino extensions are unavailable" } };
  }
  try {
    await neu.extensions.dispatch(EXTENSION_ID, event, data); // void return type - responses received through broad-
                                                              // cast event
    return { ok: true };
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

export async function checkSerialHealth() {
  return dispatch("health");
}
