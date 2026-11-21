// How each help topic shows on the page: its anchor and its icon.
import type { IconName } from '../icons/data';
import type { Topic } from './load';

const ICON: Record<Topic, IconName> = {
  'Booking and inspections': 'calendar-check',
  'Insurance and claims': 'shield-check',
  'Storms and leaks': 'cloud-rain-wind',
  'Roofs and materials': 'layers',
  Money: 'wallet',
  'About us': 'users',
};

export const topicIcon = (topic: Topic): IconName => ICON[topic];

/** The id of a topic's section on the help center page: "Storms and leaks" is #t-storms-and-leaks. */
export const topicId = (topic: string): string =>
  `t-${topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
