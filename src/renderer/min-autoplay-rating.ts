import { ratingToStarCount } from "./main-tracks-list-panel.js";

/* Star threshold below which AUTO-advance skips a track. Persisted as
   "min-autoplay-rating" (0.5 steps, 0.5..5); absent = no limit.
   Unrated tracks (star count 0) and hated tracks (-1) can never reach
   even the lowest limit of 0.5 and are always skipped on auto-advance.
   Manual starts are never filtered. */

let minRating: number | null = null;

export function getMinAutoplayRating(): number | null {
  return minRating;
}

export async function initMinAutoplayRating(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    const v = data?.["min-autoplay-rating"];
    minRating = typeof v === "number" && v >= 0.5 && v <= 5 ? v : null;
  } catch { /* ignore */ }
}

export async function saveMinAutoplayRating(value: number | null): Promise<void> {
  try {
    const next: Record<string, unknown> = {};
    if (value === null) next["min-autoplay-rating"] = undefined;
    else next["min-autoplay-rating"] = value;
    await window.electronAPI.saveSettings(next);
    minRating = value;
  } catch { /* ignore */ }
}

export function passesMinAutoplayRating(rating: number): boolean {
  if (minRating === null) return true;
  return ratingToStarCount(rating) >= minRating;
}
