import React from 'react';
import type { Book } from '../../core/types';
import { getCoverUrl } from '../../core/utils/image';
import { usePlayerStore } from '../../core/stores/playerStore';

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
export const VinylPlayerCover: React.FC<Props> = ({ book, isPlaying, preview, sizeClass, size }) => {
  // 缓冲中（还没有声音）：唱针先抬起来，等能出声再落下。
  const buffering = usePlayerStore((state) => state.isBuffering);
  const active = isPlaying && !buffering;
  return (
  <div
    className={`reader-vinyl ${sizeClass || ''} ${preview ? 'is-preview' : ''} ${active || preview ? 'is-playing' : ''}`}
    data-playing={active ? 'true' : 'false'}
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
        <circle className="reader-vinyl-pivot-ring" cx="60" cy="-4.2" r="3.9" />
        <circle className="reader-vinyl-pivot" cx="60" cy="-4.2" r="2.3" />
        <circle className="reader-vinyl-pivot-dot" cx="60" cy="-4.2" r="0.9" />
        <path className="reader-vinyl-rod" d="M60.3 -2 L65.0 16.2 Q 66.2 21.6 70.2 24.5" />
        <g transform="translate(75.2 28.1) rotate(36) scale(1.1)">
          <rect className="reader-vinyl-head" x="-5.9" y="-0.74" width="6.8" height="1.48" rx="0.5" />
          <rect className="reader-vinyl-head-slit" x="-1.9" y="-0.3" width="1.1" height="0.6" rx="0.3" />
          <rect className="reader-vinyl-head" x="0" y="-1.45" width="7.6" height="2.9" rx="1.2" />
          <rect className="reader-vinyl-head" x="6.9" y="-2.15" width="3.7" height="4.3" rx="1.1" />
          <rect className="reader-vinyl-head-slit" x="7.5" y="-1.25" width="2.5" height="0.4" rx="0.2" />
          <rect className="reader-vinyl-head-slit" x="7.1" y="0.55" width="2.5" height="0.4" rx="0.2" />
        </g>
      </g>
    </svg>
  </div>
  );
};

export default VinylPlayerCover;
