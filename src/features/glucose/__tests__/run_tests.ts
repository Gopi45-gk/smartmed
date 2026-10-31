import assert from 'node:assert';
import { parseVoiceGlucoseUtterance, normalizeNumerals, extractGlucoseContext } from '../voiceParser';
import { evaluateLocalCriticalAlert } from '../glucoseStorage';
import { GlucoseReading, DEFAULT_THRESHOLDS } from '../types';

console.log('═══════════════════════════════════════════════════════════');
console.log('SMARTMED FRONTEND GLUCOSE & VOICE PARSER TEST SUITE');
console.log('═══════════════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

// 1. Numeral Normalization Tests
it('normalizes Devanagari numerals to ASCII digits', () => {
  assert.strictEqual(normalizeNumerals('शुगर १४०'), 'शुगर 140');
  assert.strictEqual(normalizeNumerals('२५०'), '250');
});

it('normalizes Tamil numerals to ASCII digits', () => {
  assert.strictEqual(normalizeNumerals('சுகர் ௧௮0'), 'சுகர் 180');
});

it('normalizes Telugu numerals to ASCII digits', () => {
  assert.strictEqual(normalizeNumerals('షుగర్ ౧౨౦'), 'షుగర్ 120');
});

// 2. Context Extraction Tests
it('extracts fasting context in English, Hindi, Tamil, Telugu', () => {
  assert.strictEqual(extractGlucoseContext('fasting sugar 110'), 'fasting');
  assert.strictEqual(extractGlucoseContext('खाली पेट शुगर 120'), 'fasting');
  assert.strictEqual(extractGlucoseContext('வெறும் வயிறு சுகர் 115'), 'fasting');
  assert.strictEqual(extractGlucoseContext('ఉపవాసం షుగర్ 105'), 'fasting');
});

it('extracts after-meal context in English, Hindi, Tamil, Telugu', () => {
  assert.strictEqual(extractGlucoseContext('sugar 180 after food'), 'after_meal');
  assert.strictEqual(extractGlucoseContext('खाने के बाद 210'), 'after_meal');
  assert.strictEqual(extractGlucoseContext('சாப்பாட்டுக்கு பின் 195'), 'after_meal');
  assert.strictEqual(extractGlucoseContext('భోజనం తర్వాత 175'), 'after_meal');
});

it('extracts bedtime context', () => {
  assert.strictEqual(extractGlucoseContext('sugar at bedtime 135'), 'bedtime');
  assert.strictEqual(extractGlucoseContext('सोते समय 140'), 'bedtime');
});

// 3. Multilingual Utterance Parsing Tests
it('parses English "sugar 140" correctly', () => {
  const res = parseVoiceGlucoseUtterance('sugar 140', 'en');
  assert.strictEqual(res.isValid, true);
  assert.strictEqual(res.value_mgdl, 140);
  assert.strictEqual(res.isPlausible, true);
  assert.ok(res.confirmationPrompt.includes('140'));
});

it('parses Hindi "शुगर 180" correctly', () => {
  const res = parseVoiceGlucoseUtterance('शुगर 180', 'hi');
  assert.strictEqual(res.isValid, true);
  assert.strictEqual(res.value_mgdl, 180);
  assert.strictEqual(res.isPlausible, true);
  assert.ok(res.confirmationPrompt.includes('180'));
});

it('parses Tamil "என் சுகர் 160" correctly', () => {
  const res = parseVoiceGlucoseUtterance('என் சுகர் 160', 'ta');
  assert.strictEqual(res.isValid, true);
  assert.strictEqual(res.value_mgdl, 160);
  assert.strictEqual(res.isPlausible, true);
  assert.ok(res.confirmationPrompt.includes('160'));
});

it('parses Telugu "షుగర్ 130" correctly', () => {
  const res = parseVoiceGlucoseUtterance('షుగర్ 130', 'te');
  assert.strictEqual(res.isValid, true);
  assert.strictEqual(res.value_mgdl, 130);
  assert.strictEqual(res.isPlausible, true);
  assert.ok(res.confirmationPrompt.includes('130'));
});

it('converts mmol/L voice utterance to mg/dL', () => {
  const res = parseVoiceGlucoseUtterance('sugar 7.5 mmol', 'en');
  assert.strictEqual(res.isValid, true);
  assert.strictEqual(res.value_mgdl, 135); // 7.5 * 18.016 ~ 135
  assert.strictEqual(res.unit, 'mmol/L');
});

it('flags implausible low and high values', () => {
  const tooLow = parseVoiceGlucoseUtterance('sugar 10', 'en');
  assert.strictEqual(tooLow.isPlausible, false);

  const tooHigh = parseVoiceGlucoseUtterance('sugar 950', 'en');
  assert.strictEqual(tooHigh.isPlausible, false);
});

// 4. Local Critical Alert Evaluator Tests
it('triggers critical low alert for value < 70', () => {
  const reading: GlucoseReading = {
    id: 'test-1',
    patientId: 'p1',
    value_mgdl: 58,
    unit_entered: 'mg/dL',
    context: 'fasting',
    measuredAt: new Date().toISOString(),
    source: 'voice',
    createdAt: new Date().toISOString(),
  };
  const check = evaluateLocalCriticalAlert(reading);
  assert.strictEqual(check.hasCriticalAlert, true);
  assert.strictEqual(check.alert?.rule_id, 'critical_low');
  assert.strictEqual(check.alert?.severity, 'critical');
});

it('triggers critical high alert for value > 250', () => {
  const reading: GlucoseReading = {
    id: 'test-2',
    patientId: 'p1',
    value_mgdl: 310,
    unit_entered: 'mg/dL',
    context: 'after_meal',
    measuredAt: new Date().toISOString(),
    source: 'manual',
    createdAt: new Date().toISOString(),
  };
  const check = evaluateLocalCriticalAlert(reading);
  assert.strictEqual(check.hasCriticalAlert, true);
  assert.strictEqual(check.alert?.rule_id, 'critical_high');
  assert.strictEqual(check.alert?.severity, 'critical');
});

it('does not trigger critical alert for normal reading 115', () => {
  const reading: GlucoseReading = {
    id: 'test-3',
    patientId: 'p1',
    value_mgdl: 115,
    unit_entered: 'mg/dL',
    context: 'fasting',
    measuredAt: new Date().toISOString(),
    source: 'manual',
    createdAt: new Date().toISOString(),
  };
  const check = evaluateLocalCriticalAlert(reading);
  assert.strictEqual(check.hasCriticalAlert, false);
  assert.strictEqual(check.alert, null);
});

console.log('\n═══════════════════════════════════════════════════════════');
console.log(`Frontend Test Summary: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL FRONTEND UNIT TESTS PASSED!');
  process.exit(0);
}
