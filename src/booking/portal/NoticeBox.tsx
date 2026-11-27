// "Done", "Sent": a short note after an action, read out by screen readers.
// It takes focus when it appears, so it's heard even though it's new to the page.
import { useEffect, useRef } from 'preact/hooks';

export default function NoticeBox(props: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [props.text]);
  return (
    <div class="notice ok" role="status" tabIndex={-1} ref={ref}>
      <p>{props.text}</p>
    </div>
  );
}
