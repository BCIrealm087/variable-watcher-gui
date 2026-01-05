export const VARS_CONFIG_KEY = "dashboard-varsConfig-v1" as const;
export const VARS_CONFIG_PATH_KEY = "dashboard-varsConfigPath-v1" as const;

export const LAYOUT_KEY = "dashboard-layout-v1";
export const WINDOW_KEY = "dashboard-window-v1";

// Minimum pixel sizes are intentionally small because this UI is meant to scale like a game UI.
// The effective minimum is primarily controlled by MIN_MULT (relative to the base size).
export const MIN_WIDGET_W = 96 as const;
export const MIN_WIDGET_H = 80 as const;

// Multiplier limits (applied relative to the base widget size).
export const MIN_MULT = 0.25 as const;
export const MAX_MULT = 3.0 as const;

export const GAP = 16 as const;
export const PAD = 6 as const;