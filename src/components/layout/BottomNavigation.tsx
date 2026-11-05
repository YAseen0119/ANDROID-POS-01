/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import {
  CreditCard,
  LayoutDashboard,
  Package,
  Layers,
  Users,
  Receipt,
  BarChart3,
  Settings,
} from 'lucide-react';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import { AppNavTab } from '../../lib/types';
import { playTactileClick, triggerHaptic } from '../../lib/sound-fx';

interface NavItem {
  id: AppNavTab;
  labelKey: keyof ReturnType<typeof getTranslation>;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'checkout', labelKey: 'checkout', icon: CreditCard },
  { id: 'dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { id: 'products', labelKey: 'products', icon: Package },
  { id: 'inventory', labelKey: 'inventory', icon: Layers },
  { id: 'sales', labelKey: 'sales', icon: Receipt },
  { id: 'customers', labelKey: 'customers', icon: Users },
  { id: 'reports', labelKey: 'reports', icon: BarChart3 },
  { id: 'settings', labelKey: 'settings', icon: Settings },
];

export const BottomNavigation: React.FC = () => {
  const { activeTab, setActiveTab, settings } = usePOS();
  const t = getTranslation(settings.language);

  const handleSelect = (tab: AppNavTab) => {
    if (tab === activeTab) return;
    playTactileClick(settings.soundEnabled);
    triggerHaptic('light', settings.hapticsEnabled);
    setActiveTab(tab);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-neutral-950/95 backdrop-blur-md border-t border-neutral-800/80 pb-safe"
      role="navigation"
      aria-label="Main application navigation"
    >
      <div className="max-w-[1600px] mx-auto px-1 sm:px-3 grid grid-cols-8 gap-0.5 sm:gap-1.5 h-16 items-center">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const label = t[item.labelKey] as string;

          return (
            <button
              key={item.id}
              data-testid={`nav-tab-${item.id}`}
              onClick={() => handleSelect(item.id)}
              aria-label={label}
              className={`relative flex flex-col items-center justify-center min-w-0 w-full min-h-[48px] px-0.5 sm:px-2 py-1 transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded-xl ${
                isActive ? 'text-amber-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="activeTabBadge"
                  className="absolute inset-0 bg-neutral-900 border border-neutral-700/70 rounded-xl"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}

              <div className="relative z-10 flex flex-col items-center min-w-0 w-full">
                <Icon className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform shrink-0 ${isActive ? 'scale-110' : ''}`} />
                <span className="text-[9px] sm:text-[10px] tracking-tight mt-0.5 truncate max-w-full px-0.5">
                  {label}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
