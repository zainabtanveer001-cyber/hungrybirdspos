import { useEffect, useRef } from 'react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';

/**
 * Plays an alert sound and fires a toast when a new website order lands
 * in the POS inbox — but only when the OnlineOrdersModal is not already open,
 * so accepting orders doesn't produce a cascade of alerts.
 */
export function useOrderAlert(notify: (message: string) => void, ordersModalOpen: boolean) {
  const pendingCount = useLive(
    () => db.onlineOrders.where('status').equals('PENDING').count(),
    [],
  ) ?? 0;

  const prevCountRef = useRef(pendingCount);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = pendingCount;

    if (pendingCount > prev && !ordersModalOpen) {
      const newOrders = pendingCount - prev;
      // Play alert sound (silent-fail on browsers that block autoplay)
      if (!audioRef.current) {
        audioRef.current = new Audio('https://assets.mixkit.co/sfx/2580/2580-signal.mp3');
        audioRef.current.volume = 0.5;
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});

      notify(
        newOrders === 1
          ? '🔔 New website order received!'
          : `🔔 ${newOrders} new website orders received!`,
      );
    }
  }, [pendingCount, notify, ordersModalOpen]);
}
