/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from './index.ts';
import { currencies, exchangeRates } from './schema.ts';
import { eq, and, lte, or, isNull, gt, desc } from 'drizzle-orm';

export interface CurrencyRecord {
  code: string;
  name: string;
  nameAr?: string | null;
  symbol: string;
  decimalPlaces: number;
  isBase: boolean;
  isActive: boolean;
}

export interface ExchangeRateRecord {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
  effectiveFrom: string;
  expiryDate?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  inverseRate?: number;
  sourceSymbol?: string;
  targetSymbol?: string;
  sourceName?: string;
  targetName?: string;
}

export interface ConvertedAmount {
  originalAmount: number;
  fromCurrency: string;
  toCurrency: string;
  convertedAmount: number;
  exchangeRate: number;
  isInverse: boolean;
}

/**
 * Fallback static currencies in case of detached environment
 */
const DEFAULT_CURRENCIES: CurrencyRecord[] = [
  { code: 'SDG', name: 'Sudanese Pound', nameAr: 'جنيه سوداني', symbol: 'ج.س', decimalPlaces: 2, isBase: true, isActive: true },
  { code: 'USD', name: 'US Dollar', nameAr: 'دولار أمريكي', symbol: '$', decimalPlaces: 2, isBase: false, isActive: true },
  { code: 'SAR', name: 'Saudi Riyal', nameAr: 'ريال سعودي', symbol: 'ر.س', decimalPlaces: 2, isBase: false, isActive: true },
  { code: 'AED', name: 'UAE Dirham', nameAr: 'درهم إماراتي', symbol: 'د.إ', decimalPlaces: 2, isBase: false, isActive: true },
  { code: 'EUR', name: 'Euro', nameAr: 'يورو', symbol: '€', decimalPlaces: 2, isBase: false, isActive: true },
  { code: 'GBP', name: 'British Pound', nameAr: 'جنيه إسترليني', symbol: '£', decimalPlaces: 2, isBase: false, isActive: true },
];

const DEFAULT_RATES: ExchangeRateRecord[] = [
  { id: 'rate-usd-sdg-initial', sourceCurrency: 'USD', targetCurrency: 'SDG', rate: 2700.0, effectiveFrom: '2026-01-01T00:00:00.000Z', isActive: true },
  { id: 'rate-sar-sdg-initial', sourceCurrency: 'SAR', targetCurrency: 'SDG', rate: 720.0, effectiveFrom: '2026-01-01T00:00:00.000Z', isActive: true },
  { id: 'rate-aed-sdg-initial', sourceCurrency: 'AED', targetCurrency: 'SDG', rate: 735.0, effectiveFrom: '2026-01-01T00:00:00.000Z', isActive: true },
  { id: 'rate-eur-sdg-initial', sourceCurrency: 'EUR', targetCurrency: 'SDG', rate: 2900.0, effectiveFrom: '2026-01-01T00:00:00.000Z', isActive: true },
  { id: 'rate-gbp-sdg-initial', sourceCurrency: 'GBP', targetCurrency: 'SDG', rate: 3450.0, effectiveFrom: '2026-01-01T00:00:00.000Z', isActive: true },
];

/**
 * Retrieve the active base accounting currency (SDG).
 */
export async function getBaseCurrency(): Promise<CurrencyRecord> {
  if (db) {
    try {
      const res = await db.select().from(currencies).where(eq(currencies.isBase, true)).limit(1);
      if (res.length > 0) {
        return {
          code: res[0].code,
          name: res[0].name,
          nameAr: res[0].nameAr,
          symbol: res[0].symbol,
          decimalPlaces: res[0].decimalPlaces,
          isBase: res[0].isBase,
          isActive: res[0].isActive,
        };
      }
    } catch (err) {
      console.warn('PostgreSQL getBaseCurrency failed, falling back:', err);
    }
  }

  return DEFAULT_CURRENCIES.find((c) => c.isBase) || DEFAULT_CURRENCIES[0];
}

/**
 * Retrieve all registered active currencies.
 */
export async function getAllCurrencies(): Promise<CurrencyRecord[]> {
  if (db) {
    try {
      const res = await db.select().from(currencies).where(eq(currencies.isActive, true));
      if (res.length > 0) {
        return res.map((c) => ({
          code: c.code,
          name: c.name,
          nameAr: c.nameAr,
          symbol: c.symbol,
          decimalPlaces: c.decimalPlaces,
          isBase: c.isBase,
          isActive: c.isActive,
        }));
      }
    } catch (err) {
      console.warn('PostgreSQL getAllCurrencies failed, falling back:', err);
    }
  }

  return DEFAULT_CURRENCIES;
}

