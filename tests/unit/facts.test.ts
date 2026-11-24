import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { facts, has, copyrightLine } from '../../src/facts';
import { parseFacts, FactsError } from '../../src/facts/parse';

const yamlText = readFileSync(new URL('../../facts.yaml', import.meta.url), 'utf8');

describe('facts.yaml', () => {
  it('parses and validates', () => {
    expect(facts.business.name).toBe('WeatherBlock Roofing');
    expect(facts.contact.phoneE164).toMatch(/^\+1\d{10}$/);
    expect(facts.inspection.free).toBe(true);
  });

  it('treats blank facts as off', () => {
    expect(has('credentials.license.number')).toBe(false);
    expect(has('credentials.warranty.workmanship')).toBe(false);
    expect(has('contact.phone')).toBe(true);
    expect(has('credentials.fortified.certified')).toBe(false);
    expect(has('credentials.fortified.inProgress')).toBe(true);
  });

  it('fills placeholders inside fact values', () => {
    expect(facts.financing.disclosure).toContain(`${facts.business.name} does not guarantee approval`);
    expect(facts.financing.disclosure).not.toContain('{{');
  });

  it('derives owner and inspection wording', () => {
    expect(facts.derived.ownerNames).toBe('Justin Coffey and JT Stinson');
    expect(facts.derived.ownerRoles).toBe('Justin runs the crews.');
    expect(facts.derived.bookLabel).toBe('Book a free inspection');
  });

  it('names the estimate page for what it gives: free, and "instant" only when it shows a ballpark', () => {
    expect(facts.derived.estimateName).toBe('Free estimate');
    expect(facts.derived.estimateTitle).toBe('Free roof estimate');
    expect(facts.derived.anEstimate).toBe('a free estimate');
    expect(facts.derived.estimateCta).toBe('Get my free estimate');
    expect(facts.derived.bookEstimateLabel).toBe('Book my free estimate');
    expect(facts.derived.estimateCallback).toBe('within one business hour');

    const ballpark = parseFacts(yamlText.replace('showBallpark: false', 'showBallpark: true'));
    expect(ballpark.derived.estimateName).toBe('Instant estimate');
    expect(ballpark.derived.estimateCta).toBe('Get my instant estimate');

    // No promise in the facts file: the site says "soon".
    const none = parseFacts(yamlText.replace('callback: within one business hour', 'callback: ""'));
    expect(none.derived.estimateCallback).toBe('soon');

    const paid = parseFacts(yamlText.replace('  free: true', '  free: false'));
    expect(paid.derived.estimateName).toBe('Estimate');
    expect(paid.derived.bookEstimateLabel).toBe('Book my estimate');
  });

  it('footer line uses the legal name and the year', () => {
    expect(copyrightLine(2026)).toBe('© 2026 WeatherBlock Roofing Incorporated');
  });

  it('renaming the business is a one-line change', () => {
    const renamed = parseFacts(yamlText.replace('name: WeatherBlock Roofing #', 'name: Harbor Roof Co #'));
    expect(renamed.business.name).toBe('Harbor Roof Co');
    expect(renamed.financing.disclosure).toContain('Harbor Roof Co does not guarantee approval');
  });

  it('rejects a misspelled key instead of ignoring it', () => {
    const typo = yamlText.replace('  phone: (910) 209-5275', '  phon: (910) 209-5275');
    expect(() => parseFacts(typo)).toThrow(FactsError);
  });

  it('rejects a bad phone number', () => {
    const bad = yamlText.replace('phoneE164: "+19102095275"', 'phoneE164: "910-209-5275"');
    expect(() => parseFacts(bad)).toThrow(/phoneE164/);
  });

  it('turning inspection.free off changes the wording', () => {
    const paid = parseFacts(yamlText.replace('  free: true', '  free: false'));
    expect(paid.derived.bookLabel).toBe('Book an inspection');
    expect(paid.derived.anInspection).toBe('an inspection');
  });
});
