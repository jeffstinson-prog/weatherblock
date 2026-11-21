// The same icons for the interactive parts of the site (booking, estimate, owner app).
import { ICONS, type IconName } from './data';

export type { IconName };

export default function Icon(props: { name: IconName; size?: number; class?: string; stroke?: number }) {
  const size = props.size ?? 20;
  return (
    <svg
      class={`icon ${props.class ?? ''}`.trim()}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.stroke ?? 2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICONS[props.name] }}
    />
  );
}