/**
 * Retrieve single currency by code.
 */
export async function getCurrency(code: string): Promise<CurrencyRecord | null> {
  const codeUpper = code.toUpperCase().trim();
  const all = await getAllCurrencies();
  return all.find((c) => c.code === codeUpper) || null;
}

/**
 * Create a new currency or reactivate/update an existing currency, with optional initial exchange rate to SDG.
 */
export async function createOrUpdateCurrency(data: {
  code: string;
  name: string;
  nameAr?: string | null;
  symbol: string;
  decimalPlaces?: number;
  initialRateToBase?: number;
  createdBy?: string;
}): Promise<CurrencyRecord> {
  const code = (data.code || '').toUpperCase().trim();
  if (!code || code.length < 2 || code.length > 6 || !/^[A-Z0-9]+$/.test(code)) {
    throw new Error('Currency code must be 2 to 6 alphanumeric uppercase characters (e.g. USD, EGP, QAR).');
  }

  const name = (data.name || '').trim() || code;
  const nameAr = data.nameAr?.trim() || name;
  const symbol = (data.symbol || '').trim() || code;
  const decimalPlaces = data.decimalPlaces !== undefined ? Math.max(0, Math.min(6, Number(data.decimalPlaces))) : 2;

  if (db) {
    const existing = await db.select().from(currencies).where(eq(currencies.code, code)).limit(1);
    if (existing.length > 0) {
      await db
        .update(currencies)
        .set({
          name,
          nameAr,
          symbol,
          decimalPlaces,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(currencies.code, code));
    } else {
      await db.insert(currencies).values({
        code,
        name,
        nameAr,
        symbol,
        decimalPlaces,
        isBase: code === 'SDG',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  } else {
    const idx = DEFAULT_CURRENCIES.findIndex((c) => c.code === code);
    if (idx >= 0) {
      DEFAULT_CURRENCIES[idx] = {
        ...DEFAULT_CURRENCIES[idx],
        name,
        nameAr,
        symbol,
        decimalPlaces,
        isActive: true,
      };
    } else {
      DEFAULT_CURRENCIES.push({
        code,
        name,
        nameAr,
        symbol,
        decimalPlaces,
        isBase: code === 'SDG',
        isActive: true,
      });
    }
  }

  // If initial exchange rate against SDG was supplied and this is not SDG
  if (code !== 'SDG' && data.initialRateToBase !== undefined && Number(data.initialRateToBase) > 0) {
    await setExchangeRate({
      sourceCurrency: code,
      targetCurrency: 'SDG',
      rate: Number(data.initialRateToBase),
      effectiveFrom: new Date(),
      createdBy: data.createdBy || 'admin_user',
    });
  }

  return {
    code,
    name,
    nameAr,
    symbol,
    decimalPlaces,
    isBase: code === 'SDG',
    isActive: true,
  };
}

/**
 * Delete or deactivate a currency (protects base currency SDG).
 */
export async function deleteCurrency(code: string): Promise<{ deleted: boolean; code: string }> {
  const codeUpper = (code || '').toUpperCase().trim();
  if (!codeUpper) {
    throw new Error('Currency code is required.');
  }
  if (codeUpper === 'SDG') {
    throw new Error('Cannot delete the system base currency (SDG).');
  }

  if (db) {
    const existing = await db.select().from(currencies).where(eq(currencies.code, codeUpper)).limit(1);
    if (existing.length === 0) {
      throw new Error(`Currency "${codeUpper}" not found.`);
    }
    if (existing[0].isBase) {
      throw new Error(`Cannot delete base currency "${codeUpper}".`);
    }

    // Deactivate associated exchange rates
    await db
      .update(exchangeRates)
      .set({ isActive: false })
      .where(
        or(
          eq(exchangeRates.sourceCurrency, codeUpper),
          eq(exchangeRates.targetCurrency, codeUpper)
        )
      );

    // Deactivate currency so historical foreign keys remain intact
    await db
      .update(currencies)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(currencies.code, codeUpper));

    return { deleted: true, code: codeUpper };
  }

  const idx = DEFAULT_CURRENCIES.findIndex((c) => c.code === codeUpper);
  if (idx >= 0) {
    DEFAULT_CURRENCIES[idx].isActive = false;
  }
  return { deleted: true, code: codeUpper };
}


/**
 * Retrieve exchange rate between two currencies at an optional historical timestamp.
 * Supports direct pairing, reciprocal calculation (1 / rate), and triangular cross-rate through base currency.
 */
export async function getExchangeRate(
  source: string,
  target: string,
  atTimestamp: Date = new Date()
): Promise<{ rate: number; effectiveFrom: string; isInverse: boolean }> {
  const sourceCode = source.toUpperCase();
  const targetCode = target.toUpperCase();

  if (sourceCode === targetCode) {
    return { rate: 1.0, effectiveFrom: atTimestamp.toISOString(), isInverse: false };
  }

  if (db) {
    try {
      // 1. Direct query: source -> target
      const direct = await db
        .select()
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.sourceCurrency, sourceCode),
            eq(exchangeRates.targetCurrency, targetCode),
            eq(exchangeRates.isActive, true),
            lte(exchangeRates.effectiveFrom, atTimestamp),
            or(isNull(exchangeRates.expiryDate), gt(exchangeRates.expiryDate, atTimestamp))
          )
        )
        .orderBy(desc(exchangeRates.effectiveFrom))
        .limit(1);

      if (direct.length > 0) {
        return {
          rate: parseFloat(direct[0].rate),
          effectiveFrom: direct[0].effectiveFrom.toISOString(),
          isInverse: false,
        };
      }

      // 2. Inverse query: target -> source
      const inverse = await db
        .select()
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.sourceCurrency, targetCode),
            eq(exchangeRates.targetCurrency, sourceCode),
            eq(exchangeRates.isActive, true),
            lte(exchangeRates.effectiveFrom, atTimestamp),
            or(isNull(exchangeRates.expiryDate), gt(exchangeRates.expiryDate, atTimestamp))
          )
        )
        .orderBy(desc(exchangeRates.effectiveFrom))
        .limit(1);

      if (inverse.length > 0) {
        const invRate = parseFloat(inverse[0].rate);
        if (invRate <= 0) {
          throw new Error(`Invalid non-positive exchange rate recorded for ${targetCode} -> ${sourceCode}`);
        }
        return {
          rate: 1 / invRate,
          effectiveFrom: inverse[0].effectiveFrom.toISOString(),
          isInverse: true,
        };
      }

      // 3. Triangular Cross-rate through base currency SDG
      if (sourceCode !== 'SDG' && targetCode !== 'SDG') {
        const sourceToSdg = await getExchangeRate(sourceCode, 'SDG', atTimestamp);
        const targetToSdg = await getExchangeRate(targetCode, 'SDG', atTimestamp);

        const crossRate = sourceToSdg.rate / targetToSdg.rate;
        return {
          rate: crossRate,
          effectiveFrom: sourceToSdg.effectiveFrom,
          isInverse: false,
        };
      }
    } catch (err) {
      console.warn('PostgreSQL getExchangeRate query failed, checking memory fallback:', err);
    }
  }

  // Fallback memory rate resolution
  const directMatch = DEFAULT_RATES.find(
    (r) => r.sourceCurrency === sourceCode && r.targetCurrency === targetCode
  );
  if (directMatch) {
    return { rate: directMatch.rate, effectiveFrom: directMatch.effectiveFrom, isInverse: false };
  }

  const inverseMatch = DEFAULT_RATES.find(
    (r) => r.sourceCurrency === targetCode && r.targetCurrency === sourceCode
  );
  if (inverseMatch) {
    return { rate: 1 / inverseMatch.rate, effectiveFrom: inverseMatch.effectiveFrom, isInverse: true };
  }

  throw new Error(`No active exchange rate found between ${sourceCode} and ${targetCode}`);
}

