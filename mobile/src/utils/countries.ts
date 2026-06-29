import { Region } from '../types';

const RU_CODES = new Set(['RU']);

const GE_CODES = new Set([
  'QA','AE','SA','KW','BH','OM','YE','IQ','IR','SY','TR','EG','LY','TN','DZ','MA',
  'LB','JO','IL','PS','PK','AF','UZ','TM','KG','TJ','AZ','AM','GE','BY','UA','MD',
  'KZ','SD','SO','DJ','ER','ET','MR','NE','TD','ML','BF','BJ','TG','CI','GN','GW',
  'LR','SL','SN','GM','CV','GA','CG','CD','CF','CM','GQ','AO','ZM','ZW','MZ','MW',
  'MG','KM','MU','SC','ST','RW','BI','UG','TZ','RW','NA','BW','LS','SZ',
]);

const FI_CODES = new Set([
  'DE','FR','GB','IT','ES','NL','BE','SE','NO','DK','FI','PL','CZ','AT','CH','PT',
  'IE','GR','HR','RO','BG','SK','SI','LT','LV','EE','HU','LU','MT','CY','IS','LI',
  'AD','MC','SM','VA','AL','MK','ME','RS','BA','XK',
  'US','CA','MX',
  'BR','AR','CL','CO','PE','VE','EC','BO','PY','UY','GY','SR','GF',
  'AU','NZ','JP','KR','SG','HK','TW','CN','IN','TH','VN','PH','ID','MY','BD','LK','NP','BT','MM','KH','LA','MN','BN','MV',
  'ZA','NG','KE','GH','SN','CI','CM','ET','UG','TZ','AO','MZ','ZM','ZW','CD','DZ','MA','TN','EG',
  'PA','CR','GT','HN','SV','NI','BZ','CU','DO','HT','JM','TT','BB','BS','AG','DM','GD','KN','LC','VC',
]);

export function getRegionForCountry(isoCode: string): Region {
  const c = (isoCode || '').toUpperCase();
  if (RU_CODES.has(c)) return 'ru';
  if (FI_CODES.has(c)) return 'fi';
  if (GE_CODES.has(c)) return 'ge';
  return 'ge';
}

export interface CountryEntry { code: string; name: string; region: Region; flag: string }

const flag = (cc: string) => cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

const RAW: [string, string][] = [
  ['AF','Afghanistan'],['AL','Albania'],['DZ','Algeria'],['AD','Andorra'],['AO','Angola'],['AG','Antigua & Barbuda'],['AR','Argentina'],['AM','Armenia'],['AU','Australia'],['AT','Austria'],
  ['AZ','Azerbaijan'],['BS','Bahamas'],['BH','Bahrain'],['BD','Bangladesh'],['BB','Barbados'],['BY','Belarus'],['BE','Belgium'],['BZ','Belize'],['BJ','Benin'],['BT','Bhutan'],
  ['BO','Bolivia'],['BA','Bosnia & Herzegovina'],['BW','Botswana'],['BR','Brazil'],['BN','Brunei'],['BG','Bulgaria'],['BF','Burkina Faso'],['BI','Burundi'],['KH','Cambodia'],['CM','Cameroon'],
  ['CA','Canada'],['CV','Cape Verde'],['CF','Central African Rep.'],['TD','Chad'],['CL','Chile'],['CN','China'],['CO','Colombia'],['KM','Comoros'],['CG','Congo'],['CD','Congo (DRC)'],
  ['CR','Costa Rica'],['CI','Ivory Coast'],['HR','Croatia'],['CU','Cuba'],['CY','Cyprus'],['CZ','Czechia'],['DK','Denmark'],['DJ','Djibouti'],['DM','Dominica'],['DO','Dominican Rep.'],
  ['EC','Ecuador'],['EG','Egypt'],['SV','El Salvador'],['GQ','Equatorial Guinea'],['ER','Eritrea'],['EE','Estonia'],['SZ','Eswatini'],['ET','Ethiopia'],['FI','Finland'],['FR','France'],
  ['GA','Gabon'],['GM','Gambia'],['GE','Georgia'],['DE','Germany'],['GH','Ghana'],['GR','Greece'],['GD','Grenada'],['GT','Guatemala'],['GN','Guinea'],['GW','Guinea-Bissau'],
  ['GY','Guyana'],['HT','Haiti'],['HN','Honduras'],['HK','Hong Kong'],['HU','Hungary'],['IS','Iceland'],['IN','India'],['ID','Indonesia'],['IR','Iran'],['IQ','Iraq'],
  ['IE','Ireland'],['IL','Israel'],['IT','Italy'],['JM','Jamaica'],['JP','Japan'],['JO','Jordan'],['KZ','Kazakhstan'],['KE','Kenya'],['KW','Kuwait'],['KG','Kyrgyzstan'],
  ['LA','Laos'],['LV','Latvia'],['LB','Lebanon'],['LS','Lesotho'],['LR','Liberia'],['LY','Libya'],['LI','Liechtenstein'],['LT','Lithuania'],['LU','Luxembourg'],['MG','Madagascar'],
  ['MW','Malawi'],['MY','Malaysia'],['MV','Maldives'],['ML','Mali'],['MT','Malta'],['MR','Mauritania'],['MU','Mauritius'],['MX','Mexico'],['MD','Moldova'],['MC','Monaco'],
  ['MN','Mongolia'],['ME','Montenegro'],['MA','Morocco'],['MZ','Mozambique'],['MM','Myanmar'],['NA','Namibia'],['NP','Nepal'],['NL','Netherlands'],['NZ','New Zealand'],['NI','Nicaragua'],
  ['NE','Niger'],['NG','Nigeria'],['MK','North Macedonia'],['NO','Norway'],['OM','Oman'],['PK','Pakistan'],['PS','Palestine'],['PA','Panama'],['PY','Paraguay'],['PE','Peru'],
  ['PH','Philippines'],['PL','Poland'],['PT','Portugal'],['QA','Qatar'],['RO','Romania'],['RU','Russia'],['RW','Rwanda'],['KN','St Kitts & Nevis'],['LC','St Lucia'],['VC','St Vincent'],
  ['SM','San Marino'],['ST','São Tomé'],['SA','Saudi Arabia'],['SN','Senegal'],['RS','Serbia'],['SC','Seychelles'],['SL','Sierra Leone'],['SG','Singapore'],['SK','Slovakia'],['SI','Slovenia'],
  ['SO','Somalia'],['ZA','South Africa'],['KR','South Korea'],['ES','Spain'],['LK','Sri Lanka'],['SD','Sudan'],['SR','Suriname'],['SE','Sweden'],['CH','Switzerland'],['SY','Syria'],
  ['TW','Taiwan'],['TJ','Tajikistan'],['TZ','Tanzania'],['TH','Thailand'],['TG','Togo'],['TT','Trinidad & Tobago'],['TN','Tunisia'],['TR','Turkey'],['TM','Turkmenistan'],['UG','Uganda'],
  ['UA','Ukraine'],['AE','UAE'],['GB','United Kingdom'],['US','United States'],['UY','Uruguay'],['UZ','Uzbekistan'],['VA','Vatican'],['VE','Venezuela'],['VN','Vietnam'],['YE','Yemen'],
  ['ZM','Zambia'],['ZW','Zimbabwe'],['XK','Kosovo'],
];

export const COUNTRY_LIST: CountryEntry[] = RAW.map(([code, name]) => ({
  code, name, region: getRegionForCountry(code), flag: flag(code),
})).sort((a, b) => a.name.localeCompare(b.name));
