import { XMarkIcon } from '@heroicons/react/24/outline';
import type { Platform } from '@shared/platform';
import { PlatformRegistry } from '@shared/platform';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { i18nService } from '../../services/i18n';
import { imService } from '../../services/im';
import type { RootState } from '../../store';
import type { Model } from '../../store/slices/modelSlice';
import type { DingTalkInstanceConfig, DiscordInstanceConfig, FeishuInstanceConfig, IMGatewayConfig, PopoInstanceConfig, QQInstanceConfig, WecomInstanceConfig } from '../../types/im';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import { getVisibleIMPlatforms } from '../../utils/regionFilter';
import Modal from '../common/Modal';
import AgentConfirmDialog from './AgentConfirmDialog';
import AgentDetailToolbar from './AgentDetailToolbar';
import AgentSkillSelector from './AgentSkillSelector';
import { AgentConfirmDialogVariant, AgentDetailTab } from './constants';
import EmojiPicker from './EmojiPicker';

type MultiInstancePlatform = 'dingtalk' | 'feishu' | 'qq' | 'wecom' | 'discord' | 'popo';
type MultiInstanceConfig = DingTalkInstanceConfig | FeishuInstanceConfig | QQInstanceConfig | WecomInstanceConfig | DiscordInstanceConfig | PopoInstanceConfig;

const MULTI_INSTANCE_PLATFORMS: MultiInstancePlatform[] = ['dingtalk', 'feishu', 'qq', 'wecom', 'discord', 'popo'];

const isMultiInstancePlatform = (platform: Platform): platform is MultiInstancePlatform =>
  MULTI_INSTANCE_PLATFORMS.includes(platform as MultiInstancePlatform);

