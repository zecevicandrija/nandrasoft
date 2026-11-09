import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { materialRequest, materialUnits, type MaterialKind, type MaterialProduct, type MaterialCatalogueResponse } from '../lib/workMaterials';
import { useDebouncedMaterialSearch } from '../lib/useDebouncedMaterialSearch';
import MaterialProductModal from '../components/MaterialProductModal';
import TablePagination from '../components/TablePagination/TablePagination';
import styles from '../components/WorkMaterials.module.css';

const PAGE_SIZE = 10;

export default function MaterialCatalogue({ kind, canManage = false }: { kind: Extract<MaterialKind, 'CHEMICAL' | 'SEED'>; canManage?: boolean }) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedMaterialSearch(search);
  return (
    <section className={styles.catalogue}>
      <input
        className={styles.input}
        aria-label="Pretraga šifarnika materijala"
        placeholder="Pretražite naziv, šifru, sortu ili aktivnu materiju..."
        maxLength={120}
        value={search}
        onChange={event => setSearch(event.target.value)}
      />
      <CataloguePage key={`${kind}:${debounced}`} kind={kind} search={debounced} pending={search.trim() !== debounced} canManage={canManage} />
    </section>
  );
}

function CataloguePage({ kind, search, pending, canManage }: { kind: 'CHEMICAL' | 'SEED'; search: string; pending: boolean; canManage: boolean }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<MaterialProduct | 'new' | null>(null);
  const [error, setError] = useState('');
  const [archiving, setArchiving] = useState(false);
  const validSearch = !search || search.replace(/[^\p{L}\p{N}]/gu, '').length >= 2;

  const query = useQuery({
    queryKey: ['material-catalogue', kind, search, page],
    queryFn: ({ signal }) =>
      materialRequest<MaterialCatalogueResponse>(
        `/materials/catalogue/${kind}?limit=${PAGE_SIZE}&page=${page}&q=${encodeURIComponent(search)}`,
        signal
      ),
    enabled: validSearch && !pending,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (query.data?.totalPages && page > query.data.totalPages) {
      setPage(query.data.totalPages);
    }
  }, [query.data?.totalPages, page]);

  async function archive(product: MaterialProduct) {
    if (archiving || !window.confirm(`Arhivirati artikal „${product.name}”? Postojeći nalozi i radovi ostaju sačuvani.`)) return;
    setArchiving(true);
    setError('');
    try {
      await materialRequest(`/materials/catalogue/${kind}/${product.id}`, undefined, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });
      if (query.data?.items.length === 1 && page > 1) {
        setPage(p => p - 1);
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ['material-catalogue', kind] }),
        client.invalidateQueries({ queryKey: ['material-search', kind] }),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Arhiviranje nije uspelo.');
    } finally {
      setArchiving(false);
    }
  }

  const itemName = kind === 'SEED' ? 'semena' : 'preparata';

  return (
    <>
      <div className={styles.toolbar}>
        <p className={styles.hint}>
          Prikaz {PAGE_SIZE} artikala po stranici. Pretraga radi po nazivu, šifri, sorti ili aktivnoj materiji.
        </p>
        {canManage && (
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => setModal('new')}>
            <Plus size={16} /> Dodaj artikal
          </button>
        )}
      </div>

      {error && <p role="alert" className={styles.error}>{error}</p>}
      {query.isError && (
        <p role="alert" className={styles.error}>
          {query.error.message} <button type="button" className={styles.button} onClick={() => query.refetch()}>Pokušaj ponovo</button>
        </p>
      )}

      {!validSearch ? (
        <p>Unesite bar 2 slova ili broja.</p>
      ) : pending || query.isPending ? (
        <p role="status">Učitavanje...</p>
      ) : !query.isError && (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Šifra</th>
                <th>Naziv</th>
                <th>{kind === 'CHEMICAL' ? 'Aktivna materija' : 'Kultura / sorta / proizvođač'}</th>
                <th>Jedinica</th>
                <th>Napomena</th>
                <th>Akcije</th>
              </tr>
            </thead>
            <tbody>
              {!query.data?.items.length && (
                <tr>
                  <td colSpan={6}>Nema artikala za prikaz.</td>
                </tr>
              )}
              {query.data?.items.map(product => (
                <tr key={product.id}>
                  <td>{product.code}</td>
                  <td><strong>{product.name}</strong></td>
                  <td>
                    {kind === 'CHEMICAL'
                      ? product.activeIngredient || '—'
                      : [product.crop, product.variety, product.manufacturer].filter(Boolean).join(' / ')}
                  </td>
                  <td>{materialUnits[product.unit] || product.unit}</td>
                  <td>{product.notes || '—'}</td>
                  <td>
                    {canManage && (
                      <div className={styles.toolbar}>
                        <button type="button" className={styles.button} onClick={() => setModal(product)}>
                          <Pencil size={14} /> Izmeni
                        </button>
                        <button type="button" className={styles.button} disabled={archiving} onClick={() => archive(product)}>
                          Arhiviraj
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!query.isPending && !query.isError && (query.data?.totalItems ?? 0) > 0 && (
        <TablePagination
          currentPage={page}
          totalPages={query.data?.totalPages || 1}
          totalItems={query.data?.totalItems || 0}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          itemName={itemName}
        />
      )}

      {modal && (
        <MaterialProductModal
          kind={kind}
          product={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            client.invalidateQueries({ queryKey: ['material-catalogue', kind] });
          }}
        />
      )}
    </>
  );
}
