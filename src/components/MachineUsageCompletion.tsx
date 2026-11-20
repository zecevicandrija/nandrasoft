import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw, Tractor } from 'lucide-react';
import CustomSelect from './CustomSelect/CustomSelect';
import styles from './MachineUsageModal.module.css';
export type UsageCompletionData = { usageAreas: { assignmentId: string; areaDoneHa: number }[];
  machineReturns: { assignmentId: string; endHours?: number; endFuelLiters?: number; expectedMachineUpdatedAt: string; isOperational: boolean; returnNotes?: string }[] };
export default function MachineUsageCompletion({ type, id, primaryMachineId, totalArea, value, onChange }: {
  type: 'order' | 'assignment'; id: string; primaryMachineId: string; totalArea: number;
  value: UsageCompletionData; onChange: (value: UsageCompletionData) => void;
}) {
  const query = useQuery({ queryKey: ['machine-usage', type, id], queryFn: async () => {
    const r = await fetch(`/api/machine-usage/${type}/${id}`, { credentials: 'include' });
    const data = await r.json(); if (!r.ok) throw new Error(data.error); return data;
  } });
  const segments = (query.data?.assignments || []).filter((a: any) => !a.voidedAt);
  useEffect(() => {
    if (!query.data || segments.length < 2) return;
    const ids = new Set(segments.map((a: any) => a.id));
    const usageAreas = value.usageAreas.filter(a => ids.has(a.assignmentId));
    const machineReturns = value.machineReturns.filter(a => ids.has(a.assignmentId));
    for (const a of segments) {
      if (!usageAreas.some(r => r.assignmentId === a.id)) usageAreas.push({ assignmentId: a.id,
        areaDoneHa: a.areaDoneHa ?? (a.machineId === primaryMachineId ? Math.max(0, totalArea - segments.reduce((n: number, s: any) => n + (s.areaDoneHa || 0), 0)) : 0) });
      if (a.status === 'ZADUZENA' && a.machineId !== primaryMachineId && !machineReturns.some(r => r.assignmentId === a.id)) {
        machineReturns.push({ assignmentId: a.id, expectedMachineUpdatedAt: a.machine.updatedAt, isOperational: true });
      }
    }
    if (JSON.stringify(value) !== JSON.stringify({ usageAreas, machineReturns })) onChange({ usageAreas, machineReturns });
  }, [query.data, primaryMachineId, totalArea, value, onChange]);
  if (query.isPending) return <div className={styles.loading}><Loader2 size={20} className={styles.spinner} />Učitavanje korišćenih mašina…</div>;
  if (query.error) return <div role="alert" className={styles.error}><span>{query.error.message}</span><button className={styles.secondaryButton} type="button" onClick={() => query.refetch()}>Pokušaj ponovo</button></div>;
  if (segments.length < 2) return null;
  const changeArea = (assignmentId: string, areaDoneHa: number) => onChange({ ...value,
    usageAreas: value.usageAreas.map(a => a.assignmentId === assignmentId ? { assignmentId, areaDoneHa } : a) });
  const changeReturn = (assignmentId: string, patch: Record<string, unknown>) => onChange({ ...value,
    machineReturns: value.machineReturns.map(a => a.assignmentId === assignmentId ? { ...a, ...patch } : a) });
  const allocated = value.usageAreas.reduce((n, a) => n + a.areaDoneHa, 0);
  return <fieldset className={styles.completion}>
    <legend>Korišćene mašine i raspodela učinka</legend>
    <p className={styles.sectionHint}>Raspodelite ukupno {totalArea} ha na korišćene mašine i unesite podatke za razduženje.</p>
    {segments.map((a: any) => { const r = value.machineReturns.find(r => r.assignmentId === a.id); return <div key={a.id} className={styles.completionCard}>
      <div className={styles.machineCardTop}><div className={styles.sectionHeading}><h3><Tractor size={17} />{a.machine?.name}</h3></div><span className={`${styles.badge} ${a.status === 'ZADUZENA' ? styles.badgeActive : styles.badgeClosed}`}>{a.status === 'ZADUZENA' ? 'Zadužena' : 'Razdužena'}</span></div>
      <div className={styles.grid}>
        <label className={styles.field}><span>Urađeno hektara<span className={styles.required}> *</span></span><input type="number" required min={0} step="0.01" value={value.usageAreas.find(r => r.assignmentId === a.id)?.areaDoneHa ?? ''} onChange={e => changeArea(a.id, Number(e.target.value))} /></label>
        {r && <>
          <label className={styles.field}><span>Završno brojilo (rh)<span className={styles.required}> *</span></span><input type="number" required min={a.startHours} step="0.01" placeholder={`Početno: ${a.startHours} rh`} value={r.endHours ?? ''} onChange={e => changeReturn(a.id, { endHours: Number(e.target.value) })} /></label>
          <label className={styles.field}><span>Gorivo pri povratku (L)<span className={styles.required}> *</span></span><input type="number" required min={0} max={a.machine?.tankCapacityLiters ?? 200} step="0.01" value={r.endFuelLiters ?? ''} onChange={e => changeReturn(a.id, { endFuelLiters: Number(e.target.value) })} /></label>
          <div className={styles.field}><label htmlFor={`usage-return-${a.id}`}>Stanje mašine</label><CustomSelect id={`usage-return-${a.id}`} value={String(r.isOperational)} onChange={v => changeReturn(a.id, { isOperational: v === 'true' })} searchable={false}
            options={[{ value: 'true', label: 'Ispravna' }, { value: 'false', label: 'Vraćena sa kvarom' }]} triggerClassName={styles.selectTrigger} /></div>
          {!r.isOperational && <label className={styles.field}><span>Opis kvara<span className={styles.required}> *</span></span><input required value={r.returnNotes || ''} onChange={e => changeReturn(a.id, { returnNotes: e.target.value })} /></label>}
        </>}
      </div>
      {r && <button className={styles.refreshButton} type="button" disabled={query.isFetching} onClick={async () => { const fresh = await query.refetch(); const current = fresh.data?.assignments.find((s: any) => s.id === a.id); if (current) changeReturn(a.id, { expectedMachineUpdatedAt: current.machine.updatedAt, endFuelLiters: undefined }); }}><RefreshCw size={15} />Osveži stanje i ponovo očitaj gorivo</button>}
    </div>; })}
    <p className={`${styles.allocationTotal} ${Math.abs(allocated - totalArea) > .001 ? styles.allocationMismatch : ''}`}><span>Raspodeljena površina</span><strong>{allocated.toLocaleString('sr-RS')} / {totalArea.toLocaleString('sr-RS')} ha</strong></p>
  </fieldset>;
}
