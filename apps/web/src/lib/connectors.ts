/**
 * Connector registration point. Derived projects register their external
 * API connectors here so every server context (settings actions, Inngest
 * functions) sees the same registry — see packages/connectors/README.md.
 *
 * Example:
 *   import { registerConnector } from "@flyee/connectors";
 *   registerConnector(metaAdsConnector);
 */
export {};
