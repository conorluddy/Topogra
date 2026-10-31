import * as THREE from 'three';
import { isSoundMuted } from '../sound-preference';

let hurlSlap: HTMLAudioElement | undefined;

/** The ash-on-leather crack of a strike; `strength` 0–1 makes harder strikes ring louder. */
export function playHurlSlap(strength: number): void {
  if (isSoundMuted()) {
    return;
  }

  hurlSlap ??= new Audio(`${import.meta.env.BASE_URL}audio/hurl-slap.mp3`);
  hurlSlap.currentTime = 0;
  hurlSlap.volume = THREE.MathUtils.lerp(0.4, 1, strength);
  // Autoplay refusals are harmless: the strike still flies.
  hurlSlap.play().catch(() => undefined);
}
