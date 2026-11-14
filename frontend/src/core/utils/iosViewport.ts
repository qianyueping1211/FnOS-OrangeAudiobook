const isAppleTouchDevice = () => {
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export function installIOSViewportGuards() {
  if (!isAppleTouchDevice()) return;
  document.documentElement.classList.add('reader-ios');
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport) viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

  const preventGesture = (event: Event) => event.preventDefault();
  const preventMultiTouch = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault();
  };
  document.addEventListener('gesturestart', preventGesture, { passive: false, capture: true });
  document.addEventListener('gesturechange', preventGesture, { passive: false, capture: true });
  document.addEventListener('touchstart', preventMultiTouch, { passive: false, capture: true });
  document.addEventListener('touchmove', preventMultiTouch, { passive: false, capture: true });
}
