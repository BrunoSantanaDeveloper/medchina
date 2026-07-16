import { cn } from "@/lib/utils";

/**
 * The blueprint hero visual, ported 1:1 from the committed reference
 * (docs/DESIGN.md "Reference blueprint" row 2): a fixed 690×570 canvas with
 * the web record panel in light perspective, the phone recording screen
 * overlapping bottom-left, two orbit ellipses, the dashed flow line with
 * travelling dots and two floating notes. Colors/typography come ONLY from
 * tokens (teal=primary, camel=secondary, field states jade/terracotta/grey);
 * the canvas scales per breakpoint via --duo-scale so nothing reflows.
 * Purely presentational (role="img"); all strings arrive translated;
 * data is FICTITIOUS (patient "Helena Martins").
 */
export type ConsultationDuoLabels = {
  web: {
    brand: string;
    search: string;
    kicker: string;
    title: string;
    reviewChip: string;
    tabs: string[];
    fields: {
      label: string;
      stateLabel: string;
      text: string;
      source?: string;
      state: "clear" | "attention" | "empty";
    }[];
    changesKicker: string;
    changesTitle: string;
    changes: string[];
    changesCta: string;
  };
  phone: {
    /** Title of the phone screen's nav bar ("Consulta"). */
    navTitle: string;
    patient: string;
    consent: string;
    statusLabel: string;
    timer: string;
    pauseLabel: string;
    voiceLabel: string;
    finishLabel: string;
  };
  notes: {
    one: { title: string; sub: string };
    two: { badge: string; title: string; sub: string };
  };
};

