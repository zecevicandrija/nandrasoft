import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { materialLabels, materialRequest, materialUnits, type MaterialKind, type MaterialProduct } from '../lib/workMaterials';
import styles from './WorkMaterials.module.css';

export default function MaterialProductModal({ kind, product, onClose, onSaved }: {
  kind: MaterialKind; product?: MaterialProduct | null; onClose: () => void; onSaved: (product: MaterialProduct) => void;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState({ code: product?.code || '', name: product?.name || '', unit: product?.unit || (kind === 'SEED' ? 'SEME' : kind === 'CHEMICAL' ? 'L' : 'KG'),
    type: 'MINERALNO_GRANULISANO', activeIngredient: product?.activeIngredient || '', crop: product?.crop || 'Luk', variety: product?.variety || '', manufacturer: product?.manufacturer || '', notes: product?.notes || '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  async function save() {
    if (pending.current) return;
    pending.current = true; setSaving(true); setError('');
    try {
      const fertilizer = kind === 'FERTILIZER';
      const data = await materialRequest<{ product: MaterialProduct }>(fertilizer ? '/fertilizer/products' : `/materials/catalogue/${kind}${product ? `/${product.id}` : ''}`, undefined, {
        method: product ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fertilizer ? { name: form.name.trim(), unit: form.unit, type: form.type, description: form.notes || null } : form),
      });
      await Promise.all([client.invalidateQueries({ queryKey: ['material-search', kind] }), client.invalidateQueries({ queryKey: ['material-catalogue', kind] }),
        ...(fertilizer ? [client.invalidateQueries({ queryKey: ['fertilizer-products'] })] : [])]);
      onSaved(data.product);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Čuvanje nije uspelo.'); }
    finally { pending.current = false; setSaving(false); }
  }
  const textField = (key: 'code' | 'name' | 'activeIngredient' | 'crop' | 'variety' | 'manufacturer' | 'notes', label: string, maxLength: number, required = false) =>
    <label key={key}>{label}<input autoFocus={key === (kind === 'FERTILIZER' ? 'name' : 'code')} className={styles.input} required={required} minLength={key === 'name' ? 2 : undefined} maxLength={maxLength}
      value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>;

  return createPortal(<div className={styles.overlay} onClick={() => !saving && onClose()}>
    <div role="dialog" aria-modal="true" aria-label={product ? 'Izmeni artikal' : 'Dodaj artikal'} className={styles.modal} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape' && !saving) { event.stopPropagation(); onClose(); } }}>
      <div className={styles.heading}><h3>{product ? 'Izmeni' : 'Dodaj'}: {materialLabels[kind]}</h3><button className={styles.button} type="button" aria-label="Zatvori" disabled={saving} onClick={onClose}><X size={16} /></button></div>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save(); }}>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {kind !== 'FERTILIZER' && textField('code', 'Šifra *', 40, true)}
        {textField('name', 'Naziv *', kind === 'FERTILIZER' ? 120 : 160, true)}
        {kind === 'FERTILIZER' && <label>Tip đubriva<select className={styles.select} value={form.type} onChange={event => setForm({ ...form, type: event.target.value })}>
          <option value="MINERALNO_GRANULISANO">Mineralno granulisano</option><option value="VODOTOPIVO_FERTIRIGACIJA">Vodotopivo / fertirigacija</option><option value="TECNI_BIOSTIMULATOR">Tečni biostimulator</option><option value="ORGANSKO_PELETIRANO">Organsko peletirano</option>
        </select></label>}
        {kind === 'CHEMICAL' && textField('activeIngredient', 'Aktivna materija', 200)}
        {kind === 'SEED' && <>{textField('crop', 'Kultura *', 100, true)}{textField('variety', 'Sorta / hibrid', 100)}{textField('manufacturer', 'Proizvođač', 100)}</>}
        <label>Jedinica mere *<select className={styles.select} value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value })}>
          {(kind === 'FERTILIZER' ? ['KG', 'L', 'TONA'] : ['KG', 'L', 'G', 'ML', 'SEME', 'PAKOVANJE', 'KOM', 'SJ']).map(unit => <option key={unit} value={unit}>{materialUnits[unit] || unit}</option>)}
        </select></label>
        {textField('notes', 'Napomena', 500)}
        <div className={styles.toolbar}><button type="button" className={styles.button} onClick={onClose} disabled={saving}>Otkaži</button><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={saving}>{saving ? 'Čuvanje...' : 'Sačuvaj'}</button></div>
      </form>
    </div>
  </div>, document.body);
}
