import { ChatBubbleLeftIcon, CpuChipIcon, CubeIcon, EnvelopeIcon, GlobeAltIcon, InformationCircleIcon, SunIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useCallback,useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { type AppUpdateInfo,type AppUpdateRuntimeState,AppUpdateSource,AppUpdateStatus } from '../../shared/appUpdate/constants';
import {
  type BrowserWebAccessConfig,
  defaultBrowserWebAccessConfig,
  normalizeBrowserWebAccessConfig,
} from '../../shared/browserWebAccess/constants';
import { ProviderAuthType, ProviderName, ProviderRegistry, resolveCodingPlanBaseUrl } from '../../shared/providers';
import { type AppConfig, defaultConfig, getProviderDisplayName, getVisibleProviders } from '../config';
import { APP_ID, EXPORT_FORMAT_TYPE, EXPORT_PASSWORD } from '../constants/app';
import { apiService } from '../services/api';
import { configService } from '../services/config';
import { coworkService } from '../services/cowork';
import { decryptSecret, decryptWithPassword, EncryptedPayload, encryptWithPassword, PasswordEncryptedPayload } from '../services/encryption';
import { i18nService, LanguageType } from '../services/i18n';
import { imService } from '../services/im';
import { themeService } from '../services/theme';
import type { RootState } from '../store';
import { selectCoworkConfig } from '../store/selectors/coworkSelectors';
import { setAvailableModels } from '../store/slices/modelSlice';
import type {
  CoworkAgentEngine,
  CoworkMemoryStats,
  CoworkUserMemoryEntry,
  OpenClawEngineStatus,
  OpenClawSessionKeepAlive,
} from '../types/cowork';
import { OpenClawSessionKeepAlive as OpenClawSessionKeepAliveValues } from '../types/cowork';
import Modal from './common/Modal';
import DreamingSettingsSection from './cowork/DreamingSettingsSection';
import EmbeddingSettingsSection from './cowork/EmbeddingSettingsSection';
import ErrorMessage from './ErrorMessage';
import BrainIcon from './icons/BrainIcon';
import PlugIcon from './icons/PlugIcon';
import PlusCircleIcon from './icons/PlusCircleIcon';
import IMSettings from './im/IMSettings';
import PluginsSettings, { type PluginsSettingsHandle } from './plugins/PluginsSettings';
import BrowserWebAccessSettings from './settings/BrowserWebAccessSettings';
import {
  buildOpenAICompatibleChatCompletionsUrl,
  buildOpenAIResponsesUrl,
  CONNECTIVITY_TEST_TOKEN_BUDGET,
  CUSTOM_PROVIDER_KEYS,
  getDefaultActiveProvider,
  getDefaultProviders,
  getEffectiveApiFormat,
  getOpenClawProviderIdForConfig,
  getProviderDefaultBaseUrl,
  hasProviderAuthConfigured,
  type Model,
  type ProviderConfig,
  providerKeys,
  providerRequiresApiKey,
  type ProvidersConfig,
  type ProviderType,
  resolveBaseUrl,
  resolveModelSupportsImageForProvider,
  shouldAutoSwitchProviderBaseUrl,
  shouldUseMaxCompletionTokensForOpenAI,
  shouldUseOpenAIResponsesForProvider,
} from './settings/modelProviderUtils';
import ModelSettingsSection, { ModelEditorDialog } from './settings/ModelSettingsSection';
import EmailSkillConfig from './skills/EmailSkillConfig';
import ThemedSelect from './ui/ThemedSelect';

type TabType = 'general' | 'appearance' | 'coworkAgentEngine' | 'model' | 'browserWebAccess' | 'coworkMemory' | 'coworkDreaming' | 'shortcuts' | 'im' | 'email' | 'plugins' | 'about';

const SettingsSlidersIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M14 17H5" />
    <path d="M19 7h-9" />
    <circle cx="17" cy="17" r="3" />
    <circle cx="7" cy="7" r="3" />
  </svg>
);

const DreamingTabIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    width="34"
    height="34"
    viewBox="0 0 34 34"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M27.9219 21.9648L29.014 22.4621L29.8552 20.6145L27.831 20.7683L27.9219 21.9648ZM16.0762 5.03516L17.1683 5.53234L18.0095 3.68449L15.9851 3.83862L16.0762 5.03516ZM27.9219 21.9648L26.8297 21.4676C25.1281 25.205 21.3674 27.8 17 27.8V29V30.2C22.3442 30.2 26.9378 27.0221 29.014 22.4621L27.9219 21.9648ZM17 29V27.8C11.0353 27.8 6.2 22.9647 6.2 17H5H3.8C3.8 24.2902 9.70984 30.2 17 30.2V29ZM5 17H6.2C6.2 11.3157 10.5923 6.65614 16.1673 6.23169L16.0762 5.03516L15.9851 3.83862C9.16855 4.35759 3.8 10.0512 3.8 17H5ZM16.0762 5.03516L14.984 4.53798C14.2262 6.20275 13.8 8.052 13.8 10H15H16.2C16.2 8.40537 16.5483 6.8944 17.1683 5.53234L16.0762 5.03516ZM15 10H13.8C13.8 17.2902 19.7098 23.2 27 23.2V22V20.8C21.0353 20.8 16.2 15.9647 16.2 10H15ZM27 22V23.2C27.3413 23.2 27.679 23.1868 28.0128 23.1614L27.9219 21.9648L27.831 20.7683C27.5562 20.7892 27.2791 20.8 27 20.8V22Z"
      fill="currentColor"
    />
  </svg>
);

export type SettingsOpenOptions = {
  initialTab?: TabType;
  notice?: string;
  noticeI18nKey?: string;
  noticeExtra?: string;
};

interface SettingsProps extends SettingsOpenOptions {
  onClose: () => void;
  onUpdateFound?: (info: AppUpdateInfo) => void;
  enterpriseConfig?: {
    ui?: Record<string, 'hide' | 'disable' | 'readonly'>;
    disableUpdate?: boolean;
  } | null;
}


type ProviderConnectionTestResult = {
  success: boolean;
  message: string;
  provider: ProviderType;
};

interface ProviderExportEntry {
  enabled: boolean;
  apiKey: PasswordEncryptedPayload;
  baseUrl: string;
  apiFormat?: 'anthropic' | 'openai' | 'gemini';
  codingPlanEnabled?: boolean;
  models?: Model[];
}

interface ProvidersExportPayload {
  type: typeof EXPORT_FORMAT_TYPE;
  version: 2;
  exportedAt: string;
  encryption: {
    algorithm: 'AES-GCM';
    keySource: 'password';
    keyDerivation: 'PBKDF2';
  };
  providers: Record<string, ProviderExportEntry>;
}

interface ProvidersImportEntry {
  enabled?: boolean;
  apiKey?: EncryptedPayload | PasswordEncryptedPayload | string;
  apiKeyEncrypted?: string;
  apiKeyIv?: string;
  baseUrl?: string;
  apiFormat?: 'anthropic' | 'openai' | 'native';
  codingPlanEnabled?: boolean;
  models?: Model[];
}

interface ProvidersImportPayload {
  type?: string;
  version?: number;
  encryption?: {
    algorithm?: string;
    keySource?: string;
    keyDerivation?: string;
  };
  providers?: Record<string, ProvidersImportEntry>;
}

const ABOUT_CONTACT_EMAIL = 'lobsterai.project@rd.netease.com';
const ABOUT_USER_MANUAL_URL = 'https://lobsterai.youdao.com/#/docs/lobsterai_user_manual';
const ABOUT_USER_COMMUNITY_URL = 'https://lobsterai.youdao.com/#/about';
const ABOUT_SERVICE_TERMS_URL = 'https://c.youdao.com/dict/hardware/lobsterai/lobsterai_service.html';

// MiniMax Portal OAuth constants
const MINIMAX_OAUTH_CLIENT_ID = '78257093-7e40-4613-99e0-527b14b39113';
const MINIMAX_OAUTH_SCOPE = 'group_id profile model.completion';
const MINIMAX_OAUTH_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:user_code';
const MINIMAX_BASE_URL_CN = 'https://api.minimaxi.com/anthropic';
const MINIMAX_BASE_URL_GLOBAL = 'https://api.minimax.io/anthropic';
const MINIMAX_CODE_ENDPOINT_CN = 'https://api.minimaxi.com/oauth/code';
const MINIMAX_CODE_ENDPOINT_GLOBAL = 'https://api.minimax.io/oauth/code';
const MINIMAX_TOKEN_ENDPOINT_CN = 'https://api.minimaxi.com/oauth/token';
const MINIMAX_TOKEN_ENDPOINT_GLOBAL = 'https://api.minimax.io/oauth/token';

type MiniMaxRegion = 'cn' | 'global';
type MiniMaxOAuthPhase =
  | { kind: 'idle' }
  | { kind: 'requesting_code' }
  | { kind: 'pending'; userCode: string; verificationUri: string }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

async function generateMiniMaxPkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifierArray = new Uint8Array(32);
  crypto.getRandomValues(verifierArray);
  const verifier = btoa(String.fromCharCode(...verifierArray))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const stateArray = new Uint8Array(16);
  crypto.getRandomValues(stateArray);
  const state = btoa(String.fromCharCode(...stateArray))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return { verifier, challenge, state };
}

const copyTextFallback = (text: string): boolean => {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (clipboardError) {
      console.warn('Navigator clipboard write failed, trying fallback:', clipboardError);
    }
  }

  try {
    return copyTextFallback(text);
  } catch (fallbackError) {
    console.error('Fallback clipboard copy failed:', fallbackError);
    return false;
  }
};

const getUpdateCheckStatusFromRuntimeStatus = (
  state: AppUpdateRuntimeState,
): 'idle' | 'checking' | 'upToDate' | 'error' | 'downloading' | 'ready' => {
  if (state.source !== AppUpdateSource.Manual) {
    return 'idle';
  }
  switch (state.status) {
    case AppUpdateStatus.Checking:
      return 'checking';
    case AppUpdateStatus.Downloading:
      return 'downloading';
    case AppUpdateStatus.Ready:
      return 'ready';
    case AppUpdateStatus.Error:
      return 'error';
    default:
      return 'idle';
  }
};

// System shortcuts that should not be captured (clipboard, undo, select-all, quit, etc.)
const isSystemShortcut = (e: KeyboardEvent): boolean => {
  const key = e.key.toLowerCase();
  if (e.metaKey && ['c', 'v', 'x', 'z', 'y', 'a', 'q', 'w'].includes(key)) return true;
  if (e.metaKey && e.shiftKey && key === 'z') return true;
  if (e.ctrlKey && ['c', 'v', 'x', 'z', 'y', 'a', 'w'].includes(key)) return true;
  return false;
};

const formatShortcutFromEvent = (e: React.KeyboardEvent): string | null => {
  // Skip standalone modifier keys
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;
  // Require at least one non-Shift modifier
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return null;
  if (isSystemShortcut(e.nativeEvent)) return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push('Cmd');
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const keyMap: Record<string, string> = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    ' ': 'Space', Escape: 'Esc', Enter: 'Enter', Backspace: 'Backspace',
    Delete: 'Delete', Tab: 'Tab',
  };
  const key = keyMap[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(key);
  return parts.join('+');
};

const SEND_SHORTCUT_OPTIONS = [
  { value: 'Enter', label: 'Enter', labelMac: 'Enter' },
  { value: 'Shift+Enter', label: 'Shift+Enter', labelMac: 'Shift+Enter' },
  { value: 'Ctrl+Enter', label: 'Ctrl+Enter', labelMac: 'Cmd+Enter' },
  { value: 'Alt+Enter', label: 'Alt+Enter', labelMac: 'Option+Enter' },
] as const;

const isMacPlatform = navigator.platform.includes('Mac');