const CSS = `
.mkduo{--duo-scale:.46;position:relative;width:calc(690px*var(--duo-scale));height:calc(570px*var(--duo-scale));margin-inline:auto}
@media (min-width:480px){.mkduo{--duo-scale:.6}}
@media (min-width:700px){.mkduo{--duo-scale:.88}}
@media (min-width:960px){.mkduo{--duo-scale:.72}}
@media (min-width:1280px){.mkduo{--duo-scale:.95;margin-right:-48px}}
.mkduo-canvas{position:absolute;top:0;left:0;width:690px;height:570px;transform:scale(var(--duo-scale));transform-origin:top left}
.mkduo-canvas::before{content:"";position:absolute;inset:15px 45px 5px 30px;border-radius:50%;background:radial-gradient(circle at 48% 42%,hsl(var(--primary)/.08) 0,hsl(var(--background)) 58%,hsl(var(--background)/0) 72%)}
.mkduo-orbit{position:absolute;border:1px solid hsl(var(--primary)/.14);border-radius:50%}
.mkduo-orbit-1{width:575px;height:365px;top:83px;left:38px;transform:rotate(-11deg)}
.mkduo-orbit-2{width:510px;height:510px;top:11px;left:92px;border-color:hsl(var(--secondary)/.16)}
.mkduo-web{position:absolute;width:600px;height:390px;top:65px;right:25px;overflow:hidden;border:1px solid hsl(var(--grey-100));border-radius:17px;background:hsl(var(--background-paper));box-shadow:0 38px 75px hsl(var(--primary-dark)/.15);transform:perspective(1000px) rotateY(-2deg) rotateX(1deg)}
.mkduo-topbar{height:48px;display:flex;align-items:center;gap:22px;padding:0 16px;border-bottom:1px solid hsl(var(--grey-100));color:hsl(var(--text-secondary));font-size:8px}
.mkduo-minibrand{display:flex;align-items:center;gap:5px;color:hsl(var(--text-primary));font-family:var(--font-display);font-size:11px;font-weight:700}
.mkduo-minimark{width:12px;height:12px;border:1.5px solid hsl(var(--primary));border-radius:50%}
.mkduo-search{width:180px;margin-left:auto;padding:7px 10px;border-radius:6px;background:hsl(var(--background));color:hsl(var(--text-disabled))}
.mkduo-avatar{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:hsl(var(--secondary)/.18);color:hsl(var(--text-primary));font-size:7px;font-weight:700}
.mkduo-body{height:calc(100% - 48px);display:flex}
.mkduo-side{width:45px;display:flex;flex-direction:column;align-items:center;gap:17px;padding-top:25px;background:hsl(var(--background));border-right:1px solid hsl(var(--grey-100))}
.mkduo-side span{width:11px;height:11px;border-radius:3px;border:1px solid hsl(var(--grey-300))}
.mkduo-side .mkduo-side-active{background:hsl(var(--primary));border-color:hsl(var(--primary));box-shadow:0 0 0 5px hsl(var(--primary)/.12)}
.mkduo-panel{width:calc(100% - 45px);padding:20px 22px}
.mkduo-heading{display:flex;align-items:center;justify-content:space-between}
.mkduo-heading>div{display:flex;flex-direction:column;gap:5px}
.mkduo-kicker{color:hsl(var(--text-disabled));font-size:6px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
.mkduo-heading strong{font-family:var(--font-display);font-size:17px;font-weight:700;color:hsl(var(--text-primary))}
.mkduo-chip{padding:6px 9px;border-radius:20px;background:hsl(var(--accent-1)/.14);color:hsl(var(--accent-1-dark));font-size:6px;font-weight:700}
.mkduo-progress{height:2px;margin-top:14px;background:hsl(var(--grey-100))}
.mkduo-progress span{display:block;width:71%;height:100%;background:hsl(var(--primary))}
.mkduo-tabs{display:flex;gap:25px;margin:16px 0;border-bottom:1px solid hsl(var(--grey-100));color:hsl(var(--text-secondary));font-size:7px}
.mkduo-tabs>*{padding-bottom:10px}
.mkduo-tabs b{color:hsl(var(--text-primary));border-bottom:1.5px solid hsl(var(--primary))}
.mkduo-grid{display:grid;grid-template-columns:1fr 138px;gap:11px}
.mkduo-main{display:flex;flex-direction:column;gap:8px}
.mkduo-field{padding:10px 12px;border:1px solid hsl(var(--grey-100));border-left-width:3px;border-radius:7px;background:hsl(var(--background-paper))}
.mkduo-field.clear{border-left-color:hsl(var(--accent-1))}
.mkduo-field.attention{border-left-color:hsl(var(--accent-3));background:hsl(var(--accent-3)/.04)}
.mkduo-field.empty{border-left-color:hsl(var(--grey-300));background:hsl(var(--background))}
.mkduo-ftitle{display:flex;align-items:center;gap:5px;color:hsl(var(--text-primary));font-size:7px;font-weight:700}
.mkduo-ftitle small{margin-left:auto;color:hsl(var(--text-secondary));font-size:5px;font-weight:600}
.mkduo-dot{width:4px;height:4px;border-radius:50%;background:hsl(var(--accent-1))}
.attention .mkduo-dot{background:hsl(var(--accent-3))}
.empty .mkduo-dot{background:hsl(var(--grey-300))}
.mkduo-field p{margin:6px 0 4px;color:hsl(var(--text-secondary));font-size:6.5px;line-height:1.5}
.mkduo-source{color:hsl(var(--text-disabled));font-size:5.5px}
.mkduo-changes{padding:13px 11px;border-radius:8px;background:hsl(var(--primary-dark));color:hsl(var(--text-contrast))}
.mkduo-changes .mkduo-kicker{color:hsl(var(--text-contrast)/.55)}
.mkduo-changes strong{display:block;margin-top:5px;font-family:var(--font-display);font-size:15px;font-weight:700}
.mkduo-changes ul{list-style:none;margin:12px 0 13px;padding:0}
.mkduo-changes li{display:flex;align-items:center;gap:6px;padding:7px 0;border-top:1px solid hsl(var(--text-contrast)/.09);color:hsl(var(--text-contrast)/.8);font-size:6px}
.mkduo-changes li i{width:4px;height:4px;border-radius:50%;background:hsl(var(--secondary))}
.mkduo-changes .mkduo-cta{width:100%;display:flex;justify-content:space-between;padding:8px;border-radius:5px;background:hsl(var(--primary));color:hsl(var(--text-contrast));font-size:6px}
.mkduo-phone{position:absolute;z-index:5;width:188px;height:392px;left:14px;bottom:24px;padding:6px;border:1px solid hsl(var(--primary-dark)/.7);border-radius:33px;background:hsl(var(--primary-dark));box-shadow:0 28px 48px hsl(var(--primary-dark)/.28);transform:rotate(-2deg)}
.mkduo-speaker{position:absolute;z-index:2;width:56px;height:17px;top:7px;left:66px;border-radius:0 0 11px 11px;background:hsl(var(--primary-dark))}
.mkduo-screen{height:100%;overflow:hidden;padding:12px 10px 10px;border-radius:27px;background:hsl(var(--background))}
.mkduo-ptop{display:flex;justify-content:space-between;padding:0 8px;color:hsl(var(--text-secondary));font-size:5px}
.mkduo-pnav{display:flex;align-items:center;justify-content:space-between;margin-top:12px;color:hsl(var(--text-primary));font-size:8px;font-weight:700}
.mkduo-pnav i{width:8px}
.mkduo-patient{display:grid;grid-template-columns:26px 1fr 15px;align-items:center;gap:7px;margin-top:13px;padding:9px 7px;border:1px solid hsl(var(--grey-100));border-radius:9px;background:hsl(var(--background-paper))}
.mkduo-pavatar{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:hsl(var(--primary)/.12);color:hsl(var(--primary));font-size:6px;font-weight:700}
.mkduo-patient>div{display:flex;flex-direction:column;gap:3px}
.mkduo-patient strong{font-size:6.5px;color:hsl(var(--text-primary))}
.mkduo-patient span{color:hsl(var(--accent-1-dark));font-size:4.8px}
.mkduo-patient>b{display:grid;place-items:center;width:13px;height:13px;border-radius:50%;background:hsl(var(--accent-1)/.15);color:hsl(var(--accent-1-dark));font-size:6px}
.mkduo-rec{display:flex;flex-direction:column;align-items:center;padding-top:23px}
.mkduo-pulse{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:hsl(var(--primary)/.14);box-shadow:0 0 0 8px hsl(var(--primary)/.07)}
.mkduo-pulse span{width:16px;height:16px;border-radius:50%;background:hsl(var(--primary))}
.mkduo-rec small{margin-top:16px;color:hsl(var(--text-secondary));font-size:5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.mkduo-rec>strong{margin-top:4px;color:hsl(var(--text-primary));font-size:21px;font-weight:500;letter-spacing:.03em;font-variant-numeric:tabular-nums}
.mkduo-wave{height:25px;display:flex;align-items:center;gap:2px;margin-top:7px}
.mkduo-wave i{width:2px;height:7px;border-radius:2px;background:hsl(var(--primary)/.55)}
.mkduo-wave i:nth-child(3n){height:16px}
.mkduo-wave i:nth-child(4n){height:11px}
.mkduo-wave i:nth-child(5n){height:20px}
.mkduo-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:12px}
.mkduo-actions span{display:flex;flex-direction:column;align-items:center;gap:4px;padding:7px 3px;border:1px solid hsl(var(--grey-100));border-radius:7px;background:hsl(var(--background-paper));color:hsl(var(--text-secondary));font-size:5px}
.mkduo-actions span b{font-size:11px;color:hsl(var(--primary))}
.mkduo-finish{width:100%;margin-top:7px;padding:9px;border-radius:7px;background:hsl(var(--primary));color:hsl(var(--text-contrast));font-size:6px;text-align:center}
.mkduo-flow{position:absolute;z-index:4;width:200px;height:70px;left:155px;top:195px;border-top:1px dashed hsl(var(--primary)/.55);border-radius:50%;transform:rotate(-13deg)}
.mkduo-flow span,.mkduo-flow i,.mkduo-flow b{position:absolute;width:6px;height:6px;border-radius:50%;background:hsl(var(--primary));box-shadow:0 0 0 4px hsl(var(--primary)/.12)}
.mkduo-flow i{left:40%}
.mkduo-flow b{left:80%}
.mkduo-note{position:absolute;z-index:8;display:flex;align-items:center;gap:9px;padding:10px 13px;border:1px solid hsl(var(--grey-100));border-radius:9px;background:hsl(var(--background-paper)/.95);box-shadow:0 14px 28px hsl(var(--primary-dark)/.11)}
.mkduo-note>span{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:hsl(var(--accent-1)/.14);color:hsl(var(--accent-1-dark));font-size:8px;font-weight:800}
.mkduo-note>div{display:flex;flex-direction:column;gap:2px}
.mkduo-note b{color:hsl(var(--text-primary));font-size:7px}
.mkduo-note small{color:hsl(var(--text-secondary));font-size:5.5px}
.mkduo-note-1{right:15px;bottom:55px}
.mkduo-note-2{right:52px;top:24px}
.mkduo-note-2>span{background:hsl(var(--secondary)/.18);color:hsl(var(--secondary-dark))}
@media (prefers-reduced-motion:no-preference){
.mkduo-pulse span{animation:mkduo-pulse 2s ease-in-out infinite}
.mkduo-wave i{animation:mkduo-wave 1.4s ease-in-out infinite}
.mkduo-wave i:nth-child(3n){animation-delay:.25s}
.mkduo-wave i:nth-child(4n){animation-delay:.5s}
.mkduo-wave i:nth-child(5n){animation-delay:.75s}
.mkduo-flow span,.mkduo-flow i,.mkduo-flow b{animation:mkduo-travel 4s ease-in-out infinite}
.mkduo-flow i{animation-delay:1.2s}
.mkduo-flow b{animation-delay:2.4s}
}
@keyframes mkduo-pulse{50%{transform:scale(.78);opacity:.72}}
@keyframes mkduo-wave{50%{transform:scaleY(.5)}}
@keyframes mkduo-travel{0%,100%{opacity:.2;transform:translateY(-3px)}50%{opacity:1;transform:translateY(3px)}}
`;

