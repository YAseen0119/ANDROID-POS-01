/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Building2,
  FlaskConical,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Coins,
  Store,
  UserCheck,
  Sparkles,
  X,
  Lock,
  AlertCircle,
  Compass,
  Briefcase,
  Globe2,
  ArchiveRestore,
  Upload,
} from 'lucide-react';
import { usePOS, OnboardingModalView } from '../../context/POSContext';
import { BackupEnvelopeV1, remapBackupPayloadForNewCompany } from '../../lib/backup-merge-engine';

export const FirstRunOnboardingModal: React.FC = () => {
  const {
    isOnboardingModalOpen,
    onboardingModalInitialView,
    closeOnboardingModal,
    settings,
    workspaceMode,
    currentCompany,
    companies,
    currentUser,
    enterPracticeMode,
    exitPracticeMode,
    createNewCompanyWorkspace,
    switchCompanyWorkspace,
    resetAllData,
    startTrainingTour,
    hydrateCompanyFromBackupPayload,
  } = usePOS();

  const isAr = settings.language === 'ar';
  const [activeView, setActiveView] = useState<OnboardingModalView>(onboardingModalInitialView);
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [launchTourAfterSetup, setLaunchTourAfterSetup] = useState(false);

  // Restore from Backup as New Company State
  const [restoreEnvelope, setRestoreEnvelope] = useState<BackupEnvelopeV1 | null>(null);
  const [restoreFileName, setRestoreFileName] = useState('');
  const [restoreDecryptionPassword, setRestoreDecryptionPassword] = useState('');
  const [restoreCompanyName, setRestoreCompanyName] = useState('');
  const [restoreCompanyNameAr, setRestoreCompanyNameAr] = useState('');
  const [restoreOwnerName, setRestoreOwnerName] = useState('');
  const [restoreOwnerUsername, setRestoreOwnerUsername] = useState('');
  const [restoreOwnerPassword, setRestoreOwnerPassword] = useState('');
  const [restoreOwnerConfirmPassword, setRestoreOwnerConfirmPassword] = useState('');

  // Step 1: Company Profile (No pre-filled fake defaults)
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [displayNameAr, setDisplayNameAr] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [defaultLanguage, setDefaultLanguage] = useState<'ar' | 'en'>(
    settings.language === 'ar' ? 'ar' : 'en'
  );
  const [timezone, setTimezone] = useState('Africa/Khartoum');
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(1);

  // Step 2: Currency & Exchange Rate Setup (No default foreign currencies or rates unless entered by user)
  const [skipInitialCurrencies, setSkipInitialCurrencies] = useState(false);
  const [baseCurrency, setBaseCurrency] = useState('SDG');
  const [secondaryCurrencies, setSecondaryCurrencies] = useState<string[]>([]);
  const [usdRate, setUsdRate] = useState('');
  const [sarRate, setSarRate] = useState('');
  const [aedRate, setAedRate] = useState('');
  const [egpRate, setEgpRate] = useState('');
  const [exchangeRatePolicy, setExchangeRatePolicy] = useState<
    'manual_daily' | 'locked_per_shift' | 'flexible_cashier'
  >('manual_daily');

  // Step 3: Initial Main Branch (No pre-filled defaults)
  const [branchName, setBranchName] = useState('');
  const [branchNameAr, setBranchNameAr] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [branchCity, setBranchCity] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('');

  // Step 4: Initial Owner / Admin Account (No pre-filled defaults)
  const [ownerName, setOwnerName] = useState('');
  const [ownerNameAr, setOwnerNameAr] = useState('');
  const [ownerUsername, setOwnerUsername] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerConfirmPassword, setOwnerConfirmPassword] = useState('');
  const [ownerPin, setOwnerPin] = useState('');

  useEffect(() => {
    if (isOnboardingModalOpen) {
      setActiveView(onboardingModalInitialView);
      setWizardStep(1);
      setErrorMessage(null);
    }
  }, [isOnboardingModalOpen, onboardingModalInitialView]);

  if (!isOnboardingModalOpen) return null;

  const handleRestoreFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupEnvelopeV1;
      if (!parsed || parsed.formatSignature !== 'DQNAMO_POS_BACKUP_V1' || !parsed.manifest) {
        throw new Error(
          isAr
            ? 'ملف النسخة الاحتياطية غير صالح أو لا يطابق صيغة DQNAMO_POS_BACKUP_V1.'
            : 'Invalid backup file or unsupported format signature.'
        );
      }
      setRestoreEnvelope(parsed);
      setRestoreFileName(file.name);
      const srcName = parsed.manifest.sourceCompany?.displayName;
      const srcNameAr = parsed.manifest.sourceCompany?.displayNameAr;
      if (!restoreCompanyName && srcName) {
        setRestoreCompanyName(`${srcName} (Restored)`);
      }
      if (!restoreCompanyNameAr && srcNameAr) {
        setRestoreCompanyNameAr(`${srcNameAr} (مستعادة)`);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to parse backup file.');
    }
    e.target.value = '';
  };

  const handleRestoreAsNewCompanySubmit = async () => {
    setErrorMessage(null);
    if (!restoreEnvelope) {
      setErrorMessage(
        isAr ? 'يرجى اختيار ملف النسخة الاحتياطية (.backup) أولاً.' : 'Please select a .backup file first.'
      );
      return;
    }
    if (!restoreCompanyName.trim()) {
      setErrorMessage(
        isAr ? 'يرجى إدخال اسم الشركة الجديدة.' : 'Please enter the New Company Name.'
      );
      return;
    }
    if (!restoreOwnerUsername.trim()) {
      setErrorMessage(
        isAr ? 'يرجى إدخال اسم المستخدم لحساب المالك الجديد.' : 'Owner Username is required.'
      );
      return;
    }
    if (!restoreOwnerPassword || restoreOwnerPassword.length < 4) {
      setErrorMessage(
        isAr
          ? 'كلمة مرور المالك مطلوبة (4 أحرف على الأقل).'
          : 'Owner Password is required (at least 4 characters).'
      );
      return;
    }
    if (restoreOwnerPassword !== restoreOwnerConfirmPassword) {
      setErrorMessage(
        isAr
          ? 'كلمة المرور وتأكيد كلمة المرور غير متطابقين.'
          : 'Owner Password and Confirm Password do not match.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/backups/restore-new-company', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({
          envelope: restoreEnvelope,
          decryptionPassword: restoreDecryptionPassword || undefined,
          companyName: restoreCompanyName.trim(),
          companyNameAr: restoreCompanyNameAr.trim() || restoreCompanyName.trim(),
          ownerName: restoreOwnerName.trim() || restoreOwnerUsername.trim(),
          ownerUsername: restoreOwnerUsername.trim(),
          ownerPassword: restoreOwnerPassword,
          ownerConfirmPassword: restoreOwnerConfirmPassword,
        }),
      });
      const json = await response.json();
      const resultData = json?.data || json;
      if (!response.ok || (!json.success && !resultData?.ok)) {
        throw new Error(json.error || 'Failed to restore backup as new company.');
      }

      if (resultData.restoredPayload && resultData.company) {
        hydrateCompanyFromBackupPayload(resultData.restoredPayload, {
          switchToNewCompany: true,
          newOwner: resultData.owner,
        });
      }
      closeOnboardingModal();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Restore as new company failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSecondaryCurrency = (code: string) => {
    setSecondaryCurrencies((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const validateCurrentWizardStep = (): boolean => {
    setErrorMessage(null);
    if (wizardStep === 1) {
      const effectiveName = legalName.trim() || displayName.trim() || displayNameAr.trim();
      if (!effectiveName) {
        setErrorMessage(
          isAr
            ? 'يرجى إدخال اسم الشركة أو المتجر أولاً.'
            : 'Please enter the company or store name.'
        );
        return false;
      }
      if (!legalName.trim()) setLegalName(effectiveName);
      if (!displayName.trim()) setDisplayName(effectiveName);
      if (!displayNameAr.trim()) setDisplayNameAr(effectiveName);
      return true;
    }
    if (wizardStep === 2) {
      if (skipInitialCurrencies) {
        return true;
      }
      if (!baseCurrency.trim()) {
        setBaseCurrency('SDG');
      }
      const rateMap: Record<string, string> = {
        USD: usdRate,
        SAR: sarRate,
        AED: aedRate,
        EGP: egpRate,
      };
      for (const code of secondaryCurrencies) {
        const val = Number(rateMap[code]);
        if (!rateMap[code]?.trim() || isNaN(val) || val <= 0) {
          setErrorMessage(
            isAr
              ? `يرجى إدخال سعر صرف صحيح أكبر من 0 للعملة المحددة (${code}) أو إلغاء تحديدها.`
              : `Please enter a valid exchange rate greater than 0 for (${code}) or uncheck it.`
          );
          return false;
        }
      }
      return true;
    }
    if (wizardStep === 3) {
      const effectiveBranch =
        branchName.trim() ||
        branchNameAr.trim() ||
        displayNameAr.trim() ||
        displayName.trim() ||
        legalName.trim();
      if (!effectiveBranch) {
        setErrorMessage(
          isAr ? 'يرجى إدخال اسم الفرع.' : 'Please enter the branch name.'
        );
        return false;
      }
      if (!branchName.trim()) setBranchName(effectiveBranch);
      if (!branchNameAr.trim()) setBranchNameAr(effectiveBranch);
      return true;
    }
    if (wizardStep === 4) {
      const effectiveOwner =
        ownerName.trim() ||
        ownerNameAr.trim() ||
        ownerUsername.trim() ||
        displayNameAr.trim() ||
        displayName.trim() ||
        legalName.trim();
      if (!effectiveOwner) {
        setErrorMessage(
          isAr ? 'يرجى إدخال اسم المالك أو المدير.' : 'Please enter the owner name.'
        );
        return false;
      }
      if (!ownerName.trim()) setOwnerName(effectiveOwner);
      if (!ownerNameAr.trim()) setOwnerNameAr(effectiveOwner);

      if (!ownerUsername.trim() && !ownerEmail.trim()) {
        setErrorMessage(
          isAr
            ? 'يرجى إدخال اسم المستخدم (Username) لحساب المالك.'
            : 'Owner username is required.'
        );
        return false;
      }

      if (!ownerPassword.trim() || ownerPassword.trim().length < 4) {
        setErrorMessage(
          isAr
            ? 'يرجى إدخال كلمة مرور للمالك تتكون من 4 أحرف أو أرقام على الأقل.'
            : 'Owner password is required and must be at least 4 characters.'
        );
        return false;
      }

      if (ownerPassword !== ownerConfirmPassword) {
        setErrorMessage(
          isAr
            ? 'كلمة المرور وتأكيد كلمة المرور غير متطابقين.'
            : 'Password and Confirm Password do not match.'
        );
        return false;
      }
      return true;
    }
    return true;
  };

  const handleNextStep = () => {
    if (!validateCurrentWizardStep()) return;
    setWizardStep((prev) => Math.min(5, prev + 1));
  };

  const handlePrevStep = () => {
    setErrorMessage(null);
    if (wizardStep === 1) {
      setActiveView('hub');
    } else {
      setWizardStep((prev) => Math.max(1, prev - 1));
    }
  };

  const handleCreateCompanySubmit = async () => {
    setErrorMessage(null);
    const effectiveCompanyName = legalName.trim() || displayName.trim() || displayNameAr.trim();
    if (!effectiveCompanyName) {
      setWizardStep(1);
      setErrorMessage(
        isAr
          ? 'يرجى إدخال اسم الشركة أو المتجر في الخطوة 1.'
          : 'Please enter the company or store name in Step 1.'
      );
      return;
    }

    if (!ownerUsername.trim() && !ownerEmail.trim()) {
      setWizardStep(4);
      setErrorMessage(
        isAr
          ? 'يرجى إدخال اسم المستخدم (Username) لحساب المالك في الخطوة 4.'
          : 'Please enter the Owner Username in Step 4.'
      );
      return;
    }

    if (!ownerPassword.trim() || ownerPassword.trim().length < 4) {
      setWizardStep(4);
      setErrorMessage(
        isAr
          ? 'يرجى إدخال كلمة مرور المالك (4 أحرف على الأقل) في الخطوة 4.'
          : 'Please enter an Owner Password (at least 4 characters) in Step 4.'
      );
      return;
    }

    if (ownerPassword !== ownerConfirmPassword) {
      setWizardStep(4);
      setErrorMessage(
        isAr
          ? 'كلمة المرور وتأكيد كلمة المرور غير متطابقين في الخطوة 4.'
          : 'Password and Confirm Password do not match in Step 4.'
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const finalLegalName = legalName.trim() || effectiveCompanyName;
      const finalDisplayName = displayName.trim() || finalLegalName;
      const finalDisplayNameAr = displayNameAr.trim() || finalDisplayName;
      const finalBranchName =
        branchName.trim() || branchNameAr.trim() || finalDisplayName;
      const finalBranchNameAr = branchNameAr.trim() || finalBranchName;
      const finalOwnerName =
        ownerName.trim() || ownerNameAr.trim() || ownerUsername.trim() || finalDisplayName;
      const finalOwnerNameAr = ownerNameAr.trim() || finalOwnerName;
      const finalPassword = ownerPassword.trim();
      const uniqueSuffix = Date.now().toString(36).slice(-4);
      const finalUsername = ownerUsername.trim() || ownerEmail.trim();

      const idempotencyKey = `onboard-${Date.now().toString(36)}-${uniqueSuffix}`;

      // Only include exchange rates that the user explicitly enabled AND entered a valid rate for
      const cleanBase = skipInitialCurrencies ? '' : baseCurrency.trim().toUpperCase() || 'SDG';
      const userEnteredExchangeRates: Record<string, number> = cleanBase
        ? { [cleanBase]: 1 }
        : {};
      const activeSecondaryList: string[] = [];
      const rateCandidates: Record<string, string> = {
        USD: usdRate,
        SAR: sarRate,
        AED: aedRate,
        EGP: egpRate,
      };
      if (!skipInitialCurrencies) {
        for (const code of secondaryCurrencies) {
          const parsedRate = Number(rateCandidates[code]);
          if (!isNaN(parsedRate) && parsedRate > 0) {
            userEnteredExchangeRates[code] = parsedRate;
            activeSecondaryList.push(code);
          }
        }
      }

      const result = await createNewCompanyWorkspace({
        idempotencyKey,
        skipInitialCurrencies,
        legalName: finalLegalName,
        displayName: finalDisplayName,
        displayNameAr: finalDisplayNameAr,
        businessType: businessType.trim(),
        country: country.trim(),
        city: city.trim(),
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim(),
        taxNumber: taxNumber.trim(),
        defaultLanguage,
        timezone,
        fiscalYearStartMonth,
        baseCurrency: cleanBase || 'SDG',
        secondaryCurrencies: activeSecondaryList,
        exchangeRatePolicy,
        initialExchangeRates: userEnteredExchangeRates,
        branchName: finalBranchName,
        branchNameAr: finalBranchNameAr,
        branchCode: branchCode.trim() || `BR-${uniqueSuffix.toUpperCase()}`,
        branchCity: branchCity.trim() || city.trim(),
        branchAddress: branchAddress.trim() || address.trim(),
        branchPhone: branchPhone.trim() || phone.trim(),
        ownerName: finalOwnerName,
        ownerNameAr: finalOwnerNameAr,
        ownerUsername: finalUsername,
        ownerEmail: ownerEmail.trim(),
        ownerPhone: ownerPhone.trim() || phone.trim(),
        ownerPassword: finalPassword,
        ownerConfirmPassword: ownerConfirmPassword.trim(),
        ownerPin: ownerPin.trim() || '1111',
      });

      if (!result.ok) {
        setErrorMessage(result.error || 'Failed to create company.');
        return;
      }

      if (launchTourAfterSetup) {
        setTimeout(() => {
          startTrainingTour(0);
        }, 250);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-testid="first-run-onboarding-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md overflow-y-auto"
    >
      <div className="w-full max-w-4xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Top Modal Header */}
        <div className="px-5 py-4 bg-zinc-950/90 border-b border-zinc-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-zinc-100">
                  {activeView === 'create-company'
                    ? isAr
                      ? 'معالج تأسيس شركة جديدة وإعداد المالك'
                      : 'New Company & Initial Owner Setup Wizard'
                    : isAr
                    ? 'بوابة التأسيس ووضع التدريب التجريبي وإدارة الشركات'
                    : 'Company Onboarding, Practice Mode & Workspace Hub'}
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] font-black uppercase">
                  Release v1.0
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {isAr
                  ? 'اختر الدخول لبيئة التدريب المعزولة أو تأسيس شركة حقيقية جديدة مع الحفاظ التام على بياناتك الحالية'
                  : 'Enter the isolated Practice Mode sandbox, create a new production company, or switch active company workspaces'}
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="onboarding-modal-close-btn"
            onClick={closeOnboardingModal}
            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {errorMessage && (
            <div
              data-testid="onboarding-error-banner"
              className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-bold flex items-center gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {activeView === 'hub' ? (
            <div className="space-y-6">
              {/* Three Primary Entry Options: Option A (Practice Mode), Option B (Create New Company), Option C (Restore from Backup) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* OPTION A: PRACTICE MODE */}
                <div
                  data-testid="onboarding-option-practice-card"
                  className="p-5 rounded-2xl bg-gradient-to-br from-amber-500/10 via-zinc-900 to-zinc-950 border border-amber-500/30 flex flex-col justify-between gap-4 hover:border-amber-400/60 transition-all"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 text-[11px] font-black uppercase tracking-wider">
                        {isAr ? 'الخيار أ — بيئة تدريب معزولة' : 'OPTION A — TRAINING SANDBOX'}
                      </span>
                      <FlaskConical className="w-5 h-5 text-amber-400" />
                    </div>
                    <h3 className="text-base sm:text-lg font-black text-zinc-100">
                      {isAr
                        ? 'وضع التدريب التجريبي (Practice Mode)'
                        : 'Practice Mode (Isolated Demo)'}
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      {isAr
                        ? 'ادخل فوراً إلى شركة تدريبية معزولة بالكامل تحتوي على أصناف، عملاء، فواتير، مخزون، وتقارير ذكاء أعمال جاهزة للتجربة والتدريب دون أي تأثير على قاعدة بيانات الإنتاج.'
                        : 'Enter a 100% isolated demo company preloaded with sample products, customers, sales, stock movements, and intelligence recommendations. Zero impact on production data.'}
                    </p>
                    <ul className="space-y-1.5 text-xs text-zinc-300 pt-1">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>
                          {isAr
                            ? 'تجربة البيع، المرتجعات، الجرد، والعملات بأمان تام'
                            : 'Practice sales, returns, stock adjustments & multi-currency safely'}
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>
                          {isAr
                            ? 'إمكانية إعادة ضبط بيانات التدريب في أي وقت بضغطة زر'
                            : 'One-click Reset Demo Data anytime without touching production'}
                        </span>
                      </li>
                    </ul>
                  </div>

                  <button
                    type="button"
                    data-testid="onboarding-enter-practice-btn"
                    onClick={() => enterPracticeMode()}
                    className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-amber-500/10"
                  >
                    <FlaskConical className="w-4 h-4" />
                    <span>
                      {isAr
                        ? 'بدء وضع التدريب التجريبي الآن'
                        : 'Launch Practice Mode Sandbox'}
                    </span>
                  </button>
                </div>

                {/* OPTION B: CREATE NEW COMPANY */}
                <div
                  data-testid="onboarding-option-create-company-card"
                  className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-zinc-900 to-zinc-950 border border-emerald-500/30 flex flex-col justify-between gap-4 hover:border-emerald-400/60 transition-all"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 text-[11px] font-black uppercase tracking-wider">
                        {isAr ? 'الخيار ب — بيئة إنتاج حقيقية' : 'OPTION B — PRODUCTION SETUP'}
                      </span>
                      <Building2 className="w-5 h-5 text-emerald-400" />
                    </div>
                    <h3 className="text-base sm:text-lg font-black text-zinc-100">
                      {isAr ? 'تأسيس شركة جديدة (Create New Company)' : 'Create New Company'}
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      {isAr
                        ? 'معالج تأسيس احترافي من 5 خطوات لإعداد ملف الشركة، العملة الأساسية (SDG) وأسعار الصرف، الفرع الرئيسي، وحساب المالك / المدير العام بصلاحيات كاملة وعزل تام للبيانات.'
                        : 'Guided 5-step production setup wizard for Company Profile, SDG Base Currency & Exchange Rates, Initial Main Branch, and Initial Company Owner / Admin account.'}
                    </p>
                    <ul className="space-y-1.5 text-xs text-zinc-300 pt-1">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>
                          {isAr
                            ? 'عزل كامل لبيانات كل شركة وفروعها ومستخدميها'
                            : 'Complete multi-company & branch data isolation'}
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>
                          {isAr
                            ? 'إنشاء حساب المالك المشفر وإطلاق الجولة الإرشادية'
                            : 'Encrypted Owner credentials + interactive 13-step guided tour'}
                        </span>
                      </li>
                    </ul>
                  </div>

                  <button
                    type="button"
                    data-testid="onboarding-start-company-wizard-btn"
                    onClick={() => {
                      setActiveView('create-company');
                      setWizardStep(1);
                    }}
                    className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-500/10"
                  >
                    <Building2 className="w-4 h-4" />
                    <span>
                      {isAr ? 'بدء معالج تأسيس شركة جديدة' : 'Start New Company Setup Wizard'}
                    </span>
                  </button>
                </div>

                {/* OPTION C: RESTORE COMPANY FROM BACKUP */}
                <div
                  data-testid="onboarding-option-restore-backup-card"
                  className="p-5 rounded-2xl bg-gradient-to-br from-sky-500/10 via-zinc-900 to-zinc-950 border border-sky-500/30 flex flex-col justify-between gap-4 hover:border-sky-400/60 transition-all"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="px-2.5 py-1 rounded-lg bg-sky-500/20 text-sky-300 text-[11px] font-black uppercase tracking-wider">
                        {isAr ? 'الخيار ج — استعادة وترحيل' : 'OPTION C — BACKUP RESTORE'}
                      </span>
                      <ArchiveRestore className="w-5 h-5 text-sky-400" />
                    </div>
                    <h3 className="text-base sm:text-lg font-black text-zinc-100">
                      {isAr
                        ? 'استعادة شركة من نسخة احتياطية (.backup)'
                        : 'Restore Company from Backup (.backup)'}
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      {isAr
                        ? 'قم برفع ملف نسخة احتياطية (.backup) لاستعادة متجرك بالكامل أو ترحيل بيانات شركة من جهاز آخر مع توليد معرّف شركة جديد وإعداد حساب مالك آمن.'
                        : 'Upload a verified .backup archive to migrate or clone a company from another device with fresh tenant isolation and secure new Owner credentials.'}
                    </p>
                    <ul className="space-y-1.5 text-xs text-zinc-300 pt-1">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span>
                          {isAr
                            ? 'التحقق التلقائي من البصمة الرقمية SHA-256 وفك التشفير'
                            : 'SHA-256 checksum validation & AES-256-GCM decryption'}
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span>
                          {isAr
                            ? 'إعادة ربط جميع الأصناف والفواتير والعملاء تلقائياً'
                            : 'Automatic ID remapping for products, sales & accounting'}
                        </span>
                      </li>
                    </ul>
                  </div>

                  <button
                    type="button"
                    data-testid="onboarding-start-restore-backup-btn"
                    onClick={() => {
                      setErrorMessage(null);
                      setActiveView('restore-backup');
                    }}
                    className="w-full py-3 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-zinc-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-sky-500/10"
                  >
                    <ArchiveRestore className="w-4 h-4" />
                    <span>
                      {isAr ? 'استعادة شركة من ملف .backup' : 'Restore Company from Backup'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Existing Configured Production Companies Section */}
              <div className="p-4 sm:p-5 rounded-2xl bg-zinc-950/80 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-sky-400" />
                    <h4 className="text-xs sm:text-sm font-black text-zinc-200">
                      {isAr
                        ? 'الشركات والمتاجر المؤسسة (تعمل أوفلاين بالكامل وبدون أي بيانات افتراضية)'
                        : 'Configured Production Companies (100% Offline & Zero Default Seed Data)'}
                    </h4>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      data-testid="onboarding-clear-default-data-btn"
                      onClick={() => {
                        resetAllData();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold transition-colors"
                    >
                      <span>
                        {isAr
                          ? 'مسح جميع البيانات الافتراضية في الشركات'
                          : 'Clear All Default Data in Companies'}
                      </span>
                    </button>
                    <button
                      type="button"
                      data-testid="onboarding-hub-launch-tour-btn"
                      onClick={() => {
                        closeOnboardingModal();
                        startTrainingTour(0);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-amber-400 border border-amber-500/30 text-xs font-bold transition-colors"
                    >
                      <Compass className="w-3.5 h-3.5" />
                      <span>{isAr ? 'تشغيل الجولة الإرشادية (13 قسماً)' : 'Launch 13-Step Guided Tour'}</span>
                    </button>
                  </div>
                </div>

                {companies.filter((c) => !c.isDemoPractice && c.id !== 'comp-default').length === 0 ? (
                  <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 text-xs text-zinc-400 text-center">
                    {isAr
                      ? 'لا توجد شركات افتراضية مسجلة حالياً — جميع البيانات التجريبية معزولة في وضع التدريب (Practice Mode) فقط. اضغط "بدء معالج تأسيس شركة جديدة" أعلاه لإنشاء متجرك الفارغ والبدء بإدخال منتجاتك وأسعار الصرف الخاصة بك.'
                      : 'No default companies loaded — all sample data is isolated strictly inside Practice Mode. Click "Start New Company Setup Wizard" above to create your clean store.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {companies
                      .filter((c) => !c.isDemoPractice && c.id !== 'comp-default')
                      .map((comp) => {
                        const isCurrent =
                          workspaceMode === 'PRODUCTION' && currentCompany.id === comp.id;
                        return (
                          <div
                            key={comp.id}
                            data-testid={`company-workspace-card-${comp.id}`}
                            className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                              isCurrent
                                ? 'bg-sky-500/10 border-sky-500/40'
                                : 'bg-zinc-900/70 border-zinc-800'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs sm:text-sm font-black text-zinc-100 truncate">
                                  {isAr ? comp.displayNameAr || comp.displayName : comp.displayName}
                                </span>
                                {isCurrent && (
                                  <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-bold">
                                    {isAr ? 'نشطة حالياً' : 'Active'}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                                {[comp.businessType, comp.city || comp.country, comp.baseCurrency]
                                  .filter(Boolean)
                                  .join(' • ')}
                              </p>
                            </div>

                            <button
                              type="button"
                              data-testid={`switch-company-btn-${comp.id}`}
                              onClick={() => switchCompanyWorkspace(comp.id)}
                              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-bold shrink-0 transition-colors"
                            >
                              {isCurrent
                                ? isAr
                                  ? 'متابعة العمل'
                                  : 'Continue'
                                : isAr
                                ? 'التبديل للشركة'
                                : 'Switch'}
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          ) : activeView === 'restore-backup' ? (
            /* OPTION C VIEW: RESTORE EXISTING COMPANY FROM BACKUP AS NEW COMPANY */
            <div className="space-y-5" data-testid="onboarding-restore-backup-view">
              <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-start gap-3">
                <ArchiveRestore className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div className="text-xs text-zinc-300 space-y-1">
                  <h3 className="font-black text-sm text-white">
                    {isAr
                      ? 'استعادة شركة كاملة من نسخة احتياطية (.backup) كشركة مستقلة جديدة'
                      : 'Restore Full Company from Backup (.backup) as a New Independent Workspace'}
                  </h3>
                  <p className="text-zinc-400">
                    {isAr
                      ? 'يتم التحقق من سلامة الحزمة عبر SHA-256، وإعادة توليد معرّفات السجلات (Company ID, Branch IDs, Product IDs, Invoice IDs) مع حذف أي كلمات مرور قديمة وتعيين حساب المالك الجديد.'
                      : 'Verifies SHA-256 checksums, remaps all internal IDs (Company, Branches, Products, Sales, Accounts) to prevent collisions, strips legacy credentials, and binds your new Owner account.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-zinc-950/60 p-4 sm:p-5 rounded-2xl border border-zinc-800">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                    {isAr ? 'ملف النسخة الاحتياطية (.backup) *' : 'Select Backup File (.backup) *'}
                  </label>
                  <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-zinc-900 border border-dashed border-sky-500/40 hover:border-sky-400 cursor-pointer transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Upload className="w-4 h-4 text-sky-400 shrink-0" />
                      <span className="text-xs font-bold text-zinc-200 truncate">
                        {restoreFileName ||
                          (isAr
                            ? 'اضغط لاختيار ملف .backup من جهازك...'
                            : 'Click to browse for a .backup file...')}
                      </span>
                    </div>
                    <input
                      type="file"
                      data-testid="onboarding-restore-file-input"
                      accept=".backup,.json,application/json"
                      onChange={handleRestoreFileUpload}
                      className="hidden"
                    />
                    <span className="px-2.5 py-1 rounded-lg bg-sky-500/20 text-sky-300 text-[11px] font-black shrink-0">
                      {isAr ? 'اختيار ملف' : 'Browse'}
                    </span>
                  </label>
                  {restoreEnvelope && (
                    <div className="mt-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {isAr ? 'الشركة المصدر:' : 'Source Company:'}{' '}
                        <strong className="text-sky-400">
                          {restoreEnvelope.manifest.sourceCompany?.displayName}
                        </strong>{' '}
                        ({restoreEnvelope.manifest.sourceCompany?.baseCurrency || 'SDG'})
                      </span>
                      <span>
                        {isAr ? 'تاريخ النسخة:' : 'Created:'}{' '}
                        {new Date(restoreEnvelope.manifest.createdAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>

                {restoreEnvelope?.encrypted && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-amber-300 mb-1">
                      {isAr
                        ? 'كلمة مرور فك تشفير النسخة الاحتياطية (AES-256-GCM) *'
                        : 'Backup Decryption Password (AES-256-GCM) *'}
                    </label>
                    <input
                      type="password"
                      data-testid="onboarding-restore-decryption-password"
                      value={restoreDecryptionPassword}
                      onChange={(e) => setRestoreDecryptionPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-amber-500/40 text-sm text-zinc-100 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">
                    {isAr ? 'اسم الشركة الجديدة (EN) *' : 'New Company Name (EN) *'}
                  </label>
                  <input
                    type="text"
                    data-testid="onboarding-restore-company-name"
                    value={restoreCompanyName}
                    onChange={(e) => setRestoreCompanyName(e.target.value)}
                    placeholder="e.g. Nile Mart Branch 2"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">
                    {isAr ? 'اسم الشركة الجديدة (بالعربية)' : 'New Company Name (Arabic)'}
                  </label>
                  <input
                    type="text"
                    data-testid="onboarding-restore-company-name-ar"
                    value={restoreCompanyNameAr}
                    onChange={(e) => setRestoreCompanyNameAr(e.target.value)}
                    placeholder="مثال: أسواق النيل - الفرع الجديد"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">
                    {isAr ? 'الاسم الكامل للمالك الجديد' : 'New Owner Full Name'}
                  </label>
                  <input
                    type="text"
                    data-testid="onboarding-restore-owner-name"
                    value={restoreOwnerName}
                    onChange={(e) => setRestoreOwnerName(e.target.value)}
                    placeholder="e.g. Ahmed Hassan"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">
                    {isAr ? 'اسم المستخدم للمالك الجديد (Username) *' : 'New Owner Username *'}
                  </label>
                  <input
                    type="text"
                    data-testid="onboarding-restore-owner-username"
                    value={restoreOwnerUsername}
                    onChange={(e) => setRestoreOwnerUsername(e.target.value)}
                    placeholder="ahmed.owner"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-mono text-zinc-100 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">
                    {isAr ? 'كلمة مرور المالك الجديد *' : 'New Owner Password *'}
                  </label>
                  <input
                    type="password"
                    data-testid="onboarding-restore-owner-password"
                    value={restoreOwnerPassword}
                    onChange={(e) => setRestoreOwnerPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">
                    {isAr ? 'تأكيد كلمة مرور المالك الجديد *' : 'Confirm New Owner Password *'}
                  </label>
                  <input
                    type="password"
                    data-testid="onboarding-restore-owner-confirm-password"
                    value={restoreOwnerConfirmPassword}
                    onChange={(e) => setRestoreOwnerConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  data-testid="onboarding-restore-back-btn"
                  onClick={() => {
                    setErrorMessage(null);
                    setActiveView('hub');
                  }}
                  className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-bold inline-flex items-center gap-2 transition-colors"
                >
                  {isAr ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
                  <span>{isAr ? 'العودة للخيارات' : 'Back to Options'}</span>
                </button>

                <button
                  type="button"
                  data-testid="onboarding-restore-submit-btn"
                  disabled={isSubmitting}
                  onClick={handleRestoreAsNewCompanySubmit}
                  className="px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-zinc-950 text-xs sm:text-sm font-black inline-flex items-center gap-2 transition-colors disabled:opacity-50 shadow-lg shadow-sky-500/20"
                >
                  <ArchiveRestore className="w-4 h-4" />
                  <span>
                    {isSubmitting
                      ? isAr
                        ? 'جاري استعادة الشركة...'
                        : 'Restoring Company...'
                      : isAr
                      ? 'استعادة وتأسيس الشركة الآن'
                      : 'Restore & Initialize Company Now'}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            /* 5-STEP CREATE NEW COMPANY WIZARD */
            <div className="space-y-6" data-testid="create-company-wizard-form">
              {/* Stepper Progress Indicator */}
              <div className="grid grid-cols-5 gap-2">
                {[
                  { step: 1, labelEn: '1. Company Info', labelAr: '1. بيانات الشركة', icon: Briefcase },
                  { step: 2, labelEn: '2. Currencies', labelAr: '2. العملات والصرف', icon: Coins },
                  { step: 3, labelEn: '3. Main Branch', labelAr: '3. الفرع الرئيسي', icon: Store },
                  { step: 4, labelEn: '4. Owner Account', labelAr: '4. حساب المالك', icon: UserCheck },
                  { step: 5, labelEn: '5. Review & Launch', labelAr: '5. المراجعة والاعتماد', icon: Sparkles },
                ].map((s) => {
                  const Icon = s.icon;
                  const active = wizardStep === s.step;
                  const done = wizardStep > s.step;
                  return (
                    <button
                      type="button"
                      key={s.step}
                      data-testid={`wizard-step-pill-${s.step}`}
                      onClick={() => {
                        setErrorMessage(null);
                        setWizardStep(s.step);
                      }}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        active
                          ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                          : done
                          ? 'bg-zinc-900 border-emerald-500/30 text-emerald-400 hover:border-emerald-400'
                          : 'bg-zinc-950/60 border-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-1.5 text-xs font-black">
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{isAr ? s.labelAr : s.labelEn}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* STEP 1: COMPANY INFORMATION */}
              {wizardStep === 1 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-zinc-950/60 p-4 sm:p-5 rounded-2xl border border-zinc-800">
                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'الاسم القانوني للشركة *' : 'Company Legal Name *'}
                    </label>
                    <input
                      type="text"
                      data-testid="wizard-company-legal-name"
                      value={legalName}
                      onChange={(e) => {
                        setLegalName(e.target.value);
                        if (!displayName) setDisplayName(e.target.value);
                      }}
                      placeholder={isAr ? 'مثال: شركة النيل للتجارة المحدودة' : 'e.g. Nile Trading Co. LLC'}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'الاسم التجاري المختصر (EN)' : 'Display Name (English)'}
                    </label>
                    <input
                      type="text"
                      data-testid="wizard-company-display-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Nile Mart & Roastery"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'الاسم التجاري بالعربية' : 'Display Name (Arabic)'}
                    </label>
                    <input
                      type="text"
                      data-testid="wizard-company-display-name-ar"
                      value={displayNameAr}
                      onChange={(e) => setDisplayNameAr(e.target.value)}
                      placeholder="مثال: أسواق النيل التجارية"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'نوع النشاط التجاري' : 'Business Type / Category'}
                    </label>
                    <select
                      value={businessType}
                      onChange={(e) => setBusinessType(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="Retail & Wholesale">Retail & Wholesale (تجزئة وجملة)</option>
                      <option value="Supermarket & Grocery">Supermarket & Grocery (سوبرماركت ومواد غذائية)</option>
                      <option value="Pharmacy & Medical">Pharmacy & Medical (صيدلية ومستلزمات طبية)</option>
                      <option value="Specialty Cafe & Roastery">Specialty Cafe & Roastery (مقهى وتحميص مختص)</option>
                      <option value="Electronics & Hardware">Electronics & Hardware (إلكترونيات ومعدات)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'الدولة' : 'Country'}
                    </label>
                    <input
                      type="text"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'المدينة' : 'City'}
                    </label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => {
                        setCity(e.target.value);
                        setBranchCity(e.target.value);
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'رقم الهاتف الرسمي' : 'Company Phone'}
                    </label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'البريد الإلكتروني الرسمي' : 'Company Email'}
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="info@company.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'الرقم الضريبي / السجل التجاري' : 'Tax / Commercial Registration No.'}
                    </label>
                    <input
                      type="text"
                      value={taxNumber}
                      onChange={(e) => setTaxNumber(e.target.value)}
                      placeholder="SD-TIN-XXXXXX"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'اللغة الافتراضية للنظام' : 'Default System Language'}
                    </label>
                    <select
                      value={defaultLanguage}
                      onChange={(e) => setDefaultLanguage(e.target.value as 'ar' | 'en')}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="ar">العربية (RTL)</option>
                      <option value="en">English (LTR)</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'العنوان التفصيلي' : 'Street Address'}
                    </label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder={isAr ? 'الخرطوم - شارع الجمهورية' : '100 Main Avenue, Business District'}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: CURRENCY & EXCHANGE RATE SETUP */}
              {wizardStep === 2 && (
                <div className="space-y-4 bg-zinc-950/60 p-4 sm:p-5 rounded-2xl border border-zinc-800">
                  <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-zinc-900 border border-amber-500/30 cursor-pointer">
                    <div className="space-y-0.5">
                      <span className="text-xs font-black text-amber-300 block">
                        {isAr
                          ? 'تخطي إضافة العملات الآن (البدء بدون أي عملات افتراضية وإضافتها يدوياً من الإعدادات)'
                          : 'Skip Currency Setup Now (Start with 0 default currencies & add manually in Settings)'}
                      </span>
                      <span className="text-[11px] text-zinc-400 block">
                        {isAr
                          ? 'فعّل هذا الخيار إذا كنت لا تريد إضافة أي عملة تلقائياً وتفضل تخصيص العملات بنفسك لاحقاً.'
                          : 'Enable this to start with zero pre-configured currencies and customize them yourself later.'}
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      data-testid="wizard-skip-currencies-checkbox"
                      checked={skipInitialCurrencies}
                      onChange={(e) => setSkipInitialCurrencies(e.target.checked)}
                      className="w-4 h-4 accent-amber-500 shrink-0"
                    />
                  </label>

                  <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${skipInitialCurrencies ? 'opacity-40 pointer-events-none' : ''}`}>
                    <div>
                      <label className="block text-xs font-bold text-zinc-300 mb-1">
                        {isAr ? 'العملة الأساسية للمحاسبة (Base Currency)' : 'Accounting Base Currency'}
                      </label>
                      <input
                        type="text"
                        value={baseCurrency}
                        onChange={(e) => setBaseCurrency(e.target.value.toUpperCase())}
                        disabled={skipInitialCurrencies}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-black text-amber-400 focus:outline-none focus:border-emerald-500"
                      />
                      <span className="text-[11px] text-zinc-500 mt-1 block">
                        {isAr
                          ? 'الجنيه السوداني (SDG) هو العملة الأساسية الافتراضية للتقارير والمحاسبة'
                          : 'Sudanese Pound (SDG) is the default base currency for unified accounting'}
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-300 mb-1">
                        {isAr ? 'سياسة تحديث أسعار الصرف' : 'Exchange Rate Update Policy'}
                      </label>
                      <select
                        value={exchangeRatePolicy}
                        onChange={(e) => setExchangeRatePolicy(e.target.value as any)}
                        disabled={skipInitialCurrencies}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="manual_daily">
                          {isAr ? 'تحديث يومي معتمد من الإدارة' : 'Manual Daily Admin Rate'}
                        </option>
                        <option value="locked_per_shift">
                          {isAr ? 'تثبيت السعر لكل وردية' : 'Locked Per Shift'}
                        </option>
                        <option value="flexible_cashier">
                          {isAr ? 'مرن مع توثيق لقطة الفاتورة' : 'Flexible with Invoice Snapshot'}
                        </option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-2">
                      {isAr ? 'العملات الأجنبية المفعلة وأسعار الصرف مقابل SDG' : 'Active Foreign Currencies & Initial Rates to SDG'}
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { code: 'USD', val: usdRate, setVal: setUsdRate },
                        { code: 'SAR', val: sarRate, setVal: setSarRate },
                        { code: 'AED', val: aedRate, setVal: setAedRate },
                        { code: 'EGP', val: egpRate, setVal: setEgpRate },
                      ].map((curr) => {
                        const enabled = secondaryCurrencies.includes(curr.code);
                        return (
                          <div
                            key={curr.code}
                            className={`p-3 rounded-xl border ${
                              enabled
                                ? 'bg-zinc-900 border-emerald-500/40'
                                : 'bg-zinc-950 border-zinc-800 opacity-60'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-black text-zinc-100">{curr.code}</span>
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={() => toggleSecondaryCurrency(curr.code)}
                                className="accent-emerald-500"
                              />
                            </div>
                            <input
                              type="number"
                              value={curr.val}
                              placeholder={enabled ? (isAr ? 'أدخل سعر الصرف...' : 'Enter rate...') : '—'}
                              onChange={(e) => curr.setVal(e.target.value)}
                              disabled={!enabled}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-100"
                            />
                            <span className="text-[10px] text-zinc-500 mt-1 block">
                              {enabled && curr.val
                                ? `1 ${curr.code} = ${curr.val} ${baseCurrency}`
                                : isAr
                                ? 'اختياري — فعّل العملة وأدخل السعر'
                                : 'Optional — check & enter rate'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: INITIAL MAIN BRANCH SETUP */}
              {wizardStep === 3 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-zinc-950/60 p-4 sm:p-5 rounded-2xl border border-zinc-800">
                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'اسم الفرع الرئيسي (EN) *' : 'Main Branch Name (EN) *'}
                    </label>
                    <input
                      type="text"
                      data-testid="wizard-branch-name"
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'اسم الفرع الرئيسي بالعربية' : 'Main Branch Name (Arabic)'}
                    </label>
                    <input
                      type="text"
                      value={branchNameAr}
                      onChange={(e) => setBranchNameAr(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'كود الفرع (Branch Code)' : 'Branch Code'}
                    </label>
                    <input
                      type="text"
                      value={branchCode}
                      onChange={(e) => setBranchCode(e.target.value.toUpperCase())}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'مدينة الفرع' : 'Branch City'}
                    </label>
                    <input
                      type="text"
                      value={branchCity}
                      onChange={(e) => setBranchCity(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'عنوان الفرع' : 'Branch Address'}
                    </label>
                    <input
                      type="text"
                      value={branchAddress}
                      onChange={(e) => setBranchAddress(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'هاتف الفرع' : 'Branch Phone'}
                    </label>
                    <input
                      type="text"
                      value={branchPhone}
                      onChange={(e) => setBranchPhone(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}

              {/* STEP 4: INITIAL OWNER / ADMIN ACCOUNT */}
              {wizardStep === 4 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-zinc-950/60 p-4 sm:p-5 rounded-2xl border border-zinc-800">
                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'الاسم الكامل للمالك / المدير العام *' : 'Owner / Super Admin Full Name *'}
                    </label>
                    <input
                      type="text"
                      data-testid="wizard-owner-name"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder="e.g. Tariq Al-Mansoor"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'الاسم بالعربية' : 'Owner Name (Arabic)'}
                    </label>
                    <input
                      type="text"
                      value={ownerNameAr}
                      onChange={(e) => setOwnerNameAr(e.target.value)}
                      placeholder="مثال: طارق المنصور"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'اسم المستخدم للدخول (Username)' : 'Login Username'}
                    </label>
                    <input
                      type="text"
                      data-testid="wizard-owner-username"
                      value={ownerUsername}
                      onChange={(e) => setOwnerUsername(e.target.value)}
                      placeholder="tariq.owner"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'البريد الإلكتروني للمالك' : 'Owner Email'}
                    </label>
                    <input
                      type="email"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      placeholder="owner@company.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'كلمة المرور (6 أحرف على الأقل) *' : 'Password (min 6 chars) *'}
                    </label>
                    <input
                      type="password"
                      data-testid="wizard-owner-password"
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'تأكيد كلمة المرور *' : 'Confirm Password *'}
                    </label>
                    <input
                      type="password"
                      data-testid="wizard-owner-confirm-password"
                      value={ownerConfirmPassword}
                      onChange={(e) => setOwnerConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1">
                      {isAr ? 'رمز نقطة البيع السريع (PIN)' : 'Quick Terminal PIN (4-8 digits)'}
                    </label>
                    <input
                      type="text"
                      value={ownerPin}
                      onChange={(e) => setOwnerPin(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                    <Lock className="w-4 h-4 shrink-0" />
                    <span>
                      {isAr
                        ? 'سيتم منح هذا الحساب دور المالك (COMPANY_OWNER) مع جميع الصلاحيات الـ 46 وتشفير كلمة المرور عبر scrypt.'
                        : 'Account is assigned COMPANY_OWNER role with all 46 capabilities and scrypt password hashing.'}
                    </span>
                  </div>
                </div>
              )}

              {/* STEP 5: REVIEW & CONFIRM */}
              {wizardStep === 5 && (
                <div className="space-y-4 bg-zinc-950/60 p-4 sm:p-5 rounded-2xl border border-zinc-800">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1.5">
                      <span className="text-[10px] font-black uppercase text-emerald-400">
                        {isAr ? 'ملف الشركة' : 'COMPANY PROFILE'}
                      </span>
                      <p className="text-sm font-black text-zinc-100">
                        {displayName || legalName}
                      </p>
                      <p className="text-zinc-400">
                        {businessType} • {city}, {country}
                      </p>
                      <p className="text-zinc-400">
                        {isAr ? 'العملة الأساسية:' : 'Base Currency:'}{' '}
                        <strong className="text-amber-400">{baseCurrency}</strong> (
                        {secondaryCurrencies.join(', ')})
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1.5">
                      <span className="text-[10px] font-black uppercase text-sky-400">
                        {isAr ? 'الفرع الرئيسي وحساب المالك' : 'MAIN BRANCH & INITIAL OWNER'}
                      </span>
                      <p className="text-sm font-black text-zinc-100">
                        {branchName} ({branchCode})
                      </p>
                      <p className="text-zinc-300">
                        {isAr ? 'المالك:' : 'Owner:'} <strong>{ownerName}</strong> (COMPANY_OWNER)
                      </p>
                      <p className="text-zinc-400 font-mono">
                        {ownerUsername || ownerEmail || ownerName}
                      </p>
                    </div>
                  </div>

                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer text-xs text-zinc-200 font-bold">
                    <input
                      type="checkbox"
                      checked={launchTourAfterSetup}
                      onChange={(e) => setLaunchTourAfterSetup(e.target.checked)}
                      className="accent-emerald-500 w-4 h-4"
                    />
                    <span>
                      {isAr
                        ? 'تشغيل الجولة الإرشادية التفاعلية (13 قسماً) فور إتمام تأسيس الشركة'
                        : 'Launch the interactive 13-step Guided Product Tour immediately after company creation'}
                    </span>
                  </label>
                </div>
              )}

              {/* Wizard Footer Navigation */}
              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  data-testid="wizard-prev-btn"
                  onClick={handlePrevStep}
                  className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-bold inline-flex items-center gap-2 transition-colors"
                >
                  {isAr ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
                  <span>
                    {wizardStep === 1
                      ? isAr
                        ? 'العودة للخيارات'
                        : 'Back to Options'
                      : isAr
                      ? 'السابق'
                      : 'Previous'}
                  </span>
                </button>

                {wizardStep < 5 ? (
                  <button
                    type="button"
                    data-testid="wizard-next-btn"
                    onClick={handleNextStep}
                    className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs sm:text-sm font-black inline-flex items-center gap-2 transition-colors"
                  >
                    <span>{isAr ? 'الخطوة التالية' : 'Next Step'}</span>
                    {isAr ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="wizard-submit-company-btn"
                    disabled={isSubmitting}
                    onClick={handleCreateCompanySubmit}
                    className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs sm:text-sm font-black inline-flex items-center gap-2 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {isSubmitting
                        ? isAr
                          ? 'جاري تأسيس الشركة...'
                          : 'Creating Company Workspace...'
                        : isAr
                        ? 'اعتماد وتأسيس الشركة الآن'
                        : 'Confirm & Create Company Workspace'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