interface AgentCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AgentCreateModal: React.FC<AgentCreateModalProps> = ({ isOpen, onClose }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [identity, setIdentity] = useState('');
  const [icon, setIcon] = useState('');
  const [model, setModel] = useState<Model | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<AgentDetailTab>(AgentDetailTab.Prompt);
  const globalSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const coworkConfig = useSelector((state: RootState) => state.cowork.config);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const initialWorkingDirectoryRef = useRef('');
  const initialModelRef = useRef('');
  const initializedOpenRef = useRef(false);

  // IM binding state — keys are 'telegram' (single) or 'dingtalk:<instanceId>' (multi)
  const [imConfig, setImConfig] = useState<IMGatewayConfig | null>(null);
  const [boundKeys, setBoundKeys] = useState<Set<string>>(new Set());

  const isDirty = useCallback((): boolean => {
    return !!(
      name
      || description
      || systemPrompt
      || identity
      || icon
      || (model ? toOpenClawModelRef(model) : '') !== initialModelRef.current
      || workingDirectory !== initialWorkingDirectoryRef.current
      || skillIds.length > 0
      || boundKeys.size > 0
    );
  }, [name, description, systemPrompt, identity, icon, model, workingDirectory, skillIds, boundKeys]);

  useEffect(() => {
    if (!isOpen) {
      initializedOpenRef.current = false;
      return;
    }
    if (initializedOpenRef.current) return;
    initializedOpenRef.current = true;
    setName('');
    setDescription('');
    setSystemPrompt('');
    setIdentity('');
    setIcon('');
    const currentAgent = agents.find((agent) => agent.id === currentAgentId);
    const defaultWorkingDirectory = currentAgent?.workingDirectory?.trim() || coworkConfig.workingDirectory || '';
    initialWorkingDirectoryRef.current = defaultWorkingDirectory;
    initialModelRef.current = globalSelectedModel ? toOpenClawModelRef(globalSelectedModel) : '';
    setModel(globalSelectedModel ?? null);
    setWorkingDirectory(defaultWorkingDirectory);
    setSkillIds([]);
    setActiveTab(AgentDetailTab.Prompt);
    setShowUnsavedConfirm(false);
    setBoundKeys(new Set());
    imService.loadConfig().then((cfg) => {
      if (cfg) setImConfig(cfg);
    });
  }, [agents, coworkConfig.workingDirectory, currentAgentId, globalSelectedModel, isOpen]);

  useEffect(() => {
    if (!isOpen || model || !globalSelectedModel) return;
    if (!initialModelRef.current) {
      initialModelRef.current = toOpenClawModelRef(globalSelectedModel);
    }
    setModel(globalSelectedModel);
  }, [globalSelectedModel, isOpen, model]);

  if (!isOpen) return null;

  const resetForm = () => {
    setName('');
    setDescription('');
    setSystemPrompt('');
    setIdentity('');
    setIcon('');
    setModel(null);
    setWorkingDirectory('');
    setSkillIds([]);
    setActiveTab(AgentDetailTab.Prompt);
    setBoundKeys(new Set());
  };

  const handleClose = () => {
    if (isDirty()) {
      setShowUnsavedConfirm(true);
    } else {
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    setShowUnsavedConfirm(false);
    onClose();
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const agent = await agentService.createAgent({
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        identity: identity.trim(),
        model: model ? toOpenClawModelRef(model) : '',
        workingDirectory: workingDirectory.trim(),
        icon: icon.trim() || undefined,
        skillIds,
      });
      if (agent) {
        // Save IM bindings after agent is created
        if (boundKeys.size > 0 && imConfig) {
          const currentBindings = { ...(imConfig.settings?.platformAgentBindings || {}) };
          for (const key of boundKeys) {
            currentBindings[key] = agent.id;
          }
          await imService.persistConfig({
            settings: { ...imConfig.settings, platformAgentBindings: currentBindings },
          });
          await imService.saveAndSyncConfig();
        }
        agentService.switchAgent(agent.id);
        onClose();
        resetForm();
      } else {
        window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentCreateFailed') }));
      }
    } catch {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentCreateFailed') }));
    } finally {
      setCreating(false);
    }
  };

  const handleToggleIMBinding = (key: string) => {
    const next = new Set(boundKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setBoundKeys(next);
  };

  /** Get enabled instances for a multi-instance platform (doesn't require live connection) */
  const getEnabledInstances = (platform: MultiInstancePlatform) => {
    if (!imConfig) return [];
    const cfg = imConfig[platform];
    const instances = cfg?.instances;
    if (!Array.isArray(instances)) return [];
    return instances.filter((inst: MultiInstanceConfig) => inst.enabled);
  };

  const isPlatformConfigured = (platform: Platform): boolean => {
    if (!imConfig) return false;
    if (isMultiInstancePlatform(platform)) {
      return getEnabledInstances(platform).length > 0;
    }
    return 'enabled' in imConfig[platform] && imConfig[platform].enabled === true;
  };

  /** Resolve agent name by id */
  const getAgentName = (aid: string): string | null => {
    if (!aid || aid === 'main') return null;
    const agent = agents.find((a) => a.id === aid);
    return agent?.name || aid;
  };

  const tabs: { key: AgentDetailTab; label: string }[] = [
    { key: AgentDetailTab.Prompt, label: i18nService.t('agentTabPrompt') },
    { key: AgentDetailTab.Identity, label: i18nService.t('agentIdentity') },
    { key: AgentDetailTab.Skills, label: i18nService.t('agentTabSkills') },
    { key: AgentDetailTab.Im, label: i18nService.t('agentTabIM') },
  ];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/10 dark:bg-black/50"
        className="w-[calc(100vw-56px)] max-w-[854px] h-[82vh] max-h-[664px] rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.16)] bg-surface border border-border/80 flex flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-7 py-5">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <EmojiPicker value={icon} onChange={setIcon} />
            <div className="min-w-0 flex-1 pt-0.5">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={i18nService.t('agentNamePlaceholder')}
                aria-label={i18nService.t('agentName')}
                className="w-full bg-transparent text-lg font-semibold leading-6 text-foreground placeholder:text-secondary/40 focus:outline-none"
                autoFocus
              />
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={i18nService.t('agentDescriptionPlaceholder')}
                aria-label={i18nService.t('agentDescription')}
                className="mt-0.5 w-full bg-transparent text-sm leading-5 text-secondary placeholder:text-secondary/50 focus:outline-none"
              />
            </div>
          </div>
          <button type="button" onClick={handleClose} className="mt-1 p-2 rounded-lg hover:bg-surface-raised transition-colors">
            <XMarkIcon className="h-5 w-5 text-secondary" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 border-b border-border px-7">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === tab.key
                  ? 'text-foreground'
                  : 'text-secondary hover:text-foreground'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-foreground rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="px-7 py-7 overflow-hidden flex-1 min-h-0">
          {activeTab === AgentDetailTab.Prompt && (
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={i18nService.t('agentSystemPromptPlaceholder')}
              aria-label={i18nService.t('systemPrompt')}
              className="h-full min-h-0 w-full resize-none border border-transparent bg-transparent text-sm leading-6 text-foreground placeholder:text-secondary/45 focus:outline-none"
            />
          )}

          {activeTab === AgentDetailTab.Identity && (
            <textarea
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              placeholder={i18nService.t('agentIdentityPlaceholder')}
              aria-label={i18nService.t('agentIdentity')}
              className="h-full min-h-0 w-full resize-none border border-transparent bg-transparent text-sm leading-6 text-foreground placeholder:text-secondary/45 focus:outline-none"
            />
          )}

          {activeTab === AgentDetailTab.Skills && (
            <AgentSkillSelector selectedSkillIds={skillIds} onChange={setSkillIds} />
          )}

          {activeTab === AgentDetailTab.Im && (
            <div className="h-full overflow-y-auto">
              <div className="space-y-1">
                {PlatformRegistry.platforms
                  .filter((platform) => (getVisibleIMPlatforms(i18nService.getLanguage()) as readonly string[]).includes(platform))
                  .map((platform) => {
                    const logo = PlatformRegistry.logo(platform);

                    if (isMultiInstancePlatform(platform)) {
                      const enabledInstances = getEnabledInstances(platform);

                      if (enabledInstances.length === 0) {
                        return (
                          <div
                            key={platform}
                            className="flex items-center justify-between px-3 py-2.5 rounded-lg opacity-50"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center">
                                <img src={logo} alt={i18nService.t(platform)} className="w-6 h-6 object-contain rounded" />
                              </div>
                              <div>
                                <div className="text-sm font-medium text-foreground">
                                  {i18nService.t(platform)}
                                </div>
                                <div className="text-xs text-secondary/50">
                                  {i18nService.t('agentIMNotConfiguredHint') || 'Please configure in Settings > IM Bots first'}
                                </div>
                              </div>
                            </div>
                            <span className="text-xs text-secondary/50">
                              {i18nService.t('agentIMNotConfigured') || 'Not configured'}
                            </span>
                          </div>
                        );
                      }

                      return (
                        <div key={platform} className="rounded-lg border border-border overflow-hidden">
                          <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-raised">
                            <div className="flex h-8 w-8 items-center justify-center">
                              <img src={logo} alt={i18nService.t(platform)} className="w-6 h-6 object-contain rounded" />
                            </div>
                            <span className="text-sm font-semibold text-foreground">
                              {i18nService.t(platform)}
                            </span>
                          </div>
                          {enabledInstances.map((inst: MultiInstanceConfig, idx: number) => {
                            const bindingKey = `${platform}:${inst.instanceId}`;
                            const isBound = boundKeys.has(bindingKey);
                            const bindings = imConfig?.settings?.platformAgentBindings || {};
                            const otherAgentId = bindings[bindingKey];
                            const boundToOther = !!otherAgentId;
                            const otherAgentName = boundToOther ? getAgentName(otherAgentId) : null;
                            return (
                              <div
                                key={inst.instanceId}
                                className={`flex items-center justify-between px-3 py-2 pl-14 transition-colors cursor-pointer hover:bg-surface-raised ${
                                  idx < enabledInstances.length - 1 ? 'border-b border-border-subtle' : ''
                                } ${boundToOther ? 'opacity-55' : ''}`}
                                onClick={() => !boundToOther && handleToggleIMBinding(bindingKey)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                                  <span className="text-sm text-foreground">
                                    {inst.instanceName}
                                  </span>
                                  {boundToOther && otherAgentName && (
                                    <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                      {(i18nService.t('agentIMBoundToOther') || '→ {agent}').replace('{agent}', otherAgentName)}
                                    </span>
                                  )}
                                </div>
                                {boundToOther ? (
                                  <div className="w-9 h-5" />
                                ) : (
                                  <div
                                    className={`relative w-9 h-5 rounded-full transition-colors ${
                                      isBound ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                                    }`}
                                  >
                                    <div
                                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                                        isBound ? 'translate-x-4' : 'translate-x-0.5'
                                      }`}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    // Single-instance platform
                    const configured = isPlatformConfigured(platform);
                    const bound = boundKeys.has(platform);
                    const bindings = imConfig?.settings?.platformAgentBindings || {};
                    const otherAgentId = bindings[platform];
                    const boundToOther = configured && !!otherAgentId;
                    const otherAgentName = boundToOther ? getAgentName(otherAgentId) : null;
                    return (
                      <div
                        key={platform}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${
                          configured && !boundToOther
                            ? 'hover:bg-surface-raised cursor-pointer'
                            : boundToOther ? 'opacity-55' : 'opacity-50'
                        }`}
                        onClick={() => configured && !boundToOther && handleToggleIMBinding(platform)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center">
                            <img src={logo} alt={i18nService.t(platform)} className="w-6 h-6 object-contain rounded" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-foreground">
                              {i18nService.t(platform)}
                            </div>
                            {!configured && (
                              <div className="text-xs text-secondary/50">
                                {i18nService.t('agentIMNotConfiguredHint') || 'Please configure in Settings > IM Bots first'}
                              </div>
                            )}
                          </div>
                          {boundToOther && otherAgentName && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                              {(i18nService.t('agentIMBoundToOther') || '→ {agent}').replace('{agent}', otherAgentName)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {configured ? (
                            boundToOther ? <div className="w-9 h-5" /> : (
                              <div
                                className={`relative w-9 h-5 rounded-full transition-colors ${
                                  bound ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                              >
                                <div
                                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                                    bound ? 'translate-x-4' : 'translate-x-0.5'
                                  }`}
                                />
                              </div>
                            )
                          ) : (
                            <span className="text-xs text-secondary/50">
                              {i18nService.t('agentIMNotConfigured') || 'Not configured'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-border">
          <AgentDetailToolbar
            model={model}
            onModelChange={setModel}
            workingDirectory={workingDirectory}
            onWorkingDirectoryChange={setWorkingDirectory}
          />
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={!name.trim() || creating}
              className="h-9 px-5 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? i18nService.t('creating') : i18nService.t('create')}
            </button>
          </div>
        </div>
      </Modal>

      {showUnsavedConfirm && (
        <AgentConfirmDialog
          variant={AgentConfirmDialogVariant.Unsaved}
          title={i18nService.t('agentUnsavedTitle')}
          message={i18nService.t('agentUnsavedMessage')}
          cancelLabel={i18nService.t('agentUnsavedStay')}
          confirmLabel={i18nService.t('agentUnsavedDiscard')}
          onCancel={() => setShowUnsavedConfirm(false)}
          onConfirm={handleConfirmDiscard}
        />
      )}
    </>
  );
};

export default AgentCreateModal;
