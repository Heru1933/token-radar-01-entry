// Token Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks protocols that record no token yet — the launches still to come — by the value a
// token would carry if the protocol's record stayed as it is. Protocols that already trade are set
// aside in a separate live list with the market's own figures, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures, in four factors:
//
//   peer multiple  What the market already pays per dollar of TVL for a token in the same line of
//                  work: the median market-cap / TVL ratio of the snapshot's own listed protocols in
//                  the protocol's category, shrunk toward the global median when a category has few
//                  listed peers, and clamped to a sane band. No multiple is looked up by name.
//   growth         1 + clamp(change_7d, -40, 80) / 100 x 0.40: a week of TVL momentum, damped.
//   maturity       0.75 + 0.35 x min(age_days, 1460) / 1460: a protocol that has run for years with
//                  no token has a record a launch can be priced on; an unknown age scores the
//                  snapshot's median known age.
//   breadth        1 + 0.02 x min(chains - 1, 8): distribution across chains is worth a little.
//
//   implied = max(1, round(tvl_usd x multiple x growth x maturity x breadth))
//
// The board's floor is the snapshot's watchlist: every watchlist slug is ranked. Below the floor the
// radar applies the watchlist's own product screen — a candidate must record no token and must not be
// an exchange product, a versioned pool of another protocol, or a wrapped, staked or bridged product
// of an asset that already trades — and ranks everything that passes, earliest finds included.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_peers: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  shrink_peers: 4,
  multiple_floor: 0.05,
  multiple_cap: 2.5,
  growth_weight: 0.4,
  growth_floor: -40,
  growth_cap: 80,
  maturity_floor: 0.75,
  maturity_range: 0.35,
  maturity_days: 1460,
  breadth_per_chain: 0.02,
  breadth_max_extra: 8,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'launch-2';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 30;

/** One peer group's pricing: the multiple it gives and how many listed peers stand behind it. */
export interface PeerMultiple {
  multiple: number;
  peers: number;
  raw_median: number | null;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  global_peers: number;
  median_age_days: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list, or null. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** An exchange's own product line, by the name it begins with (the watchlist's rule). */
const EXCHANGE_LED = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** A wrapped or staked product's tell in its name (the watchlist's rule). */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are products of another protocol's asset, or an exchange itself (the watchlist's rule). */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * The product screen, the watchlist's own: a radar subject records no token and is not an exchange
 * product, a versioned pool, or a wrapped, staked or bridged product of an asset that already trades.
 */
export function isRadarSubject(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (EXCHANGE_LED.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  return true;
}

/**
 * What the market pays per TVL dollar, learned from the snapshot itself: for every category, the
 * median market-cap / TVL ratio of its listed protocols that record both figures, shrunk toward the
 * global median by the peer count and clamped to the model's band. A category with no listed peers
 * prices at the global median.
 */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, PeerMultiple>; global: PeerMultiple } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = median(all) ?? 0.2;
  const clampMult = (n: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, n));
  const global: PeerMultiple = { multiple: round4(clampMult(globalMedian)), peers: all.length, raw_median: round4(globalMedian) };
  const byCategory = new Map<string, PeerMultiple>();
  for (const [key, list] of ratios) {
    const raw = median(list)!;
    const shrunk = (list.length * raw + model.shrink_peers * globalMedian) / (list.length + model.shrink_peers);
    byCategory.set(key, { multiple: round4(clampMult(shrunk)), peers: list.length, raw_median: round4(raw) });
  }
  return { byCategory, global };
}

