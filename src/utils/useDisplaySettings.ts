import { useCallback, useEffect, useState } from 'react';

const FONT_SCALE_STORAGE_KEY = 'lexisync_ielts_font_scale_v1';
export const FONT_SCALE_STEPS = [90, 100, 110, 120, 130, 140, 150];

export function useDisplaySettings() {
  const [fontScale, setFontScale] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (Number.isFinite(parsed) && parsed >= 80 && parsed <= 160) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return 100;
  });

  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return Boolean(
      document.fullscreenElement ||
        (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement
    );
  });

  // Apply font scale to document.documentElement
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.fontSize = `${fontScale}%`;
    document.documentElement.setAttribute('data-font-scale', String(fontScale));
    try {
      localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(fontScale));
    } catch {
      // ignore
    }
  }, [fontScale]);

  // Fullscreen change listener
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleFullscreenChange = () => {
      setIsFullscreen(
        Boolean(
          document.fullscreenElement ||
            (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement
        )
      );
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    try {
      const isCurrentlyFull = Boolean(
        document.fullscreenElement ||
          (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement
      );

      if (!isCurrentlyFull) {
        const elem = document.documentElement as unknown as {
          requestFullscreen?: () => Promise<void>;
          webkitRequestFullscreen?: () => Promise<void>;
          msRequestFullscreen?: () => Promise<void>;
        };
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
          await elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) {
          await elem.msRequestFullscreen();
        }
      } else {
        const doc = document as unknown as {
          exitFullscreen?: () => Promise<void>;
          webkitExitFullscreen?: () => Promise<void>;
          msExitFullscreen?: () => Promise<void>;
        };
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
    }
  }, []);

  const increaseFont = useCallback(() => {
    setFontScale((prev) => {
      const next = FONT_SCALE_STEPS.find((s) => s > prev);
      return next ?? prev;
    });
  }, []);

  const decreaseFont = useCallback(() => {
    setFontScale((prev) => {
      const prevStep = [...FONT_SCALE_STEPS].reverse().find((s) => s < prev);
      return prevStep ?? prev;
    });
  }, []);

  const resetFont = useCallback(() => {
    setFontScale(100);
  }, []);

  return {
    fontScale,
    setFontScale,
    increaseFont,
    decreaseFont,
    resetFont,
    isFullscreen,
    toggleFullscreen,
  };
}
