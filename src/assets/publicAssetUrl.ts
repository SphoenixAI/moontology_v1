import { MOBILE } from '../runtime/deviceProfile';
// Injected only by the public build. Local presentation URLs stay local.
declare const __MOONTOLOGY_MOBILE_ASSET_URLS__: Record<string, string>;
declare const __MOONTOLOGY_PUBLIC_ASSET_URLS__: Record<string, string>;

export const publicAssetUrl = (url: string): string => {
  if (typeof __MOONTOLOGY_PUBLIC_ASSET_URLS__ === 'undefined') return url;
  try {
    const path = decodeURI(url.split(/[?#]/, 1)[0]);
    if (MOBILE && typeof __MOONTOLOGY_MOBILE_ASSET_URLS__ !== 'undefined') {
      return __MOONTOLOGY_MOBILE_ASSET_URLS__[path] ?? __MOONTOLOGY_PUBLIC_ASSET_URLS__[path] ?? url;
    }
    return __MOONTOLOGY_PUBLIC_ASSET_URLS__[path] ?? url;
  } catch { return url; }
};
