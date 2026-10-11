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

export function formatChapterPageDisplay(
  chapterPage: number,
  chapterTotalPages: number,
  paginationMode: 'device' | 'printed' | 'percent',
  printedPages?: number,
  bookTotalPages?: number
): string {
  const cTotal = Math.max(1, chapterTotalPages);
  const cPage = Math.min(Math.max(0, chapterPage), cTotal - 1);
  const percent = Math.round(((cPage + 1) / cTotal) * 100);

  if (paginationMode === 'printed') {
    const bTotal = Math.max(1, bookTotalPages || cTotal);
    const pTotal = printedPages && printedPages > 0 ? printedPages : cTotal;
    const approxChapPrintedTotal = Math.max(1, Math.round((cTotal / bTotal) * pTotal));
    const approxChapPrintedPage = Math.max(1, Math.min(approxChapPrintedTotal, Math.round((cPage / Math.max(1, cTotal - 1)) * (approxChapPrintedTotal - 1)) + 1));
    return `Pág. ${approxChapPrintedPage} de ${approxChapPrintedTotal} del capítulo`;
  }
  if (paginationMode === 'percent') {
    return `${percent}% del capítulo`;
  }
  return `Página ${cPage + 1} de ${cTotal} del capítulo`;
}
