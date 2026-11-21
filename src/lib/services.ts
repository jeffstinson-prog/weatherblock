// What the site says about each service in one line, and the icon that goes with it.
// The services themselves (names and addresses) live in facts.yaml.
import type { IconName } from '../icons/data';

export interface ServiceMeta {
  icon: IconName;
  blurb: string;
}

const META: Record<string, ServiceMeta> = {
  replacement: { icon: 'house', blurb: 'Materials and installation, explained before you decide.' },
  repair: { icon: 'wrench', blurb: 'Leaks, damaged shingles and problem spots.' },
  storm: { icon: 'cloud-lightning', blurb: 'A clear picture of your roof after rough weather.' },
  drone: { icon: 'drone', blurb: 'A close look at your whole roof with no foot traffic on your shingles.' },
};

/** A service added to facts.yaml without an entry here still shows, with a plain icon and no blurb. */
export function serviceMeta(key: string): ServiceMeta {
  return META[key] ?? { icon: 'house', blurb: '' };
}
