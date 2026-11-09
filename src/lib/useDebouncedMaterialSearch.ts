import { useEffect, useState } from 'react';

export function useDebouncedMaterialSearch(search: string) {
  const [settled, setSettled] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSettled(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  return settled;
}
