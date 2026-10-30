import { kkEnabled, setLang } from './index';
import { useLanguage } from './useLanguage';

/** Header integration: <LanguageSwitcher />. Does not remount pages or discard edits. */
export function LanguageSwitcher() {
  const language = useLanguage();
  return <div role="group" aria-label="Язык / Тіл" style={{ display: 'inline-flex', gap: 4 }}>
    <button type="button" className={`gp-btn${language === 'ru' ? ' gp-btn--primary' : ''}`} lang="ru" aria-pressed={language === 'ru'} onClick={() => setLang('ru')}>Рус</button>
    {kkEnabled && <button type="button" className={`gp-btn${language === 'kk' ? ' gp-btn--primary' : ''}`} lang="kk" aria-pressed={language === 'kk'} onClick={() => setLang('kk')}>Қаз</button>}
  </div>;
}
