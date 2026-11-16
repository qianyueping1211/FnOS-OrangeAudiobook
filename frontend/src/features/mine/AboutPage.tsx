import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../core/stores/authStore';
import BackButton from '../../shared/widgets/BackButton';
import SystemUpdatePanel from './SystemUpdatePanel';
import { getLocalizedPrivacyPolicyUrl, getLocalizedUserAgreementUrl, getLocalizedTingReaderWebsiteUrl } from '../../core/constants/links';

export default function AboutPage() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore(state => state.user);
  return <div className="reader-page reader-about-page reader-locked-page flex flex-1 flex-col">
    <div className="reader-page-scroll">
      <div className="max-w-4xl mx-auto w-full">
      <BackButton fallback="/mine" />
      <header className="reader-settings-title mt-5"><h1>{t('reader.systemUpdate')}</h1><p>{t('reader.updateDescription')}</p></header>
      {user?.role === 'admin' && <SystemUpdatePanel />}
      <details className="reader-help mt-6"><summary>{t('reader.openSource')}</summary><p className="mt-3">Ting Reader · AGPL-3.0-only</p>
        <a className="underline" href="https://github.com/dqsq2e2/ting-reader" target="_blank" rel="noreferrer">dqsq2e2/ting-reader</a>
        <p className="mt-2">{t('reader.privateEdition')}</p>
        <div className="flex gap-4 mt-3 flex-wrap">
          <a href={getLocalizedTingReaderWebsiteUrl(i18n.language)} target="_blank" rel="noreferrer">{t('mine.officialWebsite')}</a>
          <a href={getLocalizedUserAgreementUrl(i18n.language)} target="_blank" rel="noreferrer">{t('mine.userAgreement')}</a>
          <a href={getLocalizedPrivacyPolicyUrl(i18n.language)} target="_blank" rel="noreferrer">{t('mine.privacyPolicy')}</a>
        </div>
      </details>
    </div>
    </div>
  </div>;
}
