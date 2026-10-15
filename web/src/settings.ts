// User settings, saved in localStorage so they survive a page reload.
// Every read and write is wrapped in try/catch: private windows can block storage.

export type InputMode = 'hand' | 'mouse';
export type ThemeName = 'classic' | 'walnut' | 'midnight';

export interface Settings {
  inputMode: InputMode;
  /** 0.6 (needs a tight fist) to 1.4 (a loose fist is enough). */
  gripSensitivity: number;
  /** 0 (responsive, a bit jittery) to 1 (very smooth, a bit laggy). */
  smoothing: number;
  showPreview: boolean;
  sound: boolean;
  voice: boolean;
  theme: ThemeName;
  /** Hot-seat only: turn the camera to face whoever is to move. */
  flipBoard: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  inputMode: 'mouse',
  gripSensitivity: 1,
  smoothing: 0.5,
  showPreview: true,
  sound: true,
  voice: false,
  theme: 'classic',
  flipBoard: true,
};

const KEY = 'sleight.settings.v1';

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: settings still work for this visit.
  }
}
