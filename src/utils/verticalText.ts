const VERTICAL_TEXT_PATTERN = /([…⋯︙!?！？‼⁇⁉]+|[0-9]+)/g;
const HAS_VERTICAL_TEXT_PATTERN = /[…⋯︙!?！？‼⁇⁉0-9]/;
const VERTICAL_PUNCTUATION_PATTERN = /^[…⋯︙!?！？‼⁇⁉]+$/;
const VERTICAL_NUMBER_PATTERN = /^[0-9]+$/;

export const wrapVerticalText = (doc: Document) => {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (
      node.parentElement?.closest(
        'style, script, .vertical-punctuation, .vertical-number, .tate-chu-yoko, [class*="tcy"], [class*="tate-ch"]'
      )
    ) continue;
    if (HAS_VERTICAL_TEXT_PATTERN.test(node.nodeValue || '')) {
      textNodes.push(node as Text);
    }
  }
  textNodes.forEach((textNode) => {
    const parts = (textNode.nodeValue || '').split(VERTICAL_TEXT_PATTERN);
    const fragment = doc.createDocumentFragment();
    parts.forEach((part) => {
      if (!part) return;
      if (VERTICAL_PUNCTUATION_PATTERN.test(part) || VERTICAL_NUMBER_PATTERN.test(part)) {
        const span = doc.createElement('span');
        span.className = VERTICAL_PUNCTUATION_PATTERN.test(part)
          ? 'vertical-punctuation'
          : 'vertical-number';
        span.textContent = part;
        fragment.appendChild(span);
      } else {
        fragment.appendChild(doc.createTextNode(part));
      }
    });
    textNode.parentNode?.replaceChild(fragment, textNode);
  });
};
