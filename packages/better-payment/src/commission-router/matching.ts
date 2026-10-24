// Turning a merchant rate table and one payment into an explainable set of
// eligible providers. Everything here is pure and deterministic: no clock other
// than the `now` passed in, no I/O, no floats in the comparison path.
import type { CommissionRate, RouterBinInfo } from './rates';
import { amountMinor, formatMinor, percentCostMinorScaled } from './rates';
import type { ExclusionReason } from './types';

export interface QuoteCriteria {
  amountMinor: number;
  /** Uppercased 3-letter currency */
  currency: string;
  installment: number;
  threeDS: boolean;
  /** null when no BIN lookup is configured or the BIN is unknown */
  card: RouterBinInfo | null;
  /** Milliseconds since the epoch, for validity dates */
  now: number;
}

/** A rate line with its maths precomputed once, at plugin construction */
export interface PreparedLine {
  /** Index in the configured table, used in quotes and stable tie-breaking */
  index: number;
  provider: string;
  /** Configured percentage, as a string ('2.49') */
  rate: string;
  /** Fixed fee, formatted with 2 decimals ('0.00') */
  fixed: string;
  /** Percentage scaled by 10^4: '2.49' -> 24_900n */
  rateScaled: bigint;
  fixedMinor: number;
  minMinor: number | null;
  maxMinor: number | null;
  currencies: string[] | null;
  installments: number[] | null;
  threeDS: boolean | null;
  validFrom: number | null;
  validTo: number | null;
  cardFamily: string[] | null;
  cardAssociation: string[] | null;
  cardType: string[] | null;
  bankName: string[] | null;
  commercial: boolean | null;
}

function toList(value: string | string[] | undefined): string[] | null {
  if (value === undefined) return null;
  return (Array.isArray(value) ? value : [value]).map((item) => item.trim().toLowerCase());
}

/**
 * Validates and normalizes the table for one plugin. The table has already
 * passed `validateRateTable`; this only converts decimals to integers and
 * lowercases the card filters.
 */
export function prepareRates(rates: readonly CommissionRate[]): PreparedLine[] {
  return rates.map((line, index) => {
    const fixedMinor =
      line.fixed === undefined ? 0 : amountMinor(line.fixed, `rates[${index}].fixed`);
    return {
      index,
      provider: line.provider,
      rate: String(line.rate).trim(),
      fixed: formatMinor(fixedMinor),
      rateScaled: parseRate(String(line.rate).trim()),
      fixedMinor,
      minMinor: line.minAmount === undefined ? null : amountMinor(line.minAmount, 'minAmount'),
      maxMinor: line.maxAmount === undefined ? null : amountMinor(line.maxAmount, 'maxAmount'),
      currencies: line.currencies ? line.currencies.map((code) => code.toUpperCase()) : null,
      installments: line.installments ? [...line.installments] : null,
      threeDS: line.threeDS === undefined ? null : line.threeDS,
      validFrom: line.validFrom === undefined ? null : Date.parse(line.validFrom),
      validTo: line.validTo === undefined ? null : Date.parse(line.validTo),
      cardFamily: toList(line.cardFamily),
      cardAssociation: toList(line.cardAssociation),
      cardType: toList(line.cardType),
      bankName: toList(line.bankName),
      commercial: line.commercial === undefined ? null : line.commercial,
    };
  });
}

/** Parses a validated percentage into its 10^4-scaled integer form */
function parseRate(rate: string): bigint {
  const [whole, fraction = ''] = rate.split('.');
  return BigInt(whole + (fraction + '0000').slice(0, 4));
}

interface LineFailure {
  reason: ExclusionReason;
  detail: string;
}

function cardValue(value: string | undefined): string | undefined {
  const text = value?.trim().toLowerCase();
  return text ? text : undefined;
}

function matchesCardText(
  expected: string[],
  actual: string | undefined
): 'ok' | 'unknown' | 'mismatch' {
  if (actual === undefined) return 'unknown';
  return expected.includes(actual) ? 'ok' : 'mismatch';
}