export default function ConsultationDuo({
  labels,
  ariaLabel,
  className,
}: {
  labels: ConsultationDuoLabels;
  /** Translated description of the whole illustration (blueprint §10.9). */
  ariaLabel: string;
  className?: string;
}) {
  const { web, phone, notes } = labels;
  return (
    <div role="img" aria-label={ariaLabel} className={cn("mkduo", className)}>
      <style>{CSS}</style>
      <div aria-hidden className="mkduo-canvas">
        <div className="mkduo-orbit mkduo-orbit-1" />
        <div className="mkduo-orbit mkduo-orbit-2" />

        {/* Web record panel */}
        <div className="mkduo-web">
          <div className="mkduo-topbar">
            <div className="mkduo-minibrand">
              <span className="mkduo-minimark" /> {web.brand}
            </div>
            <div className="mkduo-search">{web.search}</div>
            <div className="mkduo-avatar">HM</div>
          </div>
          <div className="mkduo-body">
            <div className="mkduo-side">
              <span className="mkduo-side-active" />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="mkduo-panel">
              <div className="mkduo-heading">
                <div>
                  <span className="mkduo-kicker">{web.kicker}</span>
                  <strong>{web.title}</strong>
                </div>
                <span className="mkduo-chip">{web.reviewChip}</span>
              </div>
              <div className="mkduo-progress">
                <span />
              </div>
              <div className="mkduo-tabs">
                {web.tabs.map((tab, index) => (index === 0 ? <b key={tab}>{tab}</b> : <span key={tab}>{tab}</span>))}
              </div>
              <div className="mkduo-grid">
                <div className="mkduo-main">
                  {web.fields.map((field) => (
                    <article key={field.label} className={cn("mkduo-field", field.state)}>
                      <div className="mkduo-ftitle">
                        <span className="mkduo-dot" /> {field.label} <small>{field.stateLabel}</small>
                      </div>
                      <p>{field.text}</p>
                      {field.source && <div className="mkduo-source">↳ {field.source}</div>}
                    </article>
                  ))}
                </div>
                <aside className="mkduo-changes">
                  <span className="mkduo-kicker">{web.changesKicker}</span>
                  <strong>{web.changesTitle}</strong>
                  <ul>
                    {web.changes.map((change) => (
                      <li key={change}>
                        <i /> {change}
                      </li>
                    ))}
                  </ul>
                  <span className="mkduo-cta">
                    {web.changesCta} <span>→</span>
                  </span>
                </aside>
              </div>
            </div>
          </div>
        </div>

        {/* Flow line connecting the phone audio to the web fields */}
        <div className="mkduo-flow">
          <span />
          <i />
          <b />
        </div>

        {/* Phone recording screen */}
        <div className="mkduo-phone">
          <div className="mkduo-speaker" />
          <div className="mkduo-screen">
            <div className="mkduo-ptop">
              <span>09:41</span>
              <span>● ● ●</span>
            </div>
            <div className="mkduo-pnav">
              <span>‹</span>
              <strong>{phone.navTitle}</strong>
              <i />
            </div>
            <div className="mkduo-patient">
              <div className="mkduo-pavatar">HM</div>
              <div>
                <strong>{phone.patient}</strong>
                <span>{phone.consent}</span>
              </div>
              <b>✓</b>
            </div>
            <div className="mkduo-rec">
              <div className="mkduo-pulse">
                <span />
              </div>
              <small>{phone.statusLabel}</small>
              <strong>{phone.timer}</strong>
              <div className="mkduo-wave">
                {Array.from({ length: 22 }).map((_, index) => (
                  <i key={index} />
                ))}
              </div>
            </div>
            <div className="mkduo-actions">
              <span>
                <b>Ⅱ</b>
                {phone.pauseLabel}
              </span>
              <span>
                <b>＋</b>
                {phone.voiceLabel}
              </span>
            </div>
            <div className="mkduo-finish">{phone.finishLabel}</div>
          </div>
        </div>

        {/* Floating notes */}
        <div className="mkduo-note mkduo-note-1">
          <span>✓</span>
          <div>
            <b>{notes.one.title}</b>
            <small>{notes.one.sub}</small>
          </div>
        </div>
        <div className="mkduo-note mkduo-note-2">
          <span>{notes.two.badge}</span>
          <div>
            <b>{notes.two.title}</b>
            <small>{notes.two.sub}</small>
          </div>
        </div>
      </div>
    </div>
  );
}
