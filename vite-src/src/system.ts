import { 
  storage as NeuStorage, 
  filesystem as NeuFilesystem, 
  os as NeuOs, 
  window as NeuWindow,
  events as NeuEvents
} from "@neutralinojs/lib";

namespace Neutralino {
  export const storage = NeuStorage;
  export const filesystem = NeuFilesystem;
  export const os = NeuOs;
  export const window = NeuWindow;
  export const events = NeuEvents;
}

export function getNeu() {
  return Neutralino;
}

export function hasNeuStorage(neu: typeof Neutralino) {
  return !!neu?.storage?.getData && !!neu?.storage?.setData;
}

export function hasNeuWindow(neu: typeof Neutralino) {
  return !!neu?.window?.getSize && !!neu?.window?.setSize;
}

export async function safeGetData(key: string): Promise<string | null> {
  const neu = getNeu();
  try {
    if (hasNeuStorage(neu)) {
      return await neu.storage.getData(key);
    }
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function safeSetData(key: string, data: string | null): Promise<void> {
  const neu = getNeu();
  try {
    if (hasNeuStorage(neu)) {
      await neu.storage.setData(key, data);
    } else {
      if (data == null) localStorage.removeItem(key);
      else window.localStorage.setItem(key, data);
    }
  } catch (e) {
    // ignore
  }
}

export async function safeRemoveData(key: string): Promise<void> {
  const neu = getNeu();
  try {
    if (hasNeuStorage(neu)) {
      await neu.storage.removeData(key);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}