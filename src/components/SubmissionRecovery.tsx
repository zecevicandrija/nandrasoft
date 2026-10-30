type Props = { pending: boolean; busy: boolean; error?: string; onRetry: () => void };

export default function SubmissionRecovery({ pending, busy, error, onRetry }: Props) {
  if (!pending && !error) return null;
  return <div role="status" style={{ padding: '0.75rem', margin: '0.75rem 0', border: '1px solid #d97706', borderRadius: 6 }}>
    {error && <p>{error}</p>}
    {pending && <>
      <p>Prethodno slanje još nije potvrđeno. Sačuvani zahtev možete bezbedno ponoviti; nove izmene obrasca se ovim dugmetom ne šalju.</p>
      <button type="button" disabled={busy} onClick={onRetry}>{busy ? 'Provera…' : 'Ponovi prethodno slanje'}</button>
    </>}
  </div>;
}
