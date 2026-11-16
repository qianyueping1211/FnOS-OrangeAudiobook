// 播放页样式选择器：方形书封 / 黑胶唱片。
// 播放器的设置弹窗和「个性化设置」共用这一份，改完立刻生效（写 localStorage
// 后广播事件，播放页订阅同一份偏好）。
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Disc3, Square } from 'lucide-react';
import type { Book } from '../../core/types';
import { getCoverUrl } from '../../core/utils/image';
import { VinylPlayerCover } from '../../features/player/VinylPlayerCover';
import { PLAYER_VISUAL_OPTIONS, type PlayerVisual } from '../../features/player/playerVisual';

const PlayStylePicker: React.FC<{
  visual: PlayerVisual;
  onChangeVisual: (value: PlayerVisual) => void;
  coverBook?: Book | null;
}> = ({ visual, onChangeVisual, coverBook }) => {
  const { t } = useTranslation();
  const cover = getCoverUrl(coverBook?.cover_url, coverBook?.library_id, coverBook?.id, 320);
  const optionClass = (active: boolean) =>
    `relative flex flex-col items-center gap-2 rounded-2xl border px-2 pb-3 pt-2 transition-colors ${
      active
        ? 'border-primary-500 bg-primary-500/10'
        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
    }`;
  return (
    <div className="grid grid-cols-2 gap-3">
      {PLAYER_VISUAL_OPTIONS.map(option => (
        <button
          key={option}
          type="button"
          onClick={() => onChangeVisual(option)}
          aria-pressed={visual === option}
          className={optionClass(visual === option)}
        >
          <div className="flex h-[132px] w-full items-center justify-center">
            {option === 'vinyl' ? (
              <VinylPlayerCover book={coverBook} isPlaying preview size={126} />
            ) : (
              <div className="h-[72px] w-[54px] overflow-hidden rounded-lg shadow-md bg-slate-200 dark:bg-slate-800">
                {coverBook ? (
                  <img src={cover} alt={coverBook.title} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-400">
                    <Square size={18} />
                  </div>
                )}
              </div>
            )}
          </div>
          <span className="flex items-center gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
            {option === 'vinyl' ? <Disc3 size={13} /> : <Square size={13} />}
            {option === 'vinyl' ? t('player.playStyleVinyl') : t('player.playStyleClassic')}
          </span>
          {visual === option && (
            <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-white">
              <Check size={12} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

export default PlayStylePicker;
