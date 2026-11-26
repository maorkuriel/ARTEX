import { create } from "zustand";

import { firstStepIndexOf, type Persona, STEPS } from "./usecases";

// Global walkthrough state. Persona and progress persist to localStorage and are
// mirrored to the URL by the <Walkthrough /> controller, so switching persona updates
// the current step in place and never resets progress.
interface WalkthroughState {
  active: boolean;
  /** Current index into the flat STEPS list. */
  index: number;
  persona: Persona;
  start: (index?: number) => void;
  /** Exit Tour — closes the walkthrough (progress is kept). */
  stop: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  /** Jump to the first step of a use case. */
  goToUseCase: (useCase: number) => void;
  setPersona: (persona: Persona) => void;
  /** Reset Demo — restart the tour at Use Case 1, Step 1 (keeps the chosen persona). */
  reset: () => void;
  /** Hydrate persona + progress from a persisted/URL source without opening the tour. */
  hydrate: (partial: Partial<Pick<WalkthroughState, "active" | "index" | "persona">>) => void;
}

const clamp = (i: number) => Math.max(0, Math.min(STEPS.length - 1, i));

export const useWalkthrough = create<WalkthroughState>((set, get) => ({
  active: false,
  index: 0,
  persona: "executive",
  start: (index = 0) => set({ active: true, index: clamp(index) }),
  stop: () => set({ active: false }),
  next: () => {
    const { index } = get();
    if (index >= STEPS.length - 1) {
      set({ active: false });
      return;
    }
    set({ index: clamp(index + 1) });
  },
  prev: () => set((s) => ({ index: clamp(s.index - 1) })),
  goTo: (index) => set({ index: clamp(index) }),
  goToUseCase: (useCase) => set({ active: true, index: firstStepIndexOf(useCase) }),
  setPersona: (persona) => set({ persona }),
  reset: () => set({ active: true, index: 0 }),
  hydrate: (partial) =>
    set((s) => ({
      active: partial.active ?? s.active,
      index: partial.index != null ? clamp(partial.index) : s.index,
      persona: partial.persona ?? s.persona,
    })),
}));
