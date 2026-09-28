"use client";

import EventDetail from "../components/event-detail";
import { useParams } from "next/navigation";

/** One live event's console (migration 0113). The admin layout gates the route on the server. */
export default function AdminEventPage() {
  const params = useParams<{ id: string }>();
  return <EventDetail id={params.id} />;
}
