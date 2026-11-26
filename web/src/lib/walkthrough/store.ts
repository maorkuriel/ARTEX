import { create } from "zustand";

import { CHAPTERS, type Persona } from "./chapters";

// Global walkthrough state. Persona and progress are persisted to localStorage and
// mirrored to the URL by the <Walkthrough /> controller, so switching persona updates
// the current step in place and never resets progress.
interface WalkthroughState {
  active: boolean;
  /** Current chapter index into CHAPTERS. */
  index: number;
  persona: Persona;
  start: (index?: number) => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  setPersona: (persona: Persona) => void;
  /** Reset the tour to chapter 1 (keeps the chosen persona) and keeps it open. */
  restart: () => void;
  /** Hydrate persona + progress from a persisted/URL source without opening the tour. */
  hydrate: (partial: Partial<Pick<WalkthroughState, "active" | "index" | "persona">>) => void;
}

const clampIndex = (i: number) => Math.max(0, Math.min(CHAPTERS.length - 1, i));

export const useWalkthrough = create<WalkthroughState>((set, get) => ({
  active: false,
  index: 0,
  persona: "executive",
  start: (index = 0) => set({ active: true, index: clampIndex(index) }),
  stop: () => set({ active: false }),
  next: () => {
    const { index } = get();
    if (index >= CHAPTERS.length - 1) {
      set({ active: false });
      return;
    }
    set({ index: clampIndex(index + 1) });
  },
  prev: () => set((s) => ({ index: clampIndex(s.index - 1) })),
  goTo: (index) => set({ index: clampIndex(index) }),
  setPersona: (persona) => set({ persona }),
  restart: () => set({ active: true, index: 0 }),
  hydrate: (partial) =>
    set((s) => ({
      active: partial.active ?? s.active,
      index: partial.index != null ? clampIndex(partial.index) : s.index,
      persona: partial.persona ?? s.persona,
    })),
}));
