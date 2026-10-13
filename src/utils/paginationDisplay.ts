import { t, UiLanguage } from './i18n';

export function formatPageDisplay(
  globalPage: number,
  bookTotalPages: number,
  paginationMode: 'device' | 'printed' | 'percent',
  printedPages?: number,
  language: UiLanguage = 'es'
): string {
  const safeTotal = Math.max(1, bookTotalPages);
  const safeGlobal = Math.min(Math.max(0, globalPage), safeTotal - 1);
  const percent = Math.round(((safeGlobal + 1) / safeTotal) * 100);

  if (paginationMode === 'printed' && printedPages && printedPages > 0) {
    const pPages = Math.max(1, printedPages);
    const progress = safeTotal <= 1 ? 0 : safeGlobal / (safeTotal - 1);
    const pPage = Math.max(1, Math.min(pPages, Math.round(progress * (pPages - 1)) + 1));
    return `${t('pagination.pageShort', language)} ${pPage} ${t('pagination.of', language)} ${pPages} (${percent}%)`;
  }
  if (paginationMode === 'percent') {
    return `${percent}%`;
  }
  return `${t('pagination.page', language)} ${safeGlobal + 1} ${t('pagination.of', language)} ${safeTotal} (${percent}%)`;
}

export function formatChapterPageDisplay(
  chapterPage: number,
  chapterTotalPages: number,
  paginationMode: 'device' | 'printed' | 'percent',
  printedPages?: number,
  bookTotalPages?: number,
  language: UiLanguage = 'es',
  chapterName?: string
): string {
  const cTotal = Math.max(1, chapterTotalPages);
  const cPage = Math.min(Math.max(0, chapterPage), cTotal - 1);
  const percent = Math.round(((cPage + 1) / cTotal) * 100);

  if (chapterName) {
    const template = t('pagination.pageOfChapterName', language);
    let result = template
      .replace('{page}', (cPage + 1).toString())
      .replace('{total}', cTotal.toString())
      .replace('{chapter}', chapterName);
    
    if (paginationMode === 'printed') {
       const bTotal = Math.max(1, bookTotalPages || cTotal);
       const pTotal = printedPages && printedPages > 0 ? printedPages : cTotal;
       const approxChapPrintedTotal = Math.max(1, Math.round((cTotal / bTotal) * pTotal));
       const approxChapPrintedPage = Math.max(1, Math.min(approxChapPrintedTotal, Math.round((cPage / Math.max(1, cTotal - 1)) * (approxChapPrintedTotal - 1)) + 1));
       result = template
         .replace('{page}', approxChapPrintedPage.toString())
         .replace('{total}', approxChapPrintedTotal.toString())
         .replace('{chapter}', chapterName);
    } else if (paginationMode === 'percent') {
      return `${percent}% ${t('pagination.ofChapter', language)} ${chapterName}`;
    }
    return result;
  }

  if (paginationMode === 'printed') {
    const bTotal = Math.max(1, bookTotalPages || cTotal);
    const pTotal = printedPages && printedPages > 0 ? printedPages : cTotal;
    const approxChapPrintedTotal = Math.max(1, Math.round((cTotal / bTotal) * pTotal));
    const approxChapPrintedPage = Math.max(1, Math.min(approxChapPrintedTotal, Math.round((cPage / Math.max(1, cTotal - 1)) * (approxChapPrintedTotal - 1)) + 1));
    return `${t('pagination.pageShort', language)} ${approxChapPrintedPage} ${t('pagination.of', language)} ${approxChapPrintedTotal} ${t('pagination.ofChapter', language)}`;
  }
  if (paginationMode === 'percent') {
    return `${percent}% ${t('pagination.ofChapter', language)}`;
  }
  return `${t('pagination.page', language)} ${cPage + 1} ${t('pagination.of', language)} ${cTotal} ${t('pagination.ofChapter', language)}`;
}
