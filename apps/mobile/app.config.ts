import type { ConfigContext, ExpoConfig } from "expo/config";

function webHost(): string | null {
  const value = process.env.EXPO_PUBLIC_WEB_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.host : null;
  } catch {
    return null;
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const host = webHost();
  return {
    ...config,
    name: config.name ?? "MedChina",
    slug: config.slug ?? "medchina",
    ios: {
      ...config.ios,
      associatedDomains: host ? [`applinks:${host}`] : [],
    },
    android: {
      ...config.android,
      intentFilters: host
        ? [
            {
              action: "VIEW",
              autoVerify: true,
              data: [
                { scheme: "https", host, pathPrefix: "/consultas" },
                { scheme: "https", host, pathPrefix: "/consulta" },
              ],
              category: ["BROWSABLE", "DEFAULT"],
            },
          ]
        : [],
    },
  };
};
