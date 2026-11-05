/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { POSProvider, usePOS } from './context/POSContext';
import { AppHeader } from './components/layout/AppHeader';
import { BottomNavigation } from './components/layout/BottomNavigation';
import { CheckoutView } from './components/checkout/CheckoutView';
import { DashboardView } from './components/dashboard/DashboardView';
import { ProductsView } from './components/products/ProductsView';
import { InventoryView } from './components/inventory/InventoryView';
import { CustomersView } from './components/customers/CustomersView';
import { SalesView } from './components/sales/SalesView';
import { ReportsView } from './components/reports/ReportsView';
import { SettingsView } from './components/settings/SettingsView';
import { TrainingTourOverlay } from './components/tour/TrainingTourOverlay';
import { UnmetDemandCaptureModal } from './components/analytics/UnmetDemandCaptureModal';
import { PracticeModeBanner } from './components/onboarding/PracticeModeBanner';
import { FirstRunOnboardingModal } from './components/onboarding/FirstRunOnboardingModal';
import { StatusBar, Style } from '@capacitor/status-bar';

function POSAppInner() {
  const {
    activeTab,
    setActiveTab,
    isTrainingTourOpen,
    trainingTourStepIndex,
    trainingTourProgress,
    selectTrainingTourStep,
    nextTrainingTourStep,
    prevTrainingTourStep,
    finishTrainingTour,
    closeTrainingTour,
    resetTrainingTour,
  } = usePOS();
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);

  // Initialize Capacitor Android status bar and hardware back button listener
  useEffect(() => {
    try {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: '#090a0f' }).catch(() => {});
    } catch {}

    // Android hardware back button handler
    const handleBackButton = () => {
      if (isMobileCartOpen) {
        setIsMobileCartOpen(false);
      } else if (activeTab !== 'checkout') {
        setActiveTab('checkout');
      }
    };

    window.addEventListener('popstate', handleBackButton);
    return () => {
      window.removeEventListener('popstate', handleBackButton);
    };
  }, [isMobileCartOpen, activeTab, setActiveTab]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans select-none">
      {/* Persistent Practice Mode Top Indicator & Controls (visible only in Practice Mode) */}
      <PracticeModeBanner />

      {/* Top Header */}
      <AppHeader onOpenCart={() => setIsMobileCartOpen(true)} />

      {/* Main View Router */}
      <main className="flex-1 flex flex-col overflow-x-hidden">
        {activeTab === 'checkout' && (
          <CheckoutView
            isCartDrawerOpen={isMobileCartOpen}
            onCloseCartDrawer={() => setIsMobileCartOpen(false)}
          />
        )}
        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'products' && <ProductsView />}
        {activeTab === 'inventory' && <InventoryView />}
        {activeTab === 'customers' && <CustomersView />}
        {activeTab === 'sales' && <SalesView />}
        {activeTab === 'reports' && <ReportsView />}
        {activeTab === 'settings' && <SettingsView />}
      </main>

      {/* Fast Customer Unmet Demand Request Capture Modal */}
      <UnmetDemandCaptureModal />

      {/* First-Run Onboarding, Practice Mode & Company Workspace Modal */}
      <FirstRunOnboardingModal />

      {/* Interactive Guided Training Tour Overlay */}
      <TrainingTourOverlay
        isOpen={isTrainingTourOpen}
        currentStepIndex={trainingTourStepIndex}
        progress={trainingTourProgress}
        onSelectStep={selectTrainingTourStep}
        onNext={nextTrainingTourStep}
        onPrev={prevTrainingTourStep}
        onFinish={finishTrainingTour}
        onClose={closeTrainingTour}
        onResetProgress={resetTrainingTour}
      />

      {/* Fixed Bottom Navigation */}
      <BottomNavigation />
    </div>
  );
}

export default function App() {
  return (
    <POSProvider>
      <POSAppInner />
    </POSProvider>
  );
}
