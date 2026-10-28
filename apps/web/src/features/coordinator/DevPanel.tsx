import { useEffect, useState } from 'react';
import { useData } from '../../shared/api/DataProvider';
import { mockControls, onMockChange, resetMockDb, setMockControls, simulateConcurrentEdit, simulateForemanCrew, simulateWorkerReport } from '../../shared/api/mock/server';
import { Button, Modal } from '../../shared/ui/components';
import { t } from '../../shared/i18n';
import { mapBroken } from './map/mapFlags';

/** Панель отказов для приёмки (B18). Есть только в режиме тестового источника. */
export function DevPanel({ open, onClose, onAuthChange }: { open: boolean; onClose: () => void; onAuthChange: () => void }) {
  const { bump } = useData();
  const [, force] = useState(0);
  const [msg, setMsg] = useState('');
  useEffect(() => onMockChange(() => force((x) => x + 1)), []);
  const c = mockControls;
  return (
    <Modal open={open} title={t('dev.title')} onClose={onClose}>
      <div className="gp-dev">
        <label className="gp-check"><input type="checkbox" checked={c.networkDown} onChange={(e) => { setMockControls({ networkDown: e.target.checked }); bump(); }} />{t('dev.network')}</label>
        <label className="gp-check"><input type="checkbox" checked={c.aiDown} onChange={(e) => setMockControls({ aiDown: e.target.checked })} />{t('dev.ai')}</label>
        <label className="gp-check"><input type="checkbox" checked={mapBroken.value} onChange={(e) => { mapBroken.value = e.target.checked; force((x) => x + 1); location.reload(); }} />{t('dev.map')} (перезагрузит страницу)</label>
        <fieldset className="gp-fieldset">
          <legend>{t('dev.role')}</legend>
          {(['coordinator', 'admin', 'foreman', 'worker', 'anonymous'] as const).map((r) => (
            <label key={r} className="gp-check"><input type="radio" name="dev-role" checked={c.role === r} onChange={() => { setMockControls({ role: r }); onAuthChange(); bump(); }} />{r === 'anonymous' ? t('dev.anon') : t(`shell.role.${r}`)}</label>
          ))}
        </fieldset>
        <div className="gp-btn-row">
          <Button onClick={() => setMsg(t('dev.concurrentDone', { id: simulateConcurrentEdit() }))}>{t('dev.concurrent')}</Button>
          <Button onClick={() => { const id = simulateForemanCrew(); setMsg(id ? t('dev.crewDone', { id }) : t('dev.nothing')); bump(); }}>{t('dev.crew')}</Button>
          <Button onClick={() => { const id = simulateWorkerReport(); setMsg(id ? t('dev.reportDone', { id }) : t('dev.nothing')); bump(); }}>{t('dev.report')}</Button>
          <Button variant="danger" onClick={() => { resetMockDb(); bump(); setMsg('Тестовые данные сброшены к исходному набору.'); }}>{t('dev.reset')}</Button>
        </div>
        {msg && <p className="gp-alert gp-alert--info" role="status">{msg}</p>}
        <p className="gp-small gp-muted">Изменения из этой панели касаются только тестового источника в браузере (localStorage) и не попадают на сервер.</p>
        <Button variant="primary" onClick={onClose}>{t('dev.close')}</Button>
      </div>
    </Modal>
  );
}
