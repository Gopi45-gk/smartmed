import { GlucoseContext, GlucoseUnit } from './types';

export interface ParsedVoiceGlucose {
  isValid: boolean;
  value_mgdl: number | null;
  unit: GlucoseUnit;
  context: GlucoseContext;
  rawTranscript: string;
  isPlausible: boolean;
  clarificationMessage?: string;
  confirmationPrompt: string;
}

// Convert non-ASCII digits (Devanagari, Tamil, Telugu, Arabic-Indic) to standard ASCII 0-9
export function normalizeNumerals(text: string): string {
  const digitMap: Record<string, string> = {
    // Devanagari ०-९
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
    '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
    // Tamil ௧-௯ (0 is standard or ௦)
    '௦': '0', '௧': '1', '௨': '2', '௩': '3', '௪': '4',
    '௫': '5', '௬': '6', '௭': '7', '௮': '8', '௯': '9',
    // Telugu ౦-౯
    '౦': '0', '౧': '1', '౨': '2', '౩': '3', '౪': '4',
    '౫': '5', '౬': '6', '౭': '7', '౮': '8', '౯': '9',
  };

  return text.replace(/[०-९௦-௯౦-౯]/g, (ch) => digitMap[ch] || ch);
}

// Extract glucose context from text
export function extractGlucoseContext(text: string): GlucoseContext {
  const lower = text.toLowerCase();

  // Fasting keywords
  if (
    lower.includes('fasting') ||
    lower.includes('empty stomach') ||
    lower.includes('fast') ||
    lower.includes('खाली पेट') ||
    lower.includes('उपवास') ||
    lower.includes('வெறும் வயிறு') ||
    lower.includes('పస్తు') ||
    lower.includes('ఉపవాసం')
  ) {
    return 'fasting';
  }

  // After meal keywords
  if (
    lower.includes('after food') ||
    lower.includes('after meal') ||
    lower.includes('post') ||
    lower.includes('खाने के बाद') ||
    lower.includes('சாப்பாட்டுக்கு பின்') ||
    lower.includes('சாப்பிட்ட பிறகு') ||
    lower.includes('భోజనం తర్వాత') ||
    lower.includes('తిన్న తర్వాత')
  ) {
    return 'after_meal';
  }

  // Before meal keywords
  if (
    lower.includes('before food') ||
    lower.includes('before meal') ||
    lower.includes('pre') ||
    lower.includes('खाने से पहले') ||
    lower.includes('சாப்பாட்டுக்கு முன்') ||
    lower.includes('భోజనానికి ముందు')
  ) {
    return 'before_meal';
  }

  // Bedtime keywords
  if (
    lower.includes('bedtime') ||
    lower.includes('night') ||
    lower.includes('sleeping') ||
    lower.includes('सोते समय') ||
    lower.includes('रात को') ||
    lower.includes('படுக்கும் முன்') ||
    lower.includes('இரவு') ||
    lower.includes('పడుకునే ముందు') ||
    lower.includes('రాత్రి')
  ) {
    return 'bedtime';
  }

  return 'random';
}

// Main parser function for voice utterances
export function parseVoiceGlucoseUtterance(rawText: string, lang: string = 'en'): ParsedVoiceGlucose {
  const normalized = normalizeNumerals(rawText);
  const context = extractGlucoseContext(normalized);

  // Check unit
  const lower = normalized.toLowerCase();
  const isMmol = lower.includes('mmol') || lower.includes('millimol');

  // Match numbers (including decimals)
  const numberRegex = /\b(\d+(?:\.\d+)?)\b/g;
  const matches = [...normalized.matchAll(numberRegex)];

  if (matches.length === 0) {
    return {
      isValid: false,
      value_mgdl: null,
      unit: 'mg/dL',
      context,
      rawTranscript: rawText,
      isPlausible: false,
      clarificationMessage: getClarificationMessage(lang),
      confirmationPrompt: '',
    };
  }

  // Candidate selection: if multiple numbers, find one in plausible range
  let chosenValue: number | null = null;
  for (const m of matches) {
    const rawNum = parseFloat(m[1]);
    const convertedMgdl = isMmol ? Math.round(rawNum * 18.016) : Math.round(rawNum);
    if (convertedMgdl >= 20 && convertedMgdl <= 800) {
      chosenValue = convertedMgdl;
      break;
    }
  }

  // If no plausible candidate found, pick the first one anyway to flag implausibility
  if (chosenValue === null) {
    const rawNum = parseFloat(matches[0][1]);
    chosenValue = isMmol ? Math.round(rawNum * 18.016) : Math.round(rawNum);
  }

  const isPlausible = chosenValue >= 20 && chosenValue <= 800;

  const prompt = buildConfirmationPrompt(chosenValue, context, lang);

  return {
    isValid: true,
    value_mgdl: chosenValue,
    unit: isMmol ? 'mmol/L' : 'mg/dL',
    context,
    rawTranscript: rawText,
    isPlausible,
    clarificationMessage: !isPlausible ? getPlausibilityErrorMessage(chosenValue, lang) : undefined,
    confirmationPrompt: prompt,
  };
}