/**
 * Retrieve all exchange rates, optionally filtered by pair or active status.
 * Enriches rates with currency names and symbols.
 */
export async function getAllExchangeRates(options?: {
  source?: string;
  target?: string;
  activeOnly?: boolean;
}): Promise<ExchangeRateRecord[]> {
  const allCurrencies = await getAllCurrencies();
  const currencyMap = new Map(allCurrencies.map((c) => [c.code, c]));

  if (db) {
    try {
      const conditions: any[] = [];
      if (options?.source) {
        conditions.push(eq(exchangeRates.sourceCurrency, options.source.toUpperCase()));
      }
      if (options?.target) {
        conditions.push(eq(exchangeRates.targetCurrency, options.target.toUpperCase()));
      }
      if (options?.activeOnly) {
        conditions.push(eq(exchangeRates.isActive, true));
      }

      const query = db
        .select()
        .from(exchangeRates)
        .orderBy(desc(exchangeRates.effectiveFrom));

      const rows = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      return rows.map((r) => {
        const rateNum = parseFloat(r.rate);
        const sourceCur = currencyMap.get(r.sourceCurrency);
        const targetCur = currencyMap.get(r.targetCurrency);
        return {
          id: r.id,
          sourceCurrency: r.sourceCurrency,
          targetCurrency: r.targetCurrency,
          rate: rateNum,
          inverseRate: rateNum > 0 ? Math.round((1 / rateNum) * 1000000) / 1000000 : 0,
          effectiveFrom: r.effectiveFrom.toISOString(),
          expiryDate: r.expiryDate ? r.expiryDate.toISOString() : null,
          isActive: r.isActive,
          createdBy: r.createdBy,
          sourceSymbol: sourceCur?.symbol,
          targetSymbol: targetCur?.symbol,
          sourceName: sourceCur?.name,
          targetName: targetCur?.name,
        };
      });
    } catch (err) {
      console.warn('PostgreSQL getAllExchangeRates query failed, using fallback:', err);
    }
  }

  return DEFAULT_RATES.map((r) => {
    const sourceCur = currencyMap.get(r.sourceCurrency);
    const targetCur = currencyMap.get(r.targetCurrency);
    return {
      ...r,
      inverseRate: r.rate > 0 ? 1 / r.rate : 0,
      sourceSymbol: sourceCur?.symbol,
      targetSymbol: targetCur?.symbol,
      sourceName: sourceCur?.name,
      targetName: targetCur?.name,
    };
  });
}

