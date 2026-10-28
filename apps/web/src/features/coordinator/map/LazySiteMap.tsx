import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import { t } from '../../../shared/i18n';
import { SchemeView } from './SchemeView';

// MapLibre (~1 МБ) грузится отдельно: список участков доступен сразу, даже при слабой сети.
const SiteMap = lazy(() => import('./SiteMap').then((m) => ({ default: m.SiteMap })));
type Props = ComponentProps<typeof SiteMap>;

class MapChunkBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function LazySiteMap(props: Props) {
  const scheme = (
    <div className="gp-map">
      <div className="gp-alert gp-alert--warn gp-map__alert" role="status"><span aria-hidden="true">⚠ </span>{t('map.failed')}</div>
      <SchemeView sites={props.sites} eligibility={props.eligibility} selectedId={props.selectedId} onSelect={props.onSelect} />
    </div>
  );
  return (
    <MapChunkBoundary fallback={scheme}>
      <Suspense fallback={<div className="gp-map"><div className="gp-state" role="status"><span className="gp-spinner" aria-hidden="true" /> {t('state.loading')}</div></div>}>
        <SiteMap {...props} />
      </Suspense>
    </MapChunkBoundary>
  );
}