function buildConfirmationPrompt(val: number, ctx: GlucoseContext, lang: string): string {
  const ctxLabelMap: Record<string, Record<GlucoseContext, string>> = {
    en: {
      fasting: 'fasting',
      before_meal: 'before meal',
      after_meal: 'after meal',
      bedtime: 'bedtime',
      random: '',
    },
    hi: {
      fasting: 'खाली पेट',
      before_meal: 'खाने से पहले',
      after_meal: 'खाने के बाद',
      bedtime: 'सोते समय',
      random: '',
    },
    ta: {
      fasting: 'வெறும் வயிற்றில்',
      before_meal: 'உணவுக்கு முன்',
      after_meal: 'உணவுக்குப் பின்',
      bedtime: 'படுக்கும் முன்',
      random: '',
    },
    te: {
      fasting: 'ఉపవాసం',
      before_meal: 'భోజనానికి ముందు',
      after_meal: 'భోజనం తర్వాత',
      bedtime: 'పడుకునే ముందు',
      random: '',
    },
  };

  const labels = ctxLabelMap[lang] || ctxLabelMap['en'];
  const ctxStr = labels[ctx] ? ` (${labels[ctx]})` : '';

  switch (lang) {
    case 'hi':
      return `शुगर ${val}${ctxStr}, क्या यह सही है?`;
    case 'ta':
      return `சுகர் ${val}${ctxStr}, இது சரியா?`;
    case 'te':
      return `షుగర్ ${val}${ctxStr}, ఇది సరైనదేనా?`;
    case 'kn':
      return `ಸಕ್ಕರೆ ${val}${ctxStr}, ಇದು ಸರಿಯಾಗಿದೆಯೇ?`;
    case 'ml':
      return `ഷുഗർ ${val}${ctxStr}, ഇത് ശരിയാണോ?`;
    case 'ur':
      return `شوگر ${val}${ctxStr}، کیا یہ درست ہے؟`;
    case 'en':
    default:
      return `Sugar ${val} mg/dL${ctxStr}, is that correct?`;
  }
}

function getClarificationMessage(lang: string): string {
  switch (lang) {
    case 'hi':
      return 'कृपया अपना ब्लड शुगर नंबर फिर से बोलें, जैसे "शुगर 140".';
    case 'ta':
      return 'தயவுசெய்து உங்கள் சர்க்கரை அளவை மீண்டும் சொல்லுங்கள், எ.கா. "சுகர் 140".';
    case 'te':
      return 'దయచేసి మీ బ్లడ్ షుగర్ సంఖ్యను మళ్లీ చెప్పండి, ఉదా. "షుగర్ 140".';
    case 'en':
    default:
      return 'Please repeat your sugar reading, for example: "Sugar 140".';
  }
}

function getPlausibilityErrorMessage(val: number, lang: string): string {
  switch (lang) {
    case 'hi':
      return `${val} mg/dL अमान्य लगता है (सामान्य सीमा 20-800)। कृपया दोबारा बोलें।`;
    case 'ta':
      return `${val} mg/dL பொருத்தமற்றது (வரம்பு 20-800). மீண்டும் சொல்லவும்.`;
    case 'te':
      return `${val} mg/dL చెల్లుబాటు కాదు (పరిమితి 20-800). దయచేసి మళ్లీ చెప్పండి.`;
    case 'en':
    default:
      return `${val} mg/dL is out of plausible range (20–800). Please repeat.`;
  }
}