/** The snapshot's median known protocol age in days: the age an unlisted protocol is scored at. */
export function medianAgeDays(snapshot: Snapshot): number {
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  return Math.round(median(ages) ?? 365);
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: { byCategory: Map<string, PeerMultiple>; global: PeerMultiple },
  medianAge: number,
  model: ModelConstants = MODEL,
): { implied: number; peer: PeerMultiple; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const peer = multiples.byCategory.get(protocol.category ?? '') ?? multiples.global;
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? medianAge;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peer.multiple * growthMult * maturityMult * breadthMult));
  return { implied, peer, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is ranked, whatever the screen says.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other protocol that passes the product screen, at any size. The snapshot
  // starts at $5M of TVL, so the smallest row is still a protocol with a record, not a rumor.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRadarSubject(p)) chosen.set(p.slug, p);
  }
  const multiples = peerMultiples(snapshot, model);
  const medianAge = medianAgeDays(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, medianAge, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: s.peer.multiple,
      peer_count: s.peer.peers,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** A whole-dollar figure the way a reader scans it: $2.75B, $412M, $950K. */
function usdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, and the asset fees are paid in: a chain fact, not a guess. */
function gasFor(chain: string): { asset: string; cost: string } {
  switch (chain) {
    case 'Ethereum': return { asset: 'ETH', cost: 'about $8 in gas' };
    case 'Base': case 'Arbitrum': case 'Optimism': case 'Linea': case 'Scroll':
    case 'Blast': case 'Mantle': case 'Mode': case 'Taiko': case 'zkSync Era':
    case 'Unichain': case 'Ink': case 'Sonic': case 'World Chain': case 'Zora':
      return { asset: 'ETH', cost: 'under $0.50 in gas' };
    case 'Polygon': return { asset: 'POL', cost: 'under $0.05 in gas' };
    case 'Solana': return { asset: 'SOL', cost: 'under $0.10 in fees' };
    case 'Tron': return { asset: 'TRX', cost: 'about $2 in fees' };
    case 'Binance': return { asset: 'BNB', cost: 'about $0.30 in gas' };
    case 'Avalanche': return { asset: 'AVAX', cost: 'about $0.40 in gas' };
    case 'Sui': return { asset: 'SUI', cost: 'under $0.05 in fees' };
    case 'Near': return { asset: 'NEAR', cost: 'under $0.05 in fees' };
    case 'Gnosis': return { asset: 'xDAI', cost: 'under $0.05 in gas' };
    case 'Fantom': return { asset: 'FTM', cost: 'under $0.10 in gas' };
    case 'Celo': return { asset: 'CELO', cost: 'under $0.05 in gas' };
    case 'Berachain': return { asset: 'BERA', cost: 'under $0.20 in gas' };
    case 'Hyperliquid L1': return { asset: 'HYPE', cost: 'under $0.10 in fees' };
    case 'Bitcoin': return { asset: 'BTC', cost: 'about $2 in fees' };
    default: return { asset: 'the chain\'s gas token', cost: 'about $1 in gas' };
  }
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The protocol's run with no token, in words. */
function ageText(age: number | null): string {
  if (age === null) return 'an unrecorded span';
  if (age >= 730) return `${(age / 365).toFixed(1)} years`;
  if (age >= 60) return `${Math.round(age / 30)} months`;
  return `${age} days`;
}

/** One category's playbook: the opening position, the second action, and the weekly cadence. */
interface Playbook {
  open: string;
  deepen: string;
  weekly: string;
}

const PLAYBOOKS: Record<string, Playbook> = {
  'Lending': {
    open: 'Supply the USDC to {name}\'s largest market on {chain} and leave it earning.',
    deepen: 'Borrow no more than 25% of the supplied value, hold the borrow for a few days, then repay in full so the wallet records a complete borrow cycle.',
    weekly: 'adjust the position by a few dollars and confirm the health factor is comfortably above liquidation',
  },
  'Uncollateralized Lending': {
    open: 'Supply the USDC to {name}\'s main pool on {chain} under its lender terms.',
    deepen: 'Read the pool\'s borrower report and shift a small slice to a second pool if one is offered.',
    weekly: 'check the pool\'s repayment record and your accrued interest',
  },
  'Collateral Markets': {
    open: 'Supply the USDC as collateral in {name} on {chain} and keep the position unlevered.',
    deepen: 'Open and close one small collateralised borrow inside the week to record both sides of the market.',
    weekly: 'confirm the collateral ratio and top it up if it drifts',
  },
  'Collateral Management': {
    open: 'Deposit the USDC into {name}\'s managed collateral account on {chain}.',
    deepen: 'Move a small slice between two of its collateral strategies so the wallet shows an active choice.',
    weekly: 'read the strategy report and check your balance against it',
  },
  'Dexs': {
    open: 'Provide the capital, split evenly between USDC and the chain\'s main asset, to {name}\'s busiest pool on {chain}.',
    deepen: 'Route five swaps of $20 or more through {name} across the week, in both directions, so the wallet shows real flow rather than one deposit.',
    weekly: 'claim any trading fees and rebalance the position back to even',
  },
  'Yield': {
    open: 'Deposit the USDC into {name}\'s flagship yield vault on {chain}.',
    deepen: 'Put a second, smaller tranche into its next-largest vault so the wallet holds two distinct positions.',
    weekly: 'harvest or compound the yield once, and note the vault\'s rate against last week',
  },
  'Yield Aggregator': {
    open: 'Deposit the USDC into {name}\'s largest aggregator vault on {chain}.',
    deepen: 'Split a second tranche into a vault with a different underlying strategy.',
    weekly: 'compound the harvest once and check which strategy the vault rotated into',
  },
  'Liquidity Manager': {
    open: 'Deposit the USDC into {name}\'s managed liquidity position on {chain}.',
    deepen: 'Move a small slice to a second managed range so the wallet holds two positions.',
    weekly: 'check the position is still in range and claim its fees',
  },
  'Risk Curators': {
    open: 'Allocate the USDC to one {name}-curated vault on {chain}, choosing the vault with the longest published track record.',
    deepen: 'Read the curator\'s latest risk report, then move 10% of the position into a second curated vault.',
    weekly: 'check the vault\'s allocation drift and your share price against the report',
  },
  'Onchain Capital Allocator': {
    open: 'Allocate the USDC to one {name} vault on {chain}, choosing the vault with the largest existing deposit base.',
    deepen: 'Add a second, smaller allocation to a vault with a different mandate.',
    weekly: 'compare the two vaults\' share prices and note which the allocator is favouring',
  },
  'RWA': {
    open: 'Complete {name}\'s onboarding (identity checks where it asks) and subscribe the capital to its yield asset on {chain}.',
    deepen: 'Register for the asset\'s holder reports and hold the issued asset in the same wallet, unpledged.',
    weekly: 'check the published NAV or reserve report and confirm your balance matches it',
  },
  'Derivatives': {
    open: 'Deposit the USDC as margin on {name} and open one small hedged position: long and short the same asset in equal size.',
    deepen: 'Build at least $500 of total traded volume across several sessions, keeping every position hedged.',
    weekly: 'place one small hedged trade and close it before the week ends',
  },
  'Interest Rate Derivatives': {
    open: 'Deposit the USDC as margin on {name} and open one small fixed-versus-floating rate position.',
    deepen: 'Open a second position at a different tenor so the wallet shows two maturities.',
    weekly: 'check the mark on both positions and roll the nearer one',
  },
  'Options': {
    open: 'Buy one small, short-dated option on {name} with part of the capital and keep the rest as margin.',
    deepen: 'Sell the option back or let it settle, so the wallet records a full option cycle.',
    weekly: 'open one small option position and record its strike and expiry in the farm log',
  },
  'Options Vault': {
    open: 'Deposit the USDC into {name}\'s main options vault on {chain}.',
    deepen: 'Hold the vault shares through one full weekly options cycle.',
    weekly: 'check the vault\'s strike selection and your share price',
  },
  'CDP': {
    open: 'Deposit the capital in the chain\'s main collateral asset into {name} on {chain} and mint its stablecoin at under 40% of the maximum allowed.',
    deepen: 'Use part of the minted stablecoin inside one of {name}\'s own pools, then repay a slice of the debt.',
    weekly: 'check the collateral ratio and top it up before it drifts toward liquidation',
  },
  'CDP Manager': {
    open: 'Open a managed position in {name} on {chain} with the capital as collateral and a conservative debt ceiling.',
    deepen: 'Let the manager rebalance once, then repay a slice of the debt yourself.',
    weekly: 'review the manager\'s actions and your collateral ratio',
  },
  'Basis Trading': {
    open: 'Deposit the USDC into {name}\'s basis vault on {chain}.',
    deepen: 'Leave the vault shares untouched in the wallet so the holding period is unambiguous in any snapshot.',
    weekly: 'read the published funding-rate report and compound any payout back in',
  },
  'Farm': {
    open: 'Supply the USDC to {name} on {chain} and stake the receipt in its farm contract.',
    deepen: 'Harvest the first rewards and restake them once, so the wallet shows a full farm cycle.',
    weekly: 'harvest and restake the rewards',
  },
  'Leveraged Farming': {
    open: 'Supply the USDC to {name} on {chain} and open one loop at no more than 2x leverage.',
    deepen: 'Write the position\'s health factor in the farm log and set a weekly calendar check for it.',
    weekly: 'rebalance to keep leverage under 2x and the health factor comfortable',
  },
  'Prediction Market': {
    open: 'Fund {name} with the capital and take small positions in its three most liquid markets.',
    deepen: 'Hold at least one position all the way to settlement so the wallet records a complete market cycle.',
    weekly: 'trade one liquid market for at least $10, on the side the price seems wrong',
  },
  'Insurance': {
    open: 'Buy cover on a major protocol from {name} on {chain}, for the longest term the capital affords.',
    deepen: 'Keep the policy in the farming wallet for its full term rather than selling it on.',
    weekly: 'check the cover book and the pool\'s remaining capacity',
  },
  'Staking Pool': {
    open: 'Stake the capital in the chain\'s native asset through {name} and keep the receipt token in the same wallet.',
    deepen: 'Claim the first staking rewards and restake them once.',
    weekly: 'claim and restake any rewards the position has earned',
  },
  'Restaking': {
    open: 'Restake the capital in a liquid staking token through {name} on {chain}.',
    deepen: 'Delegate the restaked position to one operator and note the choice in the farm log.',
    weekly: 'check the operator\'s performance and claim any rewards',
  },
  'Chain': {
    open: 'Bridge the capital in USDC to {name} and make it the wallet\'s home chain for the month.',
    deepen: 'Use two of {name}\'s native applications with the bridged funds: one swap and one deposit.',
    weekly: 'make two ordinary transactions on the chain, on different days',
  },
  'Cross Chain Bridge': {
    open: 'Bridge the capital in USDC through {name} to {chain} and use the bridged funds in one application there.',
    deepen: 'Bridge a smaller amount back a week later, so the wallet records a round trip.',
    weekly: 'make one small bridge transfer and keep the confirmations in the farm log',
  },
  'Payments': {
    open: 'Open a {name} account, complete its verification and load the capital.',
    deepen: 'Route ordinary payments through it until at least ten are recorded.',
    weekly: 'make at least one payment and keep the receipts',
  },
  'Crypto Card Issuer': {
    open: 'Open a {name} card account, complete its verification and load the capital.',
    deepen: 'Use the card for ordinary spending until at least ten purchases are recorded.',
    weekly: 'make at least one card purchase and check the statement',
  },
  'Launchpad': {
    open: 'Register the wallet on {name} and complete its participation requirements with the capital ready.',
    deepen: 'Take part in one small sale or allocation round rather than waiting for a large one.',
    weekly: 'check the upcoming rounds and keep the wallet\'s eligibility current',
  },
  'Indexes': {
    open: 'Mint the capital\'s worth of {name}\'s flagship index basket on {chain}.',
    deepen: 'Hold the basket token through one full rebalance without selling.',
    weekly: 'read the rebalance note and confirm your basket matches it',
  },
  'Governance Incentives': {
    open: 'Deposit the capital into {name}\'s incentive programme on {chain} in the asset it rewards.',
    deepen: 'Vote in one governance decision if the programme opens one to depositors.',
    weekly: 'claim the incentive and check the programme\'s remaining budget',
  },
  'Synthetics': {
    open: 'Deposit the USDC as margin on {name} and open one small synthetic position, hedged with the underlying where you can.',
    deepen: 'Close and reopen the position once so the wallet records two full trades.',
    weekly: 'place one small trade and check the funding or fee accrual',
  },
  'Algo-Stables': {
    open: 'Mint the capital\'s worth of {name}\'s stablecoin on {chain} against its accepted collateral.',
    deepen: 'Hold the minted stablecoin in the wallet and use a small part in one of its pools.',
    weekly: 'check the peg and your collateral position',
  },
  'Dual-Token Stablecoin': {
    open: 'Mint the capital\'s worth of {name}\'s stablecoin on {chain} and hold both sides of its system in the wallet.',
    deepen: 'Stake or lock the companion token position the system issues, if it issues one.',
    weekly: 'check the peg and the system\'s published collateral ratio',
  },
  'Stablecoin Issuer': {
    open: 'Mint or deposit the capital into {name}\'s stablecoin on {chain} through its own front door.',
    deepen: 'Hold the stablecoin and make one payment or transfer with a small part of it.',
    weekly: 'check the issuer\'s reserve report against your balance',
  },
  'Stablecoin Wrapper': {
    open: 'Wrap the capital\'s worth of the underlying stablecoin through {name} on {chain}.',
    deepen: 'Use the wrapped asset in one pool or market that accepts it.',
    weekly: 'check the wrapper\'s backing report',
  },
  'Privacy': {
    open: 'Deposit the capital into {name}\'s shielded pool on {chain} in a single transaction.',
    deepen: 'Make one shielded transfer to a second wallet of your own, so both sides of the flow are yours.',
    weekly: 'make one shielded transaction and note it in the farm log kept offline',
  },
  'NFT Marketplace': {
    open: 'Set the capital aside on {name}: buy one low-priced item and list one item of your own.',
    deepen: 'Complete one sale or purchase cycle so the wallet records both sides of the market.',
    weekly: 'browse the new listings and adjust your listed price once',
  },
  'OTC Marketplace': {
    open: 'Register on {name}, complete its checks and post one small order with part of the capital.',
    deepen: 'Settle one trade in full and rate the counterparty as the market asks.',
    weekly: 'refresh the order and check the market\'s going rate',
  },
  'Token Locker': {
    open: 'Lock a small token amount through {name} on {chain} for a 90-day term.',
    deepen: 'Extend the lock once or add a second, smaller lock so the wallet shows commitment over time.',
    weekly: 'check the lock\'s status and the contract\'s total locked value',
  },
  'AI Agents': {
    open: 'Deposit the capital into {name}\'s agent vault or credit balance on {chain}, following its own onboarding.',
    deepen: 'Run one agent task or strategy cycle to completion so the wallet records real usage.',
    weekly: 'check the agent\'s reported performance and your balance',
  },
  'Decentralized AI': {
    open: 'Deposit the capital into {name}\'s compute or staking pool on {chain}.',
    deepen: 'Buy or run one small compute job through the network.',
    weekly: 'check the pool\'s utilisation and your accrued share',
  },
  'CeDeFi': {
    open: 'Deposit the USDC into {name}\'s main earn product on {chain}.',
    deepen: 'Move a small slice into a second product with a different term.',
    weekly: 'check both products\' rates and your accrued interest',
  },
  'Anchor BTC': {
    open: 'Deposit the capital in BTC or its main wrapped form into {name} on {chain}.',
    deepen: 'Hold the issued position through one full rewards epoch.',
    weekly: 'check the published reserve and your share of it',
  },
  'Decentralized BTC': {
    open: 'Deposit the capital in BTC or its main wrapped form into {name} on {chain}.',
    deepen: 'Use the issued BTC asset in one of the protocol\'s own markets.',
    weekly: 'check the backing report and your balance',
  },
};

const DEFAULT_PLAYBOOK: Playbook = {
  open: 'Deposit the USDC into {name}\'s main product on {chain} and keep the position open.',
  deepen: 'Make a second, different kind of transaction inside {name} — a claim, a vote or a small adjustment — so the wallet is not a single deposit.',
  weekly: 'repeat one qualifying action inside the product and note it in the farm log',
};

/** Fill a playbook line with the protocol's own figures. */
function fill(template: string, p: SnapshotProtocol, chain: string): string {
  return template.split('{name}').join(p.name).split('{chain}').join(chain);
}

/** One step as one string: its action, then its cost and time, inside the gate's 20..600 characters. */
function stepText(action: string, cost: string, time: string): string {
  let s = `${action} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is chosen by the
 * protocol's category and filled with its own record — name, main chain, TVL, age — so two protocols
 * in one category still get plans that name their own chain, capital tier and hold window.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = PLAYBOOKS[p.category ?? ''] ?? DEFAULT_PLAYBOOK;
  const multi = p.chains.length > 1 ? ` It also runs on ${p.chains.length - 1} other chain${p.chains.length > 2 ? 's' : ''}; stay on ${chain} so the record is easy to read.` : '';
  // The deepen and weekly lines are written per category; where one does not name the protocol,
  // name it, so no two protocols on the board carry a word-for-word identical step.
  const deepenText = fill(book.deepen, p, chain).includes(p.name)
    ? fill(book.deepen, p, chain)
    : `${fill(book.deepen, p, chain).replace(/\.$/, '')} — in ${p.name}'s own app, never a lookalike front end.`;
  const weeklyText = fill(book.weekly, p, chain).includes(p.name)
    ? fill(book.weekly, p, chain)
    : `${fill(book.weekly, p, chain)} in ${p.name}`;
  return [
    stepText(
      `Create a fresh wallet for ${p.name} alone and fund it on ${chain} with ${gas.asset} for fees plus the USDC you will commit; keep the seed phrase offline and never reuse a wallet that holds other positions.`,
      `${gas.cost} for the funding transfer`,
      '10 minutes',
    ),
    stepText(
      `${fill(book.open, p, chain)} The position is sized for a protocol holding ${usdShort(p.tvl_usd)} of TVL.${multi}`,
      `$${capital} of capital and ${gas.cost}`,
      '15 minutes to set up',
    ),
    stepText(
      deepenText,
      `${gas.cost}, and no new capital beyond the position`,
      '20 minutes, inside the first week',
    ),
    stepText(
      `Once a week, ${weeklyText}.`,
      `${gas.cost} a week`,
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days. ${p.name} has run ${ageText(age)} with no token recorded, and activity that spans several weekly snapshots is what points and eligibility checks count; a deposit made and withdrawn in one week reads as farming and nothing else.`,
      `the $${capital} stays committed for the full window`,
      `${hold} days`,
    ),
    stepText(
      `If ${p.name} announces a token, a points conversion or a claim, act only on the announcement on its official page and never pay anyone a fee to claim. To leave, unwind the position the way you entered it and move the funds out in one transaction.`,
      `${gas.cost} to exit, and never a claim fee`,
      '20 minutes',
    ),
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** A board row's form for data.js: everything the page renders, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    watchlist: row.watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = peerMultiples(snapshot, model);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: multiples.global.multiple,
    global_peers: multiples.global.peers,
    median_age_days: medianAgeDays(snapshot),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
