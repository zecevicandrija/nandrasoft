// Explicit user refresh: never silently replace the version accompanying an
// already entered measurement or a saved/retried submission.
export async function refreshMachineFuel(machineId: string) {
  const res = await fetch('http://localhost:5000/api/master/machines', { credentials: 'include' });
  if (!res.ok) throw new Error('Stanje mašine trenutno nije dostupno. Pokušajte ponovo.');
  const data = await res.json();
  const machine = data.machines?.find((item: { id: string }) => item.id === machineId);
  if (!machine?.updatedAt) throw new Error('Mašina nije pronađena. Osvežite podatke.');
  return machine;
}
