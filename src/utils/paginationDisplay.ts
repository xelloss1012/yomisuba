export function formatPageDisplay(
  globalPage: number,
  bookTotalPages: number,
  paginationMode: 'device' | 'printed' | 'percent',
  printedPages?: number
): string {
  const safeTotal = Math.max(1, bookTotalPages);
  const safeGlobal = Math.min(Math.max(0, globalPage), safeTotal - 1);
  const percent = Math.round(((safeGlobal + 1) / safeTotal) * 100);

  if (paginationMode === 'printed' && printedPages && printedPages > 0) {
    const pPages = Math.max(1, printedPages);
    const progress = safeTotal <= 1 ? 0 : safeGlobal / (safeTotal - 1);
    const pPage = Math.max(1, Math.min(pPages, Math.round(progress * (pPages - 1)) + 1));
    return `Pág. ${pPage} de ${pPages} (${percent}%)`;
  }
  if (paginationMode === 'percent') {
    return `${percent}%`;
  }
  return `Página ${safeGlobal + 1} de ${safeTotal} (${percent}%)`;
}
