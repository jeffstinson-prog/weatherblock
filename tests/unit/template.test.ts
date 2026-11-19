import { describe, expect, it } from 'vitest';
import { applyFacts, fill, formatDate, isBlank, isOn } from '../../src/facts/template';

const f = {
  name: 'Acme Roofing',
  phone: '(555) 010-0000',
  license: '',
  free: true,
  paid: false,
  list: [],
  rating: 5,
  asOf: '2026-11-19',
  nested: { a: 'A', empty: '' },
};

describe('blank and on', () => {
  it('blank means missing, empty, whitespace or empty list', () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank('  ')).toBe(true);
    expect(isBlank([])).toBe(true);
    expect(isBlank(false)).toBe(false);
    expect(isBlank(0)).toBe(false);
  });
  it('on means set and not false', () => {
    expect(isOn(true)).toBe(true);
    expect(isOn(false)).toBe(false);
    expect(isOn('x')).toBe(true);
    expect(isOn('')).toBe(false);
  });
});

describe('fill', () => {
  it('fills values', () => {
    expect(fill('Call {{phone}}.', f)).toBe('Call (555) 010-0000.');
    expect(fill('{{nested.a}}', f)).toBe('A');
  });
  it('returns null when any value is blank', () => {
    expect(fill('License {{license}}.', f)).toBeNull();
    expect(fill('{{nested.empty}}', f)).toBeNull();
    expect(fill('{{missing.path}}', f)).toBeNull();
  });
  it('refuses to print an object', () => {
    expect(fill('{{nested}}', f)).toBeNull();
  });
  it('formats dates and decimals', () => {
    expect(fill('{{asOf|date}}', f)).toBe('November 19, 2026');
    expect(fill('{{rating|1dp}}', f)).toBe('5.0');
    expect(formatDate('2027-06-01')).toBe('June 1, 2027');
  });
});

describe('applyFacts', () => {
  it('drops a paragraph that mentions a blank fact, keeps the rest', () => {
    const md = 'We are {{name}}.\n\nOur license is {{license}}.\n\nCall {{phone}}.';
    expect(applyFacts(md, f)).toBe('We are Acme Roofing.\n\nCall (555) 010-0000.');
  });

  it('drops only the list items that mention a blank fact', () => {
    const md = '- One\n- License {{license}}\n- Call {{phone}}';
    expect(applyFacts(md, f)).toBe('- One\n- Call (555) 010-0000');
  });

  it('drops a list entirely when every item is blank', () => {
    const md = 'Intro.\n\n- {{license}}\n- {{nested.empty}}';
    expect(applyFacts(md, f)).toBe('Intro.');
  });

  it('keeps ?{} blocks only when the fact is on', () => {
    expect(applyFacts('?{free} It is free.', f)).toBe('It is free.');
    expect(applyFacts('?{paid} It costs money.', f)).toBe('');
    expect(applyFacts('?{license} Licensed.', f)).toBe('');
  });

  it('keeps !{} blocks only when the fact is off', () => {
    expect(applyFacts('!{license} No license on file yet.', f)).toBe('No license on file yet.');
    expect(applyFacts('!{free} Not free.', f)).toBe('');
  });

  it('works on list items with conditions', () => {
    expect(applyFacts('- ?{free} Free\n- ?{paid} Paid\n- Always', f)).toBe('- Free\n- Always');
  });

  it('fills placeholders inside link targets', () => {
    expect(applyFacts('[Call]({{phone}})', f)).toBe('[Call]((555) 010-0000)');
  });
});
