import { useState } from 'react';
import { getCoverUrl } from '../../core/utils/image';

export default function CoverArt({ title, url, libraryId, bookId, className = '', width = 320 }: {
  title: string; url?: string; libraryId?: string; bookId?: string; className?: string; width?: number;
}) {
  const source = getCoverUrl(url, libraryId, bookId, width);
  const [failed, setFailed] = useState<string>();
  return <div className={'reader-cover ' + className}>
    <span className="reader-cover-fallback" aria-hidden="true">{title.slice(0, 4)}</span>
    {failed !== source && <img src={source} alt={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(source)} />}
  </div>;
}
