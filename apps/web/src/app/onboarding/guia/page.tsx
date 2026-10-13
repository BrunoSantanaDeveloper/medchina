import { redirect } from "next/navigation";

/**
 * The guided trail lived here: sign-up to a signed first record, walking a real
 * consultation inside the onboarding. It was removed — a user test showed the
 * professional lost when asked to start a consultation with no patient in the
 * room. The onboarding is now the preparation of the practice (`/onboarding`),
 * and the first consultation is guided on the consultation screen itself.
 *
 * The address is kept as a redirect because anyone who started the old trail
 * may still have it in her browser history or bookmarks. A consultation the
 * trail had left open is not lost: it is an ordinary draft, listed on the home
 * under what needs her attention.
 */
export default function GuidedTrailRedirect() {
  redirect("/onboarding");
}
