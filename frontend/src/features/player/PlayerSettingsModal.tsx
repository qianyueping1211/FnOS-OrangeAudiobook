import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Disc3, SkipBack, SkipForward, Square, X } from 'lucide-react';
import type { Book } from '../../core/types';
import { getCoverUrl } from '../../core/utils/image';
import { VinylPlayerCover } from './VinylPlayerCover';
import { PLAYER_VISUAL_OPTIONS, type PlayerVisual } from './playerVisual';

interface Props {
  editSkipIntro: number;
  editSkipOutro: number;
  onChangeSkipIntro: (value: number) => void;
  onChangeSkipOutro: (value: number) => void;
  volume: number;
  onChangeVolume: (value: number) => void;
  visual: PlayerVisual;
  onChangeVisual: (value: PlayerVisual) => void;
  coverBook?: Book | null;
  onClose: () => void;
  onSave: () => void;
}

// ─── PlayStylePicker ───────────────────────────────────────────────────────
// 两种播放页样式各给一张能看懂的示意卡：左边是现在的方形书封，右边是黑胶
// 唱片（预览里转盘一直在转、唱针反复起落，不用点进去也能看出区别）。
const PlayStylePicker: React.FC<{
  visual: PlayerVisual;
  onChangeVisual: (value: PlayerVisual) => void;
  coverBook?: Book | null;
  labelClassic: string;
  labelVinyl: string;
}> = ({ visual, onChangeVisual, coverBook, labelClassic, labelVinyl }) => {
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
                <img src={cover} alt={coverBook?.title} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              </div>
            )}
          </div>
          <span className="flex items-center gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
            {option === 'vinyl' ? <Disc3 size={13} /> : <Square size={13} />}
            {option === 'vinyl' ? labelVinyl : labelClassic}
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

const PlayerSettingsModal: React.FC<Props> = ({
  editSkipIntro,
  editSkipOutro,
  onChangeSkipIntro,
  onChangeSkipOutro,
  volume,
  onChangeVolume,
  visual,
  onChangeVisual,
  coverBook,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="max-h-[86vh] overflow-y-auto p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t('player.settings')}</h3>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
              <X size={20} className="text-slate-400" />
            </button>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {t('player.playStyle')}
              </label>
              <PlayStylePicker
                visual={visual}
                onChangeVisual={onChangeVisual}
                coverBook={coverBook}
                labelClassic={t('player.playStyleClassic')}
                labelVinyl={t('player.playStyleVinyl')}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <SkipBack size={14} />
                {t('player.skipIntro')}
              </label>
              <input
                type="number"
                value={editSkipIntro}
                onChange={e => onChangeSkipIntro(parseInt(e.target.value) || 0)}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                placeholder={t('player.secondsExample', { seconds: 30 })}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <SkipForward size={14} />
                {t('player.skipOutro')}
              </label>
              <input
                type="number"
                value={editSkipOutro}
                onChange={e => onChangeSkipOutro(parseInt(e.target.value) || 0)}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                placeholder={t('player.secondsExample', { seconds: 15 })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500"><label>{t('player.volume')}</label><span className="tabular-nums">{Math.round(volume * 100)}%</span></div>
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => onChangeVolume(Number(event.target.value))} className="w-full accent-primary-600" aria-label={t('player.volume')} />
            </div>
          </div>

          <div className="mt-8 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3.5 font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={onSave}
              className="flex-1 py-3.5 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-2xl shadow-lg shadow-primary-500/30 flex items-center justify-center gap-2 transition-all"
            >
              <Check size={20} />
              {t('mine.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerSettingsModal;
