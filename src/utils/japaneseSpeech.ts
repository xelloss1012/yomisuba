import { Capacitor, registerPlugin } from '@capacitor/core';

interface JapaneseTtsPlugin {
  speak(options: { text: string; rate: number }): Promise<void>;
}

const JapaneseTts = registerPlugin<JapaneseTtsPlugin>('JapaneseTts');

const getJapaneseVoice = (): Promise<SpeechSynthesisVoice | undefined> => {
  const synthesis = window.speechSynthesis;
  const currentVoices = synthesis.getVoices();
  const japaneseVoice = currentVoices.find((voice) => voice.lang.toLowerCase().startsWith('ja'));
  if (japaneseVoice || currentVoices.length > 0) return Promise.resolve(japaneseVoice);

  return new Promise((resolve) => {
    let timeout = 0;
    const finish = () => {
      window.clearTimeout(timeout);
      synthesis.removeEventListener('voiceschanged', finish);
      resolve(synthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('ja')));
    };
    synthesis.addEventListener('voiceschanged', finish, { once: true });
    timeout = window.setTimeout(finish, 1000);
  });
};

export const speakJapanese = async (text: string): Promise<void> => {
  const spokenText = text.trim();
  if (!spokenText) throw new Error('No hay texto para pronunciar.');

  if (Capacitor.isNativePlatform()) {
    await JapaneseTts.speak({ text: spokenText, rate: 0.9 });
    return;
  }

  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    throw new Error('La síntesis de voz no está disponible en este navegador.');
  }

  const synthesis = window.speechSynthesis;
  synthesis.cancel();
  const voice = await getJapaneseVoice();
  if (!voice) {
    throw new Error('No hay ninguna voz japonesa instalada en este navegador.');
  }
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.9;
    utterance.voice = voice;
    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(new Error(`No se pudo reproducir la pronunciación: ${event.error}.`));
    synthesis.speak(utterance);
  });
};
