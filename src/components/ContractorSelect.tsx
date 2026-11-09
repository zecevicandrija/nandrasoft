import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, X } from 'lucide-react';
import CustomSelect from './CustomSelect/CustomSelect';
import styles from './ParcelQuickModal.module.css';

export interface Contractor {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  notes?: string | null;
}

export function useContractors() {
  return useQuery({
    queryKey: ['contractors'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/master/contractors', { credentials: 'include', signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Kooperanti nisu učitani.');
      return data as { contractors: Contractor[] };
    },
  });
}

export function ContractorSelect({ value, onChange, canManage = false }: {
  value: string; onChange: (value: string) => void; canManage?: boolean;
}) {
  const client = useQueryClient();
  const query = useContractors();
  const [editing, setEditing] = useState<Contractor | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', phone: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const contractors = query.data?.contractors || [];
  const selected = contractors.find(c => c.id === value);

  function showModal(item: Contractor | null) {
    setEditing(item);
    setForm({ code: item?.code || '', name: item?.name || '', phone: item?.phone || '', notes: item?.notes || '' });
    setError('');
    setOpen(true);
  }

  async function save() {
    if (saving) return;
    if (!form.code.trim() || form.name.trim().length < 2) {
      setError('Unesite šifru i naziv kooperanta (najmanje 2 karaktera).');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/master/contractors${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Čuvanje nije uspelo.');
      client.setQueryData<{ contractors: Contractor[] }>(['contractors'], previous => ({
        contractors: [...(previous?.contractors || []).filter(c => c.id !== data.contractor.id), data.contractor]
          .sort((a, b) => a.code.localeCompare(b.code)),
      }));
      await Promise.all(['contractors', 'field-works', 'operational', 'work-order-detail'].map(key =>
        client.invalidateQueries({ queryKey: [key] })));
      onChange(data.contractor.id);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Čuvanje nije uspelo.');
    } finally { setSaving(false); }
  }

  return <div className={styles.quickField}>
    <span className={styles.quickFieldTitle}>Kooperant (opciono)</span>
    <CustomSelect value={value} onChange={onChange} searchable
      hideTriggerSubLabel triggerClassName={styles.quickFieldTrigger}
      placeholder={query.isLoading ? 'Učitavanje...' : '— Bez kooperanta —'}
      options={[{ value: '', label: '— Bez kooperanta —' }, ...contractors.map(c => ({ value: c.id, label: c.name, subLabel: c.code }))]} />
    {canManage && <div className={styles.quickActionsContainer}>
      <button type="button" className={styles.actionBtnAdd} onClick={() => showModal(null)}><Plus size={14} /> Dodaj kooperanta</button>
      {selected && <button type="button" className={styles.actionBtnEdit} onClick={() => showModal(selected)}><Pencil size={14} /> Izmeni</button>}
    </div>}
    {query.isError && <div role="alert">{query.error.message} <button type="button" onClick={() => query.refetch()}>Pokušaj ponovo</button></div>}
    {open && <div className={styles.modalOverlay} onClick={() => !saving && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label={editing ? 'Izmeni kooperanta' : 'Dodaj kooperanta'} className={styles.modalBox} onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); void save(); } }}>
        <div className={styles.modalHeader}>
          <h3>{editing ? 'Izmeni kooperanta' : 'Dodaj kooperanta'}</h3>
          <button type="button" aria-label="Zatvori" disabled={saving} className={styles.modalCloseBtn} onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        <div className={styles.modalForm}>
          {error && <div role="alert" className={styles.errorBox}>{error}</div>}
          {(['code', 'name', 'phone', 'notes'] as const).map(key => <label key={key} className={styles.formGroup}>
            <span className={styles.formLabel}>{{ code: 'Šifra *', name: 'Naziv / Ime i prezime *', phone: 'Telefon', notes: 'Napomena' }[key]}</span>
            <input className={styles.formInput} value={form[key]} maxLength={key === 'code' ? 20 : key === 'name' ? 100 : key === 'phone' ? 50 : 500}
              onChange={event => setForm({ ...form, [key]: event.target.value })} />
          </label>)}
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} disabled={saving} onClick={() => setOpen(false)}>Otkaži</button>
            <button type="button" className={styles.btnSubmit} disabled={saving} onClick={save}>{saving ? 'Čuvanje...' : 'Sačuvaj'}</button>
          </div>
        </div>
      </div>
    </div>}
  </div>;
}
