/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import { formatCurrency } from '../../lib/pos-calculations';
import { TactileButton } from '../ui/TactileButton';
import { ShoppingBag, Globe, Wifi, Coins, Users, ShieldCheck, Check, Settings as SettingsIcon, GraduationCap, Building2, FlaskConical } from 'lucide-react';
import { UserRole } from '../../lib/types';

const ROLE_LABELS: Record<UserRole, { en: string; ar: string; badgeClass: string }> = {
  admin: {
    en: 'Admin',
    ar: 'مدير النظام',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
  manager: {
    en: 'Branch Manager',
    ar: 'مدير الفرع',
    badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  },
  cashier: {
    en: 'Cashier',
    ar: 'كاشير مبيعات',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
  inventory_clerk: {
    en: 'Inventory Clerk',
    ar: 'أمين مخزن',
    badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  },
};

export const AppHeader: React.FC<{ onOpenCart?: () => void }> = ({ onOpenCart }) => {
  const {
    settings,
    updateSettings,
    currencies,
    cartTotals,
    cart,
    activeTab,
    setActiveTab,
    users,
    activeSessions,
    currentUser,
    switchCurrentUser,
    toggleUserActiveSession,
    startTrainingTour,
    trainingTourProgress,
    workspaceMode,
    openOnboardingModal,
  } = usePOS();
  const t = getTranslation(settings.language);
  const isAr = settings.language === 'ar';

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isUserMenuOpen]);

  const toggleLanguage = () => {
    updateSettings({ language: settings.language === 'en' ? 'ar' : 'en' });
  };

  const activeCurrencyCodes =
    currencies && currencies.length > 0
      ? currencies.filter((c) => c.isActive !== false).map((c) => c.code)
      : [];

  const roleMeta = ROLE_LABELS[currentUser.role] || ROLE_LABELS.admin;

  return (
    <header className="sticky top-0 z-30 w-full bg-neutral-950/95 backdrop-blur-md border-b border-neutral-800/80 px-2.5 sm:px-4 py-2.5 pt-safe">
      <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-2">
        {/* Brand Zone */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-2 text-start focus:outline-none group min-w-0"
            aria-label="Go to Dashboard"
          >
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center font-bold text-neutral-950 shadow-md shadow-amber-500/20 group-hover:scale-105 transition-transform overflow-hidden shrink-0">
              {settings.storeLogo ? (
                <img
                  src={settings.storeLogo}
                  alt={settings.language === 'ar' ? settings.storeNameAr : settings.storeName}
                  className="w-full h-full object-contain bg-neutral-950 p-0.5"
                />
              ) : (
                <span className="font-mono text-sm sm:text-base">DQ</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs sm:text-base font-bold tracking-tight text-white truncate max-w-[105px] sm:max-w-[220px] md:max-w-none">
                  {settings.language === 'ar' ? settings.storeNameAr : settings.storeName}
                </span>
                <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-mono font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded-md shrink-0">
                  <Wifi className="w-3 h-3 text-emerald-400" />
                  <span>ONLINE</span>
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 font-medium hidden lg:block truncate max-w-[240px]">
                {t.tagline}
              </p>
            </div>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Active User & Multi-User Concurrent Sessions Switcher */}
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              data-testid="active-user-switcher-btn"
              onClick={() => setIsUserMenuOpen((prev) => !prev)}
              className="min-h-[34px] sm:min-h-[36px] px-2 sm:px-2.5 py-1 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-emerald-500/60 flex items-center gap-1.5 sm:gap-2 text-xs transition-colors"
              title={
                isAr
                  ? 'إدارة الحسابات والمستخدمين النشطين'
                  : 'Accounts & Concurrent Active Users'
              }
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    users.length > 0 ? 'bg-emerald-500' : 'bg-amber-400'
                  }`}
                />
              </span>
              <span className="hidden sm:inline font-bold text-white truncate max-w-[95px] md:max-w-[130px]">
                {users.length === 0
                  ? isAr
                    ? 'الحسابات'
                    : 'Accounts'
                  : isAr && currentUser.nameAr
                  ? currentUser.nameAr
                  : currentUser.name}
              </span>
              {users.length > 0 && (
                <span
                  className={`hidden lg:inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold border ${roleMeta.badgeClass}`}
                >
                  {isAr ? roleMeta.ar : roleMeta.en}
                </span>
              )}
              <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono font-bold text-[10px] flex items-center gap-0.5">
                <Users className="w-3 h-3" />
                <span>{users.length}</span>
              </span>
            </button>

            {isUserMenuOpen && (
              <div className="fixed sm:absolute inset-x-3 sm:inset-x-auto sm:end-0 top-14 sm:top-full sm:mt-2 sm:w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl bg-neutral-900 border border-neutral-800 shadow-2xl p-3 z-50 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                  <div>
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>
                        {isAr
                          ? 'الحسابات المضافة والجلسات النشطة'
                          : 'Configured Accounts & Active Sessions'}
                      </span>
                    </span>
                    <span className="text-[10px] text-neutral-400 block">
                      {users.length === 0
                        ? isAr
                          ? 'لا توجد أي حسابات افتراضية — أضف حساباتك الخاصة فقط'
                          : 'Zero default accounts — add only your own custom accounts'
                        : isAr
                        ? `${users.length} حساب مسجل • ${activeSessions.length} نشط حالياً`
                        : `${users.length} configured accounts • ${activeSessions.length} active`}
                    </span>
                  </div>
                </div>

                {users.length === 0 ? (
                  <div className="py-5 px-3 text-center rounded-xl bg-neutral-950/70 border border-neutral-800/80 space-y-1.5">
                    <p className="text-xs font-bold text-neutral-300">
                      {isAr ? 'لم تقم بإضافة أي حسابات بعد' : 'No accounts added yet'}
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      {isAr
                        ? 'اضغط بالأسفل للانتقال إلى صفحة تخصيص الحسابات وإضافة حسابك الأول.'
                        : 'Click below to open the Accounts page and create your own custom account.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-60 overflow-y-auto pe-0.5">
                    {users.map((u) => {
                      const isCurrent = u.id === currentUser.id;
                      const isSessionOnline = activeSessions.some((s) => s.userId === u.id);
                      const rMeta = ROLE_LABELS[u.role] || ROLE_LABELS.cashier;
                      return (
                        <div
                          key={u.id}
                          className={`p-2 rounded-xl border flex items-center justify-between gap-2 transition-colors ${
                            isCurrent
                              ? 'bg-amber-500/10 border-amber-500/40'
                              : 'bg-neutral-950/70 border-neutral-800/80 hover:border-neutral-700'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              switchCurrentUser(u.id);
                              setIsUserMenuOpen(false);
                            }}
                            className="flex-1 text-start min-w-0"
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  isSessionOnline ? 'bg-emerald-400' : 'bg-neutral-600'
                                }`}
                              />
                              <span className="text-xs font-bold text-white truncate">
                                {isAr && u.nameAr ? u.nameAr : u.name}
                              </span>
                              {isCurrent && (
                                <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${rMeta.badgeClass}`}
                              >
                                {isAr ? rMeta.ar : rMeta.en}
                              </span>
                              <span className="text-[10px] text-neutral-400 truncate">
                                {isAr && u.terminalNameAr ? u.terminalNameAr : u.terminalName}
                              </span>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleUserActiveSession(u.id)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors shrink-0 ${
                              isSessionOnline
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                                : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-white'
                            }`}
                          >
                            {isSessionOnline
                              ? isAr
                                ? 'نشط الآن'
                                : 'Active'
                              : isAr
                              ? 'تفعيل'
                              : 'Activate'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('settings');
                    setIsUserMenuOpen(false);
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <SettingsIcon className="w-3.5 h-3.5" />
                  <span>
                    {isAr
                      ? 'تخصيص وإدارة الحسابات والصلاحيات'
                      : 'Customize & Manage Accounts'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Quick Currency Switcher */}
          {activeCurrencyCodes.length > 0 ? (
            <div className="relative flex items-center">
              <Coins className="hidden sm:block w-3.5 h-3.5 text-amber-400 absolute start-2.5 pointer-events-none" />
              <select
                aria-label="Active Currency"
                value={
                  activeCurrencyCodes.includes(settings.currency)
                    ? settings.currency
                    : activeCurrencyCodes[0]
                }
                onChange={(e) => updateSettings({ currency: e.target.value })}
                className="min-h-[34px] sm:min-h-[36px] ps-2 sm:ps-7 pe-1.5 sm:pe-2.5 py-1 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-amber-500/60 text-[11px] sm:text-xs font-mono font-bold text-amber-400 focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                {activeCurrencyCodes.map((code) => (
                  <option key={code} value={code} className="bg-neutral-900 text-white">
                    {code}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button
              type="button"
              data-testid="header-add-currency-shortcut-btn"
              onClick={() => setActiveTab('settings')}
              title={isAr ? 'إضافة عملات المتجر' : 'Add Store Currencies'}
              className="min-h-[34px] sm:min-h-[36px] px-2 sm:px-2.5 py-1 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-amber-500/60 text-[11px] sm:text-xs font-bold text-amber-400 flex items-center gap-1 transition-colors"
            >
              <Coins className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden md:inline">{isAr ? '+ عملة' : '+ Currency'}</span>
            </button>
          )}

          {/* Workspace / Practice Mode / Company Onboarding Trigger */}
          <button
            type="button"
            data-testid="header-workspace-onboarding-btn"
            onClick={() => openOnboardingModal('hub')}
            aria-label={isAr ? 'بوابة الشركات ووضع التدريب التجريبي' : 'Company Onboarding & Practice Mode'}
            className={`min-h-[34px] sm:min-h-[36px] px-2 sm:px-2.5 py-1 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${
              workspaceMode === 'PRACTICE'
                ? 'bg-amber-500/20 border-amber-400/60 text-amber-300'
                : 'bg-neutral-900 hover:bg-neutral-800 border-neutral-800 text-emerald-400'
            }`}
            title={isAr ? 'الشركات ووضع التدريب التجريبي' : 'Company Setup & Practice Mode'}
          >
            {workspaceMode === 'PRACTICE' ? (
              <FlaskConical className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            ) : (
              <Building2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            )}
            <span className="hidden xl:inline">
              {workspaceMode === 'PRACTICE'
                ? isAr
                  ? 'وضع التدريب'
                  : 'Practice'
                : isAr
                ? 'الشركة / التأسيس'
                : 'Workspace'}
            </span>
          </button>

          {/* Interactive Guided Training Tour Trigger */}
          <button
            type="button"
            data-testid="launch-training-tour-btn"
            onClick={() => startTrainingTour(trainingTourProgress.completed ? 0 : trainingTourProgress.lastStepIndex)}
            aria-label={isAr ? 'بدء الجولة التدريبية للبرنامج' : 'Start Interactive Training Tour'}
            className="min-h-[34px] sm:min-h-[36px] px-2 sm:px-2.5 py-1 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 transition-colors relative"
            title={isAr ? 'بدء الجولة التدريبية التفاعلية للبرنامج' : 'Launch Interactive POS Training Tour'}
          >
            <GraduationCap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="hidden md:inline">{isAr ? 'جولة تدريبية' : 'Tour'}</span>
            {!trainingTourProgress.completed && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>

          {/* Language Switcher */}
          <TactileButton
            variant="ghost"
            size="sm"
            onClick={toggleLanguage}
            className="font-medium text-neutral-300 hover:text-white px-2 sm:px-2.5"
            aria-label={`Switch language to ${settings.language === 'en' ? 'Arabic' : 'English'}`}
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono text-[11px] sm:text-xs">{settings.language === 'en' ? 'عربي' : 'EN'}</span>
          </TactileButton>

          {/* Quick Cart Trigger (especially on mobile/compact screens) */}
          <TactileButton
            variant={cart.length > 0 ? 'amber' : 'secondary'}
            size="sm"
            onClick={() => {
              if (activeTab !== 'checkout') setActiveTab('checkout');
              onOpenCart?.();
            }}
            className="relative font-mono font-semibold px-2 sm:px-3"
            aria-label={`Cart contains ${cartTotals.totalItemsCount} items`}
          >
            <ShoppingBag className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline tabular-nums text-xs">
              {formatCurrency(cartTotals.grandTotal, settings.currency, settings.language)}
            </span>
            {cart.length > 0 && (
              <span className="absolute -top-1 -end-1 w-5 h-5 bg-rose-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center border-2 border-neutral-950">
                {cartTotals.totalItemsCount}
              </span>
            )}
          </TactileButton>
        </div>
      </div>
    </header>
  );
};
