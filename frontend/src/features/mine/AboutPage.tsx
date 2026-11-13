import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../core/stores/authStore';
import { getRuntimeAssetUrl } from '../../core/utils/runtimeUrl';
import BackButton from '../../shared/widgets/BackButton';
import SystemUpdatePanel from './SystemUpdatePanel';
import { getLocalizedPrivacyPolicyUrl, getLocalizedUserAgreementUrl, getLocalizedTingReaderWebsiteUrl } from '../../core/constants/links';
import { CLIENT_VERSION } from '../../core/version';

export default function AboutPage() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore(state => state.user);
  return <div className="reader-page flex-1">
    <div className="max-w-4xl mx-auto w-full">
      <BackButton fallback="/mine" />
      <header className="reader-settings-title mt-5"><h1>{t('reader.systemUpdate')}</h1><p>{t('reader.updateDescription')}</p></header>
      {user?.role === 'admin' && <SystemUpdatePanel />}
      <section className="mt-6 reader-update-panel flex items-center gap-4">
        <img src={getRuntimeAssetUrl('/logo.png')} alt="" className="w-12 h-12 object-contain" />
        <div><strong>Ting Reader</strong><p className="reader-help">{t('reader.tagline')} · v{CLIENT_VERSION}</p></div>
      </section>
      <details className="reader-help mt-6"><summary>{t('reader.openSource')}</summary><p className="mt-3">Ting Reader · AGPL-3.0-only</p>
        <a className="underline" href="https://github.com/dqsq2e2/ting-reader" target="_blank" rel="noreferrer">dqsq2e2/ting-reader</a>
        <p className="mt-2">{t('reader.privateEdition')}</p>
        <div className="flex gap-4 mt-3 flex-wrap">
          <a href={getLocalizedTingReaderWebsiteUrl(i18n.language)} target="_blank" rel="noreferrer">{t('mine.officialWebsite')}</a>
          <a href={getLocalizedUserAgreementUrl(i18n.language)} target="_blank" rel="noreferrer">{t('mine.userAgreement')}</a>
          <a href={getLocalizedPrivacyPolicyUrl(i18n.language)} target="_blank" rel="noreferrer">{t('mine.privacyPolicy')}</a>
        </div>
      </details>
      <div style={{ height: 'var(--safe-bottom-base)' }} />
    </div>
  </div>;
}
