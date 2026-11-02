import { TranslationStrings } from '../types';

/**
 * Localizes meal relation / food instructions without modifying stored database values.
 */
export function formatFoodInstruction(food: string | undefined | null, t: TranslationStrings): string {
  if (!food) return '';
  const lower = food.trim().toLowerCase();

  if (lower.includes('after food') || lower.includes('after meal') || lower.includes('post meal')) {
    return t.afterFood || 'After Food';
  }
  if (lower.includes('before food') || lower.includes('before meal') || lower.includes('pre meal')) {
    return t.beforeFood || 'Before Food';
  }
  if (lower.includes('empty stomach')) {
    return t.emptyStomach || 'Empty Stomach';
  }
  if (lower.includes('with water')) {
    return t.withWater || 'With Water';
  }
  if (lower.includes('with food')) {
    return t.afterFood || 'With Food';
  }

  return food;
}
