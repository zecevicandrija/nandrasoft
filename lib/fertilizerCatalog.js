/**
 * Standardni šifarnik osnovnih đubriva za firmu NANDRA.
 * NAPOMENA: Početno stanje (currentStock) je UVEK 0 u čistom šifarniku.
 * Zaduživanje zaliha se vrši isključivo preko stvarnih prijemnica (nabavke)
 * ili inventurnog početnog stanja sa pratećim FertilizerMovement zapisima.
 */
export const DEFAULT_FERTILIZER_CATALOG = [
  {
    name: "NPK 16:16:16",
    type: "MINERALNO_GRANULISANO",
    unit: "KG",
    currentStock: 0,
    minStockWarning: 1000,
    defaultPricePerUnit: 68,
    defaultLocation: "Glavni magacin B1",
    description: "Osnovno kompleksno mineralno đubrivo za jesenju i predsetvenu obradu",
  },
  {
    name: "UREA 46% N",
    type: "MINERALNO_GRANULISANO",
    unit: "KG",
    currentStock: 0,
    minStockWarning: 1000,
    defaultPricePerUnit: 74,
    defaultLocation: "Glavni magacin B1",
    description: "Visokokoncentrovano azotno đubrivo za prihranu ratarskih i povrtarskih kultura",
  },
  {
    name: "KAN 27% N",
    type: "MINERALNO_GRANULISANO",
    unit: "KG",
    currentStock: 0,
    minStockWarning: 1000,
    defaultPricePerUnit: 52,
    defaultLocation: "Magacin pod nadstrešnicom",
    description: "Krečni amonijum nitrat za prihranu u vegetaciji",
  },
  {
    name: "YaraMila Complex 12-11-18",
    type: "MINERALNO_GRANULISANO",
    unit: "KG",
    currentStock: 0,
    minStockWarning: 800,
    defaultPricePerUnit: 115,
    defaultLocation: "Sektor A - Boks 2",
    description: "Specijalizovano bezhlorno NPK đubrivo sa mikroelementima za luk i povrće",
  },
  {
    name: "YaraTera Kristalon 18-18-18",
    type: "VODOTOPIVO_FERTIRIGACIJA",
    unit: "KG",
    currentStock: 0,
    minStockWarning: 250,
    defaultPricePerUnit: 310,
    defaultLocation: "Magacin fertirigacije",
    description: "Vodotopivo kristalno đubrivo za prihranu kroz sistem kap-po-kap",
  },
];

