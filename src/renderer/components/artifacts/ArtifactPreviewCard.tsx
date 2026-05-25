import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid';
import { ChevronDownIcon, FolderIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch } from 'react-redux';

import { i18nService } from '@/services/i18n';
import { openArtifactPreviewTab } from '@/store/slices/artifactSlice';
import { type Artifact, type ArtifactType, ArtifactTypeValue } from '@/types/artifact';

const t = (key: string) => i18nService.t(key);

const GlobeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <ellipse cx="12" cy="12" rx="4.5" ry="10" />
    <path d="M2 12h20" />
  </svg>
);

const SvgIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);

const ImageIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);

const MermaidIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="8.5" y="14" width="7" height="7" rx="1" />
    <path d="M6.5 10v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
    <path d="M12 12.5V14" />
  </svg>
);

const MarkdownIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 15V9l2.5 3L12 9v6" />
    <path d="M17 12l-2 3h4l-2-3z" />
  </svg>
);

const TextIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
  </svg>
);

const DocumentIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <rect x="8" y="12" width="8" height="6" rx="1" />
  </svg>
);

const VideoIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <polygon points="10 9 16 12 10 15" />
  </svg>
);

const AppIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M8 12h8" />
    <path d="M12 8v8" />
  </svg>
);

const TYPE_ICON_MAP: Record<ArtifactType, React.FC<{ className?: string }>> = {
  html: GlobeIcon,
  svg: SvgIcon,
  image: ImageIcon,
  video: VideoIcon,
  mermaid: MermaidIcon,
  code: GlobeIcon,
  markdown: MarkdownIcon,
  text: TextIcon,
  document: DocumentIcon,
  'local-service': GlobeIcon,
};

const SUPPORTS_OPEN_DROPDOWN: ReadonlySet<ArtifactType> = new Set(['document', 'markdown']);

const TYPE_LABEL_KEY: Record<ArtifactType, string> = {
  html: 'artifactTypeHtml',
  svg: 'artifactTypeSvg',
  image: 'artifactTypeImage',
  video: 'artifactTypeVideo',
  mermaid: 'artifactTypeMermaid',
  code: 'artifactTypeHtml',
  markdown: 'artifactTypeMarkdown',
  text: 'artifactTypeText',
  document: 'artifactTypeDocument',
  'local-service': 'artifactTypeHtml',
};

function normalizeFilePath(filePath: string): string {
  let normalized = filePath;
  if (normalized.startsWith('file:///')) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith('file://')) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith('file:/')) {
    normalized = normalized.slice(5);
  }
  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  return normalized;
}

// ── Dropdown Menu for Document Artifacts ──────────────────────────

interface AppInfo {
  name: string;
  path: string;
  isDefault: boolean;
  icon?: string;
}

interface OpenDropdownProps {
  anchorRef: React.RefObject<HTMLElement>;
  filePath: string;
  onClose: () => void;
}

