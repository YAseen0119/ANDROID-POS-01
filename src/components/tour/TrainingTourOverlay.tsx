/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { usePOS } from '../../context/POSContext';
import {
  TRAINING_TOUR_STEPS,
  TrainingTourProgressState,
  clampTourStepIndex,
  calculateTourCompletionPercent,
  isTourStepAccessibleForUser,
} from '../../lib/training-tour';
import { TactileButton } from '../ui/TactileButton';
import {
  GraduationCap,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Lightbulb,
  X,
  Compass,
  Minimize2,
  Maximize2,
  Play,
  RotateCcw,
  Lock,
} from 'lucide-react';
import { playTactileClick } from '../../lib/sound-fx';

interface TrainingTourOverlayProps {
  isOpen: boolean;
  currentStepIndex: number;
  progress: TrainingTourProgressState;
  onSelectStep: (index: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onFinish: () => void;
  onClose: () => void;
  onResetProgress: () => void;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const TrainingTourOverlay: React.FC<TrainingTourOverlayProps> = ({
  isOpen,
  currentStepIndex,
  progress,
  onSelectStep,
  onNext,
  onPrev,
  onFinish,
  onClose,
  onResetProgress,
}) => {
  const { settings, activeTab, setActiveTab, currentUser } = usePOS();
  const isAr = settings.language === 'ar';

  const [isMinimized, setIsMinimized] = useState(false);
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);

  const safeIndex = clampTourStepIndex(currentStepIndex, TRAINING_TOUR_STEPS.length);
  const currentStep = TRAINING_TOUR_STEPS[safeIndex];
  const isFirstStep = safeIndex === 0;
  const isLastStep = safeIndex === TRAINING_TOUR_STEPS.length - 1;
  const completionPercent = calculateTourCompletionPercent(progress, TRAINING_TOUR_STEPS);
  const isAccessibleForRole = currentStep
    ? isTourStepAccessibleForUser(currentStep, currentUser)
    : true;

  // Sync active POS navigation tab with the current tour step so the user sees the real screen
  useEffect(() => {
    if (!isOpen || !currentStep) return;
    if (activeTab !== currentStep.tab) {
      setActiveTab(currentStep.tab);
    }
  }, [isOpen, currentStep, activeTab, setActiveTab]);

  // Locate and measure the target element on screen for live spotlight ring
  useEffect(() => {
    if (!isOpen || !currentStep?.targetSelector) {
      setSpotlightRect(null);
      return;
    }

    const updateSpotlight = () => {
      try {
        const el = document.querySelector(currentStep.targetSelector!) as HTMLElement | null;
        if (!el) {
          setSpotlightRect(null);
          return;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setSpotlightRect({
            top: Math.max(4, rect.top - 6),
            left: Math.max(4, rect.left - 6),
            width: rect.width + 12,
            height: rect.height + 12,
          });
        } else {
          setSpotlightRect(null);
        }
      } catch {
        setSpotlightRect(null);
      }
    };

    const timer = window.setTimeout(updateSpotlight, 180);
    window.addEventListener('resize', updateSpotlight);
    window.addEventListener('scroll', updateSpotlight, true);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', updateSpotlight);
      window.removeEventListener('scroll', updateSpotlight, true);
    };
  }, [isOpen, currentStep, activeTab]);

