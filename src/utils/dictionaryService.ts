/**
 * Dictionary & IPA Pronunciation Service for LexiSync IELTS
 * 
 * Provides:
 * 1. Fast, multi-tier word lookup (Test Vocabulary -> Flashcards -> Gemini AI -> Free Dictionary API)
 * 2. Accurate British (en-GB) and American (en-US) IPA phonetics
 * 3. Text-to-Speech audio pronunciation
 * 4. Audio tone beeps for rhythmic 3-2-1 countdown in choral reading
 */

import type { AwlVocabItem, FlashcardItem } from '../types/ielts';
import { translateVocabClientSide } from './clientGemini';

export interface DictionaryWordInfo {
  word: string;
  ipaUk: string;
  ipaUs?: string;
  pos: string;
  meaningVi: string;
  contextualMeaningVi: string;
  definitionEn: string;
  example: string;
  collocations?: string[];
  audioUrl?: string;
  isLoading?: boolean;
}

// In-memory cache for fast instant lookups during slide presentations
const dictionaryCache = new Map<string, DictionaryWordInfo>();

// Common IELTS words fallback dictionary with standard British IPA & Vietnamese meanings
const COMMON_IELTS_FALLBACKS: Record<string, { ipa: string; pos: string; vi: string; en: string }> = {
  items: { ipa: '/ˈaɪ.təmz/', pos: 'noun (plural)', vi: 'các món đồ, vật dụng', en: 'individual articles or things' },
  item: { ipa: '/ˈaɪ.təm/', pos: 'noun', vi: 'món đồ, vật dụng, hạng mục', en: 'an individual article or unit' },
  stolen: { ipa: '/ˈstəʊ.lən/', pos: 'verb (pp)', vi: 'bị lấy cắp, bị mất trộm', en: 'taken without permission or stolen' },
  steal: { ipa: '/stiːl/', pos: 'verb', vi: 'lấy cắp, trộm cắp', en: 'take property without permission' },
  bag: { ipa: '/bæɡ/', pos: 'noun', vi: 'túi xách, balo, cặp', en: 'a flexible container used for carrying things' },
  yesterday: { ipa: '/ˈjes.tə.deɪ/', pos: 'adverb / noun', vi: 'ngày hôm qua', en: 'on the day before today' },
  police: { ipa: '/pəˈliːs/', pos: 'noun', vi: 'cảnh sát, công an', en: 'the civil force of a state' },
  report: { ipa: '/rɪˈpɔːt/', pos: 'verb / noun', vi: 'trình báo, báo cáo, bản tin', en: 'give a spoken or written account of' },
  station: { ipa: '/ˈsteɪ.ʃən/', pos: 'noun', vi: 'nhà ga, đồn, trạm', en: 'a regular stopping place or police post' },
  suspect: { ipa: '/ˈsʌs.pekt/', pos: 'noun / verb', vi: 'nghi phạm, nghi ngờ', en: 'a person thought to be guilty of a crime' },
  wallet: { ipa: '/ˈwɒl.ɪt/', pos: 'noun', vi: 'ví tiền', en: 'a small flat case used to hold money' },
  passport: { ipa: '/ˈpɑːs.pɔːt/', pos: 'noun', vi: 'hộ chiếu', en: 'an official document issued by a government' },
  contact: { ipa: '/ˈkɒn.tækt/', pos: 'verb / noun', vi: 'liên hệ, liên lạc', en: 'communicate with or touch' },
  details: { ipa: '/ˈdiː.teɪlz/', pos: 'noun (plural)', vi: 'thông tin chi tiết', en: 'an individual feature or specific item' },
  description: { ipa: '/dɪˈskrɪp.ʃən/', pos: 'noun', vi: 'sự miêu tả, đặc điểm', en: 'a statement giving characteristics' },
  incident: { ipa: '/ˈɪn.sɪ.dənt/', pos: 'noun', vi: 'sự cố, vụ việc', en: 'an event or occurrence, especially unpleasant' },
  office: { ipa: '/ˈɒf.ɪs/', pos: 'noun', vi: 'văn phòng, cơ quan', en: 'a room or set of rooms used as a place of business' },
  lost: { ipa: '/lɒst/', pos: 'adjective / verb', vi: 'bị mất, thất lạc', en: 'unable to be found or misplaced' },
  found: { ipa: '/faʊnd/', pos: 'verb / adjective', vi: 'tìm thấy, nhặt được', en: 'discovered or recovered' },
  property: { ipa: '/ˈprɒp.ə.ti/', pos: 'noun', vi: 'tài sản, đồ đạc sở hữu', en: 'a thing or things belonging to someone' },
  campus: { ipa: '/ˈkæm.pəs/', pos: 'noun', vi: 'khuôn viên trường', en: 'the grounds and buildings of a university' },
  library: { ipa: '/ˈlaɪ.brər.i/', pos: 'noun', vi: 'thư viện', en: 'a building or room containing collections of books' },
  student: { ipa: '/ˈstjuː.dənt/', pos: 'noun', vi: 'học sinh, sinh viên', en: 'a person who is studying at school/college' },
  lecture: { ipa: '/ˈlek.tʃər/', pos: 'noun', vi: 'bài giảng, buổi thuyết trình', en: 'an educational talk to students' },
  tutor: { ipa: '/ˈtjuː.tər/', pos: 'noun', vi: 'giáo viên hướng dẫn, trợ giảng', en: 'a private teacher or college instructor' },
};

