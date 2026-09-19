import "../(marketing)/clinical-source-home.css";
import "../palestra/palestra.css";
import "./pitch.css";

/**
 * The pitch deck's own shell, with no site chrome.
 *
 * It loads the same two stylesheets the congress deck does — the Landing DS
 * vocabulary and the deck's own system — so both decks are literally the same
 * design, and `pitch.css` only adds the handful of blocks this deck needs.
 * No header, no cookie banner, no support widget, no analytics: this is a
 * document, and nothing here is a page of the website.
 */
export default function PitchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
