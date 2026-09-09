"use client";

import { isLoopbackHost, type SyncStatus, type SyncTransport } from "./deck-sync";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { ArrowsClockwise, DeviceMobile, WarningCircle, X } from "@phosphor-icons/react";

const STATUS_COPY: Record<SyncStatus, string> = {
  idle: "Aguardando",
  connecting: "Conectando…",
  live: "Sincronizado",
  error: "Sem conexão",
};

const TRANSPORT_COPY: Record<SyncTransport, string> = {
  lan: "rede local — sem internet",
  cloud: "internet (Supabase Realtime)",
  none: "indisponível",
};

/**
 * "Scan this and the phone follows the slides."
 *
 * The QR carries the presenter URL of the room this deck is already in, so the
 * phone lands on the teleprompter and starts receiving state without anyone
 * typing an address. Two things it deliberately does NOT hide:
 *
 * - when the deck was opened on `localhost` the QR would encode an address only
 *   this laptop can resolve, so the panel says that outright and names the fix
 *   instead of printing a code that silently fails on stage;
 * - the connection status is the transport's real state, not a hopeful label.
 */
export default function DeckConnect({
  room,
  transport,
  status,
  onClose,
}: {
  room: string;
  transport: SyncTransport;
  status: SyncStatus;
  onClose: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [loopback, setLoopback] = useState(false);

  useEffect(() => {
    const target = new URL(window.location.href);
    target.hash = "";
    target.search = "";
    target.searchParams.set("apresentador", "1");
    target.searchParams.set("sala", room);
    const href = target.toString();

    setUrl(href);
    setLoopback(isLoopbackHost(window.location.hostname));

    QRCode.toDataURL(href, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 520,
      // The deck's own ink on paper — a QR is read by a camera, but it is also
      // projected, and a black square would be the only pure black on screen.
      color: { dark: "#086761ff", light: "#ffffffff" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [room]);

  return (
    <div className="deck-modal" onClick={onClose}>
      <div
        className="deck-modal-panel deck-connect"
        role="dialog"
        aria-modal="true"
        aria-label="Conectar o teleprompter no celular"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>
          Teleprompter no celular
          <button className="deck-btn deck-btn--icon" type="button" onClick={onClose} aria-label="Fechar">
            <X size={14} />
          </button>
        </h2>

        <div className="deck-connect-body">
          <figure className="deck-connect-qr">
            {qr ? (
              <img src={qr} alt={`QR code para abrir o teleprompter na sala ${room}`} />
            ) : (
              <span className="deck-connect-qr-empty">
                <ArrowsClockwise size={22} weight="duotone" aria-hidden="true" />
              </span>
            )}
            <figcaption>
              Sala <b>{room}</b>
            </figcaption>
          </figure>

          <div className="deck-connect-copy">
            <p>
              Aponte a câmera do celular. O teleprompter abre já sincronizado — os dois avançam juntos, de qualquer um
              dos lados.
            </p>

            <p className={`deck-connect-status deck-connect-status--${status}`}>
              <i aria-hidden="true" />
              <span>
                <strong>{STATUS_COPY[status]}</strong>
                <small>{TRANSPORT_COPY[transport]}</small>
              </span>
            </p>

            {loopback && (
              <p className="deck-connect-warn">
                <WarningCircle size={18} weight="duotone" aria-hidden="true" />
                <span>
                  Este deck está aberto em <b>localhost</b>, que só existe neste computador. Feche e reabra pelo
                  endereço de rede que o servidor imprime (algo como <b>http://192.168.x.x:3000/palestra</b>) para o
                  celular conseguir entrar.
                </span>
              </p>
            )}

            {transport === "none" && (
              <p className="deck-connect-warn">
                <WarningCircle size={18} weight="duotone" aria-hidden="true" />
                <span>
                  Sem transporte disponível neste endereço. Sirva o deck pelo notebook (rede local) para sincronizar sem
                  internet.
                </span>
              </p>
            )}

            <code className="deck-connect-url">{url}</code>

            <p className="deck-connect-hint">
              <DeviceMobile size={17} weight="duotone" aria-hidden="true" />
              <span>
                No palco, o mais seguro é ligar o notebook ao <b>roteador do celular</b>: os dois ficam na mesma rede e
                a sincronia não depende do Wi-Fi do evento nem de internet.
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
