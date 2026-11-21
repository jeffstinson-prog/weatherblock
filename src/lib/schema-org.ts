// schema.org structured data for search engines. Built only from facts.
// No review stars here: Google ignores self-published ratings for a business.
import { facts, has } from '../facts';

export function roofingContractor(site: URL | undefined) {
  const base = site?.href ?? `https://${facts.web.domain}/`;
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'RoofingContractor',
    name: facts.business.name,
    url: base,
    logo: new URL('/brand/logo.png', base).href,
    image: new URL('/brand/logo.png', base).href,
    address: {
      '@type': 'PostalAddress',
      addressLocality: facts.business.city,
      addressRegion: facts.business.state,
      postalCode: facts.business.zip,
      addressCountry: 'US',
    },
    areaServed: [
      ...(facts.business.city ? [{ '@type': 'City', name: `${facts.business.city}, ${facts.business.state}` }] : []),
      ...facts.serviceArea.counties.map((c) => ({
        '@type': 'AdministrativeArea',
        name: `${c} County, ${facts.serviceArea.state}`,
      })),
    ],
    knowsAbout: facts.services.map((s) => s.name),
  };
  if (facts.business.legalName) data.legalName = facts.business.legalName;
  if (facts.contact.phoneE164) data.telephone = facts.contact.phoneE164;
  if (facts.contact.email) data.email = facts.contact.email;
  if (has('inspection.free')) {
    data.makesOffer = {
      '@type': 'Offer',
      name: 'Roof inspection',
      price: '0',
      priceCurrency: 'USD',
    };
  }
  return data;
}
