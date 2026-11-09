import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { materialLabels, materialSearchOptions, materialSummary, materialUnits, parseMaterialDose, type MaterialKind, type MaterialProduct, type WorkMaterial } from '../lib/workMaterials';
import MaterialProductModal from './MaterialProductModal';
import { useDebouncedMaterialSearch } from '../lib/useDebouncedMaterialSearch';
import styles from './WorkMaterials.module.css';

export function MaterialSummary({ items }: { items?: WorkMaterial[] }) {
  return items?.length ? <div className={styles.summary}>{materialSummary(items)}</div> : null;
}

function MaterialDoseInput({ item, onChange }: { item: WorkMaterial; onChange: (value: number | null) => void }) {
  // Keep the typed decimal separator instead of replacing the text with a number on every keypress.
  const value = item.dosePerHa ?? null;
  const [draft, setDraft] = useState({ value, text: value === null ? '' : String(value) });
  const text = draft.value === value ? draft.text : value === null ? '' : String(value);
  return <input aria-label={`Doza za ${item.name}`} className={styles.input} type="text" inputMode="decimal" maxLength={32} placeholder="npr. 0,25"
    value={text} onChange={event => {
      const next = event.target.value;
      const parsed = parseMaterialDose(next);
      event.currentTarget.setCustomValidity(parsed.error);
      setDraft({ value: parsed.value, text: next });
      onChange(parsed.value);
    }} />;
}

export default function WorkMaterialsEditor({ kind, required = false, value = [], onChange, canManage = false }: {
  kind?: MaterialKind | null; required?: boolean; value?: WorkMaterial[]; onChange: (items: WorkMaterial[]) => void; canManage?: boolean;
}) {
  // A keyed child resets pending search and dialogs when switching operation kind.
  return kind ? <MaterialPicker key={kind} kind={kind} required={required} value={value} onChange={onChange} canManage={canManage} /> : null;
}

function MaterialPicker({ kind, required, value, onChange, canManage }: {
  kind: MaterialKind; required: boolean; value: WorkMaterial[]; onChange: (items: WorkMaterial[]) => void; canManage: boolean;
}) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedMaterialSearch(search);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [adding, setAdding] = useState(false);
  const listId = useId();
  const settled = debounced === search.trim();
  const enabled = debounced.replace(/[^\p{L}\p{N}]/gu, '').length >= 2;
  const query = useQuery(materialSearchOptions(kind, debounced, open));
  const items = settled ? (query.data?.items || []).filter(product => !value.some(item => item.kind === kind && item.productId === product.id)) : [];
  function choose(product: MaterialProduct) {
    if (value.length >= 20 || value.some(item => item.kind === kind && item.productId === product.id)) return;
    onChange([...value, { kind, productId: product.id, code: product.code, name: product.name, unit: product.unit, dosePerHa: null, notes: '' }]);
    setSearch(''); setOpen(false); setActive(-1);
  }
  function update(index: number, patch: Partial<WorkMaterial>) { onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item)); }

  return <section className={styles.editor} aria-label={materialLabels[kind]}>
    <div className={styles.heading}><div className={styles.sectionTitle}><h3>{materialLabels[kind]}</h3><span className={styles.optional}>{required ? 'Obavezno' : 'Opciono'}</span></div>
      {canManage && <button type="button" className={styles.button} onClick={() => setAdding(true)}><Plus size={14} /> Dodaj artikal</button>}
    </div>
    <label className={styles.searchLabel} htmlFor={`${listId}-input`}>Pretraga artikala</label>
    <input id={`${listId}-input`} className={styles.input} role="combobox" aria-autocomplete="list" aria-controls={`${listId}-results`} aria-expanded={open && items.length > 0}
      aria-activedescendant={open && active >= 0 && items[active] ? `${listId}-${active}` : undefined} autoComplete="off" placeholder="Počnite da kucate naziv ili šifru..." maxLength={120}
      value={search} disabled={value.length >= 20} onFocus={() => setOpen(true)} onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setOpen(false); }}
      onChange={event => { setSearch(event.target.value); setOpen(true); setActive(-1); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(previous => Math.max(0, Math.min(items.length - 1, previous + (event.key === 'ArrowDown' ? 1 : -1)))); }
        if (event.key === 'Enter') { event.preventDefault(); if (open && active >= 0 && items[active]) choose(items[active]); }
        if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
      }} />
    <p className={styles.hint}>Naziv, šifra{kind === 'CHEMICAL' ? ' ili aktivna materija' : kind === 'SEED' ? ', sorta ili proizvođač' : ''} · najmanje 2 znaka</p>
    {open && search.trim() && <div aria-live="polite">
      {(!enabled && settled) ? <p className={styles.hint}>Unesite bar 2 slova ili broja.</p> : (!settled || query.isFetching) ? <p className={styles.hint}>Pretraga...</p> : query.isError ?
        <p className={styles.error} role="alert">{query.error.message} <button type="button" className={styles.button} onClick={() => query.refetch()}>Pokušaj ponovo</button></p> : query.data && <>
          <div role="listbox" id={`${listId}-results`} aria-label="Rezultati pretrage" className={styles.results}>
            {items.map((product, index) => <button type="button" role="option" aria-selected={index === active} id={`${listId}-${index}`} key={product.id}
              className={`${styles.result} ${active === index ? styles.active : ''}`} onMouseDown={event => event.preventDefault()} onClick={() => choose(product)}>
              <strong>{product.name}</strong><span className={styles.hint}>{[product.code, product.variety, product.activeIngredient, product.manufacturer, materialUnits[product.unit] || product.unit].filter(Boolean).join(' · ')}</span>
            </button>)}
            {!items.length && <p className={styles.hint}>Nema novih rezultata. Promenite pretragu{canManage ? ' ili dodajte artikal' : ''}.</p>}
          </div>
          {query.data.hasMore && <p className={styles.hint}>Postoji još artikala. Precizirajte pretragu.</p>}
        </>}
    </div>}
    {value.map((item, index) => <div className={styles.row} key={`${item.kind}:${item.productId}`}>
      <div className={styles.productHeader}>
        <div className={styles.productIdentity}><strong>{item.name}</strong>{item.code && <span>{item.code}</span>}</div>
        <button type="button" className={`${styles.button} ${styles.removeButton}`} title="Ukloni artikal" aria-label={`Ukloni ${item.name}`} onClick={() => onChange(value.filter((_, i) => index !== i))}><Trash2 size={15} /></button>
      </div>
      <div className={styles.materialFields}>
        <label className={styles.materialField}><span>Doza <span className={styles.unit}>({materialUnits[item.unit] || item.unit}/ha)</span></span><MaterialDoseInput item={item} onChange={dosePerHa => update(index, { dosePerHa })} /></label>
        <label className={styles.materialField}><span>Napomena <span className={styles.unit}>(opciono)</span></span><textarea className={styles.input} rows={1} placeholder="Dodatna napomena za ovaj artikal" maxLength={500} value={item.notes || ''} onChange={event => update(index, { notes: event.target.value })} /></label>
      </div>
    </div>)}
    {!value.length && <p className={styles.hint}>{required ? 'Izaberite najmanje jedan artikal.' : 'Materijal nije izabran.'}</p>}
    {value.length >= 20 && <p className={styles.hint}>Izabrano je najviše dozvoljenih 20 artikala.</p>}
    {adding && <MaterialProductModal kind={kind} onClose={() => setAdding(false)} onSaved={choose} />}
  </section>;
}