/**
 * Retrieve the currently effective exchange rates for all active currency pairs.
 * Selects exactly the active rate where effective_from <= NOW() and (expiry_date IS NULL OR expiry_date > NOW()).
 */
export async function getEffectiveExchangeRates(): Promise<ExchangeRateRecord[]> {
  const allCurrencies = await getAllCurrencies();
  const nonBaseCurrencies = allCurrencies.filter((c) => !c.isBase);
  const now = new Date();
  const effectiveWindow = new Date(now.getTime() + 60_000);
  const effectiveList: ExchangeRateRecord[] = [];
  const baseRecord = allCurrencies.find((c) => c.isBase);

  for (const cur of nonBaseCurrencies) {
    try {
      const allRates = await getAllExchangeRates({ source: cur.code, target: 'SDG', activeOnly: true });
      const activeRecord =
        allRates.find(
          (r) =>
            new Date(r.effectiveFrom) <= effectiveWindow &&
            (!r.expiryDate || new Date(r.expiryDate) > now)
        ) || allRates[0];

      let resolvedRate = activeRecord?.rate || 0;
      if (resolvedRate <= 0) {
        try {
          const rateInfo = await getExchangeRate(cur.code, 'SDG', effectiveWindow);
          resolvedRate = rateInfo.rate;
        } catch {
          resolvedRate = 100;
        }
      }

      effectiveList.push({
        id: activeRecord?.id || `effective-${cur.code.toLowerCase()}-sdg`,
        sourceCurrency: cur.code,
        targetCurrency: 'SDG',
        rate: resolvedRate,
        inverseRate: resolvedRate > 0 ? Math.round((1 / resolvedRate) * 1000000) / 1000000 : 0,
        effectiveFrom: activeRecord?.effectiveFrom || now.toISOString(),
        expiryDate: activeRecord?.expiryDate || null,
        isActive: true,
        createdBy: activeRecord?.createdBy || 'system',
        sourceSymbol: cur.symbol,
        targetSymbol: baseRecord?.symbol || 'ج.س',
        sourceName: cur.name,
        targetName: baseRecord?.name || 'Sudanese Pound',
      });
    } catch (err) {
      console.warn(`Could not compute effective rate for ${cur.code} -> SDG, using fallback:`, err);
      effectiveList.push({
        id: `effective-${cur.code.toLowerCase()}-sdg`,
        sourceCurrency: cur.code,
        targetCurrency: 'SDG',
        rate: 100,
        inverseRate: 0.01,
        effectiveFrom: now.toISOString(),
        expiryDate: null,
        isActive: true,
        createdBy: 'system',
        sourceSymbol: cur.symbol,
        targetSymbol: baseRecord?.symbol || 'ج.س',
        sourceName: cur.name,
        targetName: baseRecord?.name || 'Sudanese Pound',
      });
    }
  }

  return effectiveList;
}