/**
 * Clean a word token into an alphabet-only lookup key
 */
export function cleanWordKey(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/[^a-zA-Z0-9]+$/, '')
    .trim();
}

/**
 * Multi-tier lookup for word definition, IPA phonetics, and context translation
 */
export async function lookupWordDictionary(
  rawWord: string,
  sentenceContext: string = '',
  testVocabulary: AwlVocabItem[] = []
): Promise<DictionaryWordInfo> {
  const clean = cleanWordKey(rawWord);
  if (!clean) {
    return {
      word: rawWord,
      ipaUk: '',
      pos: 'word',
      meaningVi: rawWord,
      contextualMeaningVi: rawWord,
      definitionEn: '',
      example: sentenceContext,
    };
  }

  // 1. Check in-memory session cache
  const cached = dictionaryCache.get(clean);
  if (cached) {
    return cached;
  }

  // 2. Check testPack.vocabulary (highest accuracy for IELTS curriculum)
  if (testVocabulary && testVocabulary.length > 0) {
    const matched = testVocabulary.find(
      (v) =>
        cleanWordKey(v.word) === clean ||
        cleanWordKey(v.word) === clean.replace(/s$/, '') ||
        cleanWordKey(v.word) === clean.replace(/ed$/, '')
    );

    if (matched) {
      const info: DictionaryWordInfo = {
        word: matched.word,
        ipaUk: matched.ipa || '',
        ipaUs: matched.ipa || '',
        pos: matched.pos || 'word',
        meaningVi: matched.contextualMeaningVi || matched.meaningVi || matched.definitionVi || '',
        contextualMeaningVi: matched.contextualMeaningVi || matched.meaningVi || matched.definitionVi || '',
        definitionEn: matched.definitionEn || '',
        example: matched.exampleInAudio || matched.contextSentence || sentenceContext,
        collocations: matched.collocations || [],
      };
      dictionaryCache.set(clean, info);
      return info;
    }
  }

  // 3. Check saved flashcards in localStorage
  try {
    const rawCards = localStorage.getItem('lexisync_ielts_flashcards_v1');
    if (rawCards) {
      const parsedCards = JSON.parse(rawCards) as FlashcardItem[];
      const matchedCard = parsedCards.find((c) => cleanWordKey(c.word) === clean);
      if (matchedCard) {
        const info: DictionaryWordInfo = {
          word: matchedCard.word,
          ipaUk: matchedCard.ipa || '',
          ipaUs: matchedCard.ipa || '',
          pos: matchedCard.pos || 'word',
          meaningVi: matchedCard.contextualMeaningVi || matchedCard.definitionVi || '',
          contextualMeaningVi: matchedCard.contextualMeaningVi || matchedCard.definitionVi || '',
          definitionEn: matchedCard.definitionEn || '',
          example: matchedCard.exampleInAudio || sentenceContext,
        };
        dictionaryCache.set(clean, info);
        return info;
      }
    }
  } catch {
    // ignore
  }

  // 4. Check Common Fallbacks map
  const fallback = COMMON_IELTS_FALLBACKS[clean] || COMMON_IELTS_FALLBACKS[clean.replace(/s$/, '')];

  // 5. Try Free Dictionary API for precise British & American IPA
  let fetchedIpaUk = fallback?.ipa || '';
  let fetchedIpaUs = '';
  let fetchedPos = fallback?.pos || 'word';
  let fetchedDefEn = fallback?.en || '';
  let fetchedExample = sentenceContext;

  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]) {
        const entry = data[0];
        // Extract phonetics
        if (entry.phonetic) {
          fetchedIpaUk = entry.phonetic;
        }
        if (Array.isArray(entry.phonetics)) {
          const ukPhonetic = entry.phonetics.find((p: { audio?: string; text?: string }) => p.audio?.includes('-uk') || p.text);
          const usPhonetic = entry.phonetics.find((p: { audio?: string; text?: string }) => p.audio?.includes('-us'));
          if (ukPhonetic?.text) fetchedIpaUk = ukPhonetic.text;
          if (usPhonetic?.text) fetchedIpaUs = usPhonetic.text;
        }

        if (Array.isArray(entry.meanings) && entry.meanings[0]) {
          const m = entry.meanings[0];
          fetchedPos = m.partOfSpeech || fetchedPos;
          if (Array.isArray(m.definitions) && m.definitions[0]) {
            fetchedDefEn = m.definitions[0].definition || fetchedDefEn;
            if (m.definitions[0].example) {
              fetchedExample = m.definitions[0].example;
            }
          }
        }
      }
    }
  } catch {
    // network timeout or offline
  }

  // 6. Try Gemini AI Translation if API key is stored
  const apiKey = localStorage.getItem('GEMINI_API_KEY') || '';
  let finalMeaningVi = fallback?.vi || '';

  if (apiKey) {
    try {
      const aiItem = await translateVocabClientSide({
        apiKey,
        word: clean,
        sentenceContext,
      });
      if (aiItem) {
        if (!fetchedIpaUk && aiItem.ipa) fetchedIpaUk = aiItem.ipa;
        if (aiItem.contextualMeaningVi) finalMeaningVi = aiItem.contextualMeaningVi;
        else if (aiItem.definitionVi) finalMeaningVi = aiItem.definitionVi;
        if (!fetchedDefEn && aiItem.definitionEn) fetchedDefEn = aiItem.definitionEn;
        if (aiItem.pos && aiItem.pos !== 'word') fetchedPos = aiItem.pos;
      }
    } catch {
      // fallback
    }
  }

  // If still no Vietnamese meaning, provide a graceful readable fallback
  if (!finalMeaningVi) {
    finalMeaningVi = fallback?.vi || `Từ "${clean}" trong ngữ cảnh câu này`;
  }

  const result: DictionaryWordInfo = {
    word: rawWord.trim(),
    ipaUk: fetchedIpaUk || '/.../',
    ipaUs: fetchedIpaUs || fetchedIpaUk || '',
    pos: fetchedPos,
    meaningVi: finalMeaningVi,
    contextualMeaningVi: finalMeaningVi,
    definitionEn: fetchedDefEn,
    example: sentenceContext || fetchedExample,
  };

  dictionaryCache.set(clean, result);
  return result;
}