  // Keyboard navigation (Escape, Left/Right arrows)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight') {
        if (isAr) {
          if (!isFirstStep) onPrev();
        } else {
          if (!isLastStep) onNext();
        }
      } else if (e.key === 'ArrowLeft') {
        if (isAr) {
          if (!isLastStep) onNext();
        } else {
          if (!isFirstStep) onPrev();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isAr, isFirstStep, isLastStep, onNext, onPrev, onClose]);

  if (!isOpen || !currentStep) return null;

  const handleTryTargetElement = () => {
    playTactileClick(settings.soundEnabled);
    if (currentStep.targetSelector) {
      const el = document.querySelector(currentStep.targetSelector) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
      }
    }
    setIsMinimized(true);
  };

  return (
    <div
      data-testid="training-tour-modal"
      role="dialog"
      aria-modal="false"
      aria-label={
        isAr
          ? 'الجولة التدريبية التفاعلية للنظام'
          : 'Interactive POS Guided Training Tour'
      }
      className="fixed inset-0 z-50 pointer-events-none flex flex-col justify-end sm:justify-center items-center p-3 sm:p-6"
    >
      {/* Subtle backdrop when expanded so the user can still see the live POS view behind */}
      {!isMinimized && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/55 backdrop-blur-[2px] pointer-events-auto transition-opacity"
        />
      )}

      {/* Live Target Spotlight Highlight Ring */}
      {spotlightRect && (
        <div
          data-testid="tour-spotlight-ring"
          style={{
            top: `${spotlightRect.top}px`,
            left: `${spotlightRect.left}px`,
            width: `${spotlightRect.width}px`,
            height: `${spotlightRect.height}px`,
          }}
          className="fixed z-50 pointer-events-none rounded-2xl border-2 border-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.25),0_0_28px_rgba(245,158,11,0.5)] transition-all duration-300"
        />
      )}

      {/* Minimized Floating Bar (allows interacting with the live screen while keeping the tour active) */}
      {isMinimized ? (
        <div
          data-testid="training-tour-minimized-bar"
          className="relative z-50 pointer-events-auto w-full max-w-2xl mb-16 sm:mb-4 rounded-2xl bg-neutral-900/95 border-2 border-amber-500/60 shadow-2xl p-3.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-neutral-950 flex items-center justify-center font-mono font-extrabold text-sm shrink-0">
              {safeIndex + 1}/{TRAINING_TOUR_STEPS.length}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-white truncate">
                {isAr ? currentStep.titleAr : currentStep.titleEn}
              </div>
              <div className="text-[11px] text-amber-300 truncate">
                {isAr
                  ? 'وضع التطبيق العملي مفعل — جرّب الشاشة الآن ثم انتقل للخطوة التالية'
                  : 'Hands-on mode active — interact with the screen then continue'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                playTactileClick(settings.soundEnabled);
                onPrev();
              }}
              disabled={isFirstStep}
              className="px-2.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-xs font-bold text-neutral-200"
            >
              {isAr ? 'السابق' : 'Prev'}
            </button>
            <button
              type="button"
              onClick={() => {
                playTactileClick(settings.soundEnabled);
                if (isLastStep) {
                  onFinish();
                } else {
                  onNext();
                }
              }}
              className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-extrabold"
            >
              {isLastStep ? (isAr ? 'إنهاء الجولة' : 'Finish') : isAr ? 'التالي' : 'Next'}
            </button>
            <button
              type="button"
              data-testid="tour-expand-btn"
              onClick={() => {
                playTactileClick(settings.soundEnabled);
                setIsMinimized(false);
              }}
              className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-amber-300"
              title={isAr ? 'تكبير بطاقة الشرح' : 'Expand Tour Guide'}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white"
              title={isAr ? 'إغلاق' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        /* Full Interactive Training Tour Dialog Card */
        <div className="relative z-50 pointer-events-auto w-full max-w-2xl rounded-3xl bg-neutral-900 border border-neutral-700/90 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
          {/* Top Progress Header */}
          <div className="p-4 sm:p-5 bg-neutral-950/90 border-b border-neutral-800 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-extrabold text-white">
                      {isAr
                        ? 'الجولة التدريبية التفاعلية لنظام نقطة البيع'
                        : 'Interactive POS Training Tour'}
                    </h3>
                    <span className="text-xs font-mono text-amber-400 font-bold">
                      {safeIndex + 1} / {TRAINING_TOUR_STEPS.length}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400">
                    {isAr
                      ? `نسبة الإنجاز: ${completionPercent}% · يتم الانتقال تلقائياً لكل قسم لشرحه عملياً`
                      : `Progress: ${completionPercent}% · Automatically navigates to each live module`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="tour-minimize-btn"
                  onClick={() => {
                    playTactileClick(settings.soundEnabled);
                    setIsMinimized(true);
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 hover:text-white text-xs font-semibold flex items-center gap-1"
                  title={isAr ? 'تصغير للتطبيق العملي المباشر' : 'Minimize to interact with screen'}
                >
                  <Minimize2 className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">
                    {isAr ? 'تصغير للتجربة' : 'Hands-on Mode'}
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="tour-close-btn"
                  onClick={onClose}
                  aria-label={isAr ? 'إغلاق الجولة التدريبية' : 'Close Training Tour'}
                  className="p-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Interactive 13-Step Selector Bar */}
            <div
              role="tablist"
              aria-label={isAr ? 'خطوات الجولة التدريبية' : 'Training tour steps'}
              className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-13 gap-1 pt-1"
            >
              {TRAINING_TOUR_STEPS.map((step, idx) => {
                const isCurrent = idx === safeIndex;
                const isDone = progress.completedStepIds.includes(step.id);
                return (
                  <button
                    key={step.id}
                    type="button"
                    role="tab"
                    aria-selected={isCurrent}
                    data-testid={`tour-step-tab-${idx + 1}`}
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      onSelectStep(idx);
                    }}
                    className={`py-1 px-1.5 rounded-lg text-[10px] font-mono font-bold border transition-all flex items-center justify-center gap-0.5 ${
                      isCurrent
                        ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                        : isDone
                        ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50 hover:border-emerald-500'
                        : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200'
                    }`}
                  >
                    <span>#{idx + 1}</span>
                    {isDone && !isCurrent && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step Body Content */}
          <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
            {!isAccessibleForRole && (
              <div
                data-testid="tour-role-restriction-notice"
                className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center gap-2"
              >
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  {isAr
                    ? 'ملاحظة: دور حسابك الحالي يمتلك صلاحية مقيدة في هذا القسم، ولكن يمكنك الاطلاع على شرحه الوظيفي هنا.'
                    : 'Note: Your current role has restricted write/view permissions for this module, but you can review its workflow here.'}
                </span>
              </div>
            )}

            {/* Step Header & Subtitle */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                <Compass className="w-3.5 h-3.5" />
                <span>{isAr ? currentStep.subtitleAr : currentStep.subtitleEn}</span>
              </div>
              <h4
                data-testid="tour-current-step-title"
                className="text-base sm:text-lg font-extrabold text-white leading-snug"
              >
                {isAr ? currentStep.titleAr : currentStep.titleEn}
              </h4>
              <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed pt-1">
                {isAr ? currentStep.descriptionAr : currentStep.descriptionEn}
              </p>
            </div>

            {/* Key Capabilities Checklist */}
            <div className="p-3.5 rounded-2xl bg-neutral-950/90 border border-neutral-800/90 space-y-2.5">
              <div className="text-xs font-bold text-neutral-200">
                {isAr ? 'أهم المهارات والمميزات في هذا القسم:' : 'Key Capabilities in This Module:'}
              </div>
              <ul className="space-y-2">
                {(isAr ? currentStep.keyPointsAr : currentStep.keyPointsEn).map((pt, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-xs text-neutral-300 leading-relaxed">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Practical Tip Box & Hands-On Action */}
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Lightbulb className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200 leading-relaxed font-medium">
                  {isAr ? currentStep.practicalTipAr : currentStep.practicalTipEn}
                </p>
              </div>

              <button
                type="button"
                data-testid="tour-try-live-btn"
                onClick={handleTryTargetElement}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-extrabold flex items-center justify-center gap-1.5 shrink-0 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{isAr ? 'طبّق عملياً الآن' : 'Try It Live'}</span>
              </button>
            </div>
          </div>

          {/* Footer Navigation Controls */}
          <div className="p-4 sm:px-6 bg-neutral-950/90 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TactileButton
                variant="ghost"
                size="sm"
                data-testid="tour-skip-btn"
                onClick={onClose}
              >
                {isAr ? 'إغلاق مؤقت' : 'Pause Tour'}
              </TactileButton>

              {progress.completedStepIds.length > 0 && (
                <button
                  type="button"
                  data-testid="tour-reset-btn"
                  onClick={() => {
                    playTactileClick(settings.soundEnabled);
                    onResetProgress();
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-[11px] text-neutral-400 hover:text-white flex items-center gap-1"
                  title={isAr ? 'إعادة الجولة من البداية' : 'Restart Tour'}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{isAr ? 'إعادة من البداية' : 'Restart'}</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <TactileButton
                variant="secondary"
                size="sm"
                data-testid="tour-prev-btn"
                disabled={isFirstStep}
                onClick={() => {
                  playTactileClick(settings.soundEnabled);
                  onPrev();
                }}
                leftIcon={isAr ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              >
                {isAr ? 'الخطوة السابقة' : 'Previous'}
              </TactileButton>

              {isLastStep ? (
                <TactileButton
                  variant="emerald"
                  size="sm"
                  data-testid="tour-finish-btn"
                  onClick={() => {
                    playTactileClick(settings.soundEnabled);
                    onFinish();
                  }}
                  leftIcon={<CheckCircle2 className="w-4 h-4" />}
                >
                  {isAr ? 'إتمام الجولة التدريبية' : 'Complete Training Tour'}
                </TactileButton>
              ) : (
                <TactileButton
                  variant="amber"
                  size="sm"
                  data-testid="tour-next-btn"
                  onClick={() => {
                    playTactileClick(settings.soundEnabled);
                    onNext();
                  }}
                  rightIcon={isAr ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                >
                  {isAr ? 'الخطوة التالية' : 'Next Step'}
                </TactileButton>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
