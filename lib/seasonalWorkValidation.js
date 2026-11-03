import { z } from "zod";
import { money, multiplyMoney } from "./money.js";

// Preserve numeric strings used by existing forms, without coercing booleans,
// arrays, whitespace or arbitrary objects into financial values.
const numeric = z.union([
  z.number(),
  z.string().trim().min(1).transform((value) => Number(value)),
]).pipe(z.number().finite());
const wage = numeric.pipe(z.number().positive("Satnica mora biti pozitivan konačan broj.").max(9999999999999.99).refine((value) => money(value) > 0, "Satnica mora biti najmanje 0,01 RSD."));
const hours = numeric.pipe(z.number().positive("Radni sati moraju biti pozitivan konačan broj.").max(24, "Radni dan ne može trajati duže od 24 sata."));
const time = z.preprocess((value) => value === "" ? null : value,
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Vreme mora biti u formatu HH:mm.").nullable().optional());

export const seasonalLogInput = z.object({
  hourlyRate: z.preprocess((value) => value === "" ? null : value, wage.nullable().optional()),
  hourlyRateApplied: z.preprocess((value) => value === "" ? null : value, wage.nullable().optional()),
  hoursWorked: z.preprocess((value) => value === null || value === "" ? undefined : value, hours.optional()),
  dailyWage: z.preprocess((value) => value === "" ? null : value, wage.nullable().optional()),
  dailyWageApplied: z.preprocess((value) => value === "" ? null : value, wage.nullable().optional()),
  breakMinutes: numeric.pipe(z.number().int().nonnegative().max(1440)).optional(),
  groupCount: z.preprocess((value) => value === "" ? null : value,
    numeric.pipe(z.number().int().positive()).nullable().optional()),
  startTime: time,
  endTime: time,
}).passthrough();

export const validateWorkHours = (value) => hours.parse(value);
export const validateAppliedWage = (value) => wage.nullable().parse(value);

// Snapshot the agreed rate; never reinterpret a legacy daily wage as an hourly rate.
export function seasonalEarnings(hoursWorked, hourlyRate) {
  const validHours = validateWorkHours(hoursWorked);
  const appliedRate = money(wage.parse(hourlyRate));
  const dailyWageApplied = multiplyMoney(validHours, appliedRate);
  z.number().max(9999999999999.99, "Obračunata zarada je prevelika.").parse(dailyWageApplied);
  return { hourlyRateApplied: appliedRate, dailyWageApplied };
}
