import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';

interface Props {
  /** Cover stored locally as a Blob (recent books). */
  cover?: Blob;
  /** Cover already encoded as a URL or data URL (Google Drive books). */
  src?: string;
  title: string;
}

export const BookCoverThumbnail: React.FC<Props> = ({ cover, src, title }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!cover) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(cover);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  const resolved = src || objectUrl;

  return (
    <span className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
      {resolved ? (
        <img src={resolved} alt={`Portada de ${title}`} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-indigo-600 dark:text-indigo-400">
          <BookOpen className="h-4 w-4" />
        </span>
      )}
    </span>
  );
};
