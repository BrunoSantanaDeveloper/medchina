"use client";

import { createContext, useContext } from "react";

/**
 * Where a slide is being rendered.
 *
 * - `stage`: the live deck. Media plays.
 * - `export`: a page of the PDF. Nothing moves and nothing loads late — a
 *   `<video>` prints as an empty box, so the views swap it for a still.
 */
export type DeckMode = "stage" | "export";

export const DeckModeContext = createContext<DeckMode>("stage");

export function useDeckMode() {
  return useContext(DeckModeContext);
}
