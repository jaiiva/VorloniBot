// Testien tyypitetty rajapinta. Botti käyttää suoraan plugins/title.cjs-tiedostoa,
// jotta otsikkohaun muutokset latautuvat ilman käännöstä tai uudelleenkäynnistystä.
import type { RequestOptions } from "node:http";

interface TitlePlugin {
  firstUrl(message: string): string | undefined;
  fetchTitle(address: string, signal?: AbortSignal): Promise<string | undefined>;
  extractTitle(html: string, preferOpenGraph?: boolean): string | undefined;
  youtubeOEmbedUrl(url: URL): URL | undefined;
  redditOEmbedUrl(url: URL): URL | undefined;
  extractOEmbedTitle(json: string): string | undefined;
  isPublicAddress(address: string): boolean;
  pinnedLookup(address: string, family: 4 | 6): NonNullable<RequestOptions["lookup"]>;
}

const title = require("../plugins/title.cjs") as TitlePlugin;

export const firstUrl = title.firstUrl;
export const fetchTitle = title.fetchTitle;
export const extractTitle = title.extractTitle;
export const youtubeOEmbedUrl = title.youtubeOEmbedUrl;
export const redditOEmbedUrl = title.redditOEmbedUrl;
export const extractOEmbedTitle = title.extractOEmbedTitle;
export const isPublicAddress = title.isPublicAddress;
export const pinnedLookup = title.pinnedLookup;
