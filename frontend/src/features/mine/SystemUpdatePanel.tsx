import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, Check, Loader2, RefreshCw } from 'lucide-react';
import apiClient from '../../core/api/client';
import { apiErrorMessage } from '../../core/api/errors';
import { notifyUpdateChanged, useSystemUpdate, type UpdateInfo } from '../../core/hooks/useSystemUpdate';
import { CLIENT_VERSION } from '../../core/version';

export default function SystemUpdatePanel() {
  const { t } = useTranslation();
  const { info, setInfo, refresh } = useSystemUpdate(true);
  const [token, setToken] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const active = info?.installer.state === 'downloading' || info?.installer.state === 'installing';
  const reloadNeeded = info?.installer.state === 'completed' && info.current_version !== CLIENT_VERSION;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => { void refresh(controller.signal).catch(() => {}); }, 2500);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [active, refresh]);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); notifyUpdateChanged(); }
    catch (cause) { setError(apiErrorMessage(cause, t('reader.updateFailed'))); }
    finally { setBusy(false); }
  };
  const check = () => perform(async () => {
    const result = await apiClient.post<UpdateInfo>('/api/system/updates/check');
    setInfo(result.data);
    setMessage(result.data.update_available ? t('reader.updateFound') : t('reader.upToDate'));
  });
  const tokenAction = () => perform(async () => {
    if (info?.has_token && !tokenEdited) {
      await apiClient.delete('/api/system/updates/token');
      setMessage(t('reader.tokenDeleted'));
    } else {
      await apiClient.put('/api/system/updates/token', { token });
      setMessage(t('reader.tokenSaved'));
    }
    setToken(''); setTokenEdited(false); await refresh();
  });
  const upgrade = () => perform(async () => {
    setConfirm(false);
    const result = await apiClient.post<UpdateInfo>('/api/system/updates/install', { version: info?.latest_version, tag: info?.tag });
    setInfo(result.data);
  });
  return <section className="reader-update-panel" aria-labelledby="system-update-title">
    <div className="reader-update-summary"><ArrowUpCircle /><div><strong id="system-update-title">{t('reader.systemUpdate')}</strong>
      <small>{t('reader.currentVersion')} v{info?.current_version || CLIENT_VERSION}{info?.update_available ? ' · ' + t('reader.latestVersion') + ' v' + info.latest_version : ''}</small>
    </div></div>
    <p className="reader-help">{t('reader.hourlyCheck')}</p>
    <label className="reader-field"><span>{t('reader.githubToken')}</span>
      <input className="reader-input" type="password" autoComplete="off" spellCheck={false} value={token}
        placeholder={info?.has_token && !tokenEdited ? '••••••••••••••••' : t('reader.tokenPlaceholder')}
        onChange={event => { setToken(event.target.value); setTokenEdited(true); }} disabled={active || busy} />
      <p className="reader-help">{info?.has_token && !tokenEdited ? t('reader.tokenStored') : t('reader.tokenHelp')}</p>
    </label>
    <div className="reader-update-actions">
      <button type="button" className={'reader-button' + (info?.has_token && !tokenEdited ? ' danger' : '')}
        disabled={busy || active || (tokenEdited && !token.trim()) || (!info?.has_token && !token.trim())} onClick={tokenAction}>
        {info?.has_token && !tokenEdited ? t('reader.deleteToken') : t('reader.saveToken')}
      </button>
      <button type="button" className="reader-button primary" disabled={busy || active} onClick={() => {
        if (reloadNeeded) window.location.reload();
        else if (info?.update_available) setConfirm(true);
        else void check();
      }}>
        {busy || active ? <Loader2 size={17} className="animate-spin" /> : info?.update_available ? <ArrowUpCircle size={17} /> : <RefreshCw size={16} />}
        {active ? t('reader.upgrading') : reloadNeeded ? t('reader.reload') : info?.update_available ? t('reader.upgrade') : t('mine.checkUpdate')}
      </button>
    </div>
    {active && <progress className="reader-update-progress" max={100} value={info?.installer.progress || 0} />}
    {(error || message || info?.installer.message) && <div role="status" className={'reader-update-message' + (error || info?.installer.state === 'error' ? ' error' : '')}>
      {!error && info?.installer.state === 'completed' && <Check size={16} className="inline mr-2" />}
      {error || message || info?.installer.message}
    </div>}
    {info?.update_available && info.notes && <details className="mt-5"><summary className="text-sm cursor-pointer">{t('reader.releaseNotes')}</summary><div className="reader-release-notes">{info.notes}</div></details>}
    {confirm && <UpgradeConfirmation version={info?.latest_version || ''} onCancel={() => setConfirm(false)} onConfirm={() => void upgrade()} />}
  </section>;
}
function UpgradeConfirmation({ version, onCancel, onConfirm }: { version: string; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="reader-dialog-overlay" onClick={onCancel}>
    <section className="reader-dialog" role="dialog" aria-modal="true" aria-labelledby="upgrade-title"
      onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape') onCancel();
        if (event.key === 'Tab') {
          event.preventDefault();
          (document.activeElement === confirmRef.current ? cancelRef.current : confirmRef.current)?.focus();
        }
      }}>
      <h2 id="upgrade-title">{t('reader.confirmUpgrade')}</h2>
      <p>{t('reader.confirmUpgradeMessage', { version })}</p>
      <div className="reader-dialog-actions">
        <button ref={cancelRef} type="button" className="reader-button" onClick={onCancel}>{t('common.cancel')}</button>
        <button ref={confirmRef} type="button" className="reader-button primary" onClick={onConfirm}>{t('reader.confirm')}</button>
      </div>
    </section>
  </div>;
}
