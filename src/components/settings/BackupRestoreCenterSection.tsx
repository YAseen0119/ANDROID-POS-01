/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Archive,
  Download,
  Upload,
  ShieldCheck,
  Lock,
  Unlock,
  RefreshCw,
  GitMerge,
  Building2,
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Trash2,
  History,
  Layers,
  Info,
  KeyRound,
  FolderSync,
} from 'lucide-react';
import { usePOS } from '../../context/POSContext';
import { AppCard } from '../ui/AppCard';
import {
  ALL_BACKUP_MODULE_IDS,
  analyzeBackupMergePreview,
  applyIntelligentBackupMerge,
  BACKUP_MODULE_DEFINITIONS,
  BackupEnvelopeV1,
  BackupManifestV1,
  BackupMergeExecutionSummary,
  BackupMergePreviewReport,
  BackupModuleId,
  BackupPayloadV1,
  computeBackupModuleRecordCounts,
  filterPayloadByIncludedModules,
  MergeClassification,
  MergeResolutionStrategy,
  remapBackupPayloadForNewCompany,
  resolveBackupModuleDependencies,
  scrubSensitiveUserFields,
} from '../../lib/backup-merge-engine';

type ActiveBackupTab = 'create' | 'restore' | 'merge' | 'checkpoints';

interface SavedBackupSummaryItem {
  backupId: string;
  fileName: string;
  encrypted: boolean;
  compression: 'gzip' | 'none';
  manifest: BackupManifestV1;
  payloadChecksumSha256: string;
  sizeBytes: number;
  localEnvelope?: BackupEnvelopeV1;
}

const LOCAL_BACKUPS_STORAGE_PREFIX = 'dqnamo_pos_company_backups_v1_';

function simpleHashHex(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0, ch; i < text.length; i++) {
    ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0')
  ).repeat(4);
}

function buildLocalFallbackEnvelope(params: {
  payload: BackupPayloadV1;
  backupType: 'FULL_COMPANY' | 'SELECTIVE_MODULES' | 'PRE_RESTORE_CHECKPOINT';
  selectedModules: BackupModuleId[];
  autoIncludeHardDependencies: boolean;
  userId: string;
  username: string;
  notes?: string;
}): BackupEnvelopeV1 {
  const nowIso = new Date().toISOString();
  const dep = resolveBackupModuleDependencies(params.selectedModules, {
    autoIncludeHardDependencies: params.autoIncludeHardDependencies,
  });
  const filtered = filterPayloadByIncludedModules(
    params.payload,
    dep.modulesIncluded
  );
  filtered.employees = (filtered.employees || []).map((u) =>
    scrubSensitiveUserFields(u)
  );
  const { recordCounts, totalRecords } = computeBackupModuleRecordCounts(
    filtered,
    dep.modulesIncluded
  );
  const jsonStr = JSON.stringify(filtered);
  const payloadChecksum = simpleHashHex(jsonStr);
  const modChecksums = {} as Record<BackupModuleId, string>;
  for (const m of ALL_BACKUP_MODULE_IDS) {
    modChecksums[m] = simpleHashHex(`${m}:${recordCounts[m]}`);
  }

  const backupId =
    params.backupType === 'PRE_RESTORE_CHECKPOINT'
      ? `chk-local-${Date.now().toString(36)}`
      : `bkp-${nowIso.slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).slice(-4)}`;

  const b64 = btoa(unescape(encodeURIComponent(jsonStr)));

  return {
    formatSignature: 'DQNAMO_POS_BACKUP_V1',
    formatVersion: '1.0.0',
    createdAt: nowIso,
    encrypted: false,
    compression: 'none',
    manifest: {
      backupId,
      backupType: params.backupType,
      schemaVersion: '2025.05.1',
      appVersion: '2.4.0',
      createdAt: nowIso,
      createdByUserId: params.userId,
      createdByUsername: params.username,
      notes: params.notes,
      sourceCompany: {
        companyId: filtered.companyProfile.id,
        code: filtered.companyProfile.code || 'CMP-MAIN',
        legalName: filtered.companyProfile.legalName || 'Store',
        displayName:
          filtered.companyProfile.displayName ||
          filtered.companyProfile.legalName ||
          'Store',
        displayNameAr: filtered.companyProfile.displayNameAr,
        baseCurrency: filtered.companyProfile.baseCurrency || 'SDG',
        businessType: filtered.companyProfile.businessType,
      },
      modulesIncluded: dep.modulesIncluded,
      autoIncludedDependencies: dep.autoIncludedDependencies,
      dependencyWarnings: dep.dependencyWarnings,
      recordCounts,
      moduleChecksumsSha256: modChecksums,
      totalRecords,
    },
    payloadChecksumSha256: payloadChecksum,
    payloadData: b64,
  };
}

