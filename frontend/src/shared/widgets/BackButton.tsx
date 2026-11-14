import React from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { backTarget } from '../../core/utils/appHistory';

interface BackButtonProps {
  fallback?: string;
  label?: string;
}

const BackButton: React.FC<BackButtonProps> = ({ fallback = '/mine', label }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleBack = () => {
    navigate(backTarget(fallback), { replace: true });
  };

  return (
    <button
      onClick={handleBack}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
    >
      <ArrowLeft size={18} />
      {label ?? t('common.back')}
    </button>
  );
};

export default BackButton;
