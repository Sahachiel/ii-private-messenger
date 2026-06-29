import type { Region } from '../types';

const RU_COUNTRIES: ReadonlySet<string> = new Set(['RU']);

const GE_COUNTRIES: ReadonlySet<string> = new Set([
  'QA', 'AE', 'SA', 'KW', 'BH', 'OM', 'YE', 'IQ', 'IR', 'SY',
  'TR', 'EG', 'LY', 'TN', 'DZ', 'MA', 'LB', 'JO', 'IL',
  'PK', 'AF', 'UZ', 'TM', 'KG', 'TJ', 'AZ', 'AM', 'GE',
]);

const FI_COUNTRIES: ReadonlySet<string> = new Set([
  'DE', 'FR', 'GB', 'IT', 'ES', 'NL', 'BE', 'SE', 'NO', 'DK', 'FI',
  'PL', 'CZ', 'AT', 'CH', 'PT', 'IE', 'GR', 'HR', 'RO', 'BG', 'SK',
  'SI', 'LT', 'LV', 'EE', 'HU', 'LU', 'MT', 'CY',
  'US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'SG', 'HK', 'TW',
  'BR', 'MX', 'AR', 'ZA', 'NG', 'KE', 'GH', 'IN', 'CN',
]);

export function countryToRegion(countryCode: string): Region {
  const cc = countryCode.toUpperCase();
  if (RU_COUNTRIES.has(cc)) return 'ru';
  if (FI_COUNTRIES.has(cc)) return 'fi';
  if (GE_COUNTRIES.has(cc)) return 'ge';
  // default for unlisted → ge
  return 'ge';
}

export function isValidRegion(value: string): value is Region {
  return value === 'ru' || value === 'ge' || value === 'fi';
}