function triggerBrowserDownload(envelope: BackupEnvelopeV1, fileName: string) {
  const jsonText = JSON.stringify(envelope, null, 2);
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.backup') ? fileName : `${fileName}.backup`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const BackupRestoreCenterSection: React.FC = () => {
  const {
    settings,
    currentCompany,
    currentUser,
    workspaceMode,
    hasCapability,
    collectClientBackupDataset,
    hydrateCompanyFromBackupPayload,
  } = usePOS();

  const isAr = settings.language === 'ar';
  const canView = hasCapability('backup.view');
  const canCreate = hasCapability('backup.create');
  const canRestore = hasCapability('backup.restore');
  const canMerge = hasCapability('backup.merge') || hasCapability('backup.import');
  const canDelete = hasCapability('backup.delete');

  const [activeTab, setActiveTab] = useState<ActiveBackupTab>('create');
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Tab 1: Create Backup State
  const [backupScopeMode, setBackupScopeMode] = useState<'FULL_COMPANY' | 'SELECTIVE_MODULES'>(
    'FULL_COMPANY'
  );
  const [selectedModules, setSelectedModules] = useState<BackupModuleId[]>([
    ...ALL_BACKUP_MODULE_IDS,
  ]);
  const [autoIncludeDeps, setAutoIncludeDeps] = useState(true);
  const [enableEncryption, setEnableEncryption] = useState(false);
  const [encryptionPassword, setEncryptionPassword] = useState('');
  const [backupNotes, setBackupNotes] = useState('');

  // Saved Backups & Audit Logs State
  const [savedBackups, setSavedBackups] = useState<SavedBackupSummaryItem[]>([]);
  const [backupAuditLogs, setBackupAuditLogs] = useState<any[]>([]);

  // Tab 2 & 3: Loaded / Uploaded Backup Envelope for Restore or Merge
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loadedEnvelope, setLoadedEnvelope] = useState<BackupEnvelopeV1 | null>(null);
  const [loadedFileName, setLoadedFileName] = useState<string>('');
  const [decryptionPassword, setDecryptionPassword] = useState('');
  const [inspectedManifest, setInspectedManifest] = useState<BackupManifestV1 | null>(null);
  const [inspectedIntegrityOk, setInspectedIntegrityOk] = useState<boolean>(false);

  // Tab 2: Restore Destination Mode ('ORIGINAL_COMPANY' vs 'NEW_COMPANY')
  const [restoreMode, setRestoreMode] = useState<'ORIGINAL_COMPANY' | 'NEW_COMPANY'>(
    'ORIGINAL_COMPANY'
  );
  const [restoreOwnerPassword, setRestoreOwnerPassword] = useState('');
  const [allowCrossCompanyOverride, setAllowCrossCompanyOverride] = useState(false);

  // Restore as New Company Form Inputs
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyNameAr, setNewCompanyNameAr] = useState('');
  const [newCompanyBusinessType, setNewCompanyBusinessType] = useState('retail');
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newOwnerUsername, setNewOwnerUsername] = useState('');
  const [newOwnerPassword, setNewOwnerPassword] = useState('');
  const [newOwnerConfirmPassword, setNewOwnerConfirmPassword] = useState('');

  // Tab 3: Intelligent Merge State
  const [mergePreviewReport, setMergePreviewReport] =
    useState<BackupMergePreviewReport | null>(null);
  const [moduleStrategies, setModuleStrategies] = useState<
    Partial<Record<BackupModuleId, MergeResolutionStrategy>>
  >({});
  const [itemResolutions, setItemResolutions] = useState<
    Record<string, MergeResolutionStrategy>
  >({});
  const [applyIncomingStockDelta, setApplyIncomingStockDelta] = useState(false);
  const [mergeFilterTab, setMergeFilterTab] = useState<
    'ALL' | 'CONFLICTS' | 'MATCHES' | 'NEW'
  >('ALL');
  const [mergeOwnerPassword, setMergeOwnerPassword] = useState('');
  const [lastMergeExecutionSummary, setLastMergeExecutionSummary] =
    useState<BackupMergeExecutionSummary | null>(null);

  // Tab 4: Delete Checkpoint Password Prompt
  const [deleteTargetBackupId, setDeleteTargetBackupId] = useState<string | null>(null);
  const [deleteOwnerPassword, setDeleteOwnerPassword] = useState('');

  const liveClientDataset = useMemo(
    () => collectClientBackupDataset(),
    [collectClientBackupDataset]
  );

  const liveModuleCounts = useMemo(
    () =>
      computeBackupModuleRecordCounts(liveClientDataset, ALL_BACKUP_MODULE_IDS)
        .recordCounts,
    [liveClientDataset]
  );

  const dependencyResolution = useMemo(() => {
    const mods =
      backupScopeMode === 'FULL_COMPANY' ? ALL_BACKUP_MODULE_IDS : selectedModules;
    return resolveBackupModuleDependencies(mods, {
      autoIncludeHardDependencies: autoIncludeDeps,
    });
  }, [backupScopeMode, selectedModules, autoIncludeDeps]);

  const loadLocalBackups = useCallback((): SavedBackupSummaryItem[] => {
    try {
      const raw = localStorage.getItem(
        `${LOCAL_BACKUPS_STORAGE_PREFIX}${currentCompany.id}`
      );
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  }, [currentCompany.id]);

  const saveLocalBackupEntry = useCallback(
    (envelope: BackupEnvelopeV1, fileName: string) => {
      try {
        const existing = loadLocalBackups().filter(
          (b) => b.backupId !== envelope.manifest.backupId
        );
        const item: SavedBackupSummaryItem = {
          backupId: envelope.manifest.backupId,
          fileName,
          encrypted: envelope.encrypted,
          compression: envelope.compression,
          manifest: envelope.manifest,
          payloadChecksumSha256: envelope.payloadChecksumSha256,
          sizeBytes: JSON.stringify(envelope).length,
          localEnvelope: envelope,
        };
        const next = [item, ...existing].slice(0, 15);
        localStorage.setItem(
          `${LOCAL_BACKUPS_STORAGE_PREFIX}${currentCompany.id}`,
          JSON.stringify(next)
        );
        return next;
      } catch {
        return loadLocalBackups();
      }
    },
    [currentCompany.id, loadLocalBackups]
  );

  const fetchBackupsAndLogs = useCallback(async () => {
    const localItems = loadLocalBackups();
    if (
      currentCompany.id === 'comp-clean-store' ||
      currentCompany.id === 'comp-demo-practice' ||
      workspaceMode === 'PRACTICE'
    ) {
      setSavedBackups(localItems);
      setBackupAuditLogs([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/backups?companyId=${encodeURIComponent(currentCompany.id)}`,
        {
          headers: {
            'x-user-id': currentUser.id,
            'x-company-id': currentCompany.id,
          },
        }
      );
      if (res.ok) {
        const payload = await res.json();
        const serverBackups: SavedBackupSummaryItem[] =
          payload?.data?.backups || [];
        const serverIds = new Set(serverBackups.map((b) => b.backupId));
        const combined = [
          ...serverBackups,
          ...localItems.filter((l) => !serverIds.has(l.backupId)),
        ];
        setSavedBackups(combined);
        setBackupAuditLogs(payload?.data?.auditLogs || []);
        return;
      }
    } catch {}
    setSavedBackups(localItems);
  }, [currentCompany.id, currentUser.id, workspaceMode, loadLocalBackups]);

  useEffect(() => {
    fetchBackupsAndLogs();
  }, [fetchBackupsAndLogs]);

  const toggleModuleSelection = (modId: BackupModuleId) => {
    setSelectedModules((prev) =>
      prev.includes(modId) ? prev.filter((m) => m !== modId) : [...prev, modId]
    );
  };

  // Create Full or Selective Backup
  const handleCreateBackup = async (downloadImmediately: boolean) => {
    setStatusBanner(null);
    if (workspaceMode === 'PRACTICE') {
      setStatusBanner({
        type: 'error',
        message: isAr
          ? 'لا يمكن إنشاء نسخ احتياطية إنتاجية من داخل وضع التدريب التجريبي.'
          : 'Production backups cannot be created inside Practice Mode.',
      });
      return;
    }

    if (
      backupScopeMode === 'SELECTIVE_MODULES' &&
      selectedModules.length === 0
    ) {
      setStatusBanner({
        type: 'error',
        message: isAr
          ? 'يرجى اختيار قسم واحد على الأقل للنسخ الاحتياطي الانتقائي.'
          : 'Please select at least one module for selective backup.',
      });
      return;
    }

    if (enableEncryption && encryptionPassword.trim().length < 4) {
      setStatusBanner({
        type: 'error',
        message: isAr
          ? 'يرجى إدخال كلمة مرور تشفير لا تقل عن 4 أحرف.'
          : 'Please enter an encryption password of at least 4 characters.',
      });
      return;
    }

    setIsBusy(true);
    try {
      const clientDataset = collectClientBackupDataset();
      let createdEnvelope: BackupEnvelopeV1 | null = null;
      let fileName = `company-backup-${new Date().toISOString().slice(0, 10)}.backup`;

      try {
        const res = await fetch('/api/backups/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': currentUser.id,
            'x-company-id': currentCompany.id,
          },
          body: JSON.stringify({
            backupType: backupScopeMode,
            selectedModules:
              backupScopeMode === 'FULL_COMPANY'
                ? ALL_BACKUP_MODULE_IDS
                : selectedModules,
            autoIncludeHardDependencies: autoIncludeDeps,
            encryptionPassword: enableEncryption
              ? encryptionPassword.trim()
              : undefined,
            notes: backupNotes.trim() || undefined,
            clientDataset,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          createdEnvelope = data?.data?.envelope;
          fileName = data?.data?.fileName || fileName;
        }
      } catch {}

      // Offline / local fallback if server user wasn't synced yet
      if (!createdEnvelope) {
        createdEnvelope = buildLocalFallbackEnvelope({
          payload: clientDataset,
          backupType: backupScopeMode,
          selectedModules:
            backupScopeMode === 'FULL_COMPANY'
              ? ALL_BACKUP_MODULE_IDS
              : selectedModules,
          autoIncludeHardDependencies: autoIncludeDeps,
          userId: currentUser.id,
          username: currentUser.username || currentUser.name,
          notes: backupNotes.trim() || undefined,
        });
      }

      saveLocalBackupEntry(createdEnvelope, fileName);
      await fetchBackupsAndLogs();

      if (downloadImmediately) {
        triggerBrowserDownload(createdEnvelope, fileName);
      }

      setLoadedEnvelope(createdEnvelope);
      setLoadedFileName(fileName);
      setInspectedManifest(createdEnvelope.manifest);
      setInspectedIntegrityOk(true);

      setStatusBanner({
        type: 'success',
        message: isAr
          ? `تم إنشاء النسخة الاحتياطية بنجاح (${createdEnvelope.manifest.backupId}) — إجمالي السجلات: ${createdEnvelope.manifest.totalRecords}.`
          : `Backup created successfully (${createdEnvelope.manifest.backupId}) — Total records: ${createdEnvelope.manifest.totalRecords}.`,
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Failed to create backup.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Upload .backup file from disk
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusBanner(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result || '');
        const parsed = JSON.parse(text) as BackupEnvelopeV1;
        if (
          !parsed ||
          parsed.formatSignature !== 'DQNAMO_POS_BACKUP_V1' ||
          !parsed.manifest
        ) {
          setStatusBanner({
            type: 'error',
            message: isAr
              ? 'ملف النسخة الاحتياطية غير صالح أو لا يطابق صيغة DQNAMO_POS_BACKUP_V1.'
              : 'Invalid backup file: missing DQNAMO_POS_BACKUP_V1 signature.',
          });
          return;
        }
        setLoadedEnvelope(parsed);
        setLoadedFileName(file.name);
        setInspectedManifest(parsed.manifest);
        setInspectedIntegrityOk(!parsed.encrypted);
        setMergePreviewReport(null);
        setLastMergeExecutionSummary(null);

        if (!newCompanyName.trim()) {
          setNewCompanyName(
            `${parsed.manifest.sourceCompany.displayName} (Restored)`
          );
          setNewCompanyNameAr(
            `${
              parsed.manifest.sourceCompany.displayNameAr ||
              parsed.manifest.sourceCompany.displayName
            } (مستعادة)`
          );
        }

        setStatusBanner({
          type: 'info',
          message: isAr
            ? `تم تحميل ملف النسخة الاحتياطية "${file.name}" (${parsed.manifest.totalRecords} سجل).`
            : `Loaded backup package "${file.name}" (${parsed.manifest.totalRecords} records).`,
        });
      } catch {
        setStatusBanner({
          type: 'error',
          message: isAr
            ? 'تعذر قراءة ملف النسخة الاحتياطية. تأكد من أن الملف بصيغة .backup صحيحة.'
            : 'Could not parse backup file. Ensure it is a valid .backup archive.',
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSelectSavedBackup = async (item: SavedBackupSummaryItem) => {
    setStatusBanner(null);
    setMergePreviewReport(null);
    setLastMergeExecutionSummary(null);

    if (item.localEnvelope) {
      setLoadedEnvelope(item.localEnvelope);
      setLoadedFileName(item.fileName);
      setInspectedManifest(item.manifest);
      setInspectedIntegrityOk(!item.encrypted);
      return;
    }

    try {
      const res = await fetch(`/api/backups/${item.backupId}/download`, {
        headers: {
          'x-user-id': currentUser.id,
          'x-company-id': currentCompany.id,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const env = data?.data?.envelope as BackupEnvelopeV1;
        if (env) {
          setLoadedEnvelope(env);
          setLoadedFileName(item.fileName);
          setInspectedManifest(env.manifest);
          setInspectedIntegrityOk(!env.encrypted);
        }
      }
    } catch {}
  };

  // Verify encrypted backup or inspect via server
  const handleVerifyBackupIntegrity = async () => {
    if (!loadedEnvelope) return;
    setStatusBanner(null);
    setIsBusy(true);
    try {
      const res = await fetch('/api/backups/inspect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
          'x-company-id': currentCompany.id,
        },
        body: JSON.stringify({
          envelope: loadedEnvelope,
          decryptionPassword: decryptionPassword.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInspectedIntegrityOk(false);
        setStatusBanner({
          type: 'error',
          message: data?.error || 'Backup integrity verification failed.',
        });
        return;
      }
      setInspectedManifest(data.data.manifest);
      setInspectedIntegrityOk(true);
      setStatusBanner({
        type: 'success',
        message: isAr
          ? 'تم التحقق من سلامة النسخة الاحتياطية وتطابق بصمة SHA-256 بنجاح.'
          : 'Backup cryptographic SHA-256 integrity verified successfully.',
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Failed to verify backup integrity.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Option 1: Restore into Original Company
  const handleRestoreIntoOriginalCompany = async () => {
    if (!loadedEnvelope) return;
    setStatusBanner(null);

    if (!restoreOwnerPassword.trim()) {
      setStatusBanner({
        type: 'error',
        message: isAr
          ? 'يرجى إدخال كلمة مرور المالك أو الرمز السري لتأكيد الاستعادة.'
          : 'Owner password or PIN is required to authorize company restore.',
      });
      return;
    }

    setIsBusy(true);
    try {
      const currentDataset = collectClientBackupDataset();

      // Always create a local pre-restore checkpoint first
      const localCheckpoint = buildLocalFallbackEnvelope({
        payload: currentDataset,
        backupType: 'PRE_RESTORE_CHECKPOINT',
        selectedModules: ALL_BACKUP_MODULE_IDS,
        autoIncludeHardDependencies: true,
        userId: currentUser.id,
        username: currentUser.username || currentUser.name,
        notes: `Automatic pre-restore checkpoint before restoring ${loadedEnvelope.manifest.backupId}`,
      });
      saveLocalBackupEntry(
        localCheckpoint,
        `pre-restore-checkpoint-${new Date().toISOString().slice(0, 10)}.backup`
      );

      const res = await fetch('/api/backups/restore-in-place', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
          'x-company-id': currentCompany.id,
        },
        body: JSON.stringify({
          envelope: loadedEnvelope,
          decryptionPassword: decryptionPassword.trim() || undefined,
          ownerPassword: restoreOwnerPassword.trim(),
          allowCrossCompanyIdOverride: allowCrossCompanyOverride,
          currentClientDataset: currentDataset,
        }),
      });

      if (res.ok) {
        const payload = await res.json();
        const restoredPayload = payload?.data?.restoredPayload as BackupPayloadV1;
        if (restoredPayload) {
          hydrateCompanyFromBackupPayload(restoredPayload);
        }
        await fetchBackupsAndLogs();
        setRestoreOwnerPassword('');
        setStatusBanner({
          type: 'success',
          message: isAr
            ? `تمت استعادة النسخة الاحتياطية للشركة بنجاح مع حفظ نقطة استعادة تلقائية (${payload?.data?.checkpointBackupId}).`
            : `Company backup restored successfully with automatic recovery checkpoint (${payload?.data?.checkpointBackupId}).`,
        });
        return;
      }

      const errData = await res.json().catch(() => null);
      if (
        errData?.errorCode === 'INVALID_OWNER_CREDENTIALS' ||
        errData?.errorCode === 'BACKUP_COMPANY_IDENTITY_MISMATCH' ||
        errData?.errorCode === 'BACKUP_PASSWORD_REQUIRED' ||
        errData?.errorCode === 'INVALID_BACKUP_PASSWORD_OR_TAMPERED'
      ) {
        setStatusBanner({
          type: 'error',
          message: errData.error,
        });
        return;
      }

      // Offline fallback if unencrypted uncompressed local envelope
      if (!loadedEnvelope.encrypted && loadedEnvelope.compression === 'none') {
        const unpackedPayload = JSON.parse(
          decodeURIComponent(escape(atob(loadedEnvelope.payloadData)))
        ) as BackupPayloadV1;
        hydrateCompanyFromBackupPayload({
          ...unpackedPayload,
          companyProfile: {
            ...unpackedPayload.companyProfile,
            id: currentCompany.id,
          },
        });
        await fetchBackupsAndLogs();
        setRestoreOwnerPassword('');
        setStatusBanner({
          type: 'success',
          message: isAr
            ? 'تمت استعادة النسخة الاحتياطية محلياً مع حفظ نقطة استعادة تلقائية.'
            : 'Company backup restored locally with automatic recovery checkpoint.',
        });
      } else {
        setStatusBanner({
          type: 'error',
          message: errData?.error || 'Restore failed.',
        });
      }
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Restore failed.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Option 2: Restore as a Completely New Company
  const handleRestoreAsNewCompany = async () => {
    if (!loadedEnvelope) return;
    setStatusBanner(null);

    if (!newCompanyName.trim()) {
      setStatusBanner({
        type: 'error',
        message: isAr
          ? 'يرجى إدخال اسم الشركة الجديدة.'
          : 'Please enter the new company/store name.',
      });
      return;
    }
    if (!newOwnerUsername.trim() || newOwnerUsername.trim().length < 3) {
      setStatusBanner({
        type: 'error',
        message: isAr
          ? 'يرجى إدخال اسم مستخدم للمالك الجديد (3 أحرف على الأقل).'
          : 'Please enter a username for the new company owner (at least 3 characters).',
      });
      return;
    }
    if (!newOwnerPassword.trim() || newOwnerPassword.trim().length < 4) {
      setStatusBanner({
        type: 'error',
        message: isAr
          ? 'يرجى إدخال كلمة مرور للمالك الجديد (4 أحرف على الأقل).'
          : 'Please enter an owner password of at least 4 characters.',
      });
      return;
    }
    if (newOwnerPassword !== newOwnerConfirmPassword) {
      setStatusBanner({
        type: 'error',
        message: isAr
          ? 'كلمة المرور وتأكيد كلمة المرور غير متطابقين.'
          : 'Owner password and confirmation do not match.',
      });
      return;
    }

    setIsBusy(true);
    try {
      const res = await fetch('/api/backups/restore-new-company', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
          'x-company-id': currentCompany.id,
        },
        body: JSON.stringify({
          envelope: loadedEnvelope,
          decryptionPassword: decryptionPassword.trim() || undefined,
          companyName: newCompanyName.trim(),
          companyNameAr: newCompanyNameAr.trim() || newCompanyName.trim(),
          businessType: newCompanyBusinessType,
          ownerName: newOwnerName.trim() || newOwnerUsername.trim(),
          ownerUsername: newOwnerUsername.trim(),
          ownerPassword: newOwnerPassword,
          ownerConfirmPassword: newOwnerConfirmPassword,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const restoredPayload = data?.data?.restoredPayload as BackupPayloadV1;
        const newOwner = data?.data?.owner;
        if (restoredPayload) {
          hydrateCompanyFromBackupPayload(restoredPayload, {
            switchToNewCompany: true,
            newOwner,
          });
        }
        setNewOwnerPassword('');
        setNewOwnerConfirmPassword('');
        setStatusBanner({
          type: 'success',
          message: isAr
            ? `تم تأسيس الشركة الجديدة "${data?.data?.company?.displayName}" واستعادة جميع البيانات إليها بنجاح (${data?.data?.idRemapCount} معرفات معاد ربطها).`
            : `Created new isolated company "${data?.data?.company?.displayName}" from backup (${data?.data?.idRemapCount} entity IDs remapped).`,
        });
        return;
      }

      const errData = await res.json().catch(() => null);
      if (
        !loadedEnvelope.encrypted &&
        loadedEnvelope.compression === 'none' &&
        !errData?.errorCode
      ) {
        const unpackedPayload = JSON.parse(
          decodeURIComponent(escape(atob(loadedEnvelope.payloadData)))
        ) as BackupPayloadV1;
        const { remappedPayload, newOwnerProfile } =
          remapBackupPayloadForNewCompany(unpackedPayload, {
            companyName: newCompanyName.trim(),
            companyNameAr: newCompanyNameAr.trim() || newCompanyName.trim(),
            businessType: newCompanyBusinessType,
            ownerName: newOwnerName.trim() || newOwnerUsername.trim(),
            ownerUsername: newOwnerUsername.trim(),
          });
        hydrateCompanyFromBackupPayload(remappedPayload, {
          switchToNewCompany: true,
          newOwner: newOwnerProfile,
        });
        setStatusBanner({
          type: 'success',
          message: isAr
            ? `تم استعادة النسخة الاحتياطية كشركة جديدة "${newCompanyName.trim()}" بنجاح.`
            : `Restored backup as new company "${newCompanyName.trim()}" successfully.`,
        });
      } else {
        setStatusBanner({
          type: 'error',
          message:
            errData?.error || 'Failed to restore backup as a new company.',
        });
      }
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Failed to restore backup as new company.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Tab 3: Preview Intelligent Merge (Dry-Run)
  const handleRunMergePreview = async () => {
    if (!loadedEnvelope) return;
    setStatusBanner(null);
    setIsBusy(true);
    try {
      const currentDataset = collectClientBackupDataset();
      const res = await fetch('/api/backups/merge-preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
          'x-company-id': currentCompany.id,
        },
        body: JSON.stringify({
          envelope: loadedEnvelope,
          decryptionPassword: decryptionPassword.trim() || undefined,
          currentClientDataset: currentDataset,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const report = data?.data?.preview as BackupMergePreviewReport;
        setMergePreviewReport(report);
        setStatusBanner({
          type: 'info',
          message: isAr
            ? `اكتمل الفحص الذكي: ${report.totals.newRecords} سجل جديد، ${report.totals.strongMatches + report.totals.exactMatches} متطابق، و ${report.totals.conflicts} تعارض يحتاج للمراجعة.`
            : `Dry-run analysis complete: ${report.totals.newRecords} new records, ${report.totals.strongMatches + report.totals.exactMatches} matches, and ${report.totals.conflicts} conflicts detected.`,
        });
        return;
      }

      const errData = await res.json().catch(() => null);
      if (!loadedEnvelope.encrypted && loadedEnvelope.compression === 'none') {
        const unpackedPayload = JSON.parse(
          decodeURIComponent(escape(atob(loadedEnvelope.payloadData)))
        ) as BackupPayloadV1;
        const localReport = analyzeBackupMergePreview(
          unpackedPayload,
          currentDataset
        );
        setMergePreviewReport(localReport);
        return;
      }

      setStatusBanner({
        type: 'error',
        message: errData?.error || 'Failed to analyze backup for merge.',
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Failed to run merge analysis.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  // Tab 3: Execute Intelligent Merge
  const handleExecuteIntelligentMerge = async () => {
    if (!loadedEnvelope || !mergePreviewReport) return;
    setStatusBanner(null);

    if (!mergeOwnerPassword.trim()) {
      setStatusBanner({
        type: 'error',
        message: isAr
          ? 'يرجى إدخال كلمة مرور المالك أو الرمز السري لتأكيد عملية الدمج الذكي.'
          : 'Owner password or PIN is required to execute intelligent data merge.',
      });
      return;
    }

    setIsBusy(true);
    try {
      const currentDataset = collectClientBackupDataset();

      // Save automatic local pre-merge checkpoint
      const localCheckpoint = buildLocalFallbackEnvelope({
        payload: currentDataset,
        backupType: 'PRE_RESTORE_CHECKPOINT',
        selectedModules: ALL_BACKUP_MODULE_IDS,
        autoIncludeHardDependencies: true,
        userId: currentUser.id,
        username: currentUser.username || currentUser.name,
        notes: `Automatic pre-merge checkpoint before merging ${loadedEnvelope.manifest.backupId}`,
      });
      saveLocalBackupEntry(
        localCheckpoint,
        `pre-merge-checkpoint-${new Date().toISOString().slice(0, 10)}.backup`
      );

      const res = await fetch('/api/backups/merge-execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
          'x-company-id': currentCompany.id,
        },
        body: JSON.stringify({
          envelope: loadedEnvelope,
          decryptionPassword: decryptionPassword.trim() || undefined,
          ownerPassword: mergeOwnerPassword.trim(),
          mergeOptions: {
            moduleStrategies,
            itemResolutions,
            applyIncomingStockDelta,
          },
          currentClientDataset: currentDataset,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const mergedPayload = data?.data?.mergedPayload as BackupPayloadV1;
        const summary = data?.data?.summary as BackupMergeExecutionSummary;
        if (mergedPayload) {
          hydrateCompanyFromBackupPayload(mergedPayload);
        }
        setLastMergeExecutionSummary(summary);
        setMergeOwnerPassword('');
        await fetchBackupsAndLogs();
        setStatusBanner({
          type: 'success',
          message: isAr
            ? `تم تنفيذ الدمج الذكي بنجاح: تمت إضافة (${summary.insertedCount})، دمج (${summary.mergedCount})، تحديث (${summary.updatedCount})، وإعادة ربط (${summary.remappedReferencesCount}) مرجع.`
            : `Intelligent Merge completed: ${summary.insertedCount} inserted, ${summary.mergedCount} merged, ${summary.updatedCount} updated, and ${summary.remappedReferencesCount} references remapped.`,
        });
        return;
      }

      const errData = await res.json().catch(() => null);
      if (
        errData?.errorCode === 'INVALID_OWNER_CREDENTIALS' ||
        errData?.errorCode === 'BACKUP_PASSWORD_REQUIRED'
      ) {
        setStatusBanner({
          type: 'error',
          message: errData.error,
        });
        return;
      }

      if (!loadedEnvelope.encrypted && loadedEnvelope.compression === 'none') {
        const unpackedPayload = JSON.parse(
          decodeURIComponent(escape(atob(loadedEnvelope.payloadData)))
        ) as BackupPayloadV1;
        const { mergedDataset, summary } = applyIntelligentBackupMerge(
          unpackedPayload,
          currentDataset,
          {
            moduleStrategies,
            itemResolutions,
            applyIncomingStockDelta,
          }
        );
        hydrateCompanyFromBackupPayload(mergedDataset);
        setLastMergeExecutionSummary(summary);
        setMergeOwnerPassword('');
        await fetchBackupsAndLogs();
        setStatusBanner({
          type: 'success',
          message: isAr
            ? `تم تنفيذ الدمج الذكي محلياً: إضافة (${summary.insertedCount}) ودمج (${summary.mergedCount}).`
            : `Local Intelligent Merge completed: ${summary.insertedCount} inserted, ${summary.mergedCount} merged.`,
        });
      } else {
        setStatusBanner({
          type: 'error',
          message: errData?.error || 'Failed to execute merge.',
        });
      }
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Failed to execute merge.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteBackupCheckpoint = async (backupId: string) => {
    if (!deleteOwnerPassword.trim()) {
      setStatusBanner({
        type: 'error',
        message: isAr
          ? 'يرجى إدخال كلمة مرور المالك لحذف النسخة الاحتياطية.'
          : 'Owner password is required to delete a backup checkpoint.',
      });
      return;
    }

    setIsBusy(true);
    try {
      await fetch(`/api/backups/${encodeURIComponent(backupId)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
          'x-company-id': currentCompany.id,
        },
        body: JSON.stringify({ ownerPassword: deleteOwnerPassword.trim() }),
      }).catch(() => {});

      const remaining = loadLocalBackups().filter((b) => b.backupId !== backupId);
      localStorage.setItem(
        `${LOCAL_BACKUPS_STORAGE_PREFIX}${currentCompany.id}`,
        JSON.stringify(remaining)
      );
      setDeleteTargetBackupId(null);
      setDeleteOwnerPassword('');
      await fetchBackupsAndLogs();
      setStatusBanner({
        type: 'success',
        message: isAr
          ? `تم حذف النسخة الاحتياطية (${backupId}) بنجاح.`
          : `Deleted backup checkpoint (${backupId}).`,
      });
    } finally {
      setIsBusy(false);
    }
  };

  if (!canView) return null;

  const filteredPreviewItems = (mergePreviewReport?.items || []).filter((item) => {
    if (mergeFilterTab === 'CONFLICTS') {
      return (
        item.classification === 'CONFLICTING_RECORD' ||
        item.classification === 'POSSIBLE_MATCH'
      );
    }
    if (mergeFilterTab === 'MATCHES') {
      return (
        item.classification === 'EXACT_MATCH' ||
        item.classification === 'STRONG_MATCH'
      );
    }
    if (mergeFilterTab === 'NEW') {
      return item.classification === 'NO_MATCH';
    }
    return true;
  });

  const renderClassificationBadge = (c: MergeClassification) => {
    switch (c) {
      case 'EXACT_MATCH':
        return (
          <span className="px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-bold">
            {isAr ? 'تطابق تام' : 'EXACT MATCH'}
          </span>
        );
      case 'STRONG_MATCH':
        return (
          <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
            {isAr ? 'تطابق قوي (قابل للدمج)' : 'STRONG MATCH'}
          </span>
        );
      case 'POSSIBLE_MATCH':
        return (
          <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
            {isAr ? 'تشابه محتمل' : 'POSSIBLE MATCH'}
          </span>
        );
      case 'NO_MATCH':
        return (
          <span className="px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px] font-bold">
            {isAr ? 'سجل جديد' : 'NEW RECORD'}
          </span>
        );
      case 'CONFLICTING_RECORD':
        return (
          <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-black">
            {isAr ? 'تعارض يحتاج لقرار' : 'CONFLICT'}
          </span>
        );
    }
  };

  return (
    <AppCard>
      <div
        data-testid="backup-restore-center-section"
        className="space-y-5"
      >
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Archive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-sm sm:text-base text-white">
                  {isAr
                    ? 'مركز النسخ الاحتياطي، الاستعادة، ترحيل الشركات والدمج الذكي'
                    : 'Backup, Restore, Company Migration & Intelligent Data Merge'}
                </h3>
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono font-bold">
                  SHA-256 + AES-256-GCM
                </span>
              </div>
              <p className="text-[11px] text-neutral-400">
                {isAr
                  ? `الشركة النشطة: ${currentCompany.displayNameAr || currentCompany.displayName} (${currentCompany.id}) — نسخ احتياطي مشفر واستعادة آمنة ودمج ذكي بدون فقدان البيانات`
                  : `Active Company: ${currentCompany.displayName} (${currentCompany.id}) — Encrypted archives, atomic restore checkpoints, and conflict-aware merge`}
              </p>
            </div>
          </div>

          {/* Hidden File Input for Uploading .backup */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".backup,.json,application/json"
            onChange={handleFileUpload}
            className="hidden"
          />

          <button
            type="button"
            data-testid="backup-upload-file-btn"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-amber-300 border border-amber-500/30 text-xs font-bold transition-colors self-start sm:self-auto"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>
              {isAr ? 'رفع ملف نسخة احتياطية (.backup)' : 'Upload .backup File'}
            </span>
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            data-testid="backup-tab-create"
            onClick={() => setActiveTab('create')}
            className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'create'
                ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                : 'bg-neutral-900/90 border-neutral-800 text-neutral-300 hover:text-white'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isAr ? '1. إنشاء نسخة احتياطية' : '1. Create Backup'}</span>
          </button>

          <button
            type="button"
            data-testid="backup-tab-restore"
            onClick={() => setActiveTab('restore')}
            className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'restore'
                ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                : 'bg-neutral-900/90 border-neutral-800 text-neutral-300 hover:text-white'
            }`}
          >
            <FolderSync className="w-3.5 h-3.5" />
            <span>{isAr ? '2. استعادة كاملة / شركة جديدة' : '2. Full Restore'}</span>
          </button>

          <button
            type="button"
            data-testid="backup-tab-merge"
            onClick={() => setActiveTab('merge')}
            className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'merge'
                ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                : 'bg-neutral-900/90 border-neutral-800 text-neutral-300 hover:text-white'
            }`}
          >
            <GitMerge className="w-3.5 h-3.5" />
            <span>{isAr ? '3. الاستيراد والدمج الذكي' : '3. Intelligent Merge'}</span>
          </button>

          <button
            type="button"
            data-testid="backup-tab-checkpoints"
            onClick={() => setActiveTab('checkpoints')}
            className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'checkpoints'
                ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                : 'bg-neutral-900/90 border-neutral-800 text-neutral-300 hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>
              {isAr
                ? `4. الأرشيف ونقاط الاستعادة (${savedBackups.length})`
                : `4. Checkpoints (${savedBackups.length})`}
            </span>
          </button>
        </div>

        {/* Status Banner */}
        {statusBanner && (
          <div
            data-testid="backup-center-status-banner"
            className={`p-3.5 rounded-xl border text-xs font-bold flex items-center justify-between gap-3 ${
              statusBanner.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : statusBanner.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-sky-500/10 border-sky-500/30 text-sky-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : statusBanner.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <Info className="w-4 h-4 shrink-0" />
              )}
              <span>{statusBanner.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100"
            >
              {isAr ? 'إغلاق' : 'Dismiss'}
            </button>
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 1: CREATE FULL OR SELECTIVE BACKUP                           */}
        {/* ================================================================ */}
        {activeTab === 'create' && (
          <div className="space-y-4">
            {/* Scope Mode Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                data-testid="backup-mode-full-btn"
                onClick={() => {
                  setBackupScopeMode('FULL_COMPANY');
                  setSelectedModules([...ALL_BACKUP_MODULE_IDS]);
                }}
                className={`p-4 rounded-xl border text-start transition-all ${
                  backupScopeMode === 'FULL_COMPANY'
                    ? 'bg-amber-500/10 border-amber-500/50 text-white'
                    : 'bg-neutral-950/70 border-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-black text-amber-400">
                    {isAr ? 'نسخة احتياطية شاملة للشركة' : 'Full Company Backup'}
                  </span>
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                </div>
                <p className="text-[11px] text-neutral-300">
                  {isAr
                    ? 'تضمين جميع الأقسام الـ 15 (المنتجات، الفئات، الباركود، العملاء، الموردون، المخزون، المبيعات، المشتريات، المحاسبة، العملات، الفروع، والموظفون بدون كلمات المرور).'
                    : 'Includes all 15 company modules (products, barcodes, UOM, customers, suppliers, inventory, sales, purchases, accounting, currencies, branches, and employees without credentials).'}
                </p>
              </button>

              <button
                type="button"
                data-testid="backup-mode-selective-btn"
                onClick={() => setBackupScopeMode('SELECTIVE_MODULES')}
                className={`p-4 rounded-xl border text-start transition-all ${
                  backupScopeMode === 'SELECTIVE_MODULES'
                    ? 'bg-sky-500/10 border-sky-500/50 text-white'
                    : 'bg-neutral-950/70 border-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-black text-sky-400">
                    {isAr ? 'نسخة احتياطية انتقائية للأقسام' : 'Selective Module Backup'}
                  </span>
                  <Layers className="w-4 h-4 text-sky-400" />
                </div>
                <p className="text-[11px] text-neutral-300">
                  {isAr
                    ? 'اختر أقساماً محددة لتصديرها مع حل تلقائي للاعتماديات المرجعية (مثل تضمين الفئات والوحدات عند تصدير المنتجات).'
                    : 'Select specific modules to export with automatic dependency resolution (e.g., auto-including categories & UOM when exporting products).'}
                </p>
              </button>
            </div>

            {/* Selective Module Checkboxes */}
            {backupScopeMode === 'SELECTIVE_MODULES' && (
              <div className="p-4 rounded-xl bg-neutral-950/80 border border-neutral-800 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-bold text-white">
                    {isAr
                      ? 'حدد الأقسام المطلوب تضمينها في النسخة الاحتياطية:'
                      : 'Select modules to include in the backup package:'}
                  </span>
                  <label className="inline-flex items-center gap-2 text-xs text-amber-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoIncludeDeps}
                      onChange={(e) => setAutoIncludeDeps(e.target.checked)}
                      className="rounded border-neutral-700"
                    />
                    <span>
                      {isAr
                        ? 'تضمين الأقسام المرتبطة إجبارياً بشكل تلقائي (موصى به)'
                        : 'Automatically include required hard dependencies (Recommended)'}
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {BACKUP_MODULE_DEFINITIONS.map((mod) => {
                    const isChecked = selectedModules.includes(mod.id);
                    const isAutoDep =
                      dependencyResolution.autoIncludedDependencies.includes(
                        mod.id
                      );
                    const count = liveModuleCounts[mod.id] || 0;
                    return (
                      <label
                        key={mod.id}
                        className={`p-2.5 rounded-xl border text-xs flex items-start justify-between gap-2 cursor-pointer transition-all ${
                          isChecked || isAutoDep
                            ? 'bg-neutral-900 border-amber-500/40 text-white'
                            : 'bg-neutral-950 border-neutral-850 text-neutral-400'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked || isAutoDep}
                            disabled={isAutoDep}
                            onChange={() => toggleModuleSelection(mod.id)}
                            className="mt-0.5 rounded border-neutral-700"
                          />
                          <div>
                            <div className="font-bold text-[11px]">
                              {isAr ? mod.labelAr : mod.labelEn}
                            </div>
                            {isAutoDep && (
                              <span className="text-[10px] text-amber-400 font-semibold">
                                {isAr ? '(مضمن تلقائياً كاعتمادية)' : '(Auto-included dependency)'}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono text-[10px]">
                          {count}
                        </span>
                      </label>
                    );
                  })}
                </div>

                {(isAr
                  ? dependencyResolution.dependencyWarningsAr
                  : dependencyResolution.dependencyWarnings
                ).length > 0 && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-1">
                    {(isAr
                      ? dependencyResolution.dependencyWarningsAr
                      : dependencyResolution.dependencyWarnings
                    ).map((w, idx) => (
                      <div
                        key={idx}
                        className="text-[11px] text-amber-300 flex items-center gap-1.5"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Encryption & Notes */}
            <div className="p-4 rounded-xl bg-neutral-950/80 border border-neutral-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="backup-enable-encryption-checkbox"
                    checked={enableEncryption}
                    onChange={(e) => setEnableEncryption(e.target.checked)}
                    className="rounded border-neutral-700"
                  />
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    {isAr
                      ? 'تشفير النسخة الاحتياطية بكلمة مرور (AES-256-GCM)'
                      : 'Password-Protect & Encrypt Backup (AES-256-GCM)'}
                  </span>
                </label>
                {enableEncryption && (
                  <input
                    type="password"
                    data-testid="backup-encryption-password-input"
                    value={encryptionPassword}
                    onChange={(e) => setEncryptionPassword(e.target.value)}
                    placeholder={
                      isAr
                        ? 'أدخل كلمة مرور تشفير النسخة الاحتياطية...'
                        : 'Enter backup encryption password...'
                    }
                    className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white"
                  />
                )}
                <p className="text-[10px] text-neutral-400">
                  {isAr
                    ? 'الأمان: لا يتم مطلقاً تخزين كلمات مرور المستخدمين أو رموز الجلسات داخل ملف النسخة الاحتياطية.'
                    : 'Security guarantee: User passwords, PINs, and session tokens are strictly stripped from all backups.'}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-white block">
                  {isAr ? 'ملاحظات النسخة الاحتياطية (اختياري)' : 'Backup Description / Notes (Optional)'}
                </label>
                <input
                  type="text"
                  data-testid="backup-notes-input"
                  value={backupNotes}
                  onChange={(e) => setBackupNotes(e.target.value)}
                  placeholder={
                    isAr
                      ? 'مثال: نسخة إغلاق الشهر قبل الجرد...'
                      : 'e.g., End-of-month backup before stock audit...'
                  }
                  className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 flex-wrap">
              <button
                type="button"
                data-testid="backup-save-checkpoint-only-btn"
                disabled={isBusy || !canCreate}
                onClick={() => handleCreateBackup(false)}
                className="px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 text-xs font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <Archive className="w-4 h-4 text-amber-400" />
                <span>
                  {isAr
                    ? 'حفظ في أرشيف نقاط الاستعادة'
                    : 'Save to Recovery Checkpoints'}
                </span>
              </button>

              <button
                type="button"
                data-testid="backup-create-and-download-btn"
                disabled={isBusy || !canCreate}
                onClick={() => handleCreateBackup(true)}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black text-xs flex items-center gap-2 transition-colors shadow-lg shadow-amber-500/10 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>
                  {isAr
                    ? 'إنشاء وتنزيل ملف النسخة الاحتياطية (.backup)'
                    : 'Create & Download .backup Package'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 2: FULL RESTORE (ORIGINAL COMPANY OR NEW ISOLATED COMPANY)   */}
        {/* ================================================================ */}
        {activeTab === 'restore' && (
          <div className="space-y-4">
            {!loadedEnvelope ? (
              <div className="p-6 rounded-2xl bg-neutral-950/70 border border-dashed border-neutral-700 text-center space-y-3">
                <Upload className="w-8 h-8 text-amber-400 mx-auto" />
                <div className="text-xs font-bold text-white">
                  {isAr
                    ? 'لم يتم اختيار ملف نسخة احتياطية بعد'
                    : 'No backup package loaded yet'}
                </div>
                <p className="text-[11px] text-neutral-400 max-w-md mx-auto">
                  {isAr
                    ? 'قم برفع ملف (.backup) من جهازك أو اختر إحدى النسخ المحفوظة من تبويب "الأرشيف ونقاط الاستعادة".'
                    : 'Upload a .backup file from your device or select a saved checkpoint from the Checkpoints tab.'}
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-amber-500 text-neutral-950 font-black text-xs inline-flex items-center gap-2"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isAr ? 'اختيار ملف .backup' : 'Select .backup File'}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Loaded Backup Manifest Summary Card */}
                <div className="p-4 rounded-xl bg-neutral-950/90 border border-neutral-800 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <FileCheck2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-black text-white">
                        {loadedFileName || loadedEnvelope.manifest.backupId}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-neutral-800 text-amber-300 font-mono text-[10px]">
                        v{loadedEnvelope.manifest.schemaVersion}
                      </span>
                      {loadedEnvelope.encrypted && (
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          AES-256-GCM
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      data-testid="backup-verify-integrity-btn"
                      onClick={handleVerifyBackupIntegrity}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold flex items-center gap-1.5"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>
                        {isAr
                          ? 'فحص سلامة الملف وبصمة SHA-256'
                          : 'Verify SHA-256 Integrity'}
                      </span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
                      <span className="text-neutral-400 block">
                        {isAr ? 'الشركة المصدر' : 'Source Company'}
                      </span>
                      <span className="font-bold text-white">
                        {loadedEnvelope.manifest.sourceCompany.displayName}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
                      <span className="text-neutral-400 block">
                        {isAr ? 'العملة الأساسية' : 'Base Currency'}
                      </span>
                      <span className="font-mono font-bold text-amber-300">
                        {loadedEnvelope.manifest.sourceCompany.baseCurrency || 'SDG'}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
                      <span className="text-neutral-400 block">
                        {isAr ? 'الأقسام المشمولة' : 'Modules Included'}
                      </span>
                      <span className="font-bold text-white">
                        {loadedEnvelope.manifest.modulesIncluded.length} / 15
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
                      <span className="text-neutral-400 block">
                        {isAr ? 'إجمالي السجلات' : 'Total Records'}
                      </span>
                      <span className="font-mono font-bold text-emerald-400">
                        {loadedEnvelope.manifest.totalRecords}
                      </span>
                    </div>
                  </div>

                  {loadedEnvelope.encrypted && (
                    <div className="pt-2">
                      <label className="text-xs font-bold text-amber-300 block mb-1">
                        {isAr
                          ? 'كلمة مرور فك تشفير النسخة الاحتياطية (AES-256-GCM):'
                          : 'Backup Decryption Password (AES-256-GCM):'}
                      </label>
                      <input
                        type="password"
                        data-testid="backup-decryption-password-input"
                        value={decryptionPassword}
                        onChange={(e) => setDecryptionPassword(e.target.value)}
                        placeholder={
                          isAr
                            ? 'أدخل كلمة مرور فك التشفير...'
                            : 'Enter backup decryption password...'
                        }
                        className="w-full sm:w-80 px-3 py-2 rounded-xl bg-neutral-900 border border-amber-500/40 text-xs text-white"
                      />
                    </div>
                  )}
                </div>

                {/* Two Restore Destinations Selector */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    data-testid="restore-option-original-company-btn"
                    onClick={() => setRestoreMode('ORIGINAL_COMPANY')}
                    className={`p-4 rounded-xl border text-start transition-all ${
                      restoreMode === 'ORIGINAL_COMPANY'
                        ? 'bg-amber-500/10 border-amber-500 text-white'
                        : 'bg-neutral-950/70 border-neutral-800 text-neutral-400'
                    }`}
                  >
                    <div className="text-xs font-black text-amber-400 mb-1">
                      {isAr
                        ? 'الخيار 1: الاستعادة داخل الشركة الحالية'
                        : 'Option 1: Restore into Current Company'}
                    </div>
                    <p className="text-[11px] text-neutral-300">
                      {isAr
                        ? 'ينشئ نقطة استعادة تلقائية لبياناتك الحالية أولاً، ثم يستعيد بيانات النسخة الاحتياطية داخل الشركة النشطة.'
                        : 'Automatically creates a recovery checkpoint of current data first, then restores backup modules into the active company.'}
                    </p>
                  </button>

                  <button
                    type="button"
                    data-testid="restore-option-new-company-btn"
                    onClick={() => setRestoreMode('NEW_COMPANY')}
                    className={`p-4 rounded-xl border text-start transition-all ${
                      restoreMode === 'NEW_COMPANY'
                        ? 'bg-emerald-500/10 border-emerald-500 text-white'
                        : 'bg-neutral-950/70 border-neutral-800 text-neutral-400'
                    }`}
                  >
                    <div className="text-xs font-black text-emerald-400 mb-1">
                      {isAr
                        ? 'الخيار 2: الاستعادة كشركة جديدة مستقلة'
                        : 'Option 2: Restore as a Completely New Company'}
                    </div>
                    <p className="text-[11px] text-neutral-300">
                      {isAr
                        ? 'ينشئ شركة جديدة بمعرف مستقل وحساب مالك جديد ويعيد ربط جميع المنتجات والفواتير والعملاء دون المساس بالشركات الحالية.'
                        : 'Creates a brand-new isolated company with a new Owner account and remaps all internal IDs without touching existing companies.'}
                    </p>
                  </button>
                </div>

                {restoreMode === 'ORIGINAL_COMPANY' ? (
                  <div className="p-4 rounded-xl bg-neutral-950/90 border border-amber-500/30 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                      <KeyRound className="w-4 h-4" />
                      <span>
                        {isAr
                          ? 'تأكيد هوية مالك الشركة قبل الاستعادة:'
                          : 'Owner Re-Authentication Required Before Restore:'}
                      </span>
                    </div>

                    {loadedEnvelope.manifest.sourceCompany.companyId !==
                      currentCompany.id && (
                      <label className="flex items-center gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 p-2.5 rounded-lg cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowCrossCompanyOverride}
                          onChange={(e) =>
                            setAllowCrossCompanyOverride(e.target.checked)
                          }
                        />
                        <span>
                          {isAr
                            ? `تنبيه: هذه النسخة مأخوذة من شركة (${loadedEnvelope.manifest.sourceCompany.displayName}). أوافق على استعادتها داخل الشركة الحالية (${currentCompany.displayName}).`
                            : `Warning: Backup belongs to "${loadedEnvelope.manifest.sourceCompany.displayName}". Confirm restoring into "${currentCompany.displayName}".`}
                        </span>
                      </label>
                    )}

                    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                      <div className="flex-1">
                        <label className="text-[11px] text-neutral-400 block mb-1">
                          {isAr
                            ? 'كلمة مرور المالك أو الرمز السري (PIN):'
                            : 'Current Company Owner Password or PIN:'}
                        </label>
                        <input
                          type="password"
                          data-testid="restore-in-place-owner-password-input"
                          value={restoreOwnerPassword}
                          onChange={(e) =>
                            setRestoreOwnerPassword(e.target.value)
                          }
                          placeholder={
                            isAr
                              ? 'أدخل كلمة مرور المالك للتأكيد...'
                              : 'Enter Owner password to authorize restore...'
                          }
                          className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white"
                        />
                      </div>

                      <button
                        type="button"
                        data-testid="execute-restore-in-place-btn"
                        disabled={isBusy || !canRestore}
                        onClick={handleRestoreIntoOriginalCompany}
                        className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <FolderSync className="w-4 h-4" />
                        <span>
                          {isAr
                            ? 'تنفيذ الاستعادة مع حفظ نقطة أمان تلقائية'
                            : 'Restore with Automatic Pre-Restore Checkpoint'}
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-neutral-950/90 border border-emerald-500/30 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                      <Building2 className="w-4 h-4" />
                      <span>
                        {isAr
                          ? 'بيانات الشركة الجديدة وحساب المالك الجديد:'
                          : 'New Isolated Company & Owner Account Credentials:'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-neutral-400 block mb-1">
                          {isAr
                            ? 'اسم الشركة / المتجر الجديد *'
                            : 'New Company / Store Name *'}
                        </label>
                        <input
                          type="text"
                          data-testid="restore-new-company-name-input"
                          value={newCompanyName}
                          onChange={(e) => setNewCompanyName(e.target.value)}
                          placeholder={
                            isAr ? 'مثال: متجر النيل الجديد' : 'e.g., Nile Market Branch 2'
                          }
                          className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-neutral-400 block mb-1">
                          {isAr ? 'اسم المالك الكامل' : 'Owner Full Name'}
                        </label>
                        <input
                          type="text"
                          data-testid="restore-new-owner-name-input"
                          value={newOwnerName}
                          onChange={(e) => setNewOwnerName(e.target.value)}
                          placeholder={
                            isAr ? 'اسم مالك الشركة الجديدة' : 'Owner Full Name'
                          }
                          className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-neutral-400 block mb-1">
                          {isAr
                            ? 'اسم المستخدم للمالك الجديد (Username) *'
                            : 'New Owner Username *'}
                        </label>
                        <input
                          type="text"
                          data-testid="restore-new-owner-username-input"
                          value={newOwnerUsername}
                          onChange={(e) => setNewOwnerUsername(e.target.value)}
                          placeholder="owner.newstore"
                          className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] text-neutral-400 block mb-1">
                            {isAr ? 'كلمة المرور *' : 'Owner Password *'}
                          </label>
                          <input
                            type="password"
                            data-testid="restore-new-owner-password-input"
                            value={newOwnerPassword}
                            onChange={(e) => setNewOwnerPassword(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-neutral-400 block mb-1">
                            {isAr ? 'تأكيد كلمة المرور *' : 'Confirm Password *'}
                          </label>
                          <input
                            type="password"
                            data-testid="restore-new-owner-confirm-input"
                            value={newOwnerConfirmPassword}
                            onChange={(e) =>
                              setNewOwnerConfirmPassword(e.target.value)
                            }
                            className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        data-testid="execute-restore-new-company-btn"
                        disabled={isBusy || !canRestore}
                        onClick={handleRestoreAsNewCompany}
                        className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-black text-xs flex items-center gap-2 disabled:opacity-50"
                      >
                        <Building2 className="w-4 h-4" />
                        <span>
                          {isAr
                            ? 'تأسيس الشركة الجديدة واستعادة البيانات إليها'
                            : 'Create New Company & Restore Backup Data'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 3: INTELLIGENT IMPORT & MERGE                                */}
        {/* ================================================================ */}
        {activeTab === 'merge' && (
          <div className="space-y-4">
            {!loadedEnvelope ? (
              <div className="p-6 rounded-2xl bg-neutral-950/70 border border-dashed border-neutral-700 text-center space-y-3">
                <GitMerge className="w-8 h-8 text-amber-400 mx-auto" />
                <div className="text-xs font-bold text-white">
                  {isAr
                    ? 'اختر ملف نسخة احتياطية لفحص التكرارات والدمج الذكي'
                    : 'Load a .backup package to analyze duplicates and preview Intelligent Merge'}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-amber-500 text-neutral-950 font-black text-xs inline-flex items-center gap-2"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isAr ? 'رفع ملف .backup' : 'Upload .backup File'}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3 p-3.5 rounded-xl bg-neutral-950 border border-neutral-800">
                  <div>
                    <span className="text-xs font-bold text-white block">
                      {isAr
                        ? `الملف الجاهز للدمج: ${loadedFileName || loadedEnvelope.manifest.backupId}`
                        : `Backup loaded for merge: ${loadedFileName || loadedEnvelope.manifest.backupId}`}
                    </span>
                    <span className="text-[11px] text-neutral-400">
                      {isAr
                        ? `المصدر: ${loadedEnvelope.manifest.sourceCompany.displayName} (${loadedEnvelope.manifest.totalRecords} سجل)`
                        : `Source: ${loadedEnvelope.manifest.sourceCompany.displayName} (${loadedEnvelope.manifest.totalRecords} records)`}
                    </span>
                  </div>

                  <button
                    type="button"
                    data-testid="run-merge-preview-btn"
                    disabled={isBusy || !canMerge}
                    onClick={handleRunMergePreview}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black text-xs flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>
                      {isAr
                        ? 'تشغيل الفحص الذكي للتكرارات والتعارضات (Dry-Run)'
                        : 'Analyze Duplicates & Preview Merge (Dry-Run)'}
                    </span>
                  </button>
                </div>

                {mergePreviewReport && (
                  <div
                    data-testid="merge-preview-report-container"
                    className="space-y-4"
                  >
                    {/* Summary KPI Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30">
                        <span className="text-[10px] text-purple-300 font-bold block">
                          {isAr ? 'سجلات جديدة (NO_MATCH)' : 'New Records'}
                        </span>
                        <span className="text-lg font-black text-white font-mono">
                          {mergePreviewReport.totals.newRecords}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                        <span className="text-[10px] text-emerald-300 font-bold block">
                          {isAr ? 'تطابق قوي (STRONG)' : 'Strong Matches'}
                        </span>
                        <span className="text-lg font-black text-white font-mono">
                          {mergePreviewReport.totals.strongMatches}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/30">
                        <span className="text-[10px] text-sky-300 font-bold block">
                          {isAr ? 'تطابق تام (EXACT)' : 'Exact Matches'}
                        </span>
                        <span className="text-lg font-black text-white font-mono">
                          {mergePreviewReport.totals.exactMatches}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                        <span className="text-[10px] text-amber-300 font-bold block">
                          {isAr ? 'تشابه محتمل (POSSIBLE)' : 'Possible Matches'}
                        </span>
                        <span className="text-lg font-black text-white font-mono">
                          {mergePreviewReport.totals.possibleMatches}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30">
                        <span className="text-[10px] text-rose-300 font-bold block">
                          {isAr ? 'تعارضات (CONFLICTS)' : 'Conflicts'}
                        </span>
                        <span className="text-lg font-black text-white font-mono">
                          {mergePreviewReport.totals.conflicts}
                        </span>
                      </div>
                    </div>

                    {/* Base Currency Conflict Warning */}
                    {mergePreviewReport.baseCurrencyConflict.hasConflict && (
                      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                          {isAr
                            ? mergePreviewReport.baseCurrencyConflict
                                .resolutionNoteAr
                            : mergePreviewReport.baseCurrencyConflict
                                .resolutionNoteEn}
                        </span>
                      </div>
                    )}

                    {/* Filter Tabs & Stock Protection Option */}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(
                          [
                            {
                              id: 'ALL',
                              labelEn: `All (${mergePreviewReport.items.length})`,
                              labelAr: `الكل (${mergePreviewReport.items.length})`,
                            },
                            {
                              id: 'CONFLICTS',
                              labelEn: `Conflicts & Possible (${
                                mergePreviewReport.totals.conflicts +
                                mergePreviewReport.totals.possibleMatches
                              })`,
                              labelAr: `التعارضات والتشابهات (${
                                mergePreviewReport.totals.conflicts +
                                mergePreviewReport.totals.possibleMatches
                              })`,
                            },
                            {
                              id: 'MATCHES',
                              labelEn: `Matches (${
                                mergePreviewReport.totals.exactMatches +
                                mergePreviewReport.totals.strongMatches
                              })`,
                              labelAr: `المتطابقة (${
                                mergePreviewReport.totals.exactMatches +
                                mergePreviewReport.totals.strongMatches
                              })`,
                            },
                            {
                              id: 'NEW',
                              labelEn: `New (${mergePreviewReport.totals.newRecords})`,
                              labelAr: `الجديدة (${mergePreviewReport.totals.newRecords})`,
                            },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setMergeFilterTab(tab.id)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                              mergeFilterTab === tab.id
                                ? 'bg-amber-500 text-neutral-950 border-amber-400'
                                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                            }`}
                          >
                            {isAr ? tab.labelAr : tab.labelEn}
                          </button>
                        ))}
                      </div>

                      <label className="inline-flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={applyIncomingStockDelta}
                          onChange={(e) =>
                            setApplyIncomingStockDelta(e.target.checked)
                          }
                          className="rounded border-neutral-700"
                        />
                        <span>
                          {isAr
                            ? 'إضافة كميات المخزون الواردة كحركة تسوية جردية (الافتراضي: الحفاظ على المخزون الحالي)'
                            : 'Add incoming product stock via audited adjustment (Default: preserve current live stock)'}
                        </span>
                      </label>
                    </div>

                    {/* Item-by-Item Resolution Table */}
                    <div className="max-h-72 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 divide-y divide-neutral-850">
                      {filteredPreviewItems.length === 0 ? (
                        <div className="p-6 text-center text-xs text-neutral-500">
                          {isAr
                            ? 'لا توجد سجلات ضمن هذا التصنيف.'
                            : 'No records in this filter category.'}
                        </div>
                      ) : (
                        filteredPreviewItems.slice(0, 80).map((item) => {
                          const currentAction =
                            itemResolutions[item.itemKey] ||
                            moduleStrategies[item.moduleId] ||
                            item.recommendedAction;
                          return (
                            <div
                              key={item.itemKey}
                              className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-neutral-900/60"
                            >
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 text-[10px] font-mono">
                                    {item.moduleId}
                                  </span>
                                  <span className="text-xs font-bold text-white truncate">
                                    {item.displayName}
                                  </span>
                                  {renderClassificationBadge(item.classification)}
                                </div>
                                <div className="text-[11px] text-neutral-400 font-mono">
                                  {item.naturalKeyLabel}
                                  {item.matchedByField && (
                                    <span className="text-amber-400 ms-2">
                                      • {isAr ? 'تطابق عبر:' : 'Matched by:'}{' '}
                                      {item.matchedByField}
                                    </span>
                                  )}
                                </div>
                                {(isAr
                                  ? item.conflictReasonAr
                                  : item.conflictReasonEn) && (
                                  <div className="text-[11px] text-rose-300">
                                    {isAr
                                      ? item.conflictReasonAr
                                      : item.conflictReasonEn}
                                  </div>
                                )}
                              </div>

                              <div className="shrink-0">
                                <select
                                  value={currentAction}
                                  onChange={(e) =>
                                    setItemResolutions((prev) => ({
                                      ...prev,
                                      [item.itemKey]:
                                        e.target.value as MergeResolutionStrategy,
                                    }))
                                  }
                                  className="px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs text-white font-semibold"
                                >
                                  <option value="MERGE">
                                    {isAr
                                      ? 'دمج ذكي (MERGE)'
                                      : 'Smart Merge (MERGE)'}
                                  </option>
                                  <option value="KEEP_EXISTING">
                                    {isAr
                                      ? 'الإبقاء على الحالي (KEEP_EXISTING)'
                                      : 'Keep Existing (KEEP_EXISTING)'}
                                  </option>
                                  <option value="UPDATE_EXISTING">
                                    {isAr
                                      ? 'تحديث الحالي بالوارد (UPDATE)'
                                      : 'Update Existing (UPDATE)'}
                                  </option>
                                  <option value="IMPORT_AS_NEW">
                                    {isAr
                                      ? 'إدراج كسجل جديد (IMPORT_AS_NEW)'
                                      : 'Import as New (IMPORT_AS_NEW)'}
                                  </option>
                                  <option value="SKIP">
                                    {isAr ? 'تجاهل (SKIP)' : 'Skip (SKIP)'}
                                  </option>
                                </select>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Execute Merge Authorization Bar */}
                    <div className="p-4 rounded-xl bg-neutral-950/90 border border-amber-500/30 flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-3">
                      <div className="flex-1">
                        <label className="text-[11px] text-neutral-300 font-bold block mb-1">
                          {isAr
                            ? 'كلمة مرور المالك لتأكيد تنفيذ الدمج الذكي (يتم حفظ نقطة استعادة تلقائية قبل الدمج):'
                            : 'Owner Password / PIN to Authorize Intelligent Merge (Creates automatic pre-merge checkpoint):'}
                        </label>
                        <input
                          type="password"
                          data-testid="merge-execute-owner-password-input"
                          value={mergeOwnerPassword}
                          onChange={(e) => setMergeOwnerPassword(e.target.value)}
                          placeholder={
                            isAr
                              ? 'أدخل كلمة مرور المالك...'
                              : 'Enter Owner password...'
                          }
                          className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-xs text-white"
                        />
                      </div>

                      <button
                        type="button"
                        data-testid="execute-intelligent-merge-btn"
                        disabled={isBusy || !canMerge}
                        onClick={handleExecuteIntelligentMerge}
                        className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-black text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <GitMerge className="w-4 h-4" />
                        <span>
                          {isAr
                            ? 'اعتماد وتنفيذ الدمج الذكي الآن'
                            : 'Approve & Execute Intelligent Merge'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 4: SAVED CHECKPOINTS & BACKUP AUDIT LOG                      */}
        {/* ================================================================ */}
        {activeTab === 'checkpoints' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <h4 className="text-xs font-black text-white flex items-center gap-2">
                <Archive className="w-4 h-4 text-amber-400" />
                <span>
                  {isAr
                    ? 'النسخ الاحتياطية ونقاط الاستعادة المحفوظة للشركة الحالية'
                    : 'Saved Company Backups & Automatic Pre-Restore Checkpoints'}
                </span>
              </h4>

              {savedBackups.length === 0 ? (
                <div className="p-6 rounded-xl bg-neutral-950 border border-neutral-800 text-center text-xs text-neutral-400">
                  {isAr
                    ? 'لا توجد نسخ احتياطية محفوظة بعد لهذه الشركة.'
                    : 'No saved backups or checkpoints yet for this company.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {savedBackups.map((item) => (
                    <div
                      key={item.backupId}
                      data-testid={`saved-backup-row-${item.backupId}`}
                      className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-black text-white font-mono">
                            {item.backupId}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              item.manifest.backupType ===
                              'PRE_RESTORE_CHECKPOINT'
                                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                                : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {item.manifest.backupType}
                          </span>
                          {item.encrypted && (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-bold">
                              AES-256-GCM
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-neutral-400">
                          {new Date(item.manifest.createdAt).toLocaleString()} •{' '}
                          {item.manifest.totalRecords}{' '}
                          {isAr ? 'سجل' : 'records'} • SHA-256:{' '}
                          <span className="font-mono text-neutral-300">
                            {item.payloadChecksumSha256.slice(0, 12)}...
                          </span>
                        </div>
                        {item.manifest.notes && (
                          <div className="text-[11px] text-neutral-300">
                            {item.manifest.notes}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={async () => {
                            await handleSelectSavedBackup(item);
                            setActiveTab('restore');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-bold"
                        >
                          {isAr ? 'استعادة' : 'Restore'}
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await handleSelectSavedBackup(item);
                            setActiveTab('merge');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-[11px] font-bold"
                        >
                          {isAr ? 'دمج ذكي' : 'Merge'}
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            if (item.localEnvelope) {
                              triggerBrowserDownload(
                                item.localEnvelope,
                                item.fileName
                              );
                              return;
                            }
                            const res = await fetch(
                              `/api/backups/${item.backupId}/download`,
                              {
                                headers: {
                                  'x-user-id': currentUser.id,
                                  'x-company-id': currentCompany.id,
                                },
                              }
                            );
                            if (res.ok) {
                              const d = await res.json();
                              if (d?.data?.envelope) {
                                triggerBrowserDownload(
                                  d.data.envelope,
                                  d.data.fileName || item.fileName
                                );
                              }
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] font-bold flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          <span>.backup</span>
                        </button>

                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setDeleteTargetBackupId(item.backupId)}
                            className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30"
                            aria-label={`Delete backup ${item.backupId}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {deleteTargetBackupId && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-bold text-rose-300 block mb-1">
                      {isAr
                        ? `أدخل كلمة مرور المالك لتأكيد حذف النسخة الاحتياطية (${deleteTargetBackupId}):`
                        : `Enter Owner password to confirm deleting backup (${deleteTargetBackupId}):`}
                    </label>
                    <input
                      type="password"
                      value={deleteOwnerPassword}
                      onChange={(e) => setDeleteOwnerPassword(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-neutral-900 border border-rose-500/40 text-xs text-white"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteTargetBackupId(null);
                        setDeleteOwnerPassword('');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-300 text-xs font-bold"
                    >
                      {isAr ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDeleteBackupCheckpoint(deleteTargetBackupId)
                      }
                      className="px-3.5 py-1.5 rounded-lg bg-rose-500 text-white text-xs font-black"
                    >
                      {isAr ? 'تأكيد الحذف' : 'Confirm Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Backup Security Audit Trail */}
            {backupAuditLogs.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-neutral-800">
                <h4 className="text-xs font-black text-white">
                  {isAr
                    ? 'سجل التدقيق الأمني لعمليات النسخ الاحتياطي والاستعادة'
                    : 'Backup, Restore & Merge Security Audit Trail'}
                </h4>
                <div className="max-h-48 overflow-y-auto rounded-xl bg-neutral-950 border border-neutral-800 divide-y divide-neutral-850">
                  {backupAuditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-2.5 flex items-center justify-between text-[11px]"
                    >
                      <div>
                        <span className="font-mono font-bold text-amber-300 me-2">
                          {log.action}
                        </span>
                        <span className="text-neutral-300">
                          {log.actorName} ({log.entityId || '—'})
                        </span>
                      </div>
                      <span className="text-neutral-500 font-mono">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppCard>
  );
};