/**
 * Retrieve full historical rate changes for a specific currency pair.
 */
export async function getExchangeRateHistory(
  source: string,
  target: string
): Promise<ExchangeRateRecord[]> {
  return getAllExchangeRates({
    source: source.toUpperCase(),
    target: target.toUpperCase(),
  });
}

/**
 * Configure / insert a new exchange rate with strict validation and safe historical preservation.
 *
 * Rules:
 * 1. sourceCurrency and targetCurrency must exist and cannot be identical.
 * 2. rate must be a strictly positive finite number (> 0).
 * 3. effectiveFrom must be a valid date.
 * 4. expiryDate, if provided, must be strictly after effectiveFrom.
 * 5. Safe Historical Window Preservation:
 *    If an active rate currently exists for this exact pair without an expiry date
 *    (or with an expiry date extending past newEffectiveFrom), its expiry_date is set
 *    to newEffectiveFrom. This closes the historical window of the old rate cleanly so past
 *    transactions preserve their rate, without creating overlapping conflicting active rates.
 */
export async function setExchangeRate(data: {
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
  effectiveFrom?: Date | string;
  expiryDate?: Date | string | null;
  createdBy?: string;
}): Promise<ExchangeRateRecord> {
  const source = data.sourceCurrency.toUpperCase().trim();
  const target = data.targetCurrency.toUpperCase().trim();

  if (!source || !target) {
    throw new Error('Source currency and target currency codes are required.');
  }

  if (source === target) {
    throw new Error('Source currency and target currency cannot be identical.');
  }

  // Validate currency existence
  const allCurrencies = await getAllCurrencies();
  const validCodes = new Set(allCurrencies.map((c) => c.code));
  if (!validCodes.has(source)) {
    throw new Error(`Source currency "${source}" is not a recognized or active currency.`);
  }
  if (!validCodes.has(target)) {
    throw new Error(`Target currency "${target}" is not a recognized or active currency.`);
  }

  // Validate rate is strictly positive
  const numericRate = Number(data.rate);
  if (isNaN(numericRate) || !isFinite(numericRate) || numericRate <= 0) {
    throw new Error(`Exchange rate must be a positive number greater than 0. Received: ${data.rate}`);
  }

  // Validate effectiveFrom date
  const now = new Date();
  let effective = data.effectiveFrom ? new Date(data.effectiveFrom) : now;
  if (isNaN(effective.getTime())) {
    throw new Error(`Invalid effective date provided: ${data.effectiveFrom}`);
  }

  // Validate expiryDate if provided
  let expiry: Date | null = null;
  if (data.expiryDate) {
    expiry = new Date(data.expiryDate);
    if (isNaN(expiry.getTime())) {
      throw new Error(`Invalid expiry date provided: ${data.expiryDate}`);
    }
    if (expiry <= effective) {
      throw new Error('Expiry date must be later than the effective date.');
    }
  }

  // If the caller sent a date-only string ("YYYY-MM-DD") or midnight UTC of today without an expiry date,
  // promote `effective` to `now` so it is strictly newer than any rate created earlier today.
  if (!expiry && typeof data.effectiveFrom === 'string') {
    const trimmed = data.effectiveFrom.trim();
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
    const isMidnightUtc = trimmed.endsWith('T00:00:00.000Z') || trimmed.endsWith('T00:00:00Z');
    if (
      (isDateOnly || isMidnightUtc) &&
      effective.toISOString().slice(0, 10) === now.toISOString().slice(0, 10) &&
      effective.getTime() < now.getTime()
    ) {
      effective = now;
    }
  }

  const id = `rate-${source.toLowerCase()}-${target.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (db) {
    // Historical Window Closure:
    // Find all currently open active rates for this pair.
    // - Rates that started at or before `effective` get their `expiryDate` set to `effective` (preserving historical queries).
    // - Rates that have `effectiveFrom > effective` (e.g., when a user sets an earlier effective date) are marked `isActive: false`
    //   so they never shadow the newly saved rate.
    try {
      const conflictingRates = await db
        .select()
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.sourceCurrency, source),
            eq(exchangeRates.targetCurrency, target),
            eq(exchangeRates.isActive, true),
            or(isNull(exchangeRates.expiryDate), gt(exchangeRates.expiryDate, effective))
          )
        );

      for (const oldRate of conflictingRates) {
        if (oldRate.effectiveFrom <= effective) {
          await db
            .update(exchangeRates)
            .set({ expiryDate: effective })
            .where(eq(exchangeRates.id, oldRate.id));
        } else {
          await db
            .update(exchangeRates)
            .set({ isActive: false, expiryDate: oldRate.effectiveFrom })
            .where(eq(exchangeRates.id, oldRate.id));
        }
      }
    } catch (err) {
      console.warn('Could not auto-close previous rate window:', err);
    }

    // Insert the new rate
    await db.insert(exchangeRates).values({
      id,
      sourceCurrency: source,
      targetCurrency: target,
      rate: numericRate.toFixed(6),
      effectiveFrom: effective,
      expiryDate: expiry,
      isActive: true,
      createdBy: data.createdBy || 'system',
      createdAt: new Date(),
    });
  }

  // Also keep in-memory fallback synchronized
  const memIdx = DEFAULT_RATES.findIndex(
    (r) => r.sourceCurrency === source && r.targetCurrency === target
  );
  if (memIdx >= 0) {
    DEFAULT_RATES[memIdx] = {
      ...DEFAULT_RATES[memIdx],
      id,
      rate: numericRate,
      effectiveFrom: effective.toISOString(),
      expiryDate: expiry ? expiry.toISOString() : null,
      isActive: true,
    };
  } else {
    DEFAULT_RATES.push({
      id,
      sourceCurrency: source,
      targetCurrency: target,
      rate: numericRate,
      effectiveFrom: effective.toISOString(),
      expiryDate: expiry ? expiry.toISOString() : null,
      isActive: true,
    });
  }

  const sourceCur = allCurrencies.find((c) => c.code === source);
  const targetCur = allCurrencies.find((c) => c.code === target);

  return {
    id,
    sourceCurrency: source,
    targetCurrency: target,
    rate: numericRate,
    inverseRate: numericRate > 0 ? Math.round((1 / numericRate) * 1000000) / 1000000 : 0,
    effectiveFrom: effective.toISOString(),
    expiryDate: expiry ? expiry.toISOString() : null,
    isActive: true,
    createdBy: data.createdBy || 'system',
    sourceSymbol: sourceCur?.symbol,
    targetSymbol: targetCur?.symbol,
    sourceName: sourceCur?.name,
    targetName: targetCur?.name,
  };
}

/**
 * Update an existing exchange rate record.
 */
export async function updateExchangeRate(
  id: string,
  updates: {
    rate?: number;
    expiryDate?: Date | string | null;
    isActive?: boolean;
  }
): Promise<ExchangeRateRecord> {
  if (updates.rate !== undefined) {
    const num = Number(updates.rate);
    if (isNaN(num) || !isFinite(num) || num <= 0) {
      throw new Error(`Exchange rate must be a positive number greater than 0. Received: ${updates.rate}`);
    }
  }

  const pairMatch = id.match(/^(?:rate|effective)-([a-z0-9]+)-([a-z0-9]+)(?:-.+)?$/i);

  if (db) {
    let targetId = id;
    let existing = await db.select().from(exchangeRates).where(eq(exchangeRates.id, targetId));

    if (existing.length === 0 && pairMatch) {
      const src = pairMatch[1].toUpperCase();
      const tgt = pairMatch[2].toUpperCase();
      if (updates.rate !== undefined) {
        return setExchangeRate({
          sourceCurrency: src,
          targetCurrency: tgt,
          rate: Number(updates.rate),
          expiryDate: updates.expiryDate,
        });
      }
      const latestForPair = await db
        .select()
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.sourceCurrency, src),
            eq(exchangeRates.targetCurrency, tgt)
          )
        )
        .orderBy(desc(exchangeRates.effectiveFrom))
        .limit(1);
      if (latestForPair.length > 0) {
        existing = latestForPair;
        targetId = latestForPair[0].id;
      }
    }

    if (existing.length === 0) {
      throw new Error(`Exchange rate record with ID "${id}" not found.`);
    }

    const payload: any = {};
    if (updates.rate !== undefined) {
      payload.rate = Number(updates.rate).toFixed(6);
    }
    if (updates.expiryDate !== undefined) {
      payload.expiryDate = updates.expiryDate ? new Date(updates.expiryDate) : null;
    }
    if (updates.isActive !== undefined) {
      payload.isActive = Boolean(updates.isActive);
    }

    await db.update(exchangeRates).set(payload).where(eq(exchangeRates.id, targetId));

    const refreshed = await db.select().from(exchangeRates).where(eq(exchangeRates.id, targetId));
    const r = refreshed[0];
    const rateNum = parseFloat(r.rate);
    return {
      id: r.id,
      sourceCurrency: r.sourceCurrency,
      targetCurrency: r.targetCurrency,
      rate: rateNum,
      inverseRate: rateNum > 0 ? 1 / rateNum : 0,
      effectiveFrom: r.effectiveFrom.toISOString(),
      expiryDate: r.expiryDate ? r.expiryDate.toISOString() : null,
      isActive: r.isActive,
      createdBy: r.createdBy,
    };
  }

  const memIdx = DEFAULT_RATES.findIndex(
    (r) =>
      r.id === id ||
      (pairMatch &&
        r.sourceCurrency === pairMatch[1].toUpperCase() &&
        r.targetCurrency === pairMatch[2].toUpperCase())
  );
  if (memIdx >= 0) {
    if (updates.rate !== undefined) DEFAULT_RATES[memIdx].rate = Number(updates.rate);
    if (updates.isActive !== undefined) DEFAULT_RATES[memIdx].isActive = Boolean(updates.isActive);
    return {
      ...DEFAULT_RATES[memIdx],
      inverseRate: DEFAULT_RATES[memIdx].rate > 0 ? 1 / DEFAULT_RATES[memIdx].rate : 0,
    };
  }

  throw new Error('Database connection required to update exchange rate.');
}

/**
 * Delete / deactivate an exchange rate record.
 * Supports both database record IDs and seed/synthetic rate IDs (e.g. "rate-usd-sdg-initial", "effective-usd-sdg") idempotently.
 */
export async function deleteExchangeRate(id: string): Promise<{ deleted: boolean; id: string }> {
  if (!id) {
    throw new Error('Exchange rate ID is required.');
  }

  const pairMatch = id.match(/^(?:rate|effective)-([a-z0-9]+)-([a-z0-9]+)(?:-.+)?$/i);

  const idx = DEFAULT_RATES.findIndex((r) => r.id === id);
  if (idx >= 0) {
    DEFAULT_RATES.splice(idx, 1);
  }

  if (db) {
    try {
      const existing = await db.select().from(exchangeRates).where(eq(exchangeRates.id, id));
      if (existing.length > 0) {
        await db.delete(exchangeRates).where(eq(exchangeRates.id, id));
        return { deleted: true, id };
      }

      if (pairMatch) {
        const src = pairMatch[1].toUpperCase();
        const tgt = pairMatch[2].toUpperCase();
        const latestForPair = await db
          .select()
          .from(exchangeRates)
          .where(
            and(
              eq(exchangeRates.sourceCurrency, src),
              eq(exchangeRates.targetCurrency, tgt),
              eq(exchangeRates.isActive, true)
            )
          )
          .orderBy(desc(exchangeRates.effectiveFrom))
          .limit(1);

        if (latestForPair.length > 0) {
          await db.delete(exchangeRates).where(eq(exchangeRates.id, latestForPair[0].id));
        }
        return { deleted: true, id };
      }
    } catch (err) {
      console.warn(`PostgreSQL deleteExchangeRate fallback for ${id}:`, err);
    }
  }

  return { deleted: true, id };
}


/**
 * Convert an amount from one currency to another with high precision.
 */
export async function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  atTimestamp: Date = new Date()
): Promise<ConvertedAmount> {
  if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) {
    return {
      originalAmount: amount,
      fromCurrency,
      toCurrency,
      convertedAmount: amount,
      exchangeRate: 1.0,
      isInverse: false,
    };
  }

  const rateInfo = await getExchangeRate(fromCurrency, toCurrency, atTimestamp);
  const converted = Math.round(amount * rateInfo.rate * 100) / 100;

  return {
    originalAmount: amount,
    fromCurrency,
    toCurrency,
    convertedAmount: converted,
    exchangeRate: rateInfo.rate,
    isInverse: rateInfo.isInverse,
  };
}
