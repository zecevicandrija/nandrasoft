// Source: the three screenshots supplied on 2026-11-03.
// Spelling and cadastral details cross-checked against the original workbook.
export const excludedWorkerNames = [
  'Igor Mihailović', 'Nikolic Stefan', 'Pesalj Margita', 'Srdjan Bodis', 'Bojan Vujačić',
];

export const workerNames = [
  'Fejsa Toni', 'Nađa Papić', 'Dedić Dragana', 'Jovan Vujičić', 'Nikolić Aleksandra',
  'Natasa Zoric Miljus', 'Vanja Marinković', 'Zlatko Ralevic', 'Lazar Adamović',
  'Dado Majstorovic', 'Srdjan Nedeljkovic', 'Karlo Sabo', 'Vislavski Zeljko', 'Nikola',
  'Bojan Ćorović', 'Šćekić Petko', 'Ognjen Brdar', 'Vukasin Vujicic', 'Pero Brdar',
  'Ceran jovo', 'ceran mico', 'Matija Miksic', 'Milenko', 'Bato Balog', 'Sasa Rmus',
];

// Preserve the workbook's full hectare precision behind the screenshot's two-decimal display.
export const parcels = [
  ['Mali Idjos', 45, '6076/1, 6075/1'],
  ['Crvenka 15', 15.36, '8951'],
  ['Crvenka 11', 11.1812, '9233/1'],
  ['Crvenka 10', 10, '350, 8013'],
  ['Vrbas-107-vetrenjace', 107, '39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 36, 37, 38, 35'],
  ['Vrbas-9 kod pruge', 8.9083, '55/1'],
  ['Vrbas-61,5-novi zalivni', 62, '124, 125, 118, 119, 120, 121, 122, 123'],
  ['Savino selo male parcele', 32, null],
  ['Ravno selo-64', 61.67, '4132, 3162, 3163'],
  ['Zmajevo', 37.84, '3878'],
  ['Savino Selo-Mihajlovic 25', 25, null],
  ['Savino Selo-Mihajlovic 35', 35, null],
  ['Klas', 2, '966/1'],
  ['Secerana 1,67', 1.67, '987/22'],
  ['Kosancic-stefan', 7.5, null],
  ['Srpska pravoslavna crkva (deo 1)', 9.026, '1369, 1336'],
  ['Srpska pravoslavna crkva (deo 2)', 62.295, null],
  ['Jaukovic', 70, null],
  ['Savino selo-gale', 41.903, null],
].map(([name, areaHa, location], i) => ({
  code: `P-${String(i + 1).padStart(2, '0')}`, name, areaHa,
  location: location ? `kat. br. ${location}` : null,
}));

// Unknown categories remain OSTALO; capacities/models are not supplied by the source.
export const machines = [
  ['agregati za luk', 'OSTALO'], ['ares 657', 'TRAKTOR'], ['ares 816', 'TRAKTOR'],
  ['arion', 'TRAKTOR'], ['arion-cebis', 'TRAKTOR'], ['audi', 'OSTALO'],
  ['axion', 'TRAKTOR'], ['bager', 'OSTALO'], ['duster-ks', 'OSTALO'],
  ['duster-ol', 'OSTALO'], ['zlatko', 'OSTALO'], ['feketic agregati', 'OSTALO'],
  ['fendt', 'TRAKTOR'], ['ford', 'OSTALO'], ['gaz', 'OSTALO'], ['golf', 'OSTALO'],
  ['hilux', 'OSTALO'], ['VS051Ck', 'OSTALO'], ['VS036Li', 'OSTALO'],
  ['VS054PB', 'OSTALO'], ['VS053CK', 'OSTALO'], ['VS023UJ', 'OSTALO'],
  ['john deer', 'TRAKTOR'], ['lexion', 'KOMBAJN'], ['ult', 'OSTALO'],
  ['man-stefan', 'KAMION'], ['marko viskovic', 'OSTALO'], ['mega', 'KOMBAJN'],
  ['repa-zalivanje', 'OSTALO'], ['ruk.klub', 'OSTALO'], ['rus', 'TRAKTOR'],
  ['sprinter', 'OSTALO'], ['viljuskar', 'VILJUSKAR'], ['teren', 'OSTALO'],
  ['putni', 'OSTALO'], ['Secerana', 'OSTALO'], ['Topovi', 'OSTALO'], ['agregat', 'OSTALO'],
].map(([name, type], i) => ({
  id: `production-machine-${String(i + 1).padStart(2, '0')}`, name, type,
  tankCapacityLiters: null,
  regNumber: /^VS\d{3}[a-z]{2}$/i.test(name) ? name.toUpperCase() : null,
}));

export function workerEmail(name) {
  const slug = name.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'dj')
    .toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  return `${slug}@nandra.rs`;
}
