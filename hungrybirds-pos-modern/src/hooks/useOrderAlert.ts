import { useEffect, useRef, useState } from 'react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';

let audioCtx: AudioContext | null = null;

function getAudio(): AudioContext | null {
  try {
    audioCtx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    return audioCtx;
  } catch {
    return null;
  }
}

// Browsers keep audio suspended until a user gesture; unlock it on the first one.
for (const evt of ['pointerdown', 'keydown'] as const)
  window.addEventListener(evt, () => void getAudio()?.resume(), { once: true });

// Web Audio (not an external mp3) so Vercel's default-src 'self' CSP doesn't block it.
function playBeep() {
  const ctx = getAudio();
  if (!ctx) return;
  void ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}

/**
 * Plays an alert sound, flashes visual indicators, and fires a toast when a new
 * order arrives in the POS inbox — while returning the live pending count so the
 * header badge and incoming-order banner stay visible until staff handle it.
 */
export function useOrderAlert(notify: (message: string) => void, ordersModalOpen: boolean) {
  const pendingCount = useLive(() => db.onlineOrders.where('status').equals('PENDING').count(), []);
  const [recentArrival, setRecentArrival] = useState(false);

  // null until the first real count arrives, so existing orders don't beep on load.
  const prevCountRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pendingCount === undefined) return;
    const prev = prevCountRef.current;
    prevCountRef.current = pendingCount;

    if (prev !== null && pendingCount > prev) {
      setRecentArrival(true);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => setRecentArrival(false), 5000);

      if (!ordersModalOpen) {
        const newOrders = pendingCount - prev;
        playBeep();
        notify(
          newOrders === 1
            ? 'New online order received! Click "Online" to review.'
            : `${newOrders} new online orders received! Click "Online" to review.`,
        );
      }
    } else if (pendingCount === 0) {
      setRecentArrival(false);
    }
  }, [pendingCount, notify, ordersModalOpen]);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, []);

  return { pendingCount: pendingCount ?? 0, recentArrival };
}