/** Every reason this line does not apply to the payment, in a stable order */
function collectFailures(line: PreparedLine, criteria: QuoteCriteria): LineFailure[] {
  const failures: LineFailure[] = [];
  const { card } = criteria;

  if (line.validFrom !== null && criteria.now < line.validFrom) {
    failures.push({ reason: 'rate-not-yet-valid', detail: 'the rate line is not valid yet' });
  }
  if (line.validTo !== null && criteria.now >= line.validTo) {
    failures.push({ reason: 'rate-expired', detail: 'the rate line has expired' });
  }
  if (line.minMinor !== null && criteria.amountMinor < line.minMinor) {
    failures.push({
      reason: 'amount-below-min',
      detail: `the amount is below the line's minimum of ${formatMinor(line.minMinor)}`,
    });
  }
  if (line.maxMinor !== null && criteria.amountMinor > line.maxMinor) {
    failures.push({
      reason: 'amount-above-max',
      detail: `the amount is above the line's maximum of ${formatMinor(line.maxMinor)}`,
    });
  }
  if (line.currencies !== null && !line.currencies.includes(criteria.currency)) {
    failures.push({
      reason: 'currency-not-supported',
      detail: `the line covers ${line.currencies.join(', ')}, not ${criteria.currency}`,
    });
  }
  if (line.installments !== null && !line.installments.includes(criteria.installment)) {
    failures.push({
      reason: 'installment-not-supported',
      detail: `installment ${criteria.installment} is not in [${line.installments.join(', ')}]`,
    });
  }
  if (line.threeDS !== null && line.threeDS !== criteria.threeDS) {
    failures.push({
      reason: 'threeds-not-supported',
      detail: line.threeDS
        ? 'the line is for 3D Secure payments only'
        : 'the line is for non-3DS payments only',
    });
  }
  if (line.cardFamily !== null) {
    const match = matchesCardText(line.cardFamily, cardValue(card?.cardFamily));
    if (match === 'unknown') {
      failures.push({
        reason: 'card-unknown',
        detail: 'the card family is unknown (no BIN lookup)',
      });
    } else if (match === 'mismatch') {
      failures.push({
        reason: 'card-mismatch',
        detail: `card family '${card?.cardFamily}' is not ${line.cardFamily.join(', ')}`,
      });
    }
  }
  if (line.cardAssociation !== null) {
    const match = matchesCardText(line.cardAssociation, cardValue(card?.cardAssociation));
    if (match === 'unknown') {
      failures.push({
        reason: 'card-unknown',
        detail: 'the card association is unknown (no BIN lookup)',
      });
    } else if (match === 'mismatch') {
      failures.push({
        reason: 'card-mismatch',
        detail: `card association '${card?.cardAssociation}' is not ${line.cardAssociation.join(', ')}`,
      });
    }
  }
  if (line.cardType !== null) {
    const match = matchesCardText(line.cardType, cardValue(card?.cardType));
    if (match === 'unknown') {
      failures.push({ reason: 'card-unknown', detail: 'the card type is unknown (no BIN lookup)' });
    } else if (match === 'mismatch') {
      failures.push({
        reason: 'card-mismatch',
        detail: `card type '${card?.cardType}' is not ${line.cardType.join(', ')}`,
      });
    }
  }
  if (line.bankName !== null) {
    const match = matchesCardText(line.bankName, cardValue(card?.bankName));
    if (match === 'unknown') {
      failures.push({
        reason: 'card-unknown',
        detail: 'the issuing bank is unknown (no BIN lookup)',
      });
    } else if (match === 'mismatch') {
      failures.push({
        reason: 'card-mismatch',
        detail: `issuing bank '${card?.bankName}' is not ${line.bankName.join(', ')}`,
      });
    }
  }
  if (line.commercial !== null) {
    if (card?.commercial === undefined) {
      failures.push({
        reason: 'card-unknown',
        detail: 'whether the card is commercial is unknown (no BIN lookup)',
      });
    } else if (card.commercial !== line.commercial) {
      failures.push({
        reason: 'card-mismatch',
        detail: line.commercial ? 'the card is not commercial' : 'the card is commercial',
      });
    }
  }
  return failures;
}

export type ProviderEvaluation =
  | {
      provider: string;
      eligible: true;
      line: PreparedLine;
      costMinor: number;
    }
  | {
      provider: string;
      eligible: false;
      reason: ExclusionReason;
      detail: string;
      rateIndex?: number;
    };

/**
 * Evaluates one provider. When several lines apply, the cheapest one is the
 * provider's cost (the merchant's contract is the best applicable line). When
 * none applies, the reason reported is from the line that came closest, so the
 * quote explains what the merchant would have to change.
 */
export function evaluateProvider(
  provider: string,
  lines: readonly PreparedLine[],
  criteria: QuoteCriteria
): ProviderEvaluation {
  const providerLines = lines.filter((line) => line.provider === provider);
  if (providerLines.length === 0) {
    return {
      provider,
      eligible: false,
      reason: 'no-rate-line',
      detail: 'no rate line for this provider',
    };
  }

  let best: { line: PreparedLine; costMinor: number } | null = null;
  let closest: { line: PreparedLine; failures: LineFailure[] } | null = null;

  for (const line of providerLines) {
    const failures = collectFailures(line, criteria);
    if (failures.length === 0) {
      const costMinor =
        percentCostMinorScaled(criteria.amountMinor, line.rateScaled) + line.fixedMinor;
      if (
        best === null ||
        costMinor < best.costMinor ||
        (costMinor === best.costMinor && line.index < best.line.index)
      ) {
        best = { line, costMinor };
      }
    } else if (
      closest === null ||
      failures.length < closest.failures.length ||
      (failures.length === closest.failures.length && line.index < closest.line.index)
    ) {
      closest = { line, failures };
    }
  }

  if (best) return { provider, eligible: true, line: best.line, costMinor: best.costMinor };

  const failure = closest?.failures[0];
  return {
    provider,
    eligible: false,
    reason: failure?.reason ?? 'no-rate-line',
    detail: failure?.detail ?? 'no rate line applies',
    rateIndex: closest?.line.index,
  };
}
