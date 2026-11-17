import React from 'react';
import type { Book } from '../../core/types';
import { getCoverUrl } from '../../core/utils/image';

interface Props {
  book: Book | null | undefined;
  // 播放时唱针落在盘上，暂停时抬起来。
  isPlaying: boolean;
  // 设置面板里的示意：不带交互，持续演示落针与转盘，方便对比两种效果。
  preview?: boolean;
  sizeClass?: string;
  // 固定边长（px）。设置面板里的示意卡要的是一个小不点，按容器宽度自动撑开会把卡撑破。
  size?: number;
}

const PlayerCoverImage: React.FC<{ book: Book | null | undefined }> = ({ book }) => {
  const [failedUrl, setFailedUrl] = React.useState<string>();
  const url = getCoverUrl(book?.cover_url, book?.library_id, book?.id, 640);
  if (failedUrl === url) {
    return <div className="w-full h-full bg-slate-700" role="img" aria-label={book?.title} />;
  }
  return (
    <img
      src={url}
      alt={book?.title}
      referrerPolicy="no-referrer"
      className="reader-vinyl-art"
      onError={() => setFailedUrl(url)}
    />
  );
};

// ─── VinylPlayerCover ──────────────────────────────────────────────────────
// 一台唱机：盘子外面套一圈半透明的光晕，封面占盘的七成，几乎没有留白的唱片中心。
// 枢轴是盘外正上方的一颗白点，白杆先往下、再顺势斜到盘的右上缘，末端是一块斜放的圆角针头；
// 暂停时整根抬起来往右上一摆，针就离开盘面。
export const VinylPlayerCover: React.FC<Props> = ({ book, isPlaying, preview, sizeClass, size }) => (
  <div
    className={`reader-vinyl ${sizeClass || ''} ${preview ? 'is-preview' : ''} ${isPlaying || preview ? 'is-playing' : ''}`}
    data-playing={isPlaying ? 'true' : 'false'}
    style={size ? { width: size, height: size, flex: 'none' } : undefined}
  >
    <div className="reader-vinyl-disc">
      <div className="reader-vinyl-spin">
        <div className="reader-vinyl-grooves" />
        <div className="reader-vinyl-label">
          <PlayerCoverImage book={book} />
        </div>
        <div className="reader-vinyl-hole" />
      </div>
      <div className="reader-vinyl-gloss" aria-hidden="true" />
    </div>
    <svg className="reader-vinyl-tonearm" viewBox="0 0 120 120" aria-hidden="true">
      <g className="reader-vinyl-arm">
        <circle className="reader-vinyl-pivot-ring" cx="60" cy="9" r="5.4" />
        <circle className="reader-vinyl-pivot" cx="60" cy="9" r="3.5" />
        <path className="reader-vinyl-rod" d="M60 11.5 C 61.5 21, 65 29, 72 34.2" />
        <g transform="rotate(48 72 34.2)">
          <rect className="reader-vinyl-head" x="71" y="32.2" width="10" height="4" rx="1.5" />
        </g>
      </g>
    </svg>
  </div>
);

export default VinylPlayerCover;
