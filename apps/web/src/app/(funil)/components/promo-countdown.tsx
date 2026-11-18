"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Time left until the promotion's END — the same instant the checkout stops
 * selling (`offerBlock`), passed in from the server.
 *
 * Honest by construction: it counts to a date written next to it, it is the
 * same for every visitor and never restarts on reload. With more than a day to
 * go it shows days, hours and minutes (a bare "214:31:07" makes the reader do
 * arithmetic and reads as pressure); seconds only in the last day. The server
 * renders the first value, so the number is in the HTML before any script runs
 * and for whoever asked for less motion.
 *
 * When it reaches zero the page is refreshed once, so the server can render
 * the closed state instead of a button the checkout would refuse.
 */
function parts(msLeft: number) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

export default function PromoCountdown({
  endsAt,
  initialNow,
  label,
  tone = "dark",
}: {
  endsAt: string;
  /** The server's clock at render, so the first paint matches the HTML. */
  initialNow: number;
  /** What ends, in words: "A condição termina em". */
  label: string;
  tone?: "dark" | "light";
}) {
  const router = useRouter();
  const end = new Date(endsAt).getTime();
  const [now, setNow] = useState(initialNow);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const left = end - now;
  useEffect(() => {
    if (left <= 0) router.refresh();
  }, [left <= 0, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const { days, hours, minutes, seconds } = parts(left);
  const units =
    days > 0
      ? [
          { value: String(days), unit: days === 1 ? "dia" : "dias" },
          { value: pad(hours), unit: "h" },
          { value: pad(minutes), unit: "min" },
        ]
      : [
          { value: pad(hours), unit: "h" },
          { value: pad(minutes), unit: "min" },
          { value: pad(seconds), unit: "s" },
        ];

  return (
    <div className={`bf-countdown bf-countdown--${tone}`} role="timer" aria-live="off">
      <span className="bf-countdown-label">{label}</span>
      <span className="bf-countdown-units">
        {units.map(({ value, unit }) => (
          <span key={unit} className="bf-countdown-unit">
            <strong>{value}</strong>
            <small>{unit}</small>
          </span>
        ))}
      </span>
    </div>
  );
}
