import { ArrowDownTrayIcon, ArrowLeftIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { kitService } from '../../services/kit';
import { resolveLocalizedText } from '../../services/skill';
import { setInstalledKits as setInstalledKitsAction, setMarketplaceKits } from '../../store/slices/kitSlice';
import type { InstalledKit, KitSkillRef, MarketplaceKit } from '../../types/kit';
import Modal from '../common/Modal';
import SearchIcon from '../icons/SearchIcon';
import KitIcon from './KitIcon';

const KitOperationType = {
  Install: 'install',
  Uninstall: 'uninstall',
} as const;

type KitOperationType = typeof KitOperationType[keyof typeof KitOperationType];

interface KitsManagerProps {
  onTryAsking?: (text: string, kitId: string) => void;
}

interface TooltipPosition {
  left: number;
  top: number;
  width: number;
}

const SKILL_TOOLTIP_WIDTH = 288;
const SKILL_TOOLTIP_MIN_WIDTH = 180;
const SKILL_TOOLTIP_VIEWPORT_MARGIN = 12;
const SKILL_TOOLTIP_GAP = 8;

const clamp = (value: number, min: number, max: number) => (
  Math.min(Math.max(value, min), Math.max(min, max))
);

const KitSkillPill: React.FC<{ skill: KitSkillRef }> = ({ skill }) => {
  const name = resolveLocalizedText(skill.name).replace(/^\//, '');
  const description = skill.description ? resolveLocalizedText(skill.description) : '';
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);

  const updateTooltipPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || !description) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipHeight = tooltipRef.current?.getBoundingClientRect().height ?? 0;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.max(SKILL_TOOLTIP_MIN_WIDTH, viewportWidth - SKILL_TOOLTIP_VIEWPORT_MARGIN * 2);
    const width = Math.min(SKILL_TOOLTIP_WIDTH, maxWidth);
    const left = clamp(
      triggerRect.left,
      SKILL_TOOLTIP_VIEWPORT_MARGIN,
      viewportWidth - width - SKILL_TOOLTIP_VIEWPORT_MARGIN,
    );
    const hasRoomAbove = triggerRect.top >= tooltipHeight + SKILL_TOOLTIP_GAP + SKILL_TOOLTIP_VIEWPORT_MARGIN;
    const rawTop = hasRoomAbove
      ? triggerRect.top - tooltipHeight - SKILL_TOOLTIP_GAP
      : triggerRect.bottom + SKILL_TOOLTIP_GAP;
    const top = clamp(
      rawTop,
      SKILL_TOOLTIP_VIEWPORT_MARGIN,
      viewportHeight - tooltipHeight - SKILL_TOOLTIP_VIEWPORT_MARGIN,
    );

    setTooltipPosition({
      left,
      top,
      width,
    });
  }, [description]);

  useLayoutEffect(() => {
    if (!tooltipVisible || !description) return undefined;

    updateTooltipPosition();
    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);
    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
    };
  }, [description, tooltipVisible, updateTooltipPosition]);

  const showTooltip = () => {
    if (!description) return;
    setTooltipVisible(true);
  };

  const hideTooltip = () => {
    setTooltipVisible(false);
    setTooltipPosition(null);
  };

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onBlur={hideTooltip}
      onFocus={showTooltip}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      <span
        className="inline-flex items-center rounded-lg border border-border bg-surface-raised px-2.5 py-1 text-xs font-medium text-secondary"
      >
        {name}
      </span>
      {description && tooltipVisible && (
        <span
          ref={tooltipRef}
          className="pointer-events-none fixed z-50 rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs font-normal leading-5 text-foreground shadow-card"
          style={{
            left: tooltipPosition?.left ?? 0,
            top: tooltipPosition?.top ?? 0,
            visibility: tooltipPosition ? 'visible' : 'hidden',
            width: tooltipPosition?.width ?? SKILL_TOOLTIP_WIDTH,
          }}
        >
          {description}
        </span>
      )}
    </span>
  );
};