const OpenDropdown: React.FC<OpenDropdownProps> = ({ anchorRef, filePath, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const normalized = normalizeFilePath(filePath);
    window.electron?.shell?.getAppsForFile(normalized).then(result => {
      if (cancelled) return;
      if (result?.success && result.apps?.length > 0) {
        setApps(result.apps);
      }
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [filePath]);

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const MAX_MENU_HEIGHT = 320;
    const naturalHeight = loading ? 88 : Math.max(88, (apps.length + 1) * 36 + 16);
    const estimatedHeight = Math.min(MAX_MENU_HEIGHT, naturalHeight);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    let top: number;
    if (spaceBelow >= estimatedHeight + 4) {
      top = rect.bottom + 4;
    } else if (spaceAbove >= estimatedHeight + 4) {
      top = rect.top - estimatedHeight - 4;
    } else {
      // Neither side has enough room — pick whichever is larger and clamp.
      top = spaceBelow >= spaceAbove
        ? Math.max(8, window.innerHeight - estimatedHeight - 8)
        : 8;
    }
    const left = Math.min(rect.right, window.innerWidth - 200);
    setPosition({ top, left });
  }, [anchorRef, apps, loading]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [anchorRef, onClose]);

  const handleOpenWithSpecificApp = useCallback((appPath: string) => {
    const normalized = normalizeFilePath(filePath);
    window.electron?.shell?.openPathWithApp(normalized, appPath);
    onClose();
  }, [filePath, onClose]);

  const handleOpenWithDefault = useCallback(() => {
    const normalized = normalizeFilePath(filePath);
    window.electron?.shell?.openPath(normalized);
    onClose();
  }, [filePath, onClose]);

  const handleRevealInFolder = useCallback(() => {
    const normalized = normalizeFilePath(filePath);
    window.electron?.shell?.showItemInFolder(normalized);
    onClose();
  }, [filePath, onClose]);

  if (!position) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[10000] min-w-[180px] max-h-[320px] overflow-y-auto rounded-lg border border-border bg-surface-raised shadow-lg py-1 animate-in fade-in zoom-in-95 duration-100"
      style={{ top: position.top, left: position.left, transform: 'translateX(-100%)' }}
    >
      {loading ? (
        <div className="flex items-center justify-center px-3 py-3">
          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : apps.length > 0 ? (
        <>
          {apps.map((app, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleOpenWithSpecificApp(app.path)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors text-left"
            >
              {app.icon ? (
                <img src={app.icon} alt="" className="w-4 h-4 flex-shrink-0" draggable={false} />
              ) : (
                <AppIcon className="w-4 h-4 text-secondary flex-shrink-0" />
              )}
              <span className="truncate">{app.name}</span>
            </button>
          ))}
        </>
      ) : (
        <button
          type="button"
          onClick={handleOpenWithDefault}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors text-left"
        >
          <AppIcon className="w-4 h-4 text-secondary flex-shrink-0" />
          <span>{t('artifactOpenWithApp')}</span>
        </button>
      )}
      <div className="mx-2 my-1 border-t border-border" />
      <button
        type="button"
        onClick={handleRevealInFolder}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors text-left"
      >
        <FolderIcon className="w-4 h-4 text-secondary flex-shrink-0" />
        <span>{t('artifactOpenInFolder')}</span>
      </button>
    </div>,
    document.body
  );
};

// ── Main Card Component ──────────────────────────────────────────

interface ArtifactPreviewCardProps {
  artifact: Artifact;
  onOpenLocalService?: (artifact: Artifact) => void;
}

const ArtifactPreviewCard: React.FC<ArtifactPreviewCardProps> = ({ artifact, onOpenLocalService }) => {
  const dispatch = useDispatch();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownAnchorRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (artifact.type === ArtifactTypeValue.LocalService && onOpenLocalService) {
      onOpenLocalService(artifact);
      return;
    }
    dispatch(openArtifactPreviewTab({ sessionId: artifact.sessionId, artifactId: artifact.id }));
  };

  const IconComponent = TYPE_ICON_MAP[artifact.type];
  const title = artifact.fileName || artifact.title;
  const subtitle = t(TYPE_LABEL_KEY[artifact.type]);
  const isDocumentWithFile = SUPPORTS_OPEN_DROPDOWN.has(artifact.type) && !!artifact.filePath;

  if (isDocumentWithFile) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-surface-raised hover:bg-surface-hover transition-colors max-w-sm w-full text-left">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <IconComponent className="w-5 h-5 text-primary" />
        </div>
        <button
          type="button"
          onClick={handleClick}
          className="flex-1 min-w-0 text-left cursor-pointer bg-transparent border-none p-0"
        >
          <div className="text-sm font-medium text-foreground truncate">{title}</div>
          <div className="text-xs text-secondary">{subtitle}</div>
        </button>
        <button
          ref={dropdownAnchorRef as React.RefObject<HTMLButtonElement>}
          type="button"
          onClick={(e) => { e.stopPropagation(); setDropdownOpen(v => !v); }}
          className="flex-shrink-0 ml-auto flex items-center gap-1 text-primary text-sm font-medium pl-6 py-1 min-w-[68px] rounded-md hover:bg-primary/10 transition-colors"
        >
          <span>{t('artifactOpen')}</span>
          <ChevronDownIcon className="w-3.5 h-3.5" />
        </button>
        {dropdownOpen && (
          <OpenDropdown
            anchorRef={dropdownAnchorRef as React.RefObject<HTMLElement>}
            filePath={artifact.filePath!}
            onClose={() => setDropdownOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-surface-raised hover:bg-surface-hover transition-colors cursor-pointer max-w-sm w-full text-left"
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
        <IconComponent className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{title}</div>
        <div className="text-xs text-secondary">{subtitle}</div>
      </div>
      <div className="flex-shrink-0 flex items-center gap-1 text-primary text-sm font-medium leading-none">
        <ArrowTopRightOnSquareIcon className="w-4 h-4 shrink-0" />
        <span>{t('artifactOpen')}</span>
      </div>
    </button>
  );
};

export default ArtifactPreviewCard;
