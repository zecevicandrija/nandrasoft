import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Check, CheckCircle2, Clock3, Gauge, History, Info, Loader2, Plus, RefreshCw, Save, ShieldCheck, Tractor, X } from 'lucide-react';
import CustomSelect from './CustomSelect/CustomSelect';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../lib/auth-client';
import { masterQueryKeys } from '../lib/masterQueryKeys';
import { useDurableSubmission } from '../lib/useDurableSubmission';
import SubmissionRecovery from './SubmissionRecovery';
import styles from './MachineUsageModal.module.css';

const API = 'http://localhost:5000/api';
type Props = { contextType: 'order' | 'work' | 'assignment'; contextId: string; onClose: () => void; onSaved?: () => void };
const localDate = (value: string | Date) => {
  const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const instant = (value: string) => new Date(value).toISOString();
export default function MachineUsageModal({ contextType, contextId, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [form, setForm] = useState<Record<string, string>>({ mode: 'CORRECT', reason: '', sourceId: '', machineId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const draft = useDurableSubmission(`machine-usage:${contextType}:${contextId}`, (session as any)?.user?.id, form, setForm);
  const query = useQuery({ queryKey: ['machine-usage', contextType, contextId], refetchOnWindowFocus: false, queryFn: async () => {
    const r = await fetch(`${API}/machine-usage/${contextType}/${contextId}`, { credentials: 'include' });
    const body = await r.json(); if (!r.ok) throw new Error(body.error); return body;
  } });
  const machines = useQuery({ queryKey: masterQueryKeys.machines, refetchOnWindowFocus: false, queryFn: async () => {
    const r = await fetch(`${API}/master/machines`, { credentials: 'include' });
    if (!r.ok) throw new Error('Mašine nisu učitane.'); return r.json();
  } });
  const c = query.data;
  const segments = (c?.assignments || []).filter((a: any) => !a.voidedAt);
  const sourceOptions = [...segments, ...(c?.unlinkedAssignments || [])];
  const source = sourceOptions.find((a: any) => a.id === form.sourceId);
  const selected = machines.data?.machines?.find((m: any) => m.id === form.machineId);
  const legacy = c?.work && segments.length === 0 && !source;
  const set = (name: string, value: string) => { draft.resume(); setForm(f => ({ ...f, [name]: value })); };
  const chooseSource = (id: string) => {
    const a = sourceOptions.find((item: any) => item.id === id);
    setForm(f => ({ ...f, contextVersion: c.version, sourceId: id, startedAt: localDate(f.mode === 'REPLACE' ? new Date() : a?.assignedAt || new Date()),
      endedAt: a?.returnedAt ? localDate(a.returnedAt) : localDate(new Date()),
      previousEndHours: a?.endHours?.toString() || '', previousEndFuelLiters: a?.endFuelLiters?.toString() || '',
      previousAreaDoneHa: a?.areaDoneHa?.toString() || '0', areaDoneHa: f.mode === 'CORRECT' ? String(a?.areaDoneHa ?? c?.work?.areaDoneHa ?? 0) : '0',
    }));
  };
  useEffect(() => {
    if (!c || initialized.current || draft.hasDraft) return;
    initialized.current = true;
    const a = segments.find((item: any) => item.status === 'ZADUZENA') || segments[segments.length - 1];
    setForm(f => ({ ...f, contextVersion: c.version, sourceId: a?.id || 'legacy', startedAt: localDate(a?.assignedAt || c.work?.date || new Date()),
      endedAt: localDate(a?.returnedAt || new Date()), previousStartedAt: localDate(c.work?.date || new Date()),
      previousEndedAt: localDate(c.work?.date || new Date()),
      previousEndHours: a?.endHours?.toString() || '', previousEndFuelLiters: a?.endFuelLiters?.toString() || '',
      previousAreaDoneHa: String(a?.areaDoneHa ?? c.work?.areaDoneHa ?? 0), areaDoneHa: String(a?.areaDoneHa ?? c.work?.areaDoneHa ?? 0),
      totalArea: String(c.work?.areaDoneHa || 0), ...Object.fromEntries(segments.map((a: any) => [`area:${a.id}`, String(a.areaDoneHa || 0)])),
    }));
  }, [c, draft.hasDraft]);
  const save = async (allocate = false, replay?: { url: string; payload: unknown }) => {
    setError(''); setBusy(true);
    try {
      let payload: any;
      if (replay) payload = replay.payload;
      else if (allocate) payload = { contextType, contextId, version: form.contextVersion, reason: form.reason, areaDoneHa: Number(form.totalArea),
        allocations: segments.map((a: any) => ({ id: a.id, areaDoneHa: Number(form[`area:${a.id}`]) })) };
      else {
        payload = { contextType, contextId, version: form.contextVersion, sourceId: form.sourceId, mode: form.mode,
          machineId: form.machineId, reason: form.reason, expectedMachineUpdatedAt: form.machineVersion,
          // Keep the original millisecond precision when correcting an existing assignment.
          startedAt: form.mode === 'CORRECT' && source ? source.assignedAt : instant(form.startedAt),
          ...(c.terminal && { endedAt: form.mode === 'CORRECT' && source?.returnedAt ? source.returnedAt : instant(form.endedAt) }),
          isOperational: form.isOperational !== 'false', previousIsOperational: form.previousIsOperational !== 'false',
        };
        for (const key of ['startHours', 'endHours', 'startFuelLiters', 'endFuelLiters', 'areaDoneHa', 'previousAreaDoneHa',
          'previousEndHours', 'previousEndFuelLiters', 'previousStartHours', 'previousStartFuelLiters', 'sourceCurrentHours', 'sourceCurrentFuelLiters']) {
          if (form[key] !== undefined && form[key] !== '') payload[key] = Number(form[key]);
        }
        if (legacy) { payload.previousStartedAt = instant(form.previousStartedAt); payload.previousEndedAt = instant(form.previousEndedAt); }
      }
      await draft.request(replay?.url || `${API}/machine-usage/${allocate ? 'allocate' : 'change'}`, replay?.payload || payload);
      draft.clear();
      await qc.invalidateQueries(); onSaved?.(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Promena nije sačuvana.'); }
    finally { setBusy(false); }
  };
  const field = (name: string, label: string, required = true, type = 'number', disabled = false) => <label className={styles.field}>
    <span>{label}{required && <span className={styles.required}> *</span>}</span>
    <input type={type} {...(type === 'number' ? { min: 0, step: '0.01' } : {})} required={required} disabled={disabled || busy}
      value={form[name] ?? ''} onChange={e => set(name, e.target.value)} />
  </label>;
  const modes = [
    { value: 'CORRECT', title: 'Pogrešan izbor', text: 'Prethodna mašina nije radila', icon: CheckCircle2 },
    { value: 'REPLACE', title: 'Zamena mašine', text: 'Sačuvaj već obavljeni rad', icon: ArrowRightLeft },
    { value: 'ADD', title: 'Dodatna mašina', text: 'Dodaj još jednu uz postojeće', icon: Plus },
  ];
  const statusLabel = (a: any) => a.voidedAt ? 'Poništeno' : a.status === 'ZADUZENA' ? 'Zadužena' : a.status === 'VRACENA_SA_KVAROM' ? 'Sa kvarom' : 'Razdužena';
  const activeSegments = (c?.assignments || []).filter((a: any) => !a.voidedAt);
  return <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="machine-usage-title" aria-describedby="machine-usage-description">
      <div className={styles.header}>
        <div className={styles.headingGroup}><span className={styles.headingIcon}><ArrowRightLeft size={22} /></span>
          <div><h2 id="machine-usage-title">Promena mašine</h2><p id="machine-usage-description">Ispravka i evidencija korišćenih mašina</p></div>
        </div>
        <button className={styles.closeButton} type="button" onClick={onClose} disabled={busy} aria-label="Zatvori"><X size={20} /></button>
      </div>
      <div className={styles.body}>
        {(query.isPending || machines.isPending) && <div className={styles.loading}><Loader2 size={24} className={styles.spinner} /><span>Učitavanje mašina i zaduženja…</span></div>}
        {(query.error || machines.error || error) && <div role="alert" className={styles.error}><Info size={18} /><span>{error || query.error?.message || machines.error?.message}</span></div>}
        <div className={styles.recovery}><SubmissionRecovery pending={!!draft.pending} error={draft.storageError} busy={busy}
          onRetry={() => draft.pending && save(false, draft.pending)} /></div>
        {c && <>
          <div className={styles.notice}><ShieldCheck size={20} /><div><strong>{c.terminal ? 'Izmena završenog posla' : 'Izmena zaduženja'}</strong>
            <p>{c.terminal ? 'Ispravite korišćene mašine i njihov učinak. Završena zaduženja ostaju zatvorena.' : 'Evidentirajte stvarno korišćenje. Zamena se beleži na istog radnika, uz istoriju prethodne mašine.'}</p></div></div>
          <section className={styles.historySection} aria-label="Evidentirane mašine">
            <div className={styles.sectionHeading}><h3><Tractor size={18} />Evidentirane mašine</h3><span className={styles.count}>{activeSegments.length}</span></div>
            {activeSegments.length ? <div className={styles.machineList}>{activeSegments.map((a: any) => <div className={styles.machineCard} key={a.id}>
              <div className={styles.machineCardTop}><strong>{a.machine?.name}</strong><span className={`${styles.badge} ${a.status === 'ZADUZENA' ? styles.badgeActive : a.status === 'VRACENA_SA_KVAROM' ? styles.badgeWarning : styles.badgeClosed}`}>{statusLabel(a)}</span></div>
              <div className={styles.machinePeriod}><Clock3 size={14} /><span>{new Date(a.assignedAt).toLocaleString('sr-RS')} — {a.returnedAt ? new Date(a.returnedAt).toLocaleString('sr-RS') : 'u toku'}</span></div>
              <div className={styles.machineMetrics}><span><strong>{a.areaDoneHa ?? '—'}</strong> ha</span><span><Gauge size={14} /><strong>{a.endHours != null ? Math.max(0, a.endHours - a.startHours) : '—'}</strong> rh</span></div>
            </div>)}</div> : <p className={styles.note}>Za ovaj rad još nema direktno povezanog zaduženja. Izaberite provereni zapis u nastavku.</p>}
            {c.assignments.some((a: any) => a.voidedAt) && <details className={styles.details}><summary><History size={16} />Istorija ispravki</summary><div className={styles.detailsBody}>
              {c.assignments.filter((a: any) => a.voidedAt).map((a: any) => <div key={a.id} className={styles.voidedRow}><strong>{a.machine?.name}</strong><span className={`${styles.badge} ${styles.badgeClosed}`}>Poništeno</span><p>{a.correctionReason}</p></div>)}
            </div></details>}
          </section>
          {!c.canEdit ? <div className={styles.notice}><Info size={20} /><p>Radnik može ispraviti svoje unose do kraja dana. Za starije unose obratite se rukovodiocu.</p></div> : <>
            <form className={styles.form} onSubmit={e => { e.preventDefault(); save(); }}>
              <fieldset className={styles.formSection}><legend>Vrsta promene</legend>
                <p className={styles.sectionHint}>Da li je prethodna mašina zaista korišćena?</p>
                <div className={styles.modeGrid}>{modes.map(({ value, title, text, icon: Icon }) => <button key={value} type="button" aria-pressed={form.mode === value}
                  className={`${styles.modeButton} ${form.mode === value ? styles.modeSelected : ''}`} disabled={busy || !!draft.pending} onClick={() => setForm(f => ({ ...f, mode: value,
                    startedAt: localDate(value === 'REPLACE' ? new Date() : source?.assignedAt || new Date()),
                    areaDoneHa: value === 'CORRECT' ? String(source?.areaDoneHa ?? c.work?.areaDoneHa ?? 0) : '0' }))}>
                  <span className={styles.modeButtonTop}><Icon size={19} />{form.mode === value && <Check size={16} />}</span><strong>{title}</strong><span>{text}</span>
                </button>)}</div>
                <div className={styles.field}><label htmlFor="usage-source">Prethodno korišćenje</label><CustomSelect id="usage-source" value={form.sourceId} onChange={chooseSource} disabled={busy || !!draft.pending}
                  options={[
                    ...(c.work && segments.length === 0 ? [{ value: 'legacy', label: 'Ručno potvrdi istoriju', subLabel: 'Nema odgovarajućeg zaduženja' }] : []),
                    ...segments.map((a: any) => ({ value: a.id, label: a.machine?.name || 'Mašina', subLabel: new Date(a.assignedAt).toLocaleString('sr-RS') })),
                    ...(c.unlinkedAssignments || []).map((a: any) => ({ value: a.id, label: `Poveži postojeće: ${a.machine?.name}`, subLabel: new Date(a.assignedAt).toLocaleString('sr-RS') })),
                  ]} placeholder="Izaberite prethodno korišćenje" triggerClassName={styles.selectTrigger} /></div>
              </fieldset>
              {legacy && <fieldset className={styles.formSection}><legend>Prethodna mašina — provera istorije</legend><p className={styles.sectionHint}>Unesite proverene podatke iz stvarne evidencije.</p><div className={styles.grid}>
                {field('previousStartedAt', 'Početak korišćenja', true, 'datetime-local')}{field('previousEndedAt', 'Završetak korišćenja', true, 'datetime-local')}{field('previousStartHours', 'Početno brojilo (rh)')}{field('previousStartFuelLiters', 'Početno gorivo (L)')}
              </div></fieldset>}
              {form.mode !== 'CORRECT' && (form.mode === 'REPLACE' || legacy) && <fieldset className={styles.formSection}><legend>Razduženje prethodne mašine</legend><div className={styles.grid}>
                {field('previousEndHours', 'Završno brojilo (rh)')}{field('previousEndFuelLiters', 'Gorivo pri povratku (L)')}
                <div className={styles.field}><label htmlFor="usage-previous-operational">Stanje mašine</label><CustomSelect id="usage-previous-operational" value={form.previousIsOperational || 'true'} onChange={v => set('previousIsOperational', v)} searchable={false} disabled={busy}
                  options={[{ value: 'true', label: 'Ispravna' }, { value: 'false', label: 'Vraćena sa kvarom' }]} triggerClassName={styles.selectTrigger} /></div>
              </div></fieldset>}
              {form.mode === 'CORRECT' && <details className={styles.details}><summary><Gauge size={16} />Provera trenutnog stanja prethodne mašine<span className={styles.optional}>Po potrebi</span></summary><div className={styles.detailsBody}>
                <p className={styles.sectionHint}>Popunite ako sistem zatraži proveru starog zaduženja ili novijih ručnih očitavanja.</p><div className={styles.grid}>
                  {field('sourceCurrentHours', 'Trenutno brojilo (rh)', false)}{field('sourceCurrentFuelLiters', 'Trenutno gorivo (L)', false)}
                </div></div></details>}
              <fieldset className={styles.formSection}><legend>{form.mode === 'ADD' ? 'Dodatna mašina' : 'Nova / stvarno korišćena mašina'}</legend>
                <div className={styles.field}><label htmlFor="usage-machine">Mašina<span className={styles.required}> *</span></label><CustomSelect id="usage-machine" value={form.machineId} disabled={busy || !!draft.pending}
                  onChange={id => { set('machineId', id); set('machineVersion', machines.data?.machines?.find((m: any) => m.id === id)?.updatedAt || ''); set('startHours', ''); set('startFuelLiters', ''); set('endHours', ''); set('endFuelLiters', ''); }}
                  options={(machines.data?.machines || []).filter((m: any) => m.type !== 'PRIKLJUCAK').map((m: any) => ({ value: m.id, label: m.name, subLabel: m.status === 'SLOBODNA' ? 'Slobodna' : m.status === 'ZADUZENA' ? 'Zadužena' : m.status === 'SERVIS' ? 'Na servisu' : m.status }))}
                  placeholder="Izaberite mašinu" icon={<Tractor size={17} />} triggerClassName={styles.selectTrigger} /></div>
                <div className={styles.grid}>{field('startedAt', form.mode === 'REPLACE' ? 'Vreme zamene' : 'Početak korišćenja', true, 'datetime-local', form.mode === 'CORRECT' && Boolean(source))}
                  {c.terminal && field('endedAt', 'Završetak korišćenja', true, 'datetime-local', form.mode === 'CORRECT' && Boolean(source?.returnedAt))}
                  {field('startHours', 'Početno brojilo (rh)')}{field('startFuelLiters', 'Početno gorivo (L)')}
                  {c.terminal && <>{field('endHours', 'Završno brojilo (rh)')}{field('endFuelLiters', 'Gorivo pri povratku (L)')}
                    <div className={styles.field}><label htmlFor="usage-operational">Stanje pri povratku</label><CustomSelect id="usage-operational" value={form.isOperational || 'true'} onChange={v => set('isOperational', v)} searchable={false} disabled={busy}
                      options={[{ value: 'true', label: 'Ispravna' }, { value: 'false', label: 'Vraćena sa kvarom' }]} triggerClassName={styles.selectTrigger} /></div></>}
                  {field('areaDoneHa', 'Učinak nove mašine (ha)', Boolean(c.work))}
                  {form.mode !== 'CORRECT' && field('previousAreaDoneHa', 'Učinak prethodne mašine (ha)', Boolean(c.work))}
                </div>
              </fieldset>
              <label className={styles.field}><span>Razlog izmene / opis kvara<span className={styles.required}> *</span></span><textarea required minLength={3} maxLength={500} rows={3} value={form.reason} placeholder="Ukratko opišite razlog promene…" onChange={e => set('reason', e.target.value)} /></label>
              <div className={styles.noticeCompact}><Info size={17} /><p>{form.mode === 'CORRECT' ? 'Pogrešno zaduženje biće poništeno i sačuvano u istoriji.' : 'Stvarno korišćenje prethodne mašine ostaje u istoriji.'} {c.work && `Ukupan rad ostaje ${c.work.areaDoneHa} ha; raspodelite površinu između mašina.`}</p></div>
              <div className={styles.actions}><button className={styles.secondaryButton} type="button" disabled={busy} onClick={onClose}>Odustani</button><button className={styles.primaryButton} type="submit" disabled={busy || !selected || !!draft.pending}>
                {busy ? <Loader2 size={17} className={styles.spinner} /> : <Save size={17} />}{busy ? 'Čuvanje…' : form.mode === 'ADD' ? 'Dodaj mašinu' : 'Sačuvaj promenu'}
              </button></div>
            </form>
            {c.work && segments.length > 0 && <details className={styles.details}><summary><Gauge size={16} />Ispravka hektara i raspodele</summary><div className={styles.detailsBody}>
              <form className={styles.form} onSubmit={e => { e.preventDefault(); save(true); }}><p className={styles.sectionHint}>Ukupna površina treba da odgovara zbiru učinka svih mašina.</p>
                <div className={styles.grid}>{field('totalArea', 'Ukupno urađeno (ha)')}{segments.map((a: any) => <div key={a.id}>{field(`area:${a.id}`, `${a.machine?.name} (ha)`)}</div>)}</div>
                <label className={styles.field}><span>Razlog ispravke<span className={styles.required}> *</span></span><textarea required minLength={3} rows={2} value={form.reason} onChange={e => set('reason', e.target.value)} /></label>
                <div className={styles.allocationActions}><button className={styles.primaryButton} type="submit" disabled={busy || !!draft.pending}><Save size={17} />Sačuvaj raspodelu</button></div>
              </form></div></details>}
          </>}
        </>}
        <div className={styles.refreshRow}><button className={styles.refreshButton} type="button" disabled={busy || !!draft.pending || query.isFetching || machines.isFetching} onClick={async () => {
          const [fresh, catalogue] = await Promise.all([query.refetch(), machines.refetch()]);
          if (fresh.data && catalogue.data) setForm(f => ({ ...f, contextVersion: fresh.data.version,
            machineVersion: catalogue.data.machines?.find((m: any) => m.id === f.machineId)?.updatedAt || '',
            startFuelLiters: '', endFuelLiters: '', previousEndFuelLiters: '', sourceCurrentFuelLiters: '' }));
        }}><RefreshCw size={15} />Osveži podatke i ponovo očitaj gorivo</button></div>
      </div>
    </section>
  </div>;
}
