/**
 * better-payment/bin: offline Turkish BIN table lookup.
 * Tree-shakable subpath export with zero bundle overhead on main package.
 */
export { lookupBin } from './lookup';
export { BIN_TABLE, type RawBinTuple } from './data';
export type { BinInfo } from './types';
