/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import { formatCurrency } from '../../lib/pos-calculations';
import { Customer } from '../../lib/types';
import { AppCard } from '../ui/AppCard';
import { AppInput } from '../ui/AppInput';
import { TactileButton } from '../ui/TactileButton';
import { AppModal } from '../ui/AppModal';
import {
  Users,
  Search,
  Phone,
  Mail,
  Award,
  Receipt,
  UserPlus,
  X,
  Trash2,
  Edit2,
} from 'lucide-react';

export const CustomersView: React.FC = () => {
  const { customers, addCustomer, updateCustomer, deleteCustomer, transactions, settings } = usePOS();
  const t = getTranslation(settings.language);
  const isAr = settings.language === 'ar';

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [selectedCustomerHistory, setSelectedCustomerHistory] = useState<Customer | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formDebt, setFormDebt] = useState('');

  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const matchName = c.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchPhone = c.phone.includes(searchQuery);
      const matchEmail = c.email?.toLowerCase().includes(searchQuery.toLowerCase()) || false;
      return searchQuery === '' || matchName || matchPhone || matchEmail;
    });
  }, [customers, searchQuery]);

  const openCreateModal = () => {
    setEditingCustomer(null);
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormNotes('');
    setFormDebt('');
    setIsModalOpen(true);
  };

  const openEditModal = (c: Customer) => {
    setEditingCustomer(c);
    setFormName(c.name);
    setFormPhone(c.phone);
    setFormEmail(c.email || '');
    setFormNotes(c.notes || '');
    setFormDebt(c.totalDebt ? String(c.totalDebt) : '');
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    const parsedDebt = Math.max(0, Number(formDebt) || 0);

    if (editingCustomer) {
      updateCustomer(editingCustomer.id, {
        name: formName.trim(),
        phone: formPhone.trim(),
        email: formEmail.trim() || undefined,
        notes: formNotes.trim() || undefined,
        totalDebt: parsedDebt,
      });
    } else {
      addCustomer({
        name: formName.trim(),
        phone: formPhone.trim(),
        email: formEmail.trim() || undefined,
        notes: formNotes.trim() || undefined,
        totalDebt: parsedDebt,
      });
    }

    setIsModalOpen(false);
  };

  const customerTransactions = useMemo(() => {
    if (!selectedCustomerHistory) return [];
    return transactions.filter((t) => t.customerId === selectedCustomerHistory.id);
  }, [selectedCustomerHistory, transactions]);

  return (
    <div className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            {isAr ? 'حسابات العملاء والذمم' : t.customerDirectory}
          </h2>
          <span className="text-xs text-neutral-400">
            {isAr
              ? `${customers.length} حساب عميل مضاف (بدون أي حسابات افتراضية)`
              : `${customers.length} custom customer accounts configured`}
          </span>
        </div>

        <TactileButton
          variant="amber"
          size="md"
          onClick={openCreateModal}
          leftIcon={<UserPlus className="w-4 h-4" />}
          data-testid="add-customer-account-btn"
        >
          {isAr ? 'إضافة حساب عميل جديد' : t.newCustomer}
        </TactileButton>
      </div>

      {/* Search Input */}
      <div className="w-full">
        <AppInput
          placeholder={
            isAr
              ? 'ابحث باسم العميل أو رقم الهاتف أو البريد الإلكتروني...'
              : 'Search by customer name, phone or email...'
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
          rightIcon={
            searchQuery ? (
              <button onClick={() => setSearchQuery('')} className="p-1 text-neutral-400 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            ) : undefined
          }
        />
      </div>

      {/* Customers List or Empty State */}
      {filteredCustomers.length === 0 ? (
        <div
          data-testid="customers-empty-state"
          className="p-10 rounded-2xl bg-neutral-900/60 border border-dashed border-neutral-800 text-center space-y-3"
        >
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
            <Users className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-sm font-bold text-white">
              {isAr
                ? 'لا توجد أي حسابات عملاء افتراضية — القائمة فارغة'
                : 'No Customer Accounts Added Yet'}
            </h3>
            <p className="text-xs text-neutral-400">
              {isAr
                ? 'أضف حسابات عملائك الخاصة فقط لتتبع مشترياتهم وديونهم وسجل فواتيرهم.'
                : 'Add your own customer accounts to track their purchases, credit balances, and history.'}
            </p>
          </div>
          <div className="pt-1">
            <TactileButton
              variant="amber"
              size="sm"
              onClick={openCreateModal}
              leftIcon={<UserPlus className="w-4 h-4" />}
            >
              {isAr ? 'إضافة أول حساب عميل' : 'Add First Customer Account'}
            </TactileButton>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredCustomers.map((cust) => (
            <AppCard key={cust.id} className="flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-700/20 border border-amber-500/30 flex items-center justify-center font-bold text-amber-400">
                      {cust.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-white">{cust.name}</h4>
                      {cust.phone && (
                        <span className="text-xs text-neutral-400 flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3 text-neutral-500" />
                          <span>{cust.phone}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-lg text-xs font-mono font-bold">
                    <Award className="w-3.5 h-3.5" />
                    <span>{cust.loyaltyPoints} pts</span>
                  </div>
                </div>

                {cust.email && (
                  <div className="text-xs text-neutral-400 flex items-center gap-1.5 mb-1.5">
                    <Mail className="w-3 h-3 text-neutral-500" />
                    <span className="truncate">{cust.email}</span>
                  </div>
                )}

                {cust.notes && (
                  <p className="text-xs text-neutral-500 bg-neutral-950/60 p-2 rounded-xl border border-neutral-850 italic">
                    "{cust.notes}"
                  </p>
                )}
              </div>

              {/* Metrics & Actions */}
              <div className="pt-3 border-t border-neutral-800 flex items-center justify-between gap-2 mt-2 flex-wrap">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-[10px] text-neutral-500 block">{t.totalSpent}</span>
                    <span className="text-sm font-bold font-mono text-emerald-400 tabular-nums">
                      {formatCurrency(cust.totalSpent, settings.currency, settings.language)}
                    </span>
                  </div>
                  {(cust.totalDebt || 0) > 0 && (
                    <div>
                      <span className="text-[10px] text-rose-400 block font-semibold">
                        {t.totalDebt}
                      </span>
                      <span className="text-sm font-bold font-mono text-rose-400 tabular-nums">
                        {formatCurrency(cust.totalDebt || 0, settings.currency, settings.language)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <TactileButton
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedCustomerHistory(cust)}
                    leftIcon={<Receipt className="w-3.5 h-3.5" />}
                  >
                    {isAr ? 'السجل' : 'History'}
                  </TactileButton>

                  <TactileButton
                    variant="secondary"
                    size="sm"
                    onClick={() => openEditModal(cust)}
                    leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                  >
                    {isAr ? 'تعديل' : 'Edit'}
                  </TactileButton>

                  {confirmDeleteId === cust.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          deleteCustomer(cust.id);
                          setConfirmDeleteId(null);
                        }}
                        className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold"
                      >
                        {isAr ? 'تأكيد' : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-1.5 py-1 rounded-lg bg-neutral-800 text-neutral-300 text-[10px]"
                      >
                        {isAr ? 'إلغاء' : 'Cancel'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(cust.id)}
                      className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-950/50 transition-colors"
                      title={isAr ? 'حذف حساب العميل' : 'Delete Customer Account'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </AppCard>
          ))}
        </div>
      )}

      {/* Customer Create/Edit Modal */}
      <AppModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={
          editingCustomer
            ? isAr
              ? 'تعديل بيانات حساب العميل'
              : 'Edit Customer Account'
            : isAr
            ? 'إضافة حساب عميل جديد'
            : t.newCustomer
        }
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <AppInput
            label={isAr ? 'اسم صاحب الحساب / العميل *' : t.customerName}
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            required
            autoFocus
          />

          <AppInput
            label={isAr ? 'رقم الهاتف (اختياري)' : t.phone}
            type="tel"
            value={formPhone}
            onChange={(e) => setFormPhone(e.target.value)}
          />

          <AppInput
            label={isAr ? 'البريد الإلكتروني (اختياري)' : t.email}
            type="email"
            value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)}
          />

          <AppInput
            label={isAr ? 'رصيد المديونية / الذمم الافتتاحي (اختياري)' : 'Opening Debt Balance (Optional)'}
            type="number"
            min="0"
            step="any"
            value={formDebt}
            onChange={(e) => setFormDebt(e.target.value)}
            placeholder="0"
          />

          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
              {isAr ? 'ملاحظات الحساب (اختياري)' : t.notes}
            </label>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={2}
              className="w-full p-3 rounded-xl bg-neutral-900 border border-neutral-800 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-amber-500"
              placeholder={isAr ? 'ملاحظات خاصة بحساب العميل...' : 'Account notes...'}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-800">
            <TactileButton variant="ghost" type="button" onClick={() => setIsModalOpen(false)}>
              {t.cancel}
            </TactileButton>
            <TactileButton variant="amber" type="submit">
              {t.saveCustomer}
            </TactileButton>
          </div>
        </form>
      </AppModal>

      {/* Customer Transaction History Modal */}
      <AppModal
        isOpen={Boolean(selectedCustomerHistory)}
        onClose={() => setSelectedCustomerHistory(null)}
        title={
          isAr
            ? `سجل معاملات الحساب: ${selectedCustomerHistory?.name}`
            : `Purchase History: ${selectedCustomerHistory?.name}`
        }
        description={`${selectedCustomerHistory?.transactionCount || 0} ${
          isAr ? 'عملية مسجلة' : 'orders recorded'
        }`}
      >
        <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
          {customerTransactions.length === 0 ? (
            <div className="text-center p-6 text-xs text-neutral-500">
              {isAr
                ? 'لا توجد فواتير سابقة مسجلة لهذا الحساب.'
                : 'No previous orders found for this customer account.'}
            </div>
          ) : (
            customerTransactions.map((tx) => (
              <div
                key={tx.id}
                className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-mono font-bold text-white block">{tx.id}</span>
                  <span className="text-[11px] text-neutral-500">
                    {new Date(tx.timestamp).toLocaleString()} • {tx.items.length} items
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-emerald-400 tabular-nums">
                    {formatCurrency(tx.grandTotal, settings.currency, settings.language)}
                  </span>
                  <span className="block text-[10px] uppercase font-mono text-neutral-400">
                    {tx.paymentMethod}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </AppModal>
    </div>
  );
};
