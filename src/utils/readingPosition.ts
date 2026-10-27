export interface ReadingPositionAnchor {
  page: number;
  pageCount?: number;
  textOffset?: number;
}

export const mapPageToLayout = (
  page: number,
  savedPageCount: number | undefined,
  currentPageCount: number,
) => {
  if (!savedPageCount || savedPageCount <= 1 || currentPageCount <= 1) return page;
  const progress = Math.min(1, Math.max(0, page / (savedPageCount - 1)));
  return Math.round(progress * (currentPageCount - 1));
};

export const resolveReadingPage = (
  position: ReadingPositionAnchor,
  currentPageCount: number,
  locateTextOffset: (offset: number) => number | null,
) => {
  const anchoredPage = position.textOffset === undefined
    ? null
    : locateTextOffset(position.textOffset);
  const page = anchoredPage ?? mapPageToLayout(
    position.page,
    position.pageCount,
    currentPageCount,
  );
  return Math.min(Math.max(0, page), Math.max(0, currentPageCount - 1));
};
