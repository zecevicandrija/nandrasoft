import { useState } from 'react';
import { CheckCircle2, Loader2, Save, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../lib/auth-client';
import { useDurableSubmission } from '../lib/useDurableSubmission';
import SubmissionRecovery from './SubmissionRecovery';
import styles from './MachineUsageModal.module.css';
export default function OtherOrderCompletion({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: session } = useSession(), qc = useQueryClient();
  const userId = (session as { user?: { id?: string } } | null | undefined)?.user?.id;
  const [form, setForm] = useState({ notes: '', workHours: '' }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const draft = useDurableSubmission(`other-order:${id}`, userId, form, setForm);
  const save = async (replay = false) => {
    setBusy(true); setError('');
    try {
      await draft.request(`/api/work-orders/${id}/complete`, replay ? draft.pending?.payload : { notes: form.notes, workHours: Number(form.workHours) });
      draft.clear();
      await Promise.all([
        qc.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'operational' && query.queryKey[3] === 'orders' }),
        qc.invalidateQueries({ queryKey: ['work-order-detail', id] }),
      ]);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Završetak nije sačuvan.'); }
    finally { setBusy(false); }
  };
  return <div className={styles.overlay}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="other-order-completion-title">
    <div className={styles.header}><div className={styles.headingGroup}><span className={styles.headingIcon}><CheckCircle2 size={22} /></span><div><h2 id="other-order-completion-title">Završavanje naloga</h2><p>Evidencija obavljenog posla</p></div></div><button type="button" className={styles.closeButton} disabled={busy} onClick={onClose} aria-label="Zatvori"><X size={20} /></button></div>
    <div className={styles.body}>
      <p className={styles.note}>Rad se beleži na dodeljenog radnika. Korišćene mašine prethodno razdužite.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.recovery}><SubmissionRecovery pending={!!draft.pending} busy={busy} error={draft.storageError} onRetry={() => save(true)} /></div>
      <form className={styles.form} onSubmit={e => { e.preventDefault(); save(); }}>
        <label className={styles.field}><span>Radnih sati<span className={styles.required}> *</span></span><input type="number" min={0} step="0.01" required disabled={busy} value={form.workHours} onChange={e => setForm(f => ({ ...f, workHours: e.target.value }))} /></label>
        <label className={styles.field}><span>Šta je obavljeno<span className={styles.required}> *</span></span><textarea required minLength={3} maxLength={1000} rows={3} disabled={busy} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></label>
        <div className={styles.actions}><button className={styles.secondaryButton} type="button" disabled={busy} onClick={onClose}>Odustani</button><button className={styles.primaryButton} type="submit" disabled={busy || !!draft.pending}>{busy ? <Loader2 size={17} className={styles.spinner} /> : <Save size={17} />}{busy ? 'Čuvanje…' : 'Završi nalog'}</button></div>
      </form>
    </div>
  </section></div>;
}