/**
 * Speak word pronunciation using Web Speech API (British or American accent)
 */
export function speakWordPronunciation(word: string, lang: 'en-GB' | 'en-US' = 'en-GB') {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  try {
    window.speechSynthesis.cancel();
    const clean = cleanWordKey(word) || word;
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = lang;
    utterance.rate = 0.88;

    const voices = window.speechSynthesis.getVoices();
    const matchedVoice = voices.find((v) => {
      if (lang === 'en-GB') {
        return (
          v.lang === 'en-GB' ||
          v.lang.startsWith('en_GB') ||
          v.name.includes('UK') ||
          v.name.includes('British') ||
          v.name.includes('George') ||
          v.name.includes('Hazel')
        );
      }
      return (
        v.lang === 'en-US' ||
        v.lang.startsWith('en_US') ||
        v.name.includes('US') ||
        v.name.includes('United States') ||
        v.name.includes('David') ||
        v.name.includes('Zira')
      );
    });

    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('[SpeechSynthesis] Failed to pronounce word:', err);
  }
}

/**
 * Speak full sentence pronunciation using Web Speech API (British or American accent)
 */
export function speakSentencePronunciation(
  sentence: string,
  lang: 'en-GB' | 'en-US' = 'en-GB',
  rate = 0.92
) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  try {
    window.speechSynthesis.cancel();
    const cleanText = sentence
      .replace(/[“”"']/g, '')
      .replace(/\[\s*\?\s*\?\s*\]/g, '')
      .trim();
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = lang;
    utterance.rate = rate;

    const voices = window.speechSynthesis.getVoices();
    const matchedVoice = voices.find((v) => {
      if (lang === 'en-GB') {
        return (
          v.lang === 'en-GB' ||
          v.lang.startsWith('en_GB') ||
          v.name.includes('UK') ||
          v.name.includes('British') ||
          v.name.includes('George') ||
          v.name.includes('Hazel')
        );
      }
      return (
        v.lang === 'en-US' ||
        v.lang.startsWith('en_US') ||
        v.name.includes('US') ||
        v.name.includes('United States') ||
        v.name.includes('David') ||
        v.name.includes('Zira')
      );
    });

    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('[SpeechSynthesis] Failed to pronounce sentence:', err);
  }
}

/**
 * Play a clean, pleasant rhythmic tone for 3-2-1 countdown
 * beat: 440Hz warm beep (120ms)
 * start: 880Hz crisp bell chime (250ms)
 */
export function playChoralBeep(type: 'beat' | 'start') {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (type === 'beat') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else {
      // 880Hz double-chime for start
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.28);
    }
  } catch {
    // Ignore audio context block
  }
}