const ShortcutRecorder: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [recording, setRecording] = useState(false);
  const divRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { setRecording(false); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { onChange(''); setRecording(false); return; }
    const shortcut = formatShortcutFromEvent(e);
    if (shortcut) { onChange(shortcut); setRecording(false); }
  };

  useEffect(() => {
    if (!recording) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (divRef.current && !divRef.current.contains(e.target as Node)) setRecording(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [recording]);

  return (
    <div
      ref={divRef}
      tabIndex={0}
      data-shortcut-input="true"
      onKeyDown={handleKeyDown}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      className={`w-36 rounded-xl border px-3 py-1.5 text-sm cursor-pointer select-none text-center outline-none transition-colors
        dark:bg-claude-darkSurfaceInset bg-claude-surfaceInset dark:text-claude-darkText text-claude-text
        ${recording
          ? 'border-claude-accent ring-1 ring-claude-accent/30 dark:text-claude-darkTextSecondary text-claude-textSecondary'
          : 'dark:border-claude-darkBorder border-claude-border hover:border-claude-accent/50'
        }`}
    >
      {value || i18nService.t('shortcutNotSet')}
    </div>
  );
};

const SendShortcutSelect: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const currentLabel = (() => {
    const opt = SEND_SHORTCUT_OPTIONS.find(o => o.value === value);
    if (!opt) return value;
    return isMacPlatform ? opt.labelMac : opt.label;
  })();

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => setOpen(!open)}
        className={`w-36 rounded-xl border px-3 py-1.5 text-sm cursor-pointer select-none text-center outline-none transition-colors
          dark:bg-claude-darkSurfaceInset bg-claude-surfaceInset dark:text-claude-darkText text-claude-text
          ${open
            ? 'border-claude-accent ring-1 ring-claude-accent/30'
            : 'dark:border-claude-darkBorder border-claude-border hover:border-claude-accent/50'
          }`}
      >
        {currentLabel}
      </div>
      {open && (
        <div className="absolute right-0 mt-1 z-50 min-w-[160px] rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurfaceInset bg-claude-surfaceInset shadow-elevated py-1">
          {SEND_SHORTCUT_OPTIONS.map((option) => {
            const label = isMacPlatform ? option.labelMac : option.label;
            const isActive = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`flex items-center justify-between w-full px-3 py-1.5 text-sm transition-colors
                  ${isActive
                    ? 'dark:text-claude-accent text-claude-accent font-medium'
                    : 'dark:text-claude-darkText text-claude-text'
                  } hover:bg-claude-accent/10`}
              >
                <span>{label}</span>
                {isActive && <span className="text-claude-accent">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const SettingsSwitch: React.FC<{
  checked: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
}> = ({ checked, label, disabled, onClick }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => {
      void onClick();
    }}
    disabled={disabled}
    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
      disabled ? 'opacity-50 cursor-not-allowed' : ''
    } ${
      checked
        ? 'bg-primary'
        : 'bg-gray-300 dark:bg-gray-600'
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const SettingsToggleRow: React.FC<{
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void | Promise<void>;
}> = ({ title, description, checked, disabled, onToggle }) => (
  <div>
    <div className="flex items-center justify-between gap-4">
      <h4 className="min-w-0 flex-1 text-sm font-medium text-foreground">
        {title}
      </h4>
      <SettingsSwitch
        checked={checked}
        label={title}
        disabled={disabled}
        onClick={onToggle}
      />
    </div>
    <p className="mt-3 text-sm text-secondary">
      {description}
    </p>
  </div>
);

const Settings: React.FC<SettingsProps> = ({ onClose, initialTab, notice, noticeI18nKey, noticeExtra, onUpdateFound, enterpriseConfig }) => {
  const dispatch = useDispatch();
  // 状态
  const [activeTab, setActiveTab] = useState<TabType>(initialTab ?? 'general');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [themeId, setThemeId] = useState<string>(themeService.getThemeId());
  const [language, setLanguage] = useState<LanguageType>('zh');
  const [autoLaunch, setAutoLaunchState] = useState(false);
  const [useSystemProxy, setUseSystemProxy] = useState(false);
  const [sqliteAutoBackupEnabled, setSqliteAutoBackupEnabled] = useState(false);
  const [browserWebAccess, setBrowserWebAccess] = useState<BrowserWebAccessConfig>(() => ({
    ...defaultBrowserWebAccessConfig,
    webFetch: { ...defaultBrowserWebAccessConfig.webFetch },
  }));
  const [isUpdatingAutoLaunch, setIsUpdatingAutoLaunch] = useState(false);
  const [preventSleep, setPreventSleepState] = useState(false);
  const [isUpdatingPreventSleep, setIsUpdatingPreventSleep] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buildNoticeMessage = useCallback((): string | null => {
    if (noticeI18nKey) {
      const base = i18nService.t(noticeI18nKey);
      return noticeExtra ? `${base} (${noticeExtra})` : base;
    }
    return notice ?? null;
  }, [notice, noticeExtra, noticeI18nKey]);

  const [noticeMessage, setNoticeMessage] = useState<string | null>(() => buildNoticeMessage());
  const [testResult, setTestResult] = useState<ProviderConnectionTestResult | null>(null);
  const [isTestResultModalOpen, setIsTestResultModalOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [pendingDeleteProvider, setPendingDeleteProvider] = useState<ProviderType | null>(null);
  const [isImportingProviders, setIsImportingProviders] = useState(false);
  const [isExportingProviders, setIsExportingProviders] = useState(false);
  const initialThemeRef = useRef<'light' | 'dark' | 'system'>(themeService.getTheme());
  const initialThemeIdRef = useRef<string>(themeService.getThemeId());
  const initialLanguageRef = useRef<LanguageType>(i18nService.getLanguage());
  const didSaveRef = useRef(false);

  // Plugin settings handle (deferred save)
  const pluginsSettingsRef = useRef<PluginsSettingsHandle>(null);

  // Add state for active provider
  const [activeProvider, setActiveProvider] = useState<ProviderType>(getDefaultActiveProvider());
  const [showApiKey, setShowApiKey] = useState(false);

  // MiniMax OAuth state
  const [minimaxOAuthPhase, setMinimaxOAuthPhase] = useState<MiniMaxOAuthPhase>({ kind: 'idle' });
  const [minimaxOAuthRegion, setMinimaxOAuthRegion] = useState<MiniMaxRegion>('cn');
  const minimaxOAuthCancelRef = useRef(false);

  // OpenAI ChatGPT (Codex) OAuth state
  type OpenAIOAuthPhase =
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'success'; email?: string }
    | { kind: 'error'; message: string };
  const [openaiOAuthPhase, setOpenaiOAuthPhase] = useState<OpenAIOAuthPhase>({ kind: 'idle' });
  // Mirrors <CODEX_HOME>/auth.json on disk; refreshed on tab focus and after
  // login/logout. `null` = not yet checked.
  const [openaiOAuthStatus, setOpenaiOAuthStatus] = useState<
    { loggedIn: false } | { loggedIn: true; email?: string } | null
  >(null);

  // Add state for providers configuration
  const [providers, setProviders] = useState<ProvidersConfig>(() => getDefaultProviders());


  // authType defaults to undefined on first open, which should behave as OAuth mode
  const minimaxIsOAuthMode = providers.minimax.authType !== 'apikey';
  // OpenAI defaults to API key mode unless the user explicitly opts in to OAuth
  const openaiIsOAuthMode = providers.openai.authType === 'oauth';
  const isBaseUrlLocked = (activeProvider === 'zhipu' && providers.zhipu.codingPlanEnabled) || (activeProvider === 'qwen' && providers.qwen.codingPlanEnabled) || (activeProvider === 'volcengine' && providers.volcengine.codingPlanEnabled) || (activeProvider === 'moonshot' && providers.moonshot.codingPlanEnabled) || (activeProvider === 'qianfan' && providers.qianfan.codingPlanEnabled) || (activeProvider === 'xiaomi' && providers.xiaomi.codingPlanEnabled) || (activeProvider === 'minimax' && minimaxIsOAuthMode) || (activeProvider === 'openai' && openaiIsOAuthMode);

  // 创建引用来确保内容区域的滚动
  const contentRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const emailCopiedTimerRef = useRef<number | null>(null);
  const updateCheckTimerRef = useRef<number | null>(null);

  // 快捷键设置
  const [shortcuts, setShortcuts] = useState({
    newChat: 'Ctrl+N',
    search: 'Ctrl+F',
    settings: 'Ctrl+,',
    sendMessage: defaultConfig.shortcuts!.sendMessage,
  });

  // GitHub Copilot device code auth state
  const [copilotAuthStatus, setCopilotAuthStatus] = useState<'idle' | 'requesting' | 'awaiting_user' | 'polling' | 'authenticated' | 'error'>('idle');
  const [copilotUserCode, setCopilotUserCode] = useState('');
  const [copilotVerificationUri, setCopilotVerificationUri] = useState('');
  const [copilotGithubUser, setCopilotGithubUser] = useState('');
  const [copilotError, setCopilotError] = useState<string | null>(null);

  // State for model editing
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [isEditingModel, setIsEditingModel] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [newModelName, setNewModelName] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [newModelSupportsImage, setNewModelSupportsImage] = useState(false);
  const [newModelContextWindow, setNewModelContextWindow] = useState<number | undefined>(undefined);
  const [newModelCustomParams, setNewModelCustomParams] = useState<string>('');
  const [modelFormError, setModelFormError] = useState<string | null>(null);

  // About tab
  const [appVersion, setAppVersion] = useState('');
  const [emailCopied, setEmailCopied] = useState(false);
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [logoClickCount, setLogoClickCount] = useState(0);
  const [testModeUnlocked, setTestModeUnlocked] = useState(false);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<'idle' | 'checking' | 'upToDate' | 'error' | 'downloading' | 'ready'>('idle');
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateRuntimeState | null>(null);

  useEffect(() => {
    window.electron.appInfo.getVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    setShowApiKey(false);
  }, [activeProvider]);

  useEffect(() => {
    let mounted = true;

    const syncUpdateStatus = async () => {
      try {
        const state = await window.electron.appUpdate.getState();
        if (!mounted) {
          return;
        }
        setAppUpdateState(state);
        setUpdateCheckStatus(getUpdateCheckStatusFromRuntimeStatus(state));
      } catch (error) {
        console.error('Failed to load app update state in settings:', error);
      }
    };

    void syncUpdateStatus();

    const unsubscribe = window.electron.appUpdate.onStateChanged((state) => {
      if (
        updateCheckTimerRef.current != null &&
        state.source === AppUpdateSource.Manual &&
        state.status !== AppUpdateStatus.Idle
      ) {
        window.clearTimeout(updateCheckTimerRef.current);
        updateCheckTimerRef.current = null;
      }
      setAppUpdateState(state);
      setUpdateCheckStatus(getUpdateCheckStatusFromRuntimeStatus(state));
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const handleCopyContactEmail = useCallback(async () => {
    const copied = await copyTextToClipboard(ABOUT_CONTACT_EMAIL);
    if (copied) {
      setEmailCopied(true);
      if (emailCopiedTimerRef.current != null) {
        window.clearTimeout(emailCopiedTimerRef.current);
      }
      emailCopiedTimerRef.current = window.setTimeout(() => {
        setEmailCopied(false);
        emailCopiedTimerRef.current = null;
      }, 1200);
    }
  }, []);

  const authUser = useSelector((state: RootState) => state.auth.user);

  const handleCheckUpdate = useCallback(async () => {
    if (updateCheckStatus === 'checking' || !appVersion) return;
    setUpdateCheckStatus('checking');
    try {
      const result = await window.electron.appUpdate.checkNow({ manual: true, userId: authUser?.yid });
      if (!result.success) {
        throw new Error(result.error || 'Update check failed');
      }

      if (!result.updateFound) {
        setUpdateCheckStatus('upToDate');
        if (updateCheckTimerRef.current != null) {
          window.clearTimeout(updateCheckTimerRef.current);
        }
        updateCheckTimerRef.current = window.setTimeout(() => {
          setUpdateCheckStatus('idle');
          updateCheckTimerRef.current = null;
        }, 3000);
        return;
      }

      if (result.state.status === AppUpdateStatus.Ready) {
        setUpdateCheckStatus('ready');
      } else if (result.state.status === AppUpdateStatus.Downloading) {
        setUpdateCheckStatus('downloading');
      } else {
        setUpdateCheckStatus('idle');
      }

      if (result.state.info) {
        onUpdateFound?.(result.state.info);
      }
    } catch {
      setUpdateCheckStatus('error');
      if (updateCheckTimerRef.current != null) {
        window.clearTimeout(updateCheckTimerRef.current);
      }
      updateCheckTimerRef.current = window.setTimeout(() => {
        setUpdateCheckStatus('idle');
        updateCheckTimerRef.current = null;
      }, 3000);
    }
  }, [appVersion, authUser, updateCheckStatus, onUpdateFound]);

  const updateButtonLabel = useMemo(() => {
    if (
      updateCheckStatus === 'downloading' &&
      appUpdateState?.progress?.percent != null &&
      Number.isFinite(appUpdateState.progress.percent)
    ) {
      return `${i18nService.t('updateDownloadingBackground')} ${Math.round(appUpdateState.progress.percent * 100)}%`;
    }
    if (updateCheckStatus === 'checking') return i18nService.t('updateChecking');
    if (updateCheckStatus === 'downloading') return i18nService.t('updateDownloadingBackground');
    if (updateCheckStatus === 'ready') return i18nService.t('updateReadyTitle');
    if (updateCheckStatus === 'upToDate') return i18nService.t('updateUpToDate');
    if (updateCheckStatus === 'error') return i18nService.t('updateCheckFailed');
    return i18nService.t('checkForUpdate');
  }, [appUpdateState?.progress?.percent, updateCheckStatus]);

  const handleOpenUserManual = useCallback(() => {
    void window.electron.shell.openExternal(ABOUT_USER_MANUAL_URL);
  }, []);

  const handleOpenUserCommunity = useCallback(() => {
    void window.electron.shell.openExternal(ABOUT_USER_COMMUNITY_URL);
  }, []);

  const handleOpenServiceTerms = useCallback(() => {
    void window.electron.shell.openExternal(ABOUT_SERVICE_TERMS_URL);
  }, []);

  const handleExportLogs = useCallback(async () => {
    if (isExportingLogs) {
      return;
    }

    setError(null);
    setNoticeMessage(null);
    setIsExportingLogs(true);
    try {
      const result = await window.electron.log.exportZip();
      if (!result.success) {
        setError(result.error || i18nService.t('aboutExportLogsFailed'));
        return;
      }
      if (result.canceled) {
        return;
      }

      if (result.path) {
        await window.electron.shell.showItemInFolder(result.path);
      }

      if ((result.missingEntries?.length ?? 0) > 0) {
        const missingList = result.missingEntries?.join(', ') || '';
        setNoticeMessage(`${i18nService.t('aboutExportLogsPartial')}: ${missingList}`);
      } else {
        setNoticeMessage(i18nService.t('aboutExportLogsSuccess'));
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : i18nService.t('aboutExportLogsFailed'));
    } finally {
      setIsExportingLogs(false);
    }
  }, [isExportingLogs]);

  const coworkConfig = useSelector(selectCoworkConfig);

  const [coworkAgentEngine, setCoworkAgentEngine] = useState<CoworkAgentEngine>(coworkConfig.agentEngine || 'openclaw');
  const [coworkMemoryEnabled, setCoworkMemoryEnabled] = useState<boolean>(coworkConfig.memoryEnabled ?? true);
  const [coworkMemoryLlmJudgeEnabled, setCoworkMemoryLlmJudgeEnabled] = useState<boolean>(coworkConfig.memoryLlmJudgeEnabled ?? false);
  const [skipMissedJobs, setSkipMissedJobs] = useState<boolean>(coworkConfig.skipMissedJobs ?? true);
  const [embeddingEnabled, setEmbeddingEnabled] = useState<boolean>(coworkConfig.embeddingEnabled ?? false);
  const [embeddingProvider, setEmbeddingProvider] = useState<string>(coworkConfig.embeddingProvider ?? 'openai');
  const [embeddingModel, setEmbeddingModel] = useState<string>(coworkConfig.embeddingModel ?? '');
  const [embeddingLocalModelPath, setEmbeddingLocalModelPath] = useState<string>(coworkConfig.embeddingLocalModelPath ?? '');
  const [embeddingVectorWeight, setEmbeddingVectorWeight] = useState<number>(coworkConfig.embeddingVectorWeight ?? 0.7);
  const [embeddingRemoteBaseUrl, setEmbeddingRemoteBaseUrl] = useState<string>(coworkConfig.embeddingRemoteBaseUrl ?? '');
  const [embeddingRemoteApiKey, setEmbeddingRemoteApiKey] = useState<string>(coworkConfig.embeddingRemoteApiKey ?? '');
  const [dreamingEnabled, setDreamingEnabled] = useState<boolean>(coworkConfig.dreamingEnabled ?? false);
  const [dreamingFrequency, setDreamingFrequency] = useState<string>(coworkConfig.dreamingFrequency ?? '0 3 * * *');
  const [dreamingModel, setDreamingModel] = useState<string>(coworkConfig.dreamingModel ?? '');
  const [dreamingTimezone, setDreamingTimezone] = useState<string>(coworkConfig.dreamingTimezone ?? '');
  const [memoryTab, setMemoryTab] = useState<'entries' | 'embedding'>('entries');
  const [openClawSessionKeepAlive, setOpenClawSessionKeepAlive] = useState<OpenClawSessionKeepAlive>(
    coworkConfig.openClawSessionPolicy?.keepAlive || OpenClawSessionKeepAliveValues.ThirtyDays,
  );
  const [coworkMemoryEntries, setCoworkMemoryEntries] = useState<CoworkUserMemoryEntry[]>([]);
  const [coworkMemoryStats, setCoworkMemoryStats] = useState<CoworkMemoryStats | null>(null);
  const [coworkMemoryListLoading, setCoworkMemoryListLoading] = useState<boolean>(false);
  const [coworkMemoryQuery, setCoworkMemoryQuery] = useState<string>('');
  const [coworkMemoryEditingId, setCoworkMemoryEditingId] = useState<string | null>(null);
  const [coworkMemoryDraftText, setCoworkMemoryDraftText] = useState<string>('');
  const [showMemoryModal, setShowMemoryModal] = useState<boolean>(false);
  const [openClawEngineStatus, setOpenClawEngineStatus] = useState<OpenClawEngineStatus | null>(null);

  useEffect(() => {
    setCoworkAgentEngine(coworkConfig.agentEngine || 'openclaw');
    setCoworkMemoryEnabled(coworkConfig.memoryEnabled ?? true);
    setCoworkMemoryLlmJudgeEnabled(coworkConfig.memoryLlmJudgeEnabled ?? false);
    setSkipMissedJobs(coworkConfig.skipMissedJobs ?? true);
    setEmbeddingEnabled(coworkConfig.embeddingEnabled ?? false);
    setEmbeddingProvider(coworkConfig.embeddingProvider ?? 'openai');
    setEmbeddingModel(coworkConfig.embeddingModel ?? '');
    setEmbeddingLocalModelPath(coworkConfig.embeddingLocalModelPath ?? '');
    setEmbeddingVectorWeight(coworkConfig.embeddingVectorWeight ?? 0.7);
    setEmbeddingRemoteBaseUrl(coworkConfig.embeddingRemoteBaseUrl ?? '');
    setEmbeddingRemoteApiKey(coworkConfig.embeddingRemoteApiKey ?? '');
    setDreamingEnabled(coworkConfig.dreamingEnabled ?? false);
    setDreamingFrequency(coworkConfig.dreamingFrequency ?? '0 3 * * *');
    setDreamingModel(coworkConfig.dreamingModel ?? '');
    setDreamingTimezone(coworkConfig.dreamingTimezone ?? '');
    setOpenClawSessionKeepAlive(coworkConfig.openClawSessionPolicy?.keepAlive || OpenClawSessionKeepAliveValues.ThirtyDays);
  }, [
    coworkConfig.agentEngine,
    coworkConfig.memoryEnabled,
    coworkConfig.memoryLlmJudgeEnabled,
    coworkConfig.openClawSessionPolicy?.keepAlive,
    coworkConfig.skipMissedJobs,
    coworkConfig.embeddingEnabled,
    coworkConfig.embeddingProvider,
    coworkConfig.embeddingModel,
    coworkConfig.embeddingLocalModelPath,
    coworkConfig.embeddingVectorWeight,
    coworkConfig.embeddingRemoteBaseUrl,
    coworkConfig.embeddingRemoteApiKey,
    coworkConfig.dreamingEnabled,
    coworkConfig.dreamingFrequency,
    coworkConfig.dreamingModel,
    coworkConfig.dreamingTimezone,
  ]);

  useEffect(() => () => {
    if (emailCopiedTimerRef.current != null) {
      window.clearTimeout(emailCopiedTimerRef.current);
    }
    if (updateCheckTimerRef.current != null) {
      window.clearTimeout(updateCheckTimerRef.current);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void coworkService.getOpenClawEngineStatus().then((status) => {
      if (!active || !status) return;
      setOpenClawEngineStatus(status);
    });
    const unsubscribe = coworkService.onOpenClawEngineStatus((status) => {
      if (!active) return;
      setOpenClawEngineStatus(status);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    try {
      const config = configService.getConfig();

      // Set general settings
      initialThemeRef.current = config.theme;
      initialLanguageRef.current = config.language;
      setTheme(config.theme);
      setLanguage(config.language);
      setUseSystemProxy(config.useSystemProxy ?? false);
      setSqliteAutoBackupEnabled(config.sqliteAutoBackupEnabled === true);
      setBrowserWebAccess(normalizeBrowserWebAccessConfig(config.browserWebAccess));
      const savedTestMode = config.app?.testMode ?? false;
      setTestMode(savedTestMode);
      if (savedTestMode) setTestModeUnlocked(true);

      // Load auto-launch setting
      window.electron.autoLaunch.get().then(({ enabled }) => {
        setAutoLaunchState(enabled);
      }).catch(err => {
        console.error('Failed to load auto-launch setting:', err);
      });

      // Load prevent-sleep setting
      window.electron.preventSleep.get().then(({ enabled }) => {
        setPreventSleepState(enabled);
      }).catch(err => {
        console.error('Failed to load prevent-sleep setting:', err);
      });

      // Set up providers based on saved config
      if (config.api) {
        // For backward compatibility with older config
        // Initialize active provider based on baseUrl
        const normalizedApiBaseUrl = config.api.baseUrl.toLowerCase();
        if (normalizedApiBaseUrl.includes('openai')) {
          setActiveProvider('openai');
          setProviders(prev => ({
            ...prev,
            openai: {
              ...prev.openai,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('deepseek')) {
          setActiveProvider('deepseek');
          setProviders(prev => ({
            ...prev,
            deepseek: {
              ...prev.deepseek,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('moonshot.ai') || normalizedApiBaseUrl.includes('moonshot.cn')) {
          setActiveProvider('moonshot');
          setProviders(prev => ({
            ...prev,
            moonshot: {
              ...prev.moonshot,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('bigmodel.cn')) {
          setActiveProvider('zhipu');
          setProviders(prev => ({
            ...prev,
            zhipu: {
              ...prev.zhipu,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('minimax')) {
          setActiveProvider('minimax');
          setProviders(prev => ({
            ...prev,
            minimax: {
              ...prev.minimax,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('openapi.youdao.com')) {
          setActiveProvider('youdaozhiyun');
          setProviders(prev => ({
            ...prev,
            youdaozhiyun: {
              ...prev.youdaozhiyun,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('dashscope')) {
          setActiveProvider('qwen');
          setProviders(prev => ({
            ...prev,
            qwen: {
              ...prev.qwen,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('stepfun')) {
          setActiveProvider('stepfun');
          setProviders(prev => ({
            ...prev,
            stepfun: {
              ...prev.stepfun,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('openrouter.ai')) {
          setActiveProvider('openrouter');
          setProviders(prev => ({
            ...prev,
            openrouter: {
              ...prev.openrouter,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('googleapis')) {
          setActiveProvider('gemini');
          setProviders(prev => ({
            ...prev,
            gemini: {
              ...prev.gemini,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('anthropic')) {
          setActiveProvider('anthropic');
          setProviders(prev => ({
            ...prev,
            anthropic: {
              ...prev.anthropic,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('ollama') || normalizedApiBaseUrl.includes('11434')) {
          setActiveProvider('ollama');
          setProviders(prev => ({
            ...prev,
            ollama: {
              ...prev.ollama,
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        } else if (normalizedApiBaseUrl.includes('lm-studio') || normalizedApiBaseUrl.includes(':1234')) {
          setActiveProvider('lm-studio');
          setProviders(prev => ({
            ...prev,
            'lm-studio': {
              ...prev['lm-studio'],
              enabled: true,
              apiKey: config.api.key,
              baseUrl: config.api.baseUrl
            }
          }));
        }
      }

      // Load provider-specific configurations if available
      // 合并已保存的配置和默认配置，确保新添加的 provider 能被显示
      if (config.providers) {
        setProviders(prev => {
          const merged = {
            ...prev,  // 保留默认的 providers（包括新添加的 anthropic）
            ...config.providers,  // 覆盖已保存的配置
          };

          // After merging, find the first enabled provider to set as activeProvider
          // This ensures we don't use stale activeProvider from old config.api.baseUrl
          const firstEnabledProvider = providerKeys.find(providerKey => merged[providerKey]?.enabled);
          if (firstEnabledProvider) {
            setActiveProvider(firstEnabledProvider);
          }

          return Object.fromEntries(
            Object.entries(merged).map(([providerKey, providerConfig]) => {
              const models = providerConfig.models?.map((model, idx) => {
                let id = model.id;
                // Fix corrupted model IDs from previous OAuth mutation bug
                if (providerKey === 'qwen' && (id === 'vision-model' || id === 'coder-model')) {
                  const defaultModel = defaultConfig.providers?.qwen?.models?.[idx];
                  id = defaultModel?.id || 'qwen3.5-plus';
                }
                return {
                  ...model,
                  id,
                  supportsImage: ProviderRegistry.resolveModelSupportsImage(
                    providerKey,
                    id,
                    model.supportsImage,
                  ),
                };
              });
              return [
                providerKey,
                {
                  ...providerConfig,
                  apiFormat: getEffectiveApiFormat(providerKey, (providerConfig as ProviderConfig).apiFormat),
                  ...(providerKey === ProviderName.Copilot && providerConfig.apiKey?.trim()
                    ? { authType: ProviderAuthType.OAuth, apiKey: '' }
                    : {}),
                  models,
                },
              ];
            })
          ) as ProvidersConfig;
        });
      }

      // 加载快捷键设置
      if (config.shortcuts) {
        setShortcuts(prev => ({
          ...prev,
          ...config.shortcuts,
        }));
      }
    } catch {
      setError('Failed to load settings');
    }
  }, []);

  useEffect(() => {
    const initialThemeId = initialThemeIdRef.current;
    const initialTheme = initialThemeRef.current;
    const initialLanguage = initialLanguageRef.current;
    return () => {
      if (didSaveRef.current) {
        return;
      }
      themeService.restoreTheme(initialThemeId, initialTheme);
      i18nService.setLanguage(initialLanguage, { persist: false });
    };
  }, []);

  // 监听标签页切换，确保内容区域滚动到顶部
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  useEffect(() => {
    setNoticeMessage(buildNoticeMessage());
  }, [buildNoticeMessage]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18nService.subscribe(() => {
      setLanguage(i18nService.getLanguage());
      // Re-translate notice message on language change
      if (noticeI18nKey) {
        const base = i18nService.t(noticeI18nKey);
        setNoticeMessage(noticeExtra ? `${base} (${noticeExtra})` : base);
      }
    });
    return unsubscribe;
  }, [noticeI18nKey, noticeExtra]);

  // Compute visible providers based on language, including active custom_N entries
  const visibleProviders = useMemo(() => {
    const visibleKeys = getVisibleProviders(language);
    const filtered: Partial<ProvidersConfig> = {};
    for (const key of visibleKeys) {
      if (providers[key as keyof ProvidersConfig]) {
        filtered[key as keyof ProvidersConfig] = providers[key as keyof ProvidersConfig];
      }
    }
    // Append custom_N providers that exist in state, sorted by numeric suffix
    for (const key of CUSTOM_PROVIDER_KEYS) {
      if (providers[key]) {
        filtered[key] = providers[key];
      }
    }
    return filtered as ProvidersConfig;
  }, [language, providers]);

  // Ensure activeProvider is always in visibleProviders when language changes
  useEffect(() => {
    const visibleKeys = Object.keys(visibleProviders) as ProviderType[];
    if (visibleKeys.length > 0 && !visibleKeys.includes(activeProvider)) {
      // If current activeProvider is not visible, switch to first visible provider
      const firstEnabledVisible = visibleKeys.find(key => visibleProviders[key]?.enabled);
      setActiveProvider(firstEnabledVisible ?? visibleKeys[0]);
    }
  }, [visibleProviders, activeProvider]);

  // Handle adding a new custom provider
  const handleAddCustomProvider = () => {
    // Find the first unused custom slot
    const usedKeys = new Set(Object.keys(providers));
    const newKey = CUSTOM_PROVIDER_KEYS.find(k => !usedKeys.has(k));
    if (!newKey) return; // All 10 slots used
    setProviders(prev => ({
      ...prev,
      [newKey]: {
        enabled: false,
        apiKey: '',
        baseUrl: '',
        apiFormat: 'openai' as const,
        models: [],
        displayName: undefined,
      },
    }));
    setActiveProvider(newKey);
    setShowApiKey(false);
    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelSupportsImage(false);
    setModelFormError(null);
  };

  // Handle deleting a custom provider
  const handleDeleteCustomProvider = (key: ProviderType) => {
    setPendingDeleteProvider(key);
  };

  const confirmDeleteCustomProvider = () => {
    const key = pendingDeleteProvider;
    if (!key) return;
    setPendingDeleteProvider(null);
    setProviders(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    // Persist the deletion immediately so it survives window close
    const currentConfig = configService.getConfig();
    const updatedProviders = { ...currentConfig.providers };
    delete updatedProviders[key];
    configService.updateConfig({ providers: updatedProviders as AppConfig['providers'] });
    // If the deleted provider was active, switch to first visible
    if (activeProvider === key) {
      const visibleKeys = Object.keys(visibleProviders).filter(k => k !== key) as ProviderType[];
      const firstEnabled = visibleKeys.find(k => visibleProviders[k]?.enabled);
      setActiveProvider(firstEnabled ?? visibleKeys[0] ?? providerKeys[0]);
    }
  };

  // Handle provider change
  const handleProviderChange = (provider: ProviderType) => {
    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelSupportsImage(false);
    setModelFormError(null);
    setActiveProvider(provider);
    // 切换 provider 时清除测试结果
    setIsTestResultModalOpen(false);
    setTestResult(null);
  };

  // Handle provider configuration change
  const handleProviderConfigChange = (provider: ProviderType, field: string, value: string) => {
    setProviders(prev => {
      if (field === 'apiFormat') {
        const nextApiFormat = getEffectiveApiFormat(provider, value);
        const nextProviderConfig: ProviderConfig = {
          ...prev[provider],
          apiFormat: nextApiFormat,
        };

        // Only auto-switch URL when current value is still a known default URL.
        if (shouldAutoSwitchProviderBaseUrl(provider, prev[provider].baseUrl)) {
          const defaultBaseUrl = getProviderDefaultBaseUrl(provider, nextApiFormat);
          if (defaultBaseUrl) {
            nextProviderConfig.baseUrl = defaultBaseUrl;
          }
        }

        return {
          ...prev,
          [provider]: nextProviderConfig,
        };
      }

      // Handle codingPlanEnabled toggle for all supported providers
      if (field === 'codingPlanEnabled') {
        const def = ProviderRegistry.get(provider);
        if (def?.codingPlanSupported) {
          const enabled = value === 'true';
          const nextModels = enabled && def.codingPlanModels
            ? def.codingPlanModels.map(m => ({ ...m }))
            : def.defaultModels.map(m => ({ ...m }));
          return {
            ...prev,
            [provider]: {
              ...prev[provider],
              codingPlanEnabled: enabled,
              models: nextModels,
            },
          };
        }
      }

      return {
        ...prev,
        [provider]: {
          ...prev[provider],
          [field]: value,
        },
      };
    });
  };

  const handleMiniMaxDeviceLogin = async (region: MiniMaxRegion) => {
    minimaxOAuthCancelRef.current = false;
    setMinimaxOAuthPhase({ kind: 'requesting_code' });

    const codeEndpoint = region === 'cn' ? MINIMAX_CODE_ENDPOINT_CN : MINIMAX_CODE_ENDPOINT_GLOBAL;
    const tokenEndpoint = region === 'cn' ? MINIMAX_TOKEN_ENDPOINT_CN : MINIMAX_TOKEN_ENDPOINT_GLOBAL;
    const defaultBaseUrl = region === 'cn' ? MINIMAX_BASE_URL_CN : MINIMAX_BASE_URL_GLOBAL;

    try {
      const { verifier, challenge, state } = await generateMiniMaxPkce();

      const codeBody = [
        'response_type=code',
        `client_id=${encodeURIComponent(MINIMAX_OAUTH_CLIENT_ID)}`,
        `scope=${encodeURIComponent(MINIMAX_OAUTH_SCOPE)}`,
        `code_challenge=${encodeURIComponent(challenge)}`,
        'code_challenge_method=S256',
        `state=${encodeURIComponent(state)}`,
      ].join('&');

      const codeRes = await window.electron.api.fetch({
        url: codeEndpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: codeBody,
      });

      if (!codeRes.ok) {
        throw new Error(`MiniMax OAuth authorization failed: ${codeRes.status}`);
      }

      const codePayload = (codeRes.data ?? {}) as {
        user_code?: string;
        verification_uri?: string;
        expired_in?: number;
        interval?: number;
        state?: string;
        error?: string;
      };

      if (!codePayload.user_code || !codePayload.verification_uri) {
        throw new Error(codePayload.error ?? 'MiniMax OAuth returned incomplete authorization payload');
      }

      if (codePayload.state !== state) {
        throw new Error('MiniMax OAuth state mismatch: possible CSRF attack or session corruption');
      }

      try {
        await window.electron.shell.openExternal(codePayload.verification_uri);
      } catch { /* ignore: user can open manually */ }

      setMinimaxOAuthPhase({
        kind: 'pending',
        userCode: codePayload.user_code,
        verificationUri: codePayload.verification_uri,
      });

      let pollIntervalMs = codePayload.interval ?? 2000;
      const expireTimeMs = codePayload.expired_in ?? (Date.now() + 5 * 60 * 1000);

      while (Date.now() < expireTimeMs) {
        if (minimaxOAuthCancelRef.current) {
          setMinimaxOAuthPhase({ kind: 'idle' });
          return;
        }

        await new Promise(r => setTimeout(r, pollIntervalMs));

        if (minimaxOAuthCancelRef.current) {
          setMinimaxOAuthPhase({ kind: 'idle' });
          return;
        }

        const tokenBody = [
          `grant_type=${encodeURIComponent(MINIMAX_OAUTH_GRANT_TYPE)}`,
          `client_id=${encodeURIComponent(MINIMAX_OAUTH_CLIENT_ID)}`,
          `user_code=${encodeURIComponent(codePayload.user_code)}`,
          `code_verifier=${encodeURIComponent(verifier)}`,
        ].join('&');

        const tokenRes = await window.electron.api.fetch({
          url: tokenEndpoint,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          body: tokenBody,
        });

        const tokenPayload = (tokenRes.data ?? {}) as {
          status?: string;
          access_token?: string;
          refresh_token?: string;
          expired_in?: number;
          resource_url?: string;
          notification_message?: string;
          base_resp?: { status_code?: number; status_msg?: string };
        };

        if (tokenPayload.status === 'error') {
          throw new Error(tokenPayload.base_resp?.status_msg ?? 'MiniMax OAuth error');
        }

        if (tokenPayload.status === 'success') {
          if (!tokenPayload.access_token || !tokenPayload.refresh_token) {
            throw new Error('MiniMax OAuth returned incomplete token payload');
          }

          let baseUrl = (tokenPayload.resource_url ?? '').trim();
          if (baseUrl && !baseUrl.startsWith('http')) {
            baseUrl = `https://${baseUrl}`;
          }
          if (!baseUrl) {
            baseUrl = defaultBaseUrl;
          }

          setProviders(prev => ({
            ...prev,
            minimax: {
              ...prev.minimax,
              enabled: true,
              oauthAccessToken: tokenPayload.access_token!,
              oauthBaseUrl: baseUrl,
              apiFormat: 'anthropic',
              authType: 'oauth',
              oauthRefreshToken: tokenPayload.refresh_token,
              oauthTokenExpiresAt: tokenPayload.expired_in,
              models: [...(defaultConfig.providers?.minimax.models ?? [])],
            },
          }));

          setMinimaxOAuthPhase({ kind: 'success' });
          setTimeout(() => setMinimaxOAuthPhase({ kind: 'idle' }), 1500);
          return;
        }

        // Still pending — back off gradually
        pollIntervalMs = Math.min(pollIntervalMs * 1.5, 10000);
      }

      throw new Error('MiniMax OAuth timed out waiting for authorization');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMinimaxOAuthPhase({ kind: 'error', message });
    }
  };

  const handleCancelMiniMaxLogin = () => {
    minimaxOAuthCancelRef.current = true;
    setMinimaxOAuthPhase({ kind: 'idle' });
  };

  const handleMiniMaxOAuthLogout = () => {
    setProviders(prev => ({
      ...prev,
      minimax: {
        ...prev.minimax,
        enabled: false,
        oauthAccessToken: undefined,
        oauthBaseUrl: undefined,
        oauthRefreshToken: undefined,
        oauthTokenExpiresAt: undefined,
      },
    }));
    setMinimaxOAuthPhase({ kind: 'idle' });
  };

  // Sync the persisted ChatGPT login state into local UI state on mount and
  // whenever the OpenAI provider tab becomes active. Also reconciles stale
  // providers config (e.g. auth.json deleted externally).
  useEffect(() => {
    let cancelled = false;
    if (activeProvider !== 'openai') return;
    void window.electron.openaiCodexOAuth.status().then((status) => {
      if (cancelled) return;
      if (status.loggedIn) {
        setOpenaiOAuthStatus({ loggedIn: true, email: status.email ?? undefined });
      } else {
        setOpenaiOAuthStatus({ loggedIn: false });
        setProviders(prev => {
          if (prev.openai.authType !== 'oauth') return prev;
          return { ...prev, openai: { ...prev.openai, authType: 'apikey' } };
        });
      }
    }).catch(() => {
      if (!cancelled) setOpenaiOAuthStatus({ loggedIn: false });
    });
    return () => { cancelled = true; };
  }, [activeProvider]);

  const persistOpenAIProvidersConfigInBackground = useCallback((nextProviders: ProvidersConfig) => {
    void configService.updateConfig({ providers: nextProviders }).catch((saveError) => {
      console.error('[Settings] failed to save OpenAI OAuth provider state:', saveError);
      setError(i18nService.t('failedToSaveSettings'));
    });
  }, []);

  const handleOpenAIOAuthLogin = async () => {
    setOpenaiOAuthPhase({ kind: 'pending' });
    try {
      const result = await window.electron.openaiCodexOAuth.start();
      if (!result.success) {
        setOpenaiOAuthPhase({ kind: 'error', message: result.error });
        return;
      }
      const nextProviders: ProvidersConfig = {
        ...providers,
        openai: {
          ...providers.openai,
          enabled: true,
          authType: 'oauth',
        },
      };
      setProviders(nextProviders);
      setOpenaiOAuthStatus({ loggedIn: true, email: result.email ?? undefined });
      setOpenaiOAuthPhase({ kind: 'success', email: result.email ?? undefined });
      persistOpenAIProvidersConfigInBackground(nextProviders);
      setTimeout(() => setOpenaiOAuthPhase({ kind: 'idle' }), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOpenaiOAuthPhase({ kind: 'error', message });
    }
  };

  const handleCancelOpenAIOAuthLogin = async () => {
    try {
      await window.electron.openaiCodexOAuth.cancel();
    } catch {
      /* ignore — we still want to reset the UI */
    }
    setOpenaiOAuthPhase({ kind: 'idle' });
  };

  const handleOpenAIOAuthLogout = async () => {
    const nextOpenAIProvider = {
      ...providers.openai,
      enabled: providers.openai.apiKey.trim().length > 0,
      authType: 'apikey' as const,
    };
    const nextProviders: ProvidersConfig = {
      ...providers,
      openai: {
        ...nextOpenAIProvider,
      },
    };
    setProviders(nextProviders);
    setOpenaiOAuthStatus({ loggedIn: false });
    setOpenaiOAuthPhase({ kind: 'idle' });
    persistOpenAIProvidersConfigInBackground(nextProviders);
    try {
      await window.electron.openaiCodexOAuth.logout();
    } catch {
      /* ignore — file may already be gone */
    }
  };

  const hasCoworkConfigChanges = coworkAgentEngine !== coworkConfig.agentEngine
    || coworkMemoryEnabled !== coworkConfig.memoryEnabled
    || coworkMemoryLlmJudgeEnabled !== coworkConfig.memoryLlmJudgeEnabled
    || skipMissedJobs !== (coworkConfig.skipMissedJobs ?? true)
    || openClawSessionKeepAlive !== (coworkConfig.openClawSessionPolicy?.keepAlive || OpenClawSessionKeepAliveValues.ThirtyDays)
    || embeddingEnabled !== (coworkConfig.embeddingEnabled ?? false)
    || embeddingProvider !== (coworkConfig.embeddingProvider ?? 'openai')
    || embeddingModel !== (coworkConfig.embeddingModel ?? '')
    || embeddingLocalModelPath !== (coworkConfig.embeddingLocalModelPath ?? '')
    || embeddingVectorWeight !== (coworkConfig.embeddingVectorWeight ?? 0.7)
    || embeddingRemoteBaseUrl !== (coworkConfig.embeddingRemoteBaseUrl ?? '')
    || embeddingRemoteApiKey !== (coworkConfig.embeddingRemoteApiKey ?? '')
    || dreamingEnabled !== (coworkConfig.dreamingEnabled ?? false)
    || dreamingFrequency !== (coworkConfig.dreamingFrequency ?? '0 3 * * *');
  const isOpenClawAgentEngine = coworkAgentEngine === 'openclaw';

  const openClawProgressPercent = useMemo(() => {
    if (typeof openClawEngineStatus?.progressPercent !== 'number' || !Number.isFinite(openClawEngineStatus.progressPercent)) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round(openClawEngineStatus.progressPercent)));
  }, [openClawEngineStatus]);

  const resolveOpenClawStatusText = (status: OpenClawEngineStatus | null): string => {
    if (!status) {
      return i18nService.t('coworkOpenClawNotInstalledNotice');
    }
    if (status.message?.trim()) {
      return status.message.trim();
    }
    switch (status.phase) {
      case 'not_installed':
        return i18nService.t('coworkOpenClawNotInstalledNotice');
      case 'installing':
        return i18nService.t('coworkOpenClawInstalling');
      case 'ready':
        return i18nService.t('coworkOpenClawReadyNotice');
      case 'starting':
        return i18nService.t('coworkOpenClawStarting');
      case 'error':
        return i18nService.t('coworkOpenClawError');
      case 'running':
      default:
        return i18nService.t('coworkOpenClawRunning');
    }
  };

  const loadCoworkMemoryData = useCallback(async () => {
    setCoworkMemoryListLoading(true);
    try {
      const [entries, stats] = await Promise.all([
        coworkService.listMemoryEntries({
          query: coworkMemoryQuery.trim() || undefined,
        }),
        coworkService.getMemoryStats(),
      ]);
      setCoworkMemoryEntries(entries);
      setCoworkMemoryStats(stats);
    } catch (loadError) {
      console.error('Failed to load cowork memory data:', loadError);
      setCoworkMemoryEntries([]);
      setCoworkMemoryStats(null);
    } finally {
      setCoworkMemoryListLoading(false);
    }
  }, [
    coworkMemoryQuery,
  ]);

  useEffect(() => {
    if (activeTab !== 'coworkMemory') return;
    void loadCoworkMemoryData();
  }, [activeTab, loadCoworkMemoryData]);

  const resetCoworkMemoryEditor = () => {
    setCoworkMemoryEditingId(null);
    setCoworkMemoryDraftText('');
    setShowMemoryModal(false);
  };

  const handleSaveCoworkMemoryEntry = async () => {
    const text = coworkMemoryDraftText.trim();
    if (!text) return;

    setCoworkMemoryListLoading(true);
    try {
      if (coworkMemoryEditingId) {
        await coworkService.updateMemoryEntry({
          id: coworkMemoryEditingId,
          text,
        });
      } else {
        await coworkService.createMemoryEntry({
          text,
        });
      }
      resetCoworkMemoryEditor();
      await loadCoworkMemoryData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : i18nService.t('coworkMemoryCrudSaveFailed'));
    } finally {
      setCoworkMemoryListLoading(false);
    }
  };

  const handleEditCoworkMemoryEntry = (entry: CoworkUserMemoryEntry) => {
    setCoworkMemoryEditingId(entry.id);
    setCoworkMemoryDraftText(entry.text);
    setShowMemoryModal(true);
  };

  const handleDeleteCoworkMemoryEntry = async (entry: CoworkUserMemoryEntry) => {
    setCoworkMemoryListLoading(true);
    try {
      await coworkService.deleteMemoryEntry({ id: entry.id });
      if (coworkMemoryEditingId === entry.id) {
        resetCoworkMemoryEditor();
      }
      await loadCoworkMemoryData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : i18nService.t('coworkMemoryCrudDeleteFailed'));
    } finally {
      setCoworkMemoryListLoading(false);
    }
  };

  const handleOpenCoworkMemoryModal = () => {
    resetCoworkMemoryEditor();
    setShowMemoryModal(true);
  };

  // Toggle provider enabled status
  const toggleProviderEnabled = (provider: ProviderType) => {
    const providerConfig = providers[provider];
    const isEnabling = !providerConfig.enabled;
    const hasValidAuth = hasProviderAuthConfigured(provider, providerConfig);

    // GitHub Copilot requires device code auth — redirect to sign-in flow
    if (provider === ProviderName.Copilot && isEnabling && !hasValidAuth) {
      handleCopilotSignIn();
      return;
    }

    if (isEnabling && !hasValidAuth) {
      setError(i18nService.t('apiKeyRequired'));
      return;
    }

    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        enabled: !prev[provider].enabled
      }
    }));
  };

  const enableProvider = (provider: ProviderType) => {
    setProviders(prev => {
      if (prev[provider].enabled) {
        return prev;
      }

      return {
        ...prev,
        [provider]: {
          ...prev[provider],
          enabled: true,
        },
      };
    });
  };

  // GitHub Copilot device code authentication
  const handleCopilotSignIn = async () => {
    try {
      setCopilotAuthStatus('requesting');
      setCopilotError(null);

      // Step 1: Request device code
      const { userCode, verificationUri, deviceCode, interval, expiresIn } =
        await window.electron.githubCopilot.requestDeviceCode();

      setCopilotUserCode(userCode);
      setCopilotVerificationUri(verificationUri);
      setCopilotAuthStatus('awaiting_user');

      // Open verification URL in browser
      await window.electron.shell.openExternal(verificationUri);

      // Step 2: Poll for token
      setCopilotAuthStatus('polling');
      const result = await window.electron.githubCopilot.pollForToken(deviceCode, interval, expiresIn);

      if (result.success && result.token) {
        setCopilotGithubUser(result.githubUser || '');
        setCopilotAuthStatus('authenticated');

        apiService.setProviderRuntimeCredential(ProviderName.Copilot, {
          apiKey: result.token,
          ...(result.baseUrl ? { baseUrl: result.baseUrl } : {}),
        });
        setProviders(prev => ({
          ...prev,
          [ProviderName.Copilot]: {
            ...prev[ProviderName.Copilot],
            enabled: true,
            authType: ProviderAuthType.OAuth,
            apiKey: '',
          },
        }));
      } else {
        setCopilotError(result.error || 'Authentication failed');
        setCopilotAuthStatus('error');
      }
    } catch (error: unknown) {
      setCopilotError(error instanceof Error ? error.message : 'Authentication failed');
      setCopilotAuthStatus('error');
    }
  };

  const handleCopilotSignOut = async () => {
    try {
      await window.electron.githubCopilot.signOut();
      setCopilotAuthStatus('idle');
      setCopilotGithubUser('');
      setCopilotUserCode('');
      setCopilotError(null);
      apiService.setProviderRuntimeCredential(ProviderName.Copilot, null);
      setProviders(prev => ({
        ...prev,
        [ProviderName.Copilot]: {
          ...prev[ProviderName.Copilot],
          enabled: false,
          authType: ProviderAuthType.ApiKey,
          apiKey: '',
        },
      }));
    } catch (error) {
      console.error('[Settings] GitHub Copilot sign-out failed:', error);
    }
  };

  const handleCopilotCancelAuth = async () => {
    try {
      await window.electron.githubCopilot.cancelPolling();
      setCopilotAuthStatus('idle');
      setCopilotUserCode('');
      setCopilotError(null);
    } catch (error) {
      console.error('[Settings] GitHub Copilot cancel polling failed:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const normalizedProviders = Object.fromEntries(
        Object.entries(providers).map(([providerKey, providerConfig]) => {
          const apiFormat = getEffectiveApiFormat(providerKey, providerConfig.apiFormat);
          const hasValidAuth = hasProviderAuthConfigured(providerKey as ProviderType, providerConfig);
          return [
            providerKey,
            {
              ...providerConfig,
              enabled: providerConfig.enabled && hasValidAuth,
              apiFormat,
              ...(providerKey === ProviderName.Copilot ? { apiKey: '' } : {}),
              baseUrl: resolveBaseUrl(providerKey as ProviderType, providerConfig.baseUrl, apiFormat),
            },
          ];
        })
      ) as ProvidersConfig;

      // Find the first enabled provider to use as the primary API
      const firstEnabledProvider = Object.entries(normalizedProviders).find(
        ([_, config]) => config.enabled
      );

      const primaryProvider = firstEnabledProvider
        ? firstEnabledProvider[1]
        : normalizedProviders[activeProvider];
      const normalizedBrowserWebAccess = normalizeBrowserWebAccessConfig({
        ...browserWebAccess,
        browserEnabled: true,
        profileMode: defaultBrowserWebAccessConfig.profileMode,
        followGlobalProxy: defaultBrowserWebAccessConfig.followGlobalProxy,
        snapshotMode: defaultBrowserWebAccessConfig.snapshotMode,
        executablePath: undefined,
        cdpUrl: undefined,
        attachOnly: undefined,
        remoteCdpTimeoutMs: undefined,
        remoteCdpHandshakeTimeoutMs: undefined,
        extraArgs: [],
        webFetch: defaultBrowserWebAccessConfig.webFetch,
      });

      await configService.updateConfig({
        api: {
          key: primaryProvider.apiKey,
          baseUrl: primaryProvider.baseUrl,
        },
        providers: normalizedProviders, // Save all providers configuration
        theme,
        language,
        useSystemProxy,
        sqliteAutoBackupEnabled,
        browserWebAccess: normalizedBrowserWebAccess,
        shortcuts,
        app: {
          ...configService.getConfig().app,
          testMode,
        },
      });

      // 应用主题
      themeService.setTheme(theme);

      // 应用语言
      i18nService.setLanguage(language, { persist: false });

      // Set API with the primary provider - handle Qwen OAuth
      let apiKeyToUse = primaryProvider.apiKey;
      let baseUrlToUse = primaryProvider.baseUrl;


      apiService.setConfig({
        apiKey: apiKeyToUse,
        baseUrl: baseUrlToUse,
      });

      // 更新 Redux store 中的可用模型列表
      const allModels: { id: string; name: string; provider?: string; providerKey?: string; openClawProviderId?: string; supportsImage?: boolean }[] = [];
      Object.entries(normalizedProviders).forEach(([providerName, config]) => {
        if (config.enabled && config.models) {
          const openClawProviderId = getOpenClawProviderIdForConfig(providerName, config);
          config.models.forEach(model => {
            allModels.push({
              id: model.id,
              name: model.name,
              provider: getProviderDisplayName(providerName, config),
              providerKey: providerName,
              openClawProviderId,
              supportsImage: resolveModelSupportsImageForProvider(providerName, model),
            });
          });
        }
      });
      dispatch(setAvailableModels(allModels));

      if (hasCoworkConfigChanges) {
        const updated = await coworkService.updateConfig({
          agentEngine: coworkAgentEngine,
          memoryEnabled: coworkMemoryEnabled,
          memoryLlmJudgeEnabled: coworkMemoryLlmJudgeEnabled,
          skipMissedJobs,
          embeddingEnabled,
          embeddingProvider,
          embeddingModel,
          embeddingLocalModelPath,
          embeddingVectorWeight,
          embeddingRemoteBaseUrl,
          embeddingRemoteApiKey,
          dreamingEnabled,
          dreamingFrequency,
          dreamingModel,
          dreamingTimezone,
        });
        if (!updated) {
          throw new Error(i18nService.t('coworkConfigSaveFailed'));
        }
        const savedSessionPolicy = await coworkService.updateSessionPolicy({
          keepAlive: openClawSessionKeepAlive,
        });
        if (!savedSessionPolicy) {
          throw new Error(i18nService.t('coworkConfigSaveFailed'));
        }
      }

      // Ask main to sync IM/OpenClaw config. The main process skips this when
      // the IM fingerprint has not changed, so unrelated settings saves do not
      // restart the gateway.
      const syncSucceeded = await imService.saveAndSyncConfig();
      if (!syncSucceeded) {
        throw new Error(i18nService.t('settingsSavedButOpenClawSyncFailed'));
      }

      // Batch save plugin changes (toggles + configs) if any pending
      if (activeTab === 'plugins' && pluginsSettingsRef.current) {
        const pendingChanges = pluginsSettingsRef.current.getPendingChanges();
        if (pendingChanges) {
          await window.electron?.plugins.batchSave(pendingChanges);
          pluginsSettingsRef.current.resetDirty();
        }
      }

      didSaveRef.current = true;
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  // 标签页切换处理
  const doTabChange = (tab: TabType) => {
    if (tab !== 'model') {
      setIsAddingModel(false);
      setIsEditingModel(false);
      setEditingModelId(null);
      setNewModelName('');
      setNewModelId('');
      setNewModelSupportsImage(false);
      setModelFormError(null);
    }
    setActiveTab(tab);
  };

  const handleTabChange = (tab: TabType) => {
    if (activeTab === 'plugins' && pluginsSettingsRef.current?.guardLeave(() => doTabChange(tab))) {
      return;
    }
    doTabChange(tab);
  };

  // Guarded close: check plugin dirty state before closing
  const guardedClose = useCallback(() => {
    if (activeTab === 'plugins' && pluginsSettingsRef.current?.guardLeave(() => onClose())) {
      return;
    }
    onClose();
  }, [activeTab, onClose]);

  // Mapping from shortcut key to i18n label key for conflict messages
  const shortcutLabelMap: Record<string, string> = {
    newChat: 'newChat',
    search: 'search',
    settings: 'openSettings',
    sendMessage: 'sendMessageShortcut',
  };

  // 快捷键更新处理
  const handleShortcutChange = (key: keyof typeof shortcuts, value: string) => {
    // Check for conflicts with other shortcuts
    const conflictKey = Object.keys(shortcuts).find(
      k => k !== key && shortcuts[k as keyof typeof shortcuts] === value
    );
    if (conflictKey) {
      const conflictLabel = i18nService.t(shortcutLabelMap[conflictKey] ?? conflictKey);
      setNoticeMessage(
        i18nService.t('shortcutConflict').replace('{0}', value).replace('{1}', conflictLabel)
      );
      return;
    }
    setShortcuts(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // 阻止点击设置窗口时事件传播到背景
  const handleSettingsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  // Handlers for model operations
  const handleAddModel = () => {
    setIsAddingModel(true);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelSupportsImage(false);
    setNewModelContextWindow(undefined);
    setNewModelCustomParams('');
    setModelFormError(null);
  };

  const handleEditModel = (modelId: string, modelName: string, supportsImage?: boolean, contextWindow?: number, customParams?: Record<string, unknown>) => {
    setIsAddingModel(false);
    setIsEditingModel(true);
    setEditingModelId(modelId);
    setNewModelName(modelName);
    setNewModelId(modelId);
    setNewModelSupportsImage(!!supportsImage);
    setNewModelContextWindow(contextWindow);
    setNewModelCustomParams(
      customParams && Object.keys(customParams).length > 0
        ? JSON.stringify(customParams, null, 2)
        : '',
    );
    setModelFormError(null);
  };

  const handleDeleteModel = (modelId: string) => {
    if (!providers[activeProvider].models) return;

    const updatedModels = providers[activeProvider].models.filter(
      model => model.id !== modelId
    );

    setProviders(prev => ({
      ...prev,
      [activeProvider]: {
        ...prev[activeProvider],
        models: updatedModels
      }
    }));
  };

  const handleSaveNewModel = () => {
    const modelId = newModelId.trim();

    if (activeProvider === 'ollama' || activeProvider === 'lm-studio') {
      // For Ollama/LM Studio, only the model name (stored as modelId) is required
      if (!modelId) {
        setModelFormError(i18nService.t(activeProvider === 'lm-studio' ? 'lmStudioModelNameRequired' : 'ollamaModelNameRequired'));
        return;
      }
    } else {
      const modelName = newModelName.trim();
      if (!modelName || !modelId) {
        setModelFormError(i18nService.t('modelNameAndIdRequired'));
        return;
      }
    }

    // For Ollama, auto-fill display name from modelId if not provided
    const modelName = activeProvider === 'ollama' || activeProvider === 'lm-studio'
      ? (newModelName.trim() && newModelName.trim() !== modelId ? newModelName.trim() : modelId)
      : newModelName.trim();

    const currentModels = providers[activeProvider].models ?? [];
    const duplicateModel = currentModels.find(
      model => model.id === modelId && (!isEditingModel || model.id !== editingModelId)
    );
    if (duplicateModel) {
      setModelFormError(i18nService.t('modelIdExists'));
      return;
    }

    // Parse custom params JSON (validate before saving)
    let parsedCustomParams: Record<string, unknown> | undefined;
    const trimmedParams = newModelCustomParams.trim();
    if (trimmedParams) {
      try {
        parsedCustomParams = JSON.parse(trimmedParams);
        if (typeof parsedCustomParams !== 'object' || parsedCustomParams === null || Array.isArray(parsedCustomParams)) {
          setModelFormError(i18nService.t('customParamsInvalidJson'));
          return;
        }
      } catch {
        setModelFormError(i18nService.t('customParamsInvalidJson'));
        return;
      }
    }

    const nextModel = {
      id: modelId,
      name: modelName,
      supportsImage: ProviderRegistry.resolveModelSupportsImage(
        activeProvider,
        modelId,
        newModelSupportsImage,
      ),
      ...(newModelContextWindow !== undefined ? { contextWindow: newModelContextWindow } : {}),
      ...(parsedCustomParams && Object.keys(parsedCustomParams).length > 0
        ? { customParams: parsedCustomParams }
        : {}),
    };
    const updatedModels = isEditingModel && editingModelId
      ? currentModels.map(model => (model.id === editingModelId ? nextModel : model))
      : [...currentModels, nextModel];

    setProviders(prev => ({
      ...prev,
      [activeProvider]: {
        ...prev[activeProvider],
        models: updatedModels
      }
    }));

    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelSupportsImage(false);
    setNewModelCustomParams('');
    setModelFormError(null);
  };

  const handleCancelModelEdit = () => {
    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelSupportsImage(false);
    setNewModelContextWindow(undefined);
    setNewModelCustomParams('');
    setModelFormError(null);
  };

  const handleModelDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelModelEdit();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveNewModel();
    }
  };

  const showTestResultModal = (
    result: Omit<ProviderConnectionTestResult, 'provider'>,
    provider: ProviderType
  ) => {
    setTestResult({
      ...result,
      provider,
    });
    setIsTestResultModalOpen(true);
  };

  // 测试 API 连接
  const handleTestConnection = async () => {
    const testingProvider = activeProvider;
    const providerConfig = providers[testingProvider];
    setIsTesting(true);
    setIsTestResultModalOpen(false);
    setTestResult(null);

    const hasValidAuth = providerConfig.apiKey;


    if (providerRequiresApiKey(testingProvider) && !hasValidAuth) {
      showTestResultModal({ success: false, message: i18nService.t('apiKeyRequired') }, testingProvider);
      setIsTesting(false);
      return;
    }

    // 获取第一个可用模型 - use a shallow copy to avoid mutating state
    const originalModel = providerConfig.models?.[0];
    if (!originalModel) {
      showTestResultModal({ success: false, message: i18nService.t('noModelsConfigured') }, testingProvider);
      setIsTesting(false);
      return;
    }

    const firstModel = { ...originalModel };

    try {
      let response: Awaited<ReturnType<typeof window.electron.api.fetch>>;
      // Apply Coding Plan endpoint switch
      let effectiveBaseUrl = resolveBaseUrl(testingProvider, providerConfig.baseUrl, getEffectiveApiFormat(testingProvider, providerConfig.apiFormat));
      let effectiveApiFormat = getEffectiveApiFormat(testingProvider, providerConfig.apiFormat);

      // Handle Coding Plan endpoint switch for supported providers
      if ((providerConfig as { codingPlanEnabled?: boolean }).codingPlanEnabled && (effectiveApiFormat === 'anthropic' || effectiveApiFormat === 'openai')) {
        const resolved = resolveCodingPlanBaseUrl(testingProvider, true, effectiveApiFormat, effectiveBaseUrl);
        effectiveBaseUrl = resolved.baseUrl;
        effectiveApiFormat = resolved.effectiveFormat;
      }

      let normalizedBaseUrl = effectiveBaseUrl.replace(/\/+$/, '');

      // Determine effective API key
      let effectiveApiKey = providerConfig.apiKey;

      if (testingProvider === ProviderName.Copilot) {
        const result = await window.electron.githubCopilot.refreshToken();
        if (!result.success || !result.token) {
          showTestResultModal({
            success: false,
            message: result.error || i18nService.t('apiKeyRequired'),
          }, testingProvider);
          return;
        }
        effectiveApiKey = result.token;
        if (result.baseUrl) {
          effectiveBaseUrl = result.baseUrl;
          normalizedBaseUrl = effectiveBaseUrl.replace(/\/+$/, '');
        }
        apiService.setProviderRuntimeCredential(ProviderName.Copilot, {
          apiKey: result.token,
          ...(result.baseUrl ? { baseUrl: result.baseUrl } : {}),
        });
      }

      if (testingProvider === 'qwen') {
        // Use regular API Key mode
        effectiveApiKey = providerConfig.apiKey;
        // Ensure model ID is not an OAuth-mapped name (vision-model/coder-model)
        // This can happen if a previous OAuth test mutated the model in state and it got persisted
        if (firstModel.id === 'vision-model' || firstModel.id === 'coder-model') {
          // Restore from defaultConfig's first qwen model
          const defaultQwenModel = defaultConfig.providers?.qwen?.models?.[0];
          firstModel.id = defaultQwenModel?.id || 'qwen3.5-plus';
        }
      }

      // Determine format after all overrides (OAuth may switch to openai)
      // 统一为两种协议格式：
      // - anthropic: /v1/messages
      // - openai provider: /v1/responses
      // - other openai-compatible providers: /v1/chat/completions
      const useAnthropicFormat = effectiveApiFormat === 'anthropic';

      if (useAnthropicFormat) {
        const anthropicUrl = normalizedBaseUrl.endsWith('/v1')
          ? `${normalizedBaseUrl}/messages`
          : `${normalizedBaseUrl}/v1/messages`;
        response = await window.electron.api.fetch({
          url: anthropicUrl,
          method: 'POST',
          headers: {
            'x-api-key': effectiveApiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: firstModel.id,
            max_tokens: CONNECTIVITY_TEST_TOKEN_BUDGET,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });
      } else {
        const useResponsesApi = shouldUseOpenAIResponsesForProvider(testingProvider);
        const openaiUrl = useResponsesApi
          ? buildOpenAIResponsesUrl(normalizedBaseUrl)
          : buildOpenAICompatibleChatCompletionsUrl(normalizedBaseUrl, testingProvider);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (effectiveApiKey) {
          headers.Authorization = `Bearer ${effectiveApiKey}`;
        }
        if (testingProvider === ProviderName.Copilot) {
          headers['Copilot-Integration-Id'] = 'vscode-chat';
          headers['Editor-Version'] = 'vscode/1.96.2';
          headers['Editor-Plugin-Version'] = 'copilot-chat/0.26.7';
          headers['User-Agent'] = 'GitHubCopilotChat/0.26.7';
          headers['Openai-Intent'] = 'conversation-panel';
        }
        const openAIRequestBody: Record<string, unknown> = useResponsesApi
          ? {
              model: firstModel.id,
              input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
              max_output_tokens: CONNECTIVITY_TEST_TOKEN_BUDGET,
            }
          : {
              model: firstModel.id,
              messages: [{ role: 'user', content: 'Hi' }],
            };
        if (!useResponsesApi && shouldUseMaxCompletionTokensForOpenAI(testingProvider, firstModel.id)) {
          openAIRequestBody.max_completion_tokens = CONNECTIVITY_TEST_TOKEN_BUDGET;
        } else {
          if (!useResponsesApi) {
            openAIRequestBody.max_tokens = CONNECTIVITY_TEST_TOKEN_BUDGET;
          }
        }
        response = await window.electron.api.fetch({
          url: openaiUrl,
          method: 'POST',
          headers,
          body: JSON.stringify(openAIRequestBody),
        });
      }

      if (response.ok) {
        enableProvider(testingProvider);
        showTestResultModal({ success: true, message: i18nService.t('connectionSuccess') }, testingProvider);
      } else {
        const data = response.data || {};
        // 提取错误信息
        const errorMessage = data.error?.message || data.message || `${i18nService.t('connectionFailed')}: ${response.status}`;
        if (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('model output limit was reached')) {
          enableProvider(testingProvider);
          showTestResultModal({ success: true, message: i18nService.t('connectionSuccess') }, testingProvider);
          return;
        }
        showTestResultModal({ success: false, message: errorMessage }, testingProvider);
      }
    } catch (err) {
      showTestResultModal({
        success: false,
        message: err instanceof Error ? err.message : i18nService.t('connectionFailed'),
      }, testingProvider);
    } finally {
      setIsTesting(false);
    }
  };

  const buildProvidersExport = async (password: string): Promise<ProvidersExportPayload> => {
    const entries = await Promise.all(
      Object.entries(providers).map(async ([providerKey, providerConfig]) => {
        const apiKey = await encryptWithPassword(providerConfig.apiKey, password);
        const apiFormat = getEffectiveApiFormat(providerKey, providerConfig.apiFormat);
        return [
          providerKey,
          {
            enabled: providerConfig.enabled,
            apiKey,
            baseUrl: resolveBaseUrl(providerKey as ProviderType, providerConfig.baseUrl, apiFormat),
            apiFormat,
            codingPlanEnabled: (providerConfig as ProviderConfig).codingPlanEnabled,
            models: normalizeModels(providerKey, providerConfig.models),
          },
        ] as const;
      })
    );

    return {
      type: EXPORT_FORMAT_TYPE,
      version: 2,
      exportedAt: new Date().toISOString(),
      encryption: {
        algorithm: 'AES-GCM',
        keySource: 'password',
        keyDerivation: 'PBKDF2',
      },
      providers: Object.fromEntries(entries),
    };
  };

  const normalizeModels = (providerKey: string, models?: Model[]) =>
    models?.map(model => ({
      ...model,
      supportsImage: resolveModelSupportsImageForProvider(providerKey, model),
    }));

  const DEFAULT_EXPORT_PASSWORD = EXPORT_PASSWORD;

  const handleExportProviders = async () => {
    setError(null);
    setIsExportingProviders(true);

    try {
      const payload = await buildProvidersExport(DEFAULT_EXPORT_PASSWORD);
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${APP_ID}-providers-${date}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      console.error('Failed to export providers:', err);
      setError(i18nService.t('exportProvidersFailed'));
    } finally {
      setIsExportingProviders(false);
    }
  };

  const handleImportProvidersClick = () => {
    importInputRef.current?.click();
  };

  const handleImportProviders = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setError(null);

    try {
      const raw = await file.text();
      console.log(`[Settings] importing providers from file: ${file.name}, size: ${file.size}`);
      let payload: ProvidersImportPayload;
      try {
        payload = JSON.parse(raw) as ProvidersImportPayload;
      } catch {
        console.warn('[Settings] import failed: invalid JSON in file');
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      if (!payload || payload.type !== EXPORT_FORMAT_TYPE || !payload.providers) {
        console.warn(`[Settings] import failed: invalid format, type=${payload?.type}, hasProviders=${!!payload?.providers}`);
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      // Check if it's version 2 (password-based encryption)
      if (payload.version === 2 && payload.encryption?.keySource === 'password') {
        console.log('[Settings] import: detected v2 password-based encryption');
        await processImportPayloadWithPassword(payload);
        return;
      }

      // Version 1 (legacy local-store key) - try to decrypt with local key
      if (payload.version === 1) {
        console.log('[Settings] import: detected v1 local-key encryption');
        await processImportPayloadWithLocalKey(payload);
        return;
      }

      console.warn(`[Settings] import failed: unsupported version=${payload.version}`);
      setError(i18nService.t('invalidProvidersFile'));
    } catch (err) {
      console.error('[Settings] import failed:', err);
      setError(i18nService.t('importProvidersFailed'));
    }
  };

  const processImportPayloadWithLocalKey = async (payload: ProvidersImportPayload) => {
    setIsImportingProviders(true);
    try {
      const fileKeys = Object.keys(payload.providers ?? {});
      console.log(`[Settings] v1 import: processing ${fileKeys.length} providers from file`);
      const providerUpdates: Partial<ProvidersConfig> = {};
      let hadDecryptFailure = false;
      for (const providerKey of providerKeys) {
        const providerData = payload.providers?.[providerKey];
        if (!providerData) {
          continue;
        }

        let apiKey: string | undefined;
        if (typeof providerData.apiKey === 'string') {
          apiKey = providerData.apiKey;
        } else if (providerData.apiKey && typeof providerData.apiKey === 'object') {
          try {
            apiKey = await decryptSecret(providerData.apiKey as EncryptedPayload);
            console.log(`[Settings] v1 import: decrypted key for ${providerKey}`);
          } catch (error) {
            hadDecryptFailure = true;
            console.warn(`[Settings] v1 import: failed to decrypt key for ${providerKey}`, error);
          }
        } else if (typeof providerData.apiKeyEncrypted === 'string' && typeof providerData.apiKeyIv === 'string') {
          try {
            apiKey = await decryptSecret({ encrypted: providerData.apiKeyEncrypted, iv: providerData.apiKeyIv });
            console.log(`[Settings] v1 import: decrypted key for ${providerKey}`);
          } catch (error) {
            hadDecryptFailure = true;
            console.warn(`[Settings] v1 import: failed to decrypt key for ${providerKey}`, error);
          }
        }

        const models = normalizeModels(providerKey, providerData.models);
        const existing = providers[providerKey];

        providerUpdates[providerKey] = {
          enabled: typeof providerData.enabled === 'boolean' ? providerData.enabled : existing?.enabled ?? false,
          apiKey: apiKey ?? existing?.apiKey ?? '',
          baseUrl: typeof providerData.baseUrl === 'string' ? providerData.baseUrl : existing?.baseUrl ?? '',
          apiFormat: getEffectiveApiFormat(providerKey, providerData.apiFormat ?? existing?.apiFormat),
          codingPlanEnabled: typeof providerData.codingPlanEnabled === 'boolean' ? providerData.codingPlanEnabled : (existing as ProviderConfig)?.codingPlanEnabled,
          models: models ?? existing?.models,
        };
      }

      if (Object.keys(providerUpdates).length === 0) {
        console.warn(`[Settings] v1 import failed: no matching providers found, file keys: ${fileKeys.join(', ')}`);
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      setProviders(prev => {
        const next = { ...prev };
        Object.entries(providerUpdates).forEach(([providerKey, update]) => {
          next[providerKey] = {
            ...prev[providerKey],
            ...update,
          };
        });
        return next;
      });
      setIsTestResultModalOpen(false);
      setTestResult(null);
      console.log(`[Settings] v1 import complete: updated ${Object.keys(providerUpdates).length} providers`);
      if (hadDecryptFailure) {
        setNoticeMessage(i18nService.t('decryptProvidersPartial'));
      }
    } catch (err) {
      console.error('[Settings] v1 import failed:', err);
      const isDecryptError = err instanceof Error
        && (err.message === 'Invalid encrypted payload' || err.name === 'OperationError');
      const message = isDecryptError
        ? i18nService.t('decryptProvidersFailed')
        : i18nService.t('importProvidersFailed');
      setError(message);
    } finally {
      setIsImportingProviders(false);
    }
  };

  const processImportPayloadWithPassword = async (payload: ProvidersImportPayload) => {
    if (!payload.providers) {
      return;
    }

    setIsImportingProviders(true);

    try {
      const fileKeys = Object.keys(payload.providers);
      console.log(`[Settings] v2 import: processing ${fileKeys.length} providers from file`);
      const providerUpdates: Partial<ProvidersConfig> = {};
      let hadDecryptFailure = false;

      for (const providerKey of providerKeys) {
        const providerData = payload.providers[providerKey];
        if (!providerData) {
          continue;
        }

        let apiKey: string | undefined;
        if (typeof providerData.apiKey === 'string') {
          apiKey = providerData.apiKey;
        } else if (providerData.apiKey && typeof providerData.apiKey === 'object') {
          const apiKeyObj = providerData.apiKey as PasswordEncryptedPayload;
          if (apiKeyObj.salt) {
            // Version 2 password-based encryption
            try {
              apiKey = await decryptWithPassword(apiKeyObj, DEFAULT_EXPORT_PASSWORD);
              console.log(`[Settings] v2 import: decrypted key for ${providerKey}`);
            } catch (error) {
              hadDecryptFailure = true;
              console.warn(`[Settings] v2 import: failed to decrypt key for ${providerKey}`, error);
            }
          }
        }

        const models = normalizeModels(providerKey, providerData.models);
        const existing = providers[providerKey];

        providerUpdates[providerKey] = {
          enabled: typeof providerData.enabled === 'boolean' ? providerData.enabled : existing?.enabled ?? false,
          apiKey: apiKey ?? existing?.apiKey ?? '',
          baseUrl: typeof providerData.baseUrl === 'string' ? providerData.baseUrl : existing?.baseUrl ?? '',
          apiFormat: getEffectiveApiFormat(providerKey, providerData.apiFormat ?? existing?.apiFormat),
          codingPlanEnabled: typeof providerData.codingPlanEnabled === 'boolean' ? providerData.codingPlanEnabled : (existing as ProviderConfig)?.codingPlanEnabled,
          models: models ?? existing?.models,
        };
      }

      if (Object.keys(providerUpdates).length === 0) {
        console.warn(`[Settings] v2 import failed: no matching providers found, file keys: ${fileKeys.join(', ')}`);
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      // Check if any key was successfully decrypted
      const anyKeyDecrypted = Object.entries(providerUpdates).some(
        ([key, update]) => update?.apiKey && update.apiKey !== providers[key]?.apiKey
      );

      if (!anyKeyDecrypted && hadDecryptFailure) {
        // All decryptions failed - likely wrong password
        console.warn('[Settings] v2 import failed: all key decryptions failed, likely wrong password');
        setError(i18nService.t('decryptProvidersFailed'));
        return;
      }

      setProviders(prev => {
        const next = { ...prev };
        Object.entries(providerUpdates).forEach(([providerKey, update]) => {
          next[providerKey] = {
            ...prev[providerKey],
            ...update,
          };
        });
        return next;
      });
      setIsTestResultModalOpen(false);
      setTestResult(null);
      console.log(`[Settings] v2 import complete: updated ${Object.keys(providerUpdates).length} providers`);
      if (hadDecryptFailure) {
        setNoticeMessage(i18nService.t('decryptProvidersPartial'));
      }
    } catch (err) {
      console.error('[Settings] v2 import failed:', err);
      const isDecryptError = err instanceof Error
        && (err.message === 'Invalid encrypted payload' || err.name === 'OperationError');
      const message = isDecryptError
        ? i18nService.t('decryptProvidersFailed')
        : i18nService.t('importProvidersFailed');
      setError(message);
    } finally {
      setIsImportingProviders(false);
    }
  };

  // 渲染标签页
  const sidebarTabs: { key: TabType; label: string; icon: React.ReactNode }[] = (() => {
    const allTabs = [
      { key: 'general' as TabType,        label: i18nService.t('general'),        icon: <SettingsSlidersIcon className="h-5 w-5" /> },
      { key: 'appearance' as TabType,     label: i18nService.t('appearance'),     icon: <SunIcon className="h-5 w-5" /> },
      { key: 'coworkAgentEngine' as TabType, label: i18nService.t('coworkAgentEngine'), icon: <CpuChipIcon className="h-5 w-5" /> },
      { key: 'model' as TabType,          label: i18nService.t('settingsCustomModel'), icon: <CubeIcon className="h-5 w-5" /> },
      { key: 'im' as TabType,             label: i18nService.t('imBot'),          icon: <ChatBubbleLeftIcon className="h-5 w-5" /> },
      { key: 'browserWebAccess' as TabType, label: i18nService.t('browserWebAccessTab'), icon: <GlobeAltIcon className="h-5 w-5" /> },
      { key: 'email' as TabType,          label: i18nService.t('emailTab'),       icon: <EnvelopeIcon className="h-5 w-5" /> },
      { key: 'coworkMemory' as TabType,   label: i18nService.t('coworkMemoryTitle'), icon: <BrainIcon className="h-5 w-5" /> },
      { key: 'coworkDreaming' as TabType, label: i18nService.t('coworkMemoryTabDreaming'), icon: <DreamingTabIcon className="h-5 w-5" /> },
      { key: 'plugins' as TabType,        label: i18nService.t('pluginsTab'),     icon: <PlugIcon className="h-5 w-5" /> },
      { key: 'shortcuts' as TabType,      label: i18nService.t('shortcuts'),      icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><rect x="2" y="4" width="20" height="14" rx="2" /><line x1="6" y1="8" x2="8" y2="8" /><line x1="10" y1="8" x2="12" y2="8" /><line x1="14" y1="8" x2="16" y2="8" /><line x1="6" y1="12" x2="8" y2="12" /><line x1="10" y1="12" x2="14" y2="12" /><line x1="16" y1="12" x2="18" y2="12" /><line x1="8" y1="15.5" x2="16" y2="15.5" /></svg> },
      { key: 'about' as TabType,          label: i18nService.t('about'),          icon: <InformationCircleIcon className="h-5 w-5" /> },
    ];
    // Filter out tabs hidden by enterprise config
    // Filter out tabs with 'hide' action in enterprise config
    // e.g., ui: { "settings.im": "hide" } → hide the 'im' tab
    const ui = enterpriseConfig?.ui;
    if (ui) {
      return allTabs.filter(tab => ui[`settings.${tab.key}`] !== 'hide');
    }
    return allTabs;
  })();

  const activeTabLabel = useMemo(() => {
    return sidebarTabs.find(t => t.key === activeTab)?.label ?? '';
  }, [activeTab, sidebarTabs]);

  const renderAppearanceSettings = () => (
    <div className="space-y-8">
      <div>
        <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--lobster-text-primary)' }}>
          {i18nService.t('appearance')}
        </h4>

        <div className="grid grid-cols-3 gap-3 mb-4">
          {(['light', 'dark', 'system'] as const).map((mode) => {
            const isSelected = theme === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setTheme(mode);
                  themeService.setTheme(mode);
                  setThemeId(themeService.getThemeId());
                }}
                className="flex flex-col items-center rounded-xl border-2 p-3 transition-colors cursor-pointer"
                style={{
                  borderColor: isSelected ? 'var(--lobster-primary)' : 'var(--lobster-border)',
                  backgroundColor: isSelected ? 'var(--lobster-primary-muted)' : undefined,
                }}
              >
                <svg viewBox="0 0 120 80" className="w-full h-auto rounded-md mb-2 overflow-hidden" xmlns="http://www.w3.org/2000/svg">
                  {mode === 'light' && (
                    <>
                      <rect width="120" height="80" fill="#F8F9FB" />
                      <rect x="0" y="0" width="30" height="80" fill="#EBEDF0" />
                      <rect x="4" y="8" width="22" height="4" rx="2" fill="#C8CBD0" />
                      <rect x="4" y="16" width="18" height="3" rx="1.5" fill="#D5D7DB" />
                      <rect x="4" y="22" width="20" height="3" rx="1.5" fill="#D5D7DB" />
                      <rect x="4" y="28" width="16" height="3" rx="1.5" fill="#D5D7DB" />
                      <rect x="36" y="8" width="78" height="64" rx="4" fill="#FFFFFF" />
                      <rect x="42" y="16" width="50" height="4" rx="2" fill="#D5D7DB" />
                      <rect x="42" y="24" width="66" height="3" rx="1.5" fill="#E2E4E7" />
                      <rect x="42" y="30" width="60" height="3" rx="1.5" fill="#E2E4E7" />
                      <rect x="42" y="36" width="55" height="3" rx="1.5" fill="#E2E4E7" />
                      <rect x="42" y="46" width="40" height="4" rx="2" fill="#D5D7DB" />
                      <rect x="42" y="54" width="66" height="3" rx="1.5" fill="#E2E4E7" />
                      <rect x="42" y="60" width="58" height="3" rx="1.5" fill="#E2E4E7" />
                    </>
                  )}
                  {mode === 'dark' && (
                    <>
                      <rect width="120" height="80" fill="#0F1117" />
                      <rect x="0" y="0" width="30" height="80" fill="#151820" />
                      <rect x="4" y="8" width="22" height="4" rx="2" fill="#3A3F4B" />
                      <rect x="4" y="16" width="18" height="3" rx="1.5" fill="#2A2F3A" />
                      <rect x="4" y="22" width="20" height="3" rx="1.5" fill="#2A2F3A" />
                      <rect x="4" y="28" width="16" height="3" rx="1.5" fill="#2A2F3A" />
                      <rect x="36" y="8" width="78" height="64" rx="4" fill="#1A1D27" />
                      <rect x="42" y="16" width="50" height="4" rx="2" fill="#3A3F4B" />
                      <rect x="42" y="24" width="66" height="3" rx="1.5" fill="#252930" />
                      <rect x="42" y="30" width="60" height="3" rx="1.5" fill="#252930" />
                      <rect x="42" y="36" width="55" height="3" rx="1.5" fill="#252930" />
                      <rect x="42" y="46" width="40" height="4" rx="2" fill="#3A3F4B" />
                      <rect x="42" y="54" width="66" height="3" rx="1.5" fill="#252930" />
                      <rect x="42" y="60" width="58" height="3" rx="1.5" fill="#252930" />
                    </>
                  )}
                  {mode === 'system' && (
                    <>
                      <defs>
                        <clipPath id="left-half">
                          <rect x="0" y="0" width="60" height="80" />
                        </clipPath>
                        <clipPath id="right-half">
                          <rect x="60" y="0" width="60" height="80" />
                        </clipPath>
                      </defs>
                      <g clipPath="url(#left-half)">
                        <rect width="120" height="80" fill="#F8F9FB" />
                        <rect x="0" y="0" width="30" height="80" fill="#EBEDF0" />
                        <rect x="4" y="8" width="22" height="4" rx="2" fill="#C8CBD0" />
                        <rect x="4" y="16" width="18" height="3" rx="1.5" fill="#D5D7DB" />
                        <rect x="4" y="22" width="20" height="3" rx="1.5" fill="#D5D7DB" />
                        <rect x="4" y="28" width="16" height="3" rx="1.5" fill="#D5D7DB" />
                        <rect x="36" y="8" width="78" height="64" rx="4" fill="#FFFFFF" />
                        <rect x="42" y="16" width="50" height="4" rx="2" fill="#D5D7DB" />
                        <rect x="42" y="24" width="66" height="3" rx="1.5" fill="#E2E4E7" />
                        <rect x="42" y="30" width="60" height="3" rx="1.5" fill="#E2E4E7" />
                        <rect x="42" y="36" width="55" height="3" rx="1.5" fill="#E2E4E7" />
                        <rect x="42" y="46" width="40" height="4" rx="2" fill="#D5D7DB" />
                        <rect x="42" y="54" width="66" height="3" rx="1.5" fill="#E2E4E7" />
                      </g>
                      <g clipPath="url(#right-half)">
                        <rect width="120" height="80" fill="#0F1117" />
                        <rect x="0" y="0" width="30" height="80" fill="#151820" />
                        <rect x="4" y="8" width="22" height="4" rx="2" fill="#3A3F4B" />
                        <rect x="4" y="16" width="18" height="3" rx="1.5" fill="#2A2F3A" />
                        <rect x="4" y="22" width="20" height="3" rx="1.5" fill="#2A2F3A" />
                        <rect x="4" y="28" width="16" height="3" rx="1.5" fill="#2A2F3A" />
                        <rect x="36" y="8" width="78" height="64" rx="4" fill="#1A1D27" />
                        <rect x="42" y="16" width="50" height="4" rx="2" fill="#3A3F4B" />
                        <rect x="42" y="24" width="66" height="3" rx="1.5" fill="#252930" />
                        <rect x="42" y="30" width="60" height="3" rx="1.5" fill="#252930" />
                        <rect x="42" y="36" width="55" height="3" rx="1.5" fill="#252930" />
                        <rect x="42" y="46" width="40" height="4" rx="2" fill="#3A3F4B" />
                        <rect x="42" y="54" width="66" height="3" rx="1.5" fill="#252930" />
                      </g>
                      <line x1="60" y1="0" x2="60" y2="80" stroke="#888" strokeWidth="0.5" />
                    </>
                  )}
                </svg>
                <span className="text-xs font-medium" style={{ color: isSelected ? 'var(--lobster-primary)' : 'var(--lobster-text-primary)' }}>
                  {i18nService.t(mode)}
                </span>
              </button>
            );
          })}
        </div>

        <h4 className="text-sm font-medium mb-3 mt-5" style={{ color: 'var(--lobster-text-primary)' }}>
          {i18nService.t('themeColor')}
        </h4>
        {(() => {
          const allThemes = themeService.getAllThemes();
          const classicThemes = allThemes.filter(t => t.meta.id === 'classic-light' || t.meta.id === 'classic-dark');
          const otherThemes = allThemes.filter(t => t.meta.id !== 'classic-light' && t.meta.id !== 'classic-dark');
          const renderTile = (t: import('../theme').ThemeDefinition) => {
            const isSelected = themeId === t.meta.id;
            const [bg, c1, c2, c3] = t.meta.preview;
            return (
              <button
                key={t.meta.id}
                type="button"
                onClick={() => {
                  themeService.setThemeById(t.meta.id);
                  setThemeId(t.meta.id);
                  setTheme(t.meta.appearance as 'light' | 'dark');
                }}
                className="flex flex-col items-center rounded-xl border-2 p-2 transition-colors cursor-pointer"
                style={{
                  borderColor: isSelected ? 'var(--lobster-primary)' : 'var(--lobster-border)',
                  backgroundColor: isSelected ? 'var(--lobster-primary-muted)' : undefined,
                }}
              >
                <svg viewBox="0 0 80 48" className="w-full h-auto rounded-md mb-1.5 overflow-hidden" xmlns="http://www.w3.org/2000/svg">
                  <rect width="80" height="48" fill={bg} />
                  <rect x="4" y="6" width="20" height="36" rx="3" fill={c1} opacity="0.7" />
                  <rect x="28" y="6" width="48" height="36" rx="3" fill={c2} opacity="0.5" />
                  <circle cx="52" cy="24" r="8" fill={c3} opacity="0.8" />
                  <rect x="32" y="34" width="40" height="4" rx="2" fill={c1} opacity="0.6" />
                </svg>
                <span className="text-[10px] font-medium truncate w-full text-center" style={{ color: isSelected ? 'var(--lobster-primary)' : 'var(--lobster-text-primary)' }}>
                  {i18nService.t('theme-name-' + t.meta.id) || t.meta.name}
                </span>
              </button>
            );
          };
          return (
            <>
              <div className="grid grid-cols-2 gap-3 mb-3">
                {classicThemes.map(renderTile)}
              </div>
              <div className="grid grid-cols-4 gap-3">
                {otherThemes.map(renderTile)}
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );

  const renderTabContent = () => {
    switch(activeTab) {
      case 'general':
        return (
          <div className="space-y-8">
            {/* Language Section */}
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-foreground">
                {i18nService.t('language')}
              </h4>
              <div className="w-[140px] shrink-0">
                <ThemedSelect
                  id="language"
                  value={language}
                  onChange={(value) => {
                    const nextLanguage = value as LanguageType;
                    setLanguage(nextLanguage);
                    i18nService.setLanguage(nextLanguage, { persist: false });
                  }}
                  options={[
                    { value: 'zh', label: i18nService.t('chinese') },
                    { value: 'en', label: i18nService.t('english') }
                  ]}
                />
              </div>
            </div>

            <SettingsToggleRow
              title={i18nService.t('autoLaunch')}
              description={i18nService.t('autoLaunchDescription')}
              checked={autoLaunch}
              disabled={isUpdatingAutoLaunch}
              onToggle={async () => {
                if (isUpdatingAutoLaunch) return;
                const next = !autoLaunch;
                setIsUpdatingAutoLaunch(true);
                try {
                  const result = await window.electron.autoLaunch.set(next);
                  if (result.success) {
                    setAutoLaunchState(next);
                  } else {
                    setError(result.error || 'Failed to update auto-launch setting');
                  }
                } catch (err) {
                  console.error('Failed to set auto-launch:', err);
                  setError('Failed to update auto-launch setting');
                } finally {
                  setIsUpdatingAutoLaunch(false);
                }
              }}
            />

            <SettingsToggleRow
              title={i18nService.t('preventSleep')}
              description={i18nService.t('preventSleepDescription')}
              checked={preventSleep}
              disabled={isUpdatingPreventSleep}
              onToggle={async () => {
                if (isUpdatingPreventSleep) return;
                const next = !preventSleep;
                setIsUpdatingPreventSleep(true);
                try {
                  const result = await window.electron.preventSleep.set(next);
                  if (result.success) {
                    setPreventSleepState(next);
                  } else {
                    setError(result.error || 'Failed to update prevent-sleep setting');
                  }
                } catch (err) {
                  console.error('Failed to set prevent-sleep:', err);
                  setError('Failed to update prevent-sleep setting');
                } finally {
                  setIsUpdatingPreventSleep(false);
                }
              }}
            />

            <SettingsToggleRow
              title={i18nService.t('useSystemProxy')}
              description={i18nService.t('useSystemProxyDescription')}
              checked={useSystemProxy}
              onToggle={() => {
                setUseSystemProxy((prev) => !prev);
              }}
            />

            <SettingsToggleRow
              title={i18nService.t('sqliteAutoBackupEnabled')}
              description={i18nService.t('sqliteAutoBackupEnabledDescription')}
              checked={sqliteAutoBackupEnabled}
              onToggle={() => {
                setSqliteAutoBackupEnabled((prev) => !prev);
              }}
            />

            <SettingsToggleRow
              title={i18nService.t('skipMissedJobs')}
              description={i18nService.t('skipMissedJobsDescription')}
              checked={skipMissedJobs}
              onToggle={() => {
                setSkipMissedJobs((prev) => !prev);
              }}
            />

          </div>
        );

      case 'appearance':
        return renderAppearanceSettings();

      case 'email':
        return <EmailSkillConfig />;

      case 'coworkAgentEngine':
        return (
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-xl border px-3 py-2 text-sm border-border">
                <input
                  type="radio"
                  checked={true}
                  readOnly
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium text-foreground">
                    {i18nService.t('coworkAgentEngineOpenClaw')}
                  </span>
                  <span className="block text-xs text-secondary">
                    {i18nService.t('coworkAgentEngineOpenClawHint')}
                  </span>
                </span>
              </div>
            </div>
            {isOpenClawAgentEngine && (
              <div className="space-y-3 rounded-xl border px-4 py-4 border-border">
                <div className="text-xs text-secondary">
                  {i18nService.t('coworkOpenClawInstallHint')}
                </div>
                <div className={`rounded-xl border px-4 py-3 text-sm ${openClawEngineStatus?.phase === 'error'
                  ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                  : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      {resolveOpenClawStatusText(openClawEngineStatus)}
                      {openClawProgressPercent !== null && (
                        <span className="ml-2 text-xs opacity-80">{openClawProgressPercent}%</span>
                      )}
                    </div>
                  </div>
                  {openClawProgressPercent !== null && (
                    <div className="mt-2 h-2 rounded-full bg-black/10 overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${openClawProgressPercent}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case 'coworkMemory': {
        const memoryTabs = [
          { key: 'entries' as const, titleKey: 'coworkMemoryTabEntries' },
          { key: 'embedding' as const, titleKey: 'coworkMemoryTabEmbedding' },
        ];
        return (
          <div className="flex flex-col h-full space-y-4">
            <div
              className="flex flex-wrap gap-2 border-b border-border pb-3 shrink-0"
              role="tablist"
              aria-label={i18nService.t('coworkMemoryTitle')}
            >
              {memoryTabs.map((tab) => (
                <button
                  type="button"
                  key={tab.key}
                  role="tab"
                  aria-selected={memoryTab === tab.key}
                  onClick={() => setMemoryTab(tab.key)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    memoryTab === tab.key
                      ? 'bg-primary-muted text-primary'
                      : 'text-secondary hover:text-foreground hover:bg-surface-raised'
                  }`}
                >
                  {i18nService.t(tab.titleKey)}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {memoryTab === 'entries' && (
                <div className="space-y-4 rounded-xl border px-4 py-4 border-border">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">
                        {i18nService.t('coworkMemoryCrudTitle')}
                      </div>
                      <div className="text-xs text-secondary">
                        {i18nService.t('coworkMemoryManageHint')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenCoworkMemoryModal}
                      className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm transition-colors active:scale-[0.98]"
                    >
                      <PlusCircleIcon className="h-4 w-4 mr-1.5" />
                      {i18nService.t('coworkMemoryCrudCreate')}
                    </button>
                  </div>

                  {coworkMemoryStats && (
                    <div className="text-xs text-secondary">
                      {`${i18nService.t('coworkMemoryTotalLabel')}: ${coworkMemoryStats.total}`}
                    </div>
                  )}

                  <input
                    type="text"
                    value={coworkMemoryQuery}
                    onChange={(event) => setCoworkMemoryQuery(event.target.value)}
                    placeholder={i18nService.t('coworkMemorySearchPlaceholder')}
                    className="w-full rounded-lg border px-3 py-2 text-sm border-border bg-surface"
                  />

                  <div className="rounded-lg border border-border">
                    {coworkMemoryListLoading ? (
                      <div className="px-3 py-3 text-xs text-secondary">
                        {i18nService.t('loading')}
                      </div>
                    ) : coworkMemoryEntries.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-secondary">
                        {i18nService.t('coworkMemoryEmpty')}
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {coworkMemoryEntries.map((entry) => (
                          <div key={entry.id} className="px-3 py-3 text-xs hover:bg-surface-raised transition-colors">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-foreground break-words">
                                  {entry.text}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleEditCoworkMemoryEntry(entry)}
                                  className="rounded border px-2 py-1 border-border text-foreground hover:bg-surface-raised transition-colors"
                                >
                                  {i18nService.t('edit')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { void handleDeleteCoworkMemoryEntry(entry); }}
                                  className="rounded border px-2 py-1 text-red-500 border-border hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60 transition-colors"
                                  disabled={coworkMemoryListLoading}
                                >
                                  {i18nService.t('delete')}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {memoryTab === 'embedding' && (
                <EmbeddingSettingsSection
                  embeddingEnabled={embeddingEnabled}
                  embeddingProvider={embeddingProvider}
                  embeddingModel={embeddingModel}
                  embeddingVectorWeight={embeddingVectorWeight}
                  embeddingRemoteBaseUrl={embeddingRemoteBaseUrl}
                  embeddingRemoteApiKey={embeddingRemoteApiKey}
                  onEmbeddingEnabledChange={setEmbeddingEnabled}
                  onEmbeddingProviderChange={setEmbeddingProvider}
                  onEmbeddingModelChange={setEmbeddingModel}
                  onEmbeddingVectorWeightChange={setEmbeddingVectorWeight}
                  onEmbeddingRemoteBaseUrlChange={setEmbeddingRemoteBaseUrl}
                  onEmbeddingRemoteApiKeyChange={setEmbeddingRemoteApiKey}
                />
              )}

            </div>
          </div>
        );
      }

      case 'coworkDreaming':
        return (
          <div className="min-h-full">
            <DreamingSettingsSection
              dreamingEnabled={dreamingEnabled}
              dreamingFrequency={dreamingFrequency}
              onDreamingEnabledChange={setDreamingEnabled}
              onDreamingFrequencyChange={setDreamingFrequency}
            />
          </div>
        );

      case 'browserWebAccess':
        return (
          <BrowserWebAccessSettings
            value={browserWebAccess}
            onChange={setBrowserWebAccess}
          />
        );

      case 'model':
        return (
          <ModelSettingsSection
            providers={providers}
            activeProvider={activeProvider}
            visibleProviders={visibleProviders}
            showApiKey={showApiKey}
            setShowApiKey={setShowApiKey}
            isImportingProviders={isImportingProviders}
            isExportingProviders={isExportingProviders}
            minimaxIsOAuthMode={minimaxIsOAuthMode}
            openaiIsOAuthMode={openaiIsOAuthMode}
            isBaseUrlLocked={isBaseUrlLocked}
            minimaxOAuthPhase={minimaxOAuthPhase}
            minimaxOAuthRegion={minimaxOAuthRegion}
            setMinimaxOAuthRegion={setMinimaxOAuthRegion}
            setMinimaxOAuthPhase={setMinimaxOAuthPhase}
            openaiOAuthPhase={openaiOAuthPhase}
            setOpenaiOAuthPhase={setOpenaiOAuthPhase}
            openaiOAuthStatus={openaiOAuthStatus}
            copilotAuthStatus={copilotAuthStatus}
            copilotUserCode={copilotUserCode}
            copilotVerificationUri={copilotVerificationUri}
            copilotGithubUser={copilotGithubUser}
            copilotError={copilotError}
            isTesting={isTesting}
            testResult={testResult}
            isTestResultModalOpen={isTestResultModalOpen}
            setIsTestResultModalOpen={setIsTestResultModalOpen}
            pendingDeleteProvider={pendingDeleteProvider}
            setPendingDeleteProvider={setPendingDeleteProvider}
            importInputRef={importInputRef}
            handleImportProvidersClick={handleImportProvidersClick}
            handleExportProviders={handleExportProviders}
            handleImportProviders={handleImportProviders}
            handleProviderChange={handleProviderChange}
            toggleProviderEnabled={toggleProviderEnabled}
            handleAddCustomProvider={handleAddCustomProvider}
            handleDeleteCustomProvider={handleDeleteCustomProvider}
            confirmDeleteCustomProvider={confirmDeleteCustomProvider}
            handleProviderConfigChange={handleProviderConfigChange}
            setProviders={setProviders}
            handleMiniMaxDeviceLogin={handleMiniMaxDeviceLogin}
            handleCancelMiniMaxLogin={handleCancelMiniMaxLogin}
            handleMiniMaxOAuthLogout={handleMiniMaxOAuthLogout}
            handleOpenAIOAuthLogin={handleOpenAIOAuthLogin}
            handleCancelOpenAIOAuthLogin={handleCancelOpenAIOAuthLogin}
            handleOpenAIOAuthLogout={handleOpenAIOAuthLogout}
            handleCopilotSignIn={handleCopilotSignIn}
            handleCopilotSignOut={handleCopilotSignOut}
            handleCopilotCancelAuth={handleCopilotCancelAuth}
            handleTestConnection={handleTestConnection}
            handleAddModel={handleAddModel}
            handleEditModel={handleEditModel}
            handleDeleteModel={handleDeleteModel}
          />
        );

      case 'shortcuts':
        return (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-foreground mb-3">
                {i18nService.t('keyboardShortcuts')}
              </label>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{i18nService.t('newChat')}</span>
                  <ShortcutRecorder value={shortcuts.newChat} onChange={(v) => handleShortcutChange('newChat', v)} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{i18nService.t('search')}</span>
                  <ShortcutRecorder value={shortcuts.search} onChange={(v) => handleShortcutChange('search', v)} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{i18nService.t('openSettings')}</span>
                  <ShortcutRecorder value={shortcuts.settings} onChange={(v) => handleShortcutChange('settings', v)} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{i18nService.t('sendMessageShortcut')}</span>
                  <SendShortcutSelect
                    value={shortcuts.sendMessage}
                    onChange={(v) => handleShortcutChange('sendMessage', v)}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case 'im':
        return <IMSettings />;

      case 'plugins':
        return (
          <PluginsSettings
            handleRef={pluginsSettingsRef}
          />
        );

      case 'about':
        return (
          <div className="flex min-h-full flex-col items-center pt-6 pb-3">
            {/* Logo & App Name */}
            <img
              src="logo.png"
              alt="LobsterAI"
              className="w-16 h-16 mb-3 cursor-pointer select-none"
              onClick={() => {
                const next = logoClickCount + 1;
                setLogoClickCount(next);
                if (next >= 10 && !testModeUnlocked) {
                  setTestModeUnlocked(true);
                }
              }}
            />
            <h3 className="text-lg font-semibold text-foreground">LobsterAI</h3>
            <span className="text-xs text-secondary mt-1">v{appVersion}</span>

            {/* Info Card */}
            <div className="w-full mt-8 rounded-xl border border-border overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 border-b border-border">
                <span className="shrink-0 text-sm text-foreground">{i18nService.t('aboutVersion')}</span>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <span className="text-sm text-secondary">{appVersion}</span>
                  {!enterpriseConfig?.disableUpdate && (
                  <button
                    type="button"
                    disabled={updateCheckStatus === 'checking' || updateCheckStatus === 'downloading'}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCheckUpdate();
                    }}
                    className="text-xs px-2 py-0.5 rounded-md border border-border text-secondary hover:text-primary dark:hover:text-primary hover:border-primary dark:hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {updateButtonLabel}
                  </button>
                  )}
                  {enterpriseConfig?.disableUpdate && (
                  <span className="text-xs text-claude-textSecondary dark:text-claude-darkTextSecondary">
                    {i18nService.t('settings.enterprise.managed')}
                  </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 border-b border-border">
                <span className="shrink-0 text-sm text-foreground">{i18nService.t('aboutContactEmail')}</span>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCopyContactEmail();
                    }}
                    title={i18nService.t('copyToClipboard')}
                    className="min-w-0 break-all text-right text-sm text-secondary bg-transparent border-none appearance-none p-0 m-0 cursor-pointer focus:outline-none"
                  >
                    {ABOUT_CONTACT_EMAIL}
                  </button>
                  {emailCopied && (
                    <span className="text-[11px] leading-4 text-emerald-600 dark:text-emerald-400">
                      {i18nService.t('copied')}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 border-b border-border">
                <span className="shrink-0 text-sm text-foreground">{i18nService.t('aboutUserManual')}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenUserManual();
                  }}
                  className="min-w-0 break-all text-right text-sm text-secondary hover:text-primary dark:hover:text-primary bg-transparent border-none appearance-none px-1.5 py-0.5 -mx-1.5 -my-0.5 rounded-md cursor-pointer focus:outline-none hover:bg-surface-raised transition-colors"
                >
                  {ABOUT_USER_MANUAL_URL}
                </button>
              </div>
              <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3${testModeUnlocked ? ' border-b border-border' : ''}`}>
                <span className="shrink-0 text-sm text-foreground">{i18nService.t('aboutUserCommunity')}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenUserCommunity();
                  }}
                  className="min-w-0 break-all text-right text-sm text-secondary hover:text-primary dark:hover:text-primary bg-transparent border-none appearance-none px-1.5 py-0.5 -mx-1.5 -my-0.5 rounded-md cursor-pointer focus:outline-none hover:bg-surface-raised transition-colors"
                >
                  {ABOUT_USER_COMMUNITY_URL}
                </button>
              </div>
              {testModeUnlocked && (
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                  <span className="shrink-0 text-sm text-foreground">{i18nService.t('testMode')}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={testMode}
                    onClick={() => setTestMode((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                      testMode ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        testMode ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-auto w-full pt-14 pb-2 flex flex-col items-center">
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-secondary">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenServiceTerms();
                  }}
                  className="bg-transparent border-none appearance-none px-1.5 py-0.5 -mx-1.5 -my-0.5 rounded-md cursor-pointer hover:text-primary dark:hover:text-primary transition-colors"
                >
                  {i18nService.t('aboutServiceTerms')}
                </button>
                <span className="text-xs opacity-40">|</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleExportLogs();
                  }}
                  disabled={isExportingLogs}
                  className="bg-transparent border-none appearance-none px-1.5 py-0.5 -mx-1.5 -my-0.5 rounded-md cursor-pointer hover:text-primary dark:hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExportingLogs ? i18nService.t('aboutExportingLogs') : i18nService.t('aboutExportLogs')}
                </button>
              </div>

              <p className="mt-5 text-center text-xs text-secondary">
                {i18nService.t('copyrightHolder')}
              </p>
              <p className="mt-1 text-center text-xs text-secondary">
                Copyright &copy; {new Date().getFullYear()} NetEase Youdao. All Rights Reserved.
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Modal
      onClose={guardedClose}
      overlayClassName="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-3 sm:p-4"
      className="w-[calc(100vw-1.5rem)] max-w-[900px] min-w-0 sm:w-[calc(100vw-2rem)]"
    >
      <div
        className="relative flex h-[80vh] max-h-[calc(100vh-2rem)] w-full min-w-0 rounded-2xl border-border border shadow-modal overflow-hidden modal-content"
        onClick={handleSettingsClick}
      >
        {/* Left sidebar */}
        <div className="w-[220px] shrink-0 flex flex-col bg-surface-raised border-r border-border rounded-l-2xl overflow-y-auto">
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-lg font-semibold text-foreground">{i18nService.t('settings')}</h2>
          </div>
          <nav className="flex flex-col gap-0.5 px-3 pb-4">
            {sidebarTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === tab.key
                    ? 'bg-primary-muted text-primary'
                    : 'text-secondary hover:text-foreground hover:bg-surface-raised'
                }`}
              >
                <span className="shrink-0">{tab.icon}</span>
                <span className="min-w-0 truncate">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Right content */}
        <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden bg-background rounded-r-2xl">
          {/* Content header */}
          <div className="flex justify-between items-center gap-3 px-6 pt-5 pb-3 shrink-0">
            <h3 className="min-w-0 truncate text-lg font-semibold text-foreground">{activeTabLabel}</h3>
            <button
              onClick={guardedClose}
              className="text-secondary hover:text-foreground p-1.5 hover:bg-surface-raised rounded-lg transition-colors"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {noticeMessage && (
            <div className="px-6">
              <ErrorMessage
                message={noticeMessage}
                onClose={() => setNoticeMessage(null)}
              />
            </div>
          )}

          {error && (
            <div className="px-6">
              <ErrorMessage
                message={error}
                onClose={() => setError(null)}
              />
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            {/* Tab content */}
            <div
              ref={contentRef}
              className="px-6 py-4 flex-1 overflow-y-auto"
              style={{ scrollbarGutter: 'stable' }}
            >
              {renderTabContent()}
            </div>

            {/* Footer buttons */}
            <div className="flex justify-end space-x-4 p-4 border-border border-t bg-background shrink-0">
              <button
                type="button"
                onClick={guardedClose}
                className="px-4 py-2 rounded-xl transition-colors text-sm font-medium border border-border text-foreground hover:bg-surface-raised active:scale-[0.98]"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {isSaving ? i18nService.t('saving') : i18nService.t('save')}
              </button>
            </div>
          </form>

        </div>

        <ModelEditorDialog
          activeProvider={activeProvider}
          isAddingModel={isAddingModel}
          isEditingModel={isEditingModel}
          newModelName={newModelName}
          setNewModelName={setNewModelName}
          newModelId={newModelId}
          setNewModelId={setNewModelId}
          newModelSupportsImage={newModelSupportsImage}
          setNewModelSupportsImage={setNewModelSupportsImage}
          newModelContextWindow={newModelContextWindow}
          setNewModelContextWindow={setNewModelContextWindow}
          newModelCustomParams={newModelCustomParams}
          setNewModelCustomParams={setNewModelCustomParams}
          modelFormError={modelFormError}
          setModelFormError={setModelFormError}
          handleSaveNewModel={handleSaveNewModel}
          handleCancelModelEdit={handleCancelModelEdit}
          handleModelDialogKeyDown={handleModelDialogKeyDown}
        />

          {/* Memory Modal */}
          {showMemoryModal && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/35 px-4 rounded-2xl"
              onClick={resetCoworkMemoryEditor}
            >
              <div
                className="bg-surface border-border border rounded-2xl shadow-xl w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-5 pt-5 pb-4 border-b border-border">
                  <h3 className="text-base font-semibold text-foreground">
                    {coworkMemoryEditingId ? i18nService.t('coworkMemoryCrudUpdate') : i18nService.t('coworkMemoryCrudCreate')}
                  </h3>
                </div>

                <div className="px-5 py-4 space-y-4">
                  {coworkMemoryEditingId && (
                    <div className="rounded-lg border px-2 py-1 text-xs border-border text-secondary">
                      {i18nService.t('coworkMemoryEditingTag')}
                    </div>
                  )}
                  <label className="block text-xs font-medium text-secondary mb-1">
                    {i18nService.t('coworkMemoryCrudContentLabel')}<span className="text-red-500 dark:text-red-400 ml-0.5">*</span>
                  </label>
                  <textarea
                    value={coworkMemoryDraftText}
                    onChange={(event) => setCoworkMemoryDraftText(event.target.value)}
                    placeholder={i18nService.t('coworkMemoryCrudTextPlaceholder')}
                    autoFocus
                    className="min-h-[200px] w-full rounded-lg border px-3 py-2 text-sm border-border bg-surface text-foreground focus:border-primary focus:ring-1 focus:ring-primary/30"
                  />
                </div>

                <div className="flex justify-end space-x-2 px-5 pb-5">
                  <button
                    type="button"
                    onClick={resetCoworkMemoryEditor}
                    className="px-3 py-1.5 text-sm text-foreground hover:bg-surface-raised rounded-xl border border-border transition-colors"
                  >
                    {i18nService.t('cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleSaveCoworkMemoryEntry(); }}
                    disabled={!coworkMemoryDraftText.trim() || coworkMemoryListLoading}
                    className="px-3 py-1.5 text-sm text-white bg-primary hover:bg-primary-hover rounded-xl disabled:opacity-60 disabled:cursor-not-allowed transition-colors active:scale-[0.98]"
                  >
                    {coworkMemoryEditingId ? i18nService.t('save') : i18nService.t('coworkMemoryCrudCreate')}
                  </button>
                </div>
              </div>
            </div>
          )}

      </div>
    </Modal>
  );
};

export default Settings;
