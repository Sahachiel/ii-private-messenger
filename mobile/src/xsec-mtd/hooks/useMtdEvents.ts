import { useEffect, useRef, useState, useCallback } from 'react';
import { mtd } from '../engine/MTDEngine';
import { MtdEvent } from '../types';
import { readEvents, ackEvent as ack, clearEvents as clr } from '../storage/eventLog';

export function useMtdEvents(): { events: MtdEvent[]; reload: () => Promise<void>; acknowledge: (id: string) => Promise<void>; clear: () => Promise<void> } {
  const [events, setEvents] = useState<MtdEvent[]>([]);
  const pending = useRef<any>(null);

  const reload = useCallback(async () => { setEvents(await readEvents()); }, []);

  useEffect(() => {
    reload();
    const off = mtd.onEvent(() => {
      // Debounce: collapse bursts of events within 300ms into a single reload.
      if (pending.current) return;
      pending.current = setTimeout(() => { pending.current = null; reload(); }, 300);
    });
    return () => { off(); if (pending.current) clearTimeout(pending.current); };
  }, [reload]);

  return {
    events,
    reload,
    acknowledge: async (id: string) => { await ack(id); await reload(); },
    clear: async () => { await clr(); await reload(); },
  };
}
