import { useEffect, useState } from 'react';

export interface GameSettings {
  sound: boolean;
  vibration: boolean;
  reducedMotion: boolean;
}

const defaults: GameSettings = {
  sound: true,
  vibration: true,
  reducedMotion: false,
};

export function readSettings(): GameSettings {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem('poker-settings') ?? '{}') as Partial<GameSettings>) };
  } catch {
    return defaults;
  }
}

export function useGameSettings(): [GameSettings, (next: GameSettings) => void] {
  const [settings, setSettings] = useState(readSettings);
  const update = (next: GameSettings) => {
    localStorage.setItem('poker-settings', JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('poker-settings', { detail: next }));
    setSettings(next);
  };
  useEffect(() => {
    const listener = (event: Event) => setSettings((event as CustomEvent<GameSettings>).detail);
    window.addEventListener('poker-settings', listener);
    return () => window.removeEventListener('poker-settings', listener);
  }, []);
  return [settings, update];
}

let audioContext: AudioContext | null = null;

export function playTone(kind: 'turn' | 'chip' | 'win'): void {
  if (!readSettings().sound) return;
  try {
    audioContext ??= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const frequencies = { turn: 720, chip: 420, win: 880 };
    oscillator.frequency.value = frequencies[kind];
    oscillator.type = kind === 'chip' ? 'triangle' : 'sine';
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + (kind === 'win' ? 0.32 : 0.14));
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + (kind === 'win' ? 0.34 : 0.16));
  } catch {
    // 浏览器未授权音频时保持静默。
  }
}

export function vibrate(pattern: number | number[]): void {
  if (readSettings().vibration && 'vibrate' in navigator) navigator.vibrate(pattern);
}
