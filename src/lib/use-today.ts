import { useSyncExternalStore } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Today as a local `YYYY-MM-DD`, read from the browser's clock; `null` during
 * SSR and hydration, so server output stays timezone-independent. The grid's
 * highlight and the Today button share this one definition so they cannot
 * disagree about which day it is.
 */
export function useToday(): string | null {
  return useSyncExternalStore(
    () => () => {},
    () => {
      const now = new Date();
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    },
    () => null
  );
}
