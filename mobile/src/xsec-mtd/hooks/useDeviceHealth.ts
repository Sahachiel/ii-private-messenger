import { useEffect, useState } from 'react';
import { mtd, ScanProgress } from '../engine/MTDEngine';
import { DeviceState } from '../types';

export interface DeviceHealth {
  state: DeviceState;
  score: number;
  lastScan: number;
  scanning: boolean;
  progress: ScanProgress | null;
  rescan: () => Promise<void>;
}

export function useDeviceHealth(): DeviceHealth {
  const [state, setState] = useState<DeviceState>(mtd.getState());
  const [score, setScore] = useState<number>(mtd.getScore());
  const [lastScan, setLastScan] = useState<number>(mtd.getLastScan());
  const [scanning, setScanning] = useState<boolean>(mtd.isScanning());
  const [progress, setProgress] = useState<ScanProgress | null>(mtd.getLastProgress());

  useEffect(() => {
    const off1 = mtd.onStateChange((s) => { setState(s); setScore(mtd.getScore()); });
    const off2 = mtd.onEvent(() => { setScore(mtd.getScore()); setLastScan(mtd.getLastScan()); });
    const off3 = mtd.onScanProgress((p) => {
      setScanning(p.scanning);
      setProgress(p);
      if (!p.scanning) setLastScan(mtd.getLastScan());
    });
    return () => { off1(); off2(); off3(); };
  }, []);

  return { state, score, lastScan, scanning, progress, rescan: () => mtd.runScan() };
}
