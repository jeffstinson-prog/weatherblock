// Photos: the ones the customer sent us, and the ones our team shared, newest
// first. Each opens full size in a new tab, so it can be zoomed.
import Icon from '../../icons/Icon';
import { monthDay } from '../format';
import type { PortalPhoto } from './types';

const altText = (p: PortalPhoto) => p.caption || (p.source === 'team' ? 'Photo from your inspection' : 'A photo you sent us');

export default function Photos(props: { photos: PortalPhoto[]; beforeVisit: boolean }) {
  return (
    <section class="portal-section" aria-labelledby="photos-h">
      <h2 id="photos-h">
        <Icon name="camera" size={20} />
        Photos
      </h2>
      {props.photos.length === 0 ? (
        <p class="muted">{props.beforeVisit ? 'Photos from your inspection will show here.' : 'No photos yet.'}</p>
      ) : (
        <ul class="photo-grid">
          {props.photos.map((p) => (
            <li key={p.id}>
              <figure>
                <a class="photo-link" href={p.url} target="_blank" rel="noopener">
                  <img src={p.url} alt={altText(p)} width={400} height={300} loading="lazy" decoding="async" />
                  <span class="visually-hidden"> (opens full size in a new tab)</span>
                </a>
                <figcaption>
                  {p.caption && <span class="photo-caption">{p.caption}</span>}
                  <span class="photo-meta">
                    {p.source === 'team' ? 'From our team' : 'From you'}, {monthDay(p.at)}
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
