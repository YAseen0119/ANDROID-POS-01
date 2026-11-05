/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { usePOS } from '../../context/POSContext';
import {
  TRAINING_TOUR_STEPS,
  calculateTourCompletionPercent,
  isTourStepAccessibleForUser,
} from '../../lib/training-tour';
import { AppCard } from '../ui/AppCard';
import { TactileButton } from '../ui/TactileButton';
import {
  GraduationCap,
  Play,
  CheckCircle2,
  RotateCcw,
  Compass,
  FlaskConical,
  Building2,
  ClipboardCheck,
  Lock,
} from 'lucide-react';
import { playTactileClick } from '../../lib/sound-fx';

export const TrainingCenterSection: React.FC = () => {
  const {
    settings,
    currentUser,
    workspaceMode,
    currentCompany,
    trainingTourProgress,
    startTrainingTour,
    resetTrainingTour,
    enterPracticeMode,
    exitPracticeMode,
    openOnboardingModal,
    onboardingChecklist,
  } = usePOS();
  const isAr = settings.language === 'ar';

  const completionPercent = calculateTourCompletionPercent(
    trainingTourProgress,
    TRAINING_TOUR_STEPS
  );

  const checklistItems = [
    {
      id: 'companyProfileConfigured',
      done: onboardingChecklist.companyProfileConfigured,
      labelEn: '1. Company Profile Configured',
      labelAr: '1. إعداد ملف الشركة والبيانات القانونية',
    },
    {
      id: 'currenciesConfigured',
      done: onboardingChecklist.currenciesConfigured,
      labelEn: '2. Base Currency (SDG) & Exchange Rates Set',
      labelAr: '2. ضبط العملة الأساسية (SDG) وأسعار الصرف',
    },
    {
      id: 'branchCreated',
      done: onboardingChecklist.branchCreated,
      labelEn: '3. Initial Main Branch Created',
      labelAr: '3. إنشاء الفرع الرئيسي للشركة',
    },
    {
      id: 'firstProductsAdded',
      done: onboardingChecklist.firstProductsAdded,
      labelEn: '4. Product Catalog & Barcodes Added',
      labelAr: '4. إضافة الأصناف والمنتجات والباركود',
    },
    {
      id: 'firstEmployeeCreated',
      done: onboardingChecklist.firstEmployeeCreated,
      labelEn: '5. Employee Accounts & Roles Configured',
      labelAr: '5. إنشاء حسابات الموظفين وتخصيص الأدوار',
    },
    {
      id: 'firstSaleCompleted',
      done: onboardingChecklist.firstSaleCompleted,
      labelEn: '6. First POS Sale Completed',
      labelAr: '6. إتمام أول عملية بيع عبر الكاشير',
    },
    {
      id: 'inventoryReviewed',
      done: onboardingChecklist.inventoryReviewed,
      labelEn: '7. Inventory & Stock Movements Reviewed',
      labelAr: '7. مراجعة المخزون وحركات الجرد والتوريد',
    },
    {
      id: 'guidedTourCompleted',
      done: onboardingChecklist.guidedTourCompleted,
      labelEn: '8. 13-Step Guided Tour Completed',
      labelAr: '8. إتمام الجولة الإرشادية الشاملة (13 قسماً)',
    },
  ];

  return (
    <AppCard
      data-testid="training-center-section"
      className="space-y-5 border-amber-500/30"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-extrabold text-white">
                {isAr
                  ? 'مركز التدريب والتأسيس والجولة التعريفية (13 قسماً)'
                  : 'Onboarding Checklist, Practice Mode & 13-Step Guided Tour'}
              </h3>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                  workspaceMode === 'PRACTICE'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                }`}
              >
                {workspaceMode === 'PRACTICE'
                  ? isAr
                    ? 'وضع التدريب التجريبي'
                    : 'PRACTICE MODE'
                  : isAr
                  ? currentCompany.displayNameAr || currentCompany.displayName
                  : currentCompany.displayName}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              {isAr
                ? `نسبة إتمام التدريب: ${completionPercent}% · ${trainingTourProgress.completedStepIds.length} من ${TRAINING_TOUR_STEPS.length} أقسام مكتملة`
                : `Tour Completion: ${completionPercent}% · ${trainingTourProgress.completedStepIds.length} of ${TRAINING_TOUR_STEPS.length} modules completed`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            data-testid="settings-toggle-practice-mode-btn"
            onClick={() => {
              playTactileClick(settings.soundEnabled);
              if (workspaceMode === 'PRACTICE') {
                exitPracticeMode();
              } else {
                enterPracticeMode();
              }
            }}
            className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>
              {workspaceMode === 'PRACTICE'
                ? isAr
                  ? 'الخروج من وضع التدريب'
                  : 'Exit Practice Mode'
                : isAr
                ? 'دخول وضع التدريب التجريبي'
                : 'Enter Practice Mode'}
            </span>
          </button>

          <button
            type="button"
            data-testid="settings-open-company-wizard-btn"
            onClick={() => {
              playTactileClick(settings.soundEnabled);
              openOnboardingModal('create-company');
            }}
            className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>{isAr ? 'تأسيس شركة جديدة' : 'Create New Company'}</span>
          </button>

          {trainingTourProgress.completedStepIds.length > 0 && (
            <TactileButton
              variant="secondary"
              size="sm"
              data-testid="settings-reset-tour-btn"
              onClick={() => {
                playTactileClick(settings.soundEnabled);
                resetTrainingTour();
              }}
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              {isAr ? 'إعادة الضبط' : 'Reset'}
            </TactileButton>
          )}
          <TactileButton
            variant="amber"
            size="sm"
            data-testid="settings-start-full-tour-btn"
            onClick={() => {
              playTactileClick(settings.soundEnabled);
              startTrainingTour(0);
            }}
            leftIcon={<Play className="w-3.5 h-3.5" />}
          >
            {isAr ? 'بدء الجولة التدريبية الشاملة' : 'Start Full Guided Tour'}
          </TactileButton>
        </div>
      </div>

      {/* Live 8-Item Onboarding Checklist Card */}
      <div
        data-testid="onboarding-checklist-card"
        className="p-4 rounded-2xl bg-neutral-950/90 border border-neutral-800 space-y-3"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs sm:text-sm font-black text-zinc-100">
              {isAr
                ? 'قائمة التحقق من جاهزية الشركة والتأسيس (Onboarding Checklist)'
                : 'Company Setup & Operational Readiness Checklist'}
            </h4>
          </div>
          <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-mono font-bold">
            {onboardingChecklist.completedCount} / {onboardingChecklist.totalCount} (
            {onboardingChecklist.completionPercent}%)
          </span>
        </div>

        <div className="w-full h-2 rounded-full bg-neutral-900 border border-neutral-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-amber-400 transition-all duration-300"
            style={{ width: `${onboardingChecklist.completionPercent}%` }}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {checklistItems.map((item) => (
            <div
              key={item.id}
              data-testid={`checklist-item-${item.id}`}
              className={`p-2.5 rounded-xl border flex items-center gap-2 text-xs font-bold ${
                item.done
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                  : 'bg-neutral-900/60 border-neutral-800 text-neutral-400'
              }`}
            >
              <CheckCircle2
                className={`w-4 h-4 shrink-0 ${
                  item.done ? 'text-emerald-400' : 'text-neutral-600'
                }`}
              />
              <span className="truncate">{isAr ? item.labelAr : item.labelEn}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tour Progress Bar */}
      <div className="w-full h-2 rounded-full bg-neutral-950 border border-neutral-800 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-300"
          style={{ width: `${completionPercent}%` }}
        />
      </div>

      {/* Grid of all 13 Interactive Training Modules */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {TRAINING_TOUR_STEPS.map((step, idx) => {
          const isCompleted = trainingTourProgress.completedStepIds.includes(step.id);
          const isAccessible = isTourStepAccessibleForUser(step, currentUser);
          return (
            <button
              key={step.id}
              type="button"
              data-testid={`settings-launch-tour-step-${idx + 1}`}
              onClick={() => {
                playTactileClick(settings.soundEnabled);
                startTrainingTour(idx);
              }}
              className="p-3 rounded-2xl bg-neutral-950/80 hover:bg-neutral-900 border border-neutral-800/90 hover:border-amber-500/50 text-start transition-all flex items-start justify-between gap-2.5 group"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-white group-hover:text-amber-300 transition-colors">
                  {isCompleted ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Compass className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  )}
                  <span className="truncate">
                    {isAr ? step.titleAr : step.titleEn}
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400 line-clamp-2 leading-relaxed">
                  {isAr ? step.subtitleAr : step.subtitleEn}
                </p>
                {!isAccessible && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-bold pt-0.5">
                    <Lock className="w-3 h-3" />
                    <span>{isAr ? 'حسب صلاحية الدور' : 'Role-restricted view'}</span>
                  </span>
                )}
              </div>
              <span className="text-[11px] font-mono font-bold text-amber-400 shrink-0 pt-0.5">
                {isAr ? 'ابدأ ←' : 'Start →'}
              </span>
            </button>
          );
        })}
      </div>
    </AppCard>
  );
};
