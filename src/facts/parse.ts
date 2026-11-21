import { load } from 'js-yaml';
import { z } from 'zod';
import { FactsSchema, type Derived, type Facts, type FactsInput } from './schema';
import { getPath, isOn, resolveFactStrings } from './template';

export class FactsError extends Error {}

/** Parse and validate facts.yaml text. Throws a readable error if anything is off. */
export function parseFacts(yamlText: string): Facts {
  let data: unknown;
  try {
    data = load(yamlText);
  } catch (err) {
    throw new FactsError(`facts.yaml is not valid YAML: ${(err as Error).message}`);
  }
  const result = FactsSchema.safeParse(data);
  if (!result.success) {
    throw new FactsError(`facts.yaml has a problem:\n${z.prettifyError(result.error)}`);
  }
  return derive(resolveFactStrings(result.data));
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function derive(input: FactsInput): Facts {
  const owners = input.business.owners;
  const free = input.inspection.free;
  const derived: Derived = {
    ownerNames: joinNames(owners.map((o) => o.name)),
    ownerRoles: owners
      .filter((o) => o.role)
      .map((o) => `${o.name.split(' ')[0]} ${o.role.replace(/[.\s]+$/, '')}.`)
      .join(' '),
    anInspection: free ? 'a free inspection' : 'an inspection',
    theInspection: free ? 'the free inspection' : 'the inspection',
    bookLabel: free ? 'Book a free inspection' : 'Book an inspection',
  };
  return { ...input, derived };
}

/** Small helper bound to one facts object: has('credentials.license.number') */
export function makeHas(facts: Facts) {
  return (path: string): boolean => isOn(getPath(facts, path));
}
