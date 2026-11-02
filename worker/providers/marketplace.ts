import {
  parseConfirmations, parseCsvInventory, parseInventory, signEntryUrl,
  type ConfirmationAction, type EntrySigningOptions, type InventoryParseResult,
} from "../domain/marketplace.ts";

export type MarketplaceProvider = "GENERIC" | "CINT" | "PURESPECTRUM" | "DYNATA" | "TOLUNA" | "OTHER";
export const marketplaceProviders: readonly MarketplaceProvider[] = ["GENERIC", "CINT", "PURESPECTRUM", "DYNATA", "TOLUNA", "OTHER"];

/** Non-secret per-marketplace settings stored in marketplaces.config. */
export type MarketplaceConfig = {
  secretEnv?: string;
  entrySigning?: EntrySigningOptions & { enabled?: boolean };
};

export interface MarketplaceAdapter {
  provider: MarketplaceProvider;
  /** Normalises a pushed or pasted inventory feed (JSON value or CSV text). */
  parseInventory(input: { format: "json" | "csv"; data: unknown }): InventoryParseResult;
  /** Returns the URL the respondent should be sent to, signed when configured. */
  buildEntryUrl(url: string, config: MarketplaceConfig, secret: string | undefined): Promise<string>;
  /** Normalises a confirmation/reversal report into ledger actions. */
  parseConfirmations(payload: unknown): { actions: ConfirmationAction[]; errors: string[] };
}

// Cint, PureSpectrum, Dynata and Toluna each publish a private integration
// contract (entry-link hashing recipe, callback payloads). Until their sandbox
// documentation and credentials are available (tracker BLK-03/PURE-01) every
// provider uses this generic behaviour. Replace an entry in `adapters` with a
// provider-specific implementation once its contract has been certified.
const genericAdapter = (provider: MarketplaceProvider): MarketplaceAdapter => ({
  provider,
  parseInventory({ format, data }) {
    if (format === "csv") return typeof data === "string" ? parseCsvInventory(data) : { surveys: [], errors: ["CSV data must be text"] };
    if (typeof data === "string") {
      try { return parseInventory(JSON.parse(data)); } catch { return { surveys: [], errors: ["The pasted inventory is not valid JSON"] }; }
    }
    return parseInventory(data);
  },
  async buildEntryUrl(url, config, secret) {
    if (!config.entrySigning?.enabled) return url;
    if (!secret) throw new Error("Entry-link signing is enabled but the marketplace secret is not configured");
    return signEntryUrl(url, secret, config.entrySigning);
  },
  parseConfirmations,
});

export const marketplaceAdapters: Record<MarketplaceProvider, MarketplaceAdapter> = Object.fromEntries(
  marketplaceProviders.map((provider) => [provider, genericAdapter(provider)]),
) as Record<MarketplaceProvider, MarketplaceAdapter>;

export function adapterFor(provider: string): MarketplaceAdapter {
  return marketplaceAdapters[(marketplaceProviders as readonly string[]).includes(provider) ? provider as MarketplaceProvider : "GENERIC"];
}
