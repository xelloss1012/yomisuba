import React from 'react';

const inlinePattern = /(\*\*[\s\S]+?\*\*|__[\s\S]+?__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_|~~[^~]+~~|\[([^\]]+)\]\([^)]+\))/g;

const renderInline = (text: string, keyPrefix: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  inlinePattern.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = inlinePattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const content = token.startsWith('**') || token.startsWith('__')
      ? token.slice(2, -2)
      : token.startsWith('~~')
        ? token.slice(2, -2)
        : token.startsWith('*') || token.startsWith('_') || token.startsWith('`')
          ? token.slice(1, -1)
          : match[2];
    const key = `${keyPrefix}-${index}`;

    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{content}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{content}</del>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-zinc-200/70 px-1 py-0.5 font-mono text-[0.9em] dark:bg-zinc-700/70">
          {content}
        </code>
      );
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key}>{content}</em>);
    } else {
      nodes.push(content);
    }

    lastIndex = match.index + token.length;
    index += 1;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
};

interface Block {
  type: 'paragraph' | 'heading' | 'unordered-list' | 'ordered-list' | 'quote' | 'code';
  level?: number;
  lines: string[];
}

const parseBlocks = (markdown: string): Block[] => {
  const blocks: Block[] = [];
  let codeLines: string[] | null = null;

  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    if (line.trimStart().startsWith('```')) {
      if (codeLines) {
        blocks.push({ type: 'code', lines: codeLines });
        codeLines = null;
      } else {
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim() || /^\s*([-*_]\s*){3,}$/.test(line)) continue;

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, lines: [heading[2]] });
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'unordered-list') last.lines.push(unordered[1]);
      else blocks.push({ type: 'unordered-list', lines: [unordered[1]] });
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'ordered-list') last.lines.push(ordered[1]);
      else blocks.push({ type: 'ordered-list', lines: [ordered[1]] });
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      blocks.push({ type: 'quote', lines: [quote[1]] });
      continue;
    }

    const last = blocks[blocks.length - 1];
    if (last?.type === 'paragraph') last.lines.push(line.trim());
    else blocks.push({ type: 'paragraph', lines: [line.trim()] });
  }

  if (codeLines) blocks.push({ type: 'code', lines: codeLines });
  return blocks;
};

export const MarkdownContent: React.FC<{ content: string }> = ({ content }) => (
  <div className="space-y-2">
    {parseBlocks(content).map((block, index) => {
      const key = `block-${index}`;
      if (block.type === 'heading') {
        const className = block.level === 1
          ? 'text-base font-bold'
          : 'text-sm font-semibold';
        return (
          <div key={key} className={`${className} text-zinc-900 dark:text-zinc-100`}>
            {renderInline(block.lines[0], key)}
          </div>
        );
      }
      if (block.type === 'unordered-list' || block.type === 'ordered-list') {
        const List = block.type === 'unordered-list' ? 'ul' : 'ol';
        return (
          <List
            key={key}
            className={`space-y-1 pl-5 ${block.type === 'unordered-list' ? 'list-disc' : 'list-decimal'}`}
          >
            {block.lines.map((line, lineIndex) => (
              <li key={`${key}-${lineIndex}`} className="pl-0.5">
                {renderInline(line, `${key}-${lineIndex}`)}
              </li>
            ))}
          </List>
        );
      }
      if (block.type === 'quote') {
        return (
          <blockquote key={key} className="border-l-2 border-indigo-300 pl-3 text-zinc-600 dark:border-indigo-700 dark:text-zinc-300">
            {renderInline(block.lines[0], key)}
          </blockquote>
        );
      }
      if (block.type === 'code') {
        return (
          <pre key={key} className="overflow-x-auto rounded-lg bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-800">
            {block.lines.join('\n')}
          </pre>
        );
      }
      return (
        <p key={key}>
          {renderInline(block.lines.join(' '), key)}
        </p>
      );
    })}
  </div>
);