const KitsManager: React.FC<KitsManagerProps> = ({ onTryAsking }) => {
  const dispatch = useDispatch();
  const [kits, setKits] = useState<MarketplaceKit[]>([]);
  const [installedKits, setInstalledKits] = useState<Record<string, InstalledKit>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKit, setSelectedKit] = useState<MarketplaceKit | null>(null);
  const [operatingKitId, setOperatingKitId] = useState<string | null>(null);
  const [operationType, setOperationType] = useState<KitOperationType | null>(null);
  const [installPrompt, setInstallPrompt] = useState<{ kitId: string; text: string } | null>(null);
  const [kitPendingUninstall, setKitPendingUninstall] = useState<MarketplaceKit | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [marketKits, installed] = await Promise.all([
      kitService.fetchMarketplaceKits(),
      kitService.getInstalledKits(),
    ]);
    setKits(marketKits);
    setInstalledKits(installed);
    dispatch(setMarketplaceKits(marketKits));
    dispatch(setInstalledKitsAction(installed));
    setIsLoading(false);
  }, [dispatch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredKits = useMemo(() => {
    let results = kits;
    // Search filtering
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      results = results.filter((kit) => {
        const name = resolveLocalizedText(kit.name).toLowerCase();
        const desc = resolveLocalizedText(kit.description).toLowerCase();
        return name.includes(q) || desc.includes(q);
      });
    }
    return results;
  }, [kits, searchQuery]);

  const handleInstall = async (kit: MarketplaceKit) => {
    setOperatingKitId(kit.id);
    setOperationType(KitOperationType.Install);
    try {
      const result = await kitService.installKit(kit);
      if (result.success) {
        const installed = await kitService.getInstalledKits();
        setInstalledKits(installed);
        dispatch(setInstalledKitsAction(installed));
      } else {
        console.error('[KitsManager] Install failed:', result.error);
      }
    } finally {
      setOperatingKitId(null);
      setOperationType(null);
    }
  };

  const handleRequestUninstall = (kit: MarketplaceKit) => {
    setKitPendingUninstall(kit);
  };

  const handleCancelUninstall = () => {
    if (operationType === KitOperationType.Uninstall) return;
    setKitPendingUninstall(null);
  };

  const handleUninstall = async (kitId: string) => {
    setOperatingKitId(kitId);
    setOperationType(KitOperationType.Uninstall);
    try {
      const result = await kitService.uninstallKit(kitId);
      if (result.success) {
        const installed = await kitService.getInstalledKits();
        setInstalledKits(installed);
        dispatch(setInstalledKitsAction(installed));
      } else {
        console.error('[KitsManager] Uninstall failed:', result.error);
      }
    } finally {
      setOperatingKitId(null);
      setOperationType(null);
      setKitPendingUninstall(null);
    }
  };

  const handleConfirmUninstall = async () => {
    if (!kitPendingUninstall || operationType === KitOperationType.Uninstall) return;
    await handleUninstall(kitPendingUninstall.id);
  };

  const isKitInstalled = (kitId: string) => !!installedKits[kitId];
  const isOperating = (kitId: string) => operatingKitId === kitId;
  const getSkillCount = (kit: MarketplaceKit) => kit.skills?.list.length ?? 0;

  const handleTryAskingClick = (text: string, kitId: string) => {
    if (isKitInstalled(kitId)) {
      onTryAsking?.(text, kitId);
    } else {
      setInstallPrompt({ kitId, text });
    }
  };

  const handleInstallAndTry = async () => {
    if (!installPrompt || !selectedKit) return;
    const { kitId, text } = installPrompt;
    setInstallPrompt(null);
    await handleInstall(selectedKit);
    // After install, check if it succeeded and navigate
    const installed = await kitService.getInstalledKits();
    if (installed[kitId]) {
      onTryAsking?.(text, kitId);
    }
  };

  const uninstallConfirmModal = kitPendingUninstall ? (
    <Modal
      onClose={handleCancelUninstall}
      overlayClassName="fixed inset-0 z-[9999] flex items-center justify-center modal-backdrop px-4"
      className="modal-content w-full max-w-sm rounded-2xl border border-border bg-surface shadow-modal p-5"
    >
      <div className="text-lg font-semibold text-foreground">
        {i18nService.t('kitUninstall')}
      </div>
      <p className="mt-2 text-sm text-secondary">
        {i18nService.t('kitUninstallConfirm').replace(
          '{name}',
          resolveLocalizedText(kitPendingUninstall.name),
        )}
      </p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleCancelUninstall}
          disabled={operationType === KitOperationType.Uninstall}
          className="px-3 py-1.5 text-xs rounded-lg border border-border text-secondary hover:bg-surface-raised transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {i18nService.t('cancel')}
        </button>
        <button
          type="button"
          onClick={handleConfirmUninstall}
          disabled={operationType === KitOperationType.Uninstall}
          className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {i18nService.t('confirmDelete')}
        </button>
      </div>
    </Modal>
  ) : null;

  // Detail view
  if (selectedKit) {
    const installed = isKitInstalled(selectedKit.id);
    const operating = isOperating(selectedKit.id);

    return (
      <div className="space-y-6">
        {/* Back button */}
        <button
          type="button"
          onClick={() => setSelectedKit(null)}
          className="non-draggable relative z-30 inline-flex items-center gap-1.5 text-sm text-secondary hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {i18nService.t('kitBack')}
        </button>

        {/* Kit header */}
        <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <KitIcon icon={selectedKit.icon} className="h-20 w-20" />
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-foreground">{resolveLocalizedText(selectedKit.name)}</h2>
                <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-secondary">
                  {resolveLocalizedText(selectedKit.description)}
                </p>
                <div className="mt-3 flex items-center gap-1.5 text-[10px] text-secondary">
                  {selectedKit.author && (
                    <>
                      <span className="rounded-md bg-primary-muted px-1.5 py-0.5 font-medium text-primary">
                        {i18nService.t('kitOfficial')}
                      </span>
                      <span className="text-secondary/50">·</span>
                    </>
                  )}
                  {selectedKit.version && (
                    <>
                      <span className="rounded-md bg-surface-raised px-1.5 py-0.5 font-medium">
                        v{selectedKit.version}
                      </span>
                      <span className="text-secondary/50">·</span>
                    </>
                  )}
                  {getSkillCount(selectedKit) > 0 && (
                    <span>{i18nService.t('kitSkillCount').replace('{count}', String(getSkillCount(selectedKit)))}</span>
                  )}
                </div>
              </div>
            </div>
            {installed ? (
              <button
                type="button"
                disabled={operating}
                onClick={() => handleRequestUninstall(selectedKit)}
                className="rounded-lg p-2 text-secondary transition-colors hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={operating}
                onClick={() => handleInstall(selectedKit)}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                <ArrowDownTrayIcon className="h-3 w-3" />
                {operating && operationType === KitOperationType.Install
                  ? i18nService.t('kitInstalling')
                  : i18nService.t('kitInstall')}
              </button>
            )}
          </div>
        </div>

        {/* Try asking */}
        {selectedKit.tryAsking && selectedKit.tryAsking.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">
              {i18nService.t('kitTryAsking')}
            </h3>
            <div className="space-y-2">
              {selectedKit.tryAsking.map((prompt, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-surface hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => handleTryAskingClick(resolveLocalizedText(prompt), selectedKit.id)}
                >
                  <span className="text-sm text-foreground">{resolveLocalizedText(prompt)}</span>
                  <ArrowLeftIcon className="h-3.5 w-3.5 text-secondary rotate-180 flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skills list */}
        {selectedKit.skills && selectedKit.skills.list.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">
              {i18nService.t('kitSkills')} {selectedKit.skills.list.length}
            </h3>
            <div className="flex flex-wrap gap-2">
              {selectedKit.skills.list.map((skill) => (
                <KitSkillPill key={skill.id} skill={skill} />
              ))}
            </div>
          </div>
        )}

        {/* Install confirmation dialog */}
        {installPrompt && (
          <Modal
            onClose={() => setInstallPrompt(null)}
            overlayClassName="fixed inset-0 z-[9999] flex items-center justify-center modal-backdrop px-4"
            className="modal-content w-full max-w-sm rounded-2xl border border-border bg-surface shadow-modal overflow-hidden"
          >
            <div className="px-5 py-4">
              <h2 className="text-base font-semibold text-foreground">
                {i18nService.t('kitInstallRequired')}
              </h2>
              <p className="mt-1.5 text-sm leading-5 text-secondary">
                {i18nService.t('kitInstallRequiredDesc')}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={() => setInstallPrompt(null)}
                className="px-4 py-2 text-sm font-medium rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleInstallAndTry}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors"
              >
                {i18nService.t('kitInstall')}
              </button>
            </div>
          </Modal>
        )}

        {uninstallConfirmModal}
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold text-foreground">
          {i18nService.t('kits')}
        </h1>
        <p className="text-[13px] text-secondary">
          {i18nService.t('kitDescription')}
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={i18nService.t('kitSearchPlaceholder')}
          className="h-10 w-full rounded-lg border border-border bg-surface px-3.5 pl-10 text-[13px] text-foreground transition-colors placeholder:text-secondary/75 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-secondary transition-colors hover:text-foreground"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Market section */}
      <div className="flex items-center border-b border-border">
        <h2 className="relative px-2.5 pb-2.5 pt-0.5 text-[13px] font-semibold text-foreground">
          {i18nService.t('kitMarketplace')}
          <div className="absolute bottom-[-1px] left-0 right-0 h-0.5 rounded-full bg-primary" />
        </h2>
      </div>

      {/* Kit grid */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-secondary">
          {i18nService.t('kitLoading')}
        </div>
      ) : filteredKits.length === 0 ? (
        <div className="text-center py-12 text-sm text-secondary">
          {i18nService.t('kitEmpty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filteredKits.map((kit) => {
            const installed = isKitInstalled(kit.id);
            const operating = isOperating(kit.id);
            const skillCount = getSkillCount(kit);

            return (
              <div
                key={kit.id}
                className="group relative min-h-[116px] cursor-pointer rounded-xl border border-border bg-surface p-4 shadow-subtle transition-all hover:border-primary/50 hover:shadow-card"
                onClick={() => setSelectedKit(kit)}
              >
                <div className="flex gap-3.5">
                  <KitIcon icon={kit.icon} className="h-16 w-16" />

                  <div className="min-w-0 flex-1 pr-20">
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {resolveLocalizedText(kit.name)}
                    </h3>
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-[18px] text-secondary">
                      {resolveLocalizedText(kit.description)}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-secondary">
                      {kit.author && (
                        <>
                          <span className="rounded-md bg-primary-muted px-1.5 py-0.5 font-medium text-primary">
                            {i18nService.t('kitOfficial')}
                          </span>
                          <span className="text-secondary/50">·</span>
                        </>
                      )}
                      {kit.version && (
                        <>
                          <span className="rounded-md bg-surface-raised px-1.5 py-0.5 font-medium">
                            v{kit.version}
                          </span>
                          <span className="text-secondary/50">·</span>
                        </>
                      )}
                      {skillCount > 0 && (
                        <span>{i18nService.t('kitSkillCount').replace('{count}', String(skillCount))}</span>
                      )}
                    </div>
                  </div>

                  {installed ? (
                    <button
                      type="button"
                      disabled={operating}
                      onClick={(e) => { e.stopPropagation(); handleRequestUninstall(kit); }}
                      className="absolute right-4 top-4 rounded-lg p-1.5 text-secondary transition-colors hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={operating}
                      onClick={(e) => { e.stopPropagation(); handleInstall(kit); }}
                      className="absolute right-4 top-4 inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
                    >
                      <ArrowDownTrayIcon className="h-3 w-3" />
                      {operating && operationType === KitOperationType.Install
                        ? i18nService.t('kitInstalling')
                        : i18nService.t('kitInstall')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {uninstallConfirmModal}
    </div>
  );
};

export default KitsManager;
