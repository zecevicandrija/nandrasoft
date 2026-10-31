type Props = { error: Error; onRetry: () => void; pending?: boolean; title?: string };

export default function QueryErrorNotice({ error, onRetry, pending, title = 'Podaci nisu učitani.' }: Props) {
  return (
    <div role="alert" style={{ padding: '1rem', marginBlock: '1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem' }}>
      <strong>{title}</strong>
      <p>{error.message}</p>
      <button type="button" onClick={onRetry} disabled={pending}>
        {pending ? 'Učitavanje…' : 'Pokušaj ponovo'}
      </button>
    </div>
  );
}
