import { getNeu } from "./system";
import { updateConnection, updateValue } from "./variableStore";

interface SerialUpdatePayload {
  values?: Record<string, number>;
  timestamp?: number;
}

interface SerialStatusPayload {
  status?: string;
  state?: string;
  port?: string;
  baudrate?: number;
  lastError?: string;
  lastSeen?: number;
}

type DispatchOk = { ok: true; status?: SerialStatusPayload; data?: unknown };
type DispatchError = { ok: false; error: { code?: string; message?: string } };
type DispatchResult = DispatchOk | DispatchError;

const EXTENSION_ID = "serial-input-python";
const UPDATE_EVENT = "serial:update";
const STATUS_EVENT = "serial:status";

let listenersRegistered = false;

function extractDetail(ev: CustomEvent): unknown {
  return ev.detail?.data ?? ev.detail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isSerialUpdatePayload(value: unknown): value is SerialUpdatePayload {
  if (!isRecord(value)) return false;
  if ("values" in value) {
    if (!isRecord(value.values)) return false;
    const entries = Object.entries(value.values);
    if (!entries.every(([, entry]) => isNumber(entry))) return false;
  }
  if ("timestamp" in value && !isNumber(value.timestamp)) return false;
  return true;
}

function isSerialStatusPayload(value: unknown): value is SerialStatusPayload {
  if (!isRecord(value)) return false;
  if ("status" in value && !isString(value.status)) return false;
  if ("state" in value && !isString(value.state)) return false;
  if ("port" in value && !isString(value.port)) return false;
  if ("baudrate" in value && !isNumber(value.baudrate)) return false;
  if ("lastError" in value && !isString(value.lastError)) return false;
  if ("lastSeen" in value && !isNumber(value.lastSeen)) return false;
  return true;
}

function isDispatchResult(value: unknown): value is DispatchResult {
  if (!isRecord(value)) return false;
  if (value.ok === true) {
    if ("status" in value && value.status !== undefined && !isSerialStatusPayload(value.status)) return false;
    return true;
  }
  if (value.ok === false) {
    if (!("error" in value) || !isRecord(value.error)) return false;
    return true;
  }
  return false;
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
    const payload = extractDetail(ev);
    if (!isSerialUpdatePayload(payload)) return;
    if (payload.values) {
      Object.entries(payload.values).forEach(([id, value]) => {
        updateValue(id, value, payload.timestamp ? payload.timestamp * 1000 : undefined);
      });
    } else {
      console.warn(`Empty values update event received with timestamp \`${payload.timestamp}\``);
    }
  });

  safeOn(STATUS_EVENT, (ev) => {
    const payload = extractDetail(ev);
    if (!isSerialStatusPayload(payload)) return;
    updateConnection({
      status: payload.status ?? "idle",
      port: payload.port ?? "",
      baudrate: payload.baudrate ?? 115200,
      lastError: payload.lastError,
      lastUpdate: payload.lastSeen ? payload.lastSeen * 1000 : undefined,
    });
  });
}

async function dispatch(event: string, data?: unknown): Promise<DispatchResult> {
  const neu = getNeu();
  if (!neu?.extensions?.dispatch) {
    return { ok: false, error: { code: "no_neutralino", message: "Neutralino extensions are unavailable" } };
  }

  try {
    const raw = await neu.extensions.dispatch(EXTENSION_ID, event, data);
    const res = isDispatchResult(raw) ? raw : { ok: true, data: raw };
    if (res.ok && res.status) {
      updateConnection({
        status: res.status.status ?? res.status.state ?? "idle",
        port: res.status.port ?? "",
        baudrate: res.status.baudrate ?? 115200,
        lastError: res.status.lastError,
        lastUpdate: res.status.lastSeen ? res.status.lastSeen * 1000 : undefined,
      });
    }
    return res;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
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
