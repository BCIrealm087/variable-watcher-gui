import { useSyncExternalStore } from "react";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error" | "stopped";

type SerialState = {
  status: ConnectionStatus;
  port: string;
  baudrate: number;
  lastError?: string | null;
  lastUpdate?: number | null;
  lastValue?: Record<string, number>;
  values: Record<string, number>;
};

let state: SerialState = {
  status: "idle",
  port: "",
  baudrate: 115200,
  lastError: null,
  lastUpdate: null,
  lastValue: undefined,
  values: {},
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setState(update: (prev: SerialState) => SerialState) {
  state = update(state);
  emit();
}

export function updateConnection(next: Partial<SerialState>) {
  setState((prev) => ({
    ...prev,
    ...next,
    lastError: next.lastError ?? prev.lastError ?? null,
  }));
}

export function updateValue(id: string, value: number, timestamp?: number) {
  setState((prev) => {
    const values = { ...prev.values, [id]: value };
    return {
      ...prev,
      values,
      lastValue: { ...values },
      lastUpdate: timestamp ?? Date.now(),
    };
  });
}

export function useSerialState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state
  );
}
