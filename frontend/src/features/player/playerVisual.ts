// 播放页的封面样式：默认的方形书封，或黑胶唱片（圆形封面 + 播放时落针）。
// 存在本机 localStorage：这是"这台设备看着顺眼"的偏好，不需要跨设备同步，
// 也不值得为它加一趟后端往返。
import React from 'react';

export type PlayerVisual = 'classic' | 'vinyl';

const STORAGE_KEY = 'ting-reader-player-visual';
const CHANGE_EVENT = 'ting-reader-player-visual-change';

export const readPlayerVisual = (): PlayerVisual => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'vinyl' ? 'vinyl' : 'classic';
  } catch {
    return 'classic';
  }
};

export const writePlayerVisual = (value: PlayerVisual) => {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 存不进去也照常生效，只是下次启动会回到默认。
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const PLAYER_VISUAL_OPTIONS: PlayerVisual[] = ['classic', 'vinyl'];

// 设置面板改完要立刻作用于播放页，所以用一个轻量的订阅事件把两端接起来。
export const usePlayerVisual = (): PlayerVisual => {
  const [visual, setVisual] = React.useState<PlayerVisual>(readPlayerVisual);
  React.useEffect(() => {
    const sync = () => setVisual(readPlayerVisual());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);
  return visual;
};
