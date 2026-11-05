/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  FlaskConical,
  RotateCcw,
  Building2,
  LogOut,
  Compass,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { usePOS } from '../../context/POSContext';

export const PracticeModeBanner: React.FC = () => {
  const {
    workspaceMode,
    settings,
    resetPracticeModeData,
    exitPracticeMode,
    openOnboardingModal,
    startTrainingTour,
  } = usePOS();
  const isAr = settings.language === 'ar';
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  if (workspaceMode !== 'PRACTICE') return null;

  const handleResetDemo = async () => {
    setIsResetting(true);
    try {
      await resetPracticeModeData();
      setResetSuccess(true);
      setTimeout(() => setResetSuccess(false), 3000);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div
      data-testid="practice-mode-banner"
      className="bg-gradient-to-r from-amber-600/95 via-amber-500/95 to-orange-600/95 text-zinc-950 border-b border-amber-300/60 px-3 sm:px-5 py-2 shrink-0 z-40 shadow-md"
    >
      <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-zinc-950/20 flex items-center justify-center shrink-0">
            <FlaskConical className="w-4 h-4 text-zinc-950" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 text-amber-300 text-[10px] font-black uppercase tracking-wider">
                <ShieldAlert className="w-3 h-3" />
                {isAr ? 'وضع التدريب التجريبي' : 'PRACTICE MODE'}
              </span>
              <span className="text-xs sm:text-sm font-black text-zinc-950 truncate">
                {isAr
                  ? 'بيئة تدريب معزولة بالكامل — لا تؤثر المبيعات أو التعديلات هنا على بيانات الشركة الحقيقية'
                  : 'Isolated Training Sandbox — Sales, stock edits & resets never affect production company data'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <button
            type="button"
            data-testid="practice-start-tour-btn"
            onClick={() => startTrainingTour(0)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950/15 hover:bg-zinc-950/25 text-zinc-950 text-xs font-bold transition-colors"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>{isAr ? 'الجولة الإرشادية' : 'Guided Tour'}</span>
          </button>

          <button
            type="button"
            data-testid="practice-reset-demo-btn"
            disabled={isResetting}
            onClick={handleResetDemo}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950/15 hover:bg-zinc-950/25 text-zinc-950 text-xs font-bold transition-colors disabled:opacity-50"
          >
            {resetSuccess ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-950" />
                <span>{isAr ? 'تمت إعادة ضبط التدريب' : 'Demo Data Reset!'}</span>
              </>
            ) : (
              <>
                <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
                <span>{isAr ? 'إعادة ضبط بيانات التدريب' : 'Reset Demo Data'}</span>
              </>
            )}
          </button>

          <button
            type="button"
            data-testid="practice-create-company-btn"
            onClick={() => openOnboardingModal('create-company')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950/20 hover:bg-zinc-950/30 text-zinc-950 text-xs font-black transition-colors border border-zinc-950/25"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>{isAr ? 'تأسيس شركة حقيقية' : 'Create New Company'}</span>
          </button>

          <button
            type="button"
            data-testid="practice-exit-btn"
            onClick={() => exitPracticeMode()}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-950 hover:bg-zinc-900 text-amber-300 text-xs font-black transition-colors shadow-sm"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{isAr ? 'الخروج للوضع الحقيقي' : 'Exit Practice Mode'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
