import "../(marketing)/clinical-source-home.css";
import "../palestra/palestra.css";
import "./demonstracao.css";

/**
 * The product demo's own shell, with no site chrome.
 *
 * It loads the same two stylesheets as the congress deck and the pitch — the
 * Landing DS vocabulary and the deck's own system — so the three decks are
 * literally the same design, and `demonstracao.css` only adds what this one
 * composes differently. No header, no cookie banner, no support widget, no
 * analytics: it is shown to someone, and nothing on it is a page of the website.
 */
export default function DemonstracaoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
