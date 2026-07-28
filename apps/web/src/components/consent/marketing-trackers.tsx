import { cookies } from "next/headers";

import { COOKIE_KEYS } from "@/constants";

/**
 * Meta Pixel + GA4 base scripts, rendered SERVER-SIDE so they are present in the
 * initial HTML (detectable by audits, and firing for every visitor). OPT-OUT
 * model: they load by default and are skipped only when the visitor opted out
 * (the `analyticsOptOut` cookie). Nothing renders when no id is configured.
 *
 * MOUNT THIS ONLY IN THE MARKETING LAYOUT. It must never reach the authenticated
 * clinical app — no ad/analytics tracker runs over health data (LGPD Art. 11).
 * The ids are our own build-time config (not user input), so interpolating them
 * into the inline scripts is safe.
 */

const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || null;
const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID?.trim() || null;

export default async function MarketingTrackers() {
  if (!META_PIXEL_ID && !GA4_ID) return null;
  const optedOut = (await cookies()).get(COOKIE_KEYS.analyticsOptOut)?.value === "1";
  if (optedOut) return null;

  return (
    <>
      {META_PIXEL_ID && (
        <>
          <script
            id="meta-pixel"
            dangerouslySetInnerHTML={{
              __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`,
            }}
          />
          <noscript>
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              alt=""
              src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      )}
      {GA4_ID && (
        <>
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`} />
          <script
            id="ga4-init"
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA4_ID}',{anonymize_ip:true});`,
            }}
          />
        </>
      )}
    </>
  );
}
