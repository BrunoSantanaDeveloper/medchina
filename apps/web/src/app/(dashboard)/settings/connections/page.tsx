import { redirect } from "next/navigation";

/** Connections are not part of the MedChina MVP; keep old bookmarks safe. */
export default function ConnectionsRedirect() {
  redirect("/settings");
}
