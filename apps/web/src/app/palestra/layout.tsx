/*
  The congress deck is built in the Landing DS (docs/DESIGN.md), so it imports
  the home's stylesheet first: that one import brings the `:root` palette
  (`--jade`, `--coral`, `--ink`, `--paper`…), the self-hosted TT Chocolates and
  Mulish faces and the shared class vocabulary. A slide then looks like the same
  company as the website instead of like a deck someone styled from scratch.
*/
import "../(marketing)/clinical-source-home.css";
import "./palestra.css";

/**
 * Chrome for the deck — deliberately none.
 *
 * This is a sibling of `(marketing)` and `(funil)` for the same reason those
 * are siblings of each other: a nested layout cannot remove what its parent
 * mounts. A projected slide must not carry the site header, the cookie banner
 * or the floating support widget — all three would be on the screen, in front
 * of a congress audience, for the whole talk. The analytics that `(funil)`
 * deliberately keeps are equally deliberately absent: nobody is being measured
 * here, this is a presentation.
 */
export default function PalestraLayout({ children }: { children: React.ReactNode }) {
  return children;
}
