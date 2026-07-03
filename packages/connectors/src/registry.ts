import type { Connector } from "./types";

const registry = new Map<string, Connector>();

/** Called at module scope by derived projects (see README for the wiring point). */
export function registerConnector(connector: Connector) {
  registry.set(connector.provider, connector);
}

export const getConnector = (provider: string) => registry.get(provider);

export const listConnectors = () =>
  [...registry.values()].map(({ provider, name, secretFields }) => ({ provider, name, secretFields }));
