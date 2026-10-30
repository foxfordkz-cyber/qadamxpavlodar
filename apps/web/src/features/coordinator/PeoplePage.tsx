import { useData, useResource } from '../../shared/api/DataProvider';
import { StateView } from '../../shared/ui/components';
import { t } from '../../shared/i18n';
import { fmtTime } from '../../shared/format';

// Управление людьми и бригадами — модуль сервера. Здесь только просмотр текущего состава
// и точка подключения; редактирование выполняется в его интерфейсе на сервере.
export function PeoplePage() {
  const { api } = useData();
  const brigades = useResource(() => api.brigades(), []);
  const workers = useResource(() => api.workers(), []);
  const name = (id: string) => workers.data?.find((w) => w.id === id)?.displayName ?? id;
  return (
    <div className="gp-page">
      <div className="gp-page__head"><div><p className="gp-eyebrow">{t('people.eyebrow')}</p><h1 className="gp-h1">{t('nav.people')}</h1></div></div>
      <div className="gp-alert gp-alert--info">{t('people.note')}</div>
      <StateView loading={brigades.loading} error={brigades.error} hasData={!!brigades.data} onRetry={brigades.reload}>
        <div className="gp-tiles">
          {(brigades.data ?? []).map((b) => (
            <div key={b.id} className="gp-tile gp-tile--static">
              <span><strong>{b.name}</strong><br /><span className="gp-small">{t('tasks.foreman')}: {name(b.foremanId)}</span></span>
              <span className="gp-small">{b.memberIds.map(name).join(', ')}<br />{t('tasks.shift', { from: fmtTime(b.shiftStart), to: fmtTime(b.shiftEnd) })} · {b.equipment.join(', ')}</span>
            </div>
          ))}
        </div>
      </StateView>
    </div>
  );
}
