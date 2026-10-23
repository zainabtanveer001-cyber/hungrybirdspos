import { useEffect, useRef } from 'react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';

/**
 * Plays a short beep using the Web Audio API — avoids CSP issues with
 * external CDN audio URLs in production (Vercel sets default-src 'self').
 */
function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Web Audio API unavailable — silently skip
  }
}

/**
 * Plays an alert sound and fires a toast when a new order arrives
 * in the POS inbox — but only when the OnlineOrdersModal is not already open,
 * so accepting orders doesn't produce a cascade of alerts.
 */
export function useOrderAlert(notify: (message: string) => void, ordersModalOpen: boolean) {
  const pendingCount = useLive(
    () => db.onlineOrders.where('status').equals('PENDING').count(),
    [],
  ) ?? 0;

  const prevCountRef = useRef(pendingCount);

  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = pendingCount;

    if (pendingCount > prev && !ordersModalOpen) {
      const newOrders = pendingCount - prev;
      playBeep();

      notify(
        newOrders === 1
          ? '🔔 New website order received!'
          : `🔔 ${newOrders} new website orders received!`,
      );
    }
  }, [pendingCount, notify, ordersModalOpen]);
}
