import { Prisma } from "@prisma/client";

const Decimal = Prisma.Decimal;
// Preserve the numeric API without silently losing decimal digits at its edge.
export function decimalNumber(value) {
  const decimal = new Decimal(value);
  const number = decimal.toNumber();
  if (!Number.isFinite(number) || !new Decimal(number).equals(decimal)) {
    throw new RangeError("Novčani iznos je izvan preciznog numeričkog opsega API-ja.");
  }
  return number;
}
export const money = (value) => decimalNumber(new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
export const rate = (value) => decimalNumber(new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP));
export const addMoney = (...values) => money(values.reduce((sum, value) => sum.plus(money(value ?? 0)), new Decimal(0)));
export const subtractMoney = (a, b) => money(new Decimal(money(a ?? 0)).minus(money(b ?? 0)));
export const multiplyMoney = (quantity, price) => money(new Decimal(quantity).times(rate(price)));
export const divideRate = (amount, quantity) => rate(new Decimal(money(amount)).dividedBy(quantity));

// Decimal stays exact in PostgreSQL. Existing routes and clients consume numbers;
// convert only at this compatibility boundary, refusing lossy conversions.
export function numericDecimals(value) {
  if (Decimal.isDecimal(value)) return decimalNumber(value);
  if (Array.isArray(value)) return value.map(numericDecimals);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, numericDecimals(item)]));
  }
  return value;
}
