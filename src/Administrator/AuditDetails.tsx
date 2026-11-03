import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { History, X, UserRound, CalendarDays, ArrowRight, Info, Loader2, AlertCircle } from 'lucide-react';
import styles from './AuditDetails.module.css';

const labels: Record<string, string> = {
  liters: 'Litara', totalCost: 'Ukupan trošak', pricePerLiter: 'Cena po litru',
  status: 'Status', name: 'Naziv / ime', role: 'Uloga', isActive: 'Aktivan',
  dailyWage: 'Dnevnica', dailyWageApplied: 'Obračunata dnevnica', hourlyRate: 'Satnica',
  hoursWorked: 'Sati rada', breakMinutes: 'Pauza (min)', jobDescription: 'Opis posla',
  date: 'Datum', orderDate: 'Datum naloga', orderNumber: 'Broj naloga', dispatchNumber: 'Broj otpremnice',
  quantityKg: 'Količina (kg)', totalWeightKg: 'Ukupna masa (kg)', packageCount: 'Broj pakovanja',
  currentQuantityKg: 'Preostala masa (kg)', totalValue: 'Ukupna vrednost', pricePerKg: 'Cena po kg',
  groupName: 'Grupa', groupCount: 'Broj radnika', notes: 'Napomena', instructions: 'Uputstvo',
  reason: 'Razlog', members: 'Članovi', items: 'Stavke', description: 'Opis',
  worker: 'Radnik', workerName: 'Ime radnika', machine: 'Mašina', parcel: 'Parcela',
  lot: 'LOT', supplier: 'Dobavljač', buyer: 'Kupac', product: 'Proizvod',
  references: 'Povezani podaci', before: 'Pre', after: 'Posle',
};

function Value({ value }: { value: unknown }) {
  if (value === null) return <span className={styles.mutedValue}>Prazno</span>;
  if (value === undefined) return <span className={styles.mutedValue}>Nije zabeleženo</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Da' : 'Ne'}</span>;
  if (typeof value === 'number') return <span>{value.toLocaleString('sr-RS', { maximumFractionDigits: 4 })}</span>;
  if (typeof value === 'object') return <dl className={styles.nestedValues}>
    {Object.entries(value).map(([key, item]) => <div key={key}>
      <dt>{Array.isArray(value) ? `Stavka ${Number(key) + 1}` : labels[key] || key}</dt><dd><Value value={item} /></dd>
    </div>)}
  </dl>;
  return <span className={styles.textValue}>{String(value)}</span>;
}

export default function AuditDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [id, onClose]);
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-detail', id],
    queryFn: async () => {
      const res = await fetch(`http://localhost:5000/api/audit-logs/${encodeURIComponent(id)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Detalji događaja nisu dostupni.');
      return res.json();
    },
  });
  const log = data?.log;
  const fields = [...new Set([...Object.keys(log?.oldValues || {}), ...Object.keys(log?.newValues || {})])];
  const context = Object.fromEntries(Object.entries(log?.context || {}).filter(([key]) => key !== 'operationId'));
  const actionLabel = ({ KREIRANJE: 'Kreiranje', IZMENA: 'Izmena', KOREKCIJA: 'Korekcija', BRISANJE: 'Brisanje', STORNO: 'Storniranje', DEAKTIVACIJA: 'Deaktivacija' } as Record<string, string>)[log?.action] || log?.action;
  return createPortal(<div className={styles.overlay} onClick={onClose}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="audit-detail-title" className={styles.modal} onClick={(e) => e.stopPropagation()}>
      <header className={styles.header}>
        <div className={styles.heading}><span className={styles.headerIcon}><History size={23} /></span><div><span className={styles.eyebrow}>Revizorski trag</span><h3 id="audit-detail-title">Detalji događaja</h3></div></div>
        <button ref={closeButton} type="button" onClick={onClose} className={styles.closeButton} aria-label="Zatvori detalje"><X size={20} /></button>
      </header>
      <div className={styles.body}>
      {isLoading && <div className={styles.state} role="status"><Loader2 className={styles.spinner} size={26} /><p>Učitavanje detalja…</p></div>}
      {error && <div className={styles.error} role="alert"><AlertCircle size={20} />{error.message}</div>}
      {log && <>
        <div className={styles.summary}>
          <span className={`${styles.actionBadge} ${['BRISANJE', 'STORNO', 'DEAKTIVACIJA'].includes(log.action) ? styles.destructive : ''}`}>{actionLabel}</span>
          <p className={styles.description}>{log.description}</p>
          <div className={styles.metadata}><span><UserRound size={15} />{log.userName}</span><span><CalendarDays size={15} />{new Date(log.createdAt).toLocaleString('sr-RS')}</span></div>
        </div>
        <div className={styles.sectionHeading}><h4>Pregled podataka</h4><span>Pre <ArrowRight size={13} /> Posle</span></div>
        {fields.length > 0 ? <div className={styles.tableWrapper} tabIndex={0} role="region" aria-label="Podaci pre i posle promene"><table className={styles.comparison}>
          <thead><tr><th scope="col">Podatak</th><th scope="col">Pre promene</th><th scope="col">Posle promene</th></tr></thead>
          <tbody>{fields.map((field) => <tr key={field}>
            <th scope="row">{labels[field] || field}</th>
            <td><Value value={log.oldValues?.[field]} /></td>
            <td className={styles.newValue}><Value value={log.newValues?.[field]} /></td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>Za ovaj događaj nisu zabeležene pojedinačne vrednosti polja.</p>}
        {Object.keys(context).length > 0 && <aside className={styles.context}><h4><Info size={16} />Dodatni podaci</h4><Value value={context} /></aside>}
      </>}
      </div>
      <footer className={styles.footer}><span>Istorija aktivnosti</span><button type="button" onClick={onClose} className={styles.doneButton}>Zatvori pregled</button></footer>
    </section>
  </div>, document.body);
}
