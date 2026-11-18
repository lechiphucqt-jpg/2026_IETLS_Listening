export type QuestionType = 'completion' | 'mcq' | 'matching';

export type ErrorCategory =
  | 'Spelling'
  | 'Plural/Singular'
  | 'Unit'
  | 'Distractor'
  | 'WordLimit'
  | 'Unanswered';

export interface TranscriptSegment {
  id: string;
  speaker: string;
  startSec: number;
  endSec: number;
  timestampLabel: string; // e.g. "[00:14.20]"
  text: string;
  stressPattern?: string;
  intonationNote?: string;
  questionRef?: number;
}

export interface IeltsQuestion {
  number: number;
  type: QuestionType;
  prompt: string;
  contextBefore?: string;
  contextAfter?: string;
  wordLimitInstruction?: string;
  options?: { key: string; text: string }[];
  correctAnswer: string;
  acceptedVariants?: string[];
  timestampSec: number;
  timestampEndSec?: number;
  timestampLabel: string;
  paraphraseQuestion: string;
  paraphraseTranscript: string;
  distractorType: string;
  distractorDetail: string;
  transcriptQuote: string;
  explanationVi: string;
  errorCategoryHint: ErrorCategory;
}

export interface AwlVocabItem {
  word: string;
  ipa: string;
  pos: string;
  definitionVi: string;
  contextualMeaningVi?: string;
  definitionEn: string;
  exampleInAudio: string;
  exampleTranslationVi?: string;
  timestampSec: number;
  timestampEndSec?: number;
  timestampLabel: string;
  isAwl: boolean;
}

export interface IntensiveDrillItem {
  id: string;
  segmentId: string;
  startSec: number;
  endSec: number;
  timestampLabel: string;
  sentenceWithBlanks: string;
  missingPhrases: {
    answer: string;
    hintContext: string;
    letterMask: string;
  }[];
  connectedSpeechNote: string;
}

export interface ClassroomDrillSentence {
  id: string;
  order: number;
  speaker: string;
  sentence: string;
  translationVi: string;
  startSec: number;
  endSec: number;
  timestampLabel: string;
  selectionReasonVi: string;
  stressPattern: string;
  connectedSpeechNote: string;
  keyWords: string[];
}

export interface SpeakerVoiceProfile {
  name: string;
  voice: 'Puck' | 'Kore' | 'Charon' | 'Fenrir' | 'Zephyr';
  style: string;
}

export interface ListeningTestPack {
  id: string;
  title: string;
  partLabel: string;
  topic: string;
  bandTarget: string;
  durationSec: number;
  audioUrl?: string;
  audioFileName?: string;
  pdfUrl?: string;
  pdfFileName?: string;
  createdAt?: string;
  isCustomUpload?: boolean;
  speakers: SpeakerVoiceProfile[];
  segments: TranscriptSegment[];
  questions: IeltsQuestion[];
  vocabulary: AwlVocabItem[];
  intensiveDrills: IntensiveDrillItem[];
  classroomDrills?: ClassroomDrillSentence[];
}

export interface AnswerKeyAnalysisRow {
  questionNumber: number;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  errorCategory?: ErrorCategory;
  timestampSec: number;
  timestampEndSec?: number;
  timestampLabel: string;
  paraphraseMapping: string;
  distractorType: string;
}

export interface ExplanationItem {
  questionNumber: number;
  isCorrect: boolean;
  userAnswer?: string;
  correctAnswer?: string;
  paraphraseMapping?: string;
  distractorType?: string;
  logicVi: string;
  directQuote: string;
  timestampSec: number;
  timestampEndSec?: number;
  timestampLabel: string;
}

export interface BehavioralErrorBreakdown {
  category: string;
  count: number;
  insightVi: string;
}

export interface PedagogicalReport {
  generatedAt: string;
  testId: string;
  testTitle: string;
  part1AnswerKey: AnswerKeyAnalysisRow[];
  part2Explanations: ExplanationItem[];
  part3BehavioralInsights: {
    correctCount: number;
    totalCount: number;
    accuracyPercent: number;
    estimatedBand: string;
    errorBreakdown: BehavioralErrorBreakdown[];
    overallDiagnosisVi: string;
  };
  part4AcademicSpotlight: AwlVocabItem[];
  part5ActionPlan: {
    summaryVi: string;
    shadowingTargets: {
      label: string;
      timestampSec: number;
      timestampLabel: string;
      focusNote: string;
    }[];
    intensiveTargets: {
      label: string;
      questionType: string;
      timestampSec: number;
      timestampLabel: string;
    }[];
  };
}

export interface FlashcardItem {
  id: string;
  testId?: string;
  word: string;
  ipa: string;
  pos: string;
  definitionVi: string;
  contextualMeaningVi?: string;
  definitionEn: string;
  exampleInAudio: string;
  exampleTranslationVi?: string;
  timestampLabel: string;
  sourceTitle: string;
  status: 'new' | 'reviewing' | 'mastered';
  addedAt: string;
}
