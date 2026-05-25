import React from 'react';

import { i18nService } from '../../services/i18n';
import type { SubagentSessionSummary } from '../../types/cowork';
import LoadingIcon from '../icons/LoadingIcon';

interface SubagentTaskRowProps {
  subagent: SubagentSessionSummary;
  isSelected?: boolean;
  onSelect: () => void;
}

const formatDuration = (createdAt: number): string => {
  const elapsed = Date.now() - createdAt;
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const SubagentTaskRow: React.FC<SubagentTaskRowProps> = ({ subagent, isSelected = false, onSelect }) => {
  const displayName = subagent.label ?? subagent.agentId ?? i18nService.t('subagentUnnamed');
  const duration = formatDuration(subagent.createdAt);

  return (
    <div
      className={`group relative -ml-[6px] flex h-[26px] w-[calc(100%+12px)] cursor-pointer items-center gap-1.5 rounded-md pl-[52px] pr-2.5 text-[13px] font-normal transition-colors ${
        isSelected
          ? 'bg-black/[0.06] text-foreground/80 dark:bg-white/[0.07]'
          : 'text-foreground/60 hover:bg-black/[0.03] hover:text-foreground/80 dark:hover:bg-white/[0.04]'
      }`}
      onClick={onSelect}
      role="treeitem"
      aria-level={3}
      aria-selected={isSelected}
    >
      <span className="min-w-0 flex-1 truncate">
        {displayName}
      </span>

      {subagent.status === 'running' ? (
        <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
          <LoadingIcon className="h-3 w-3 animate-spin text-secondary" aria-hidden="true" />
        </span>
      ) : subagent.status === 'error' ? (
        <span className="shrink-0 whitespace-nowrap text-[11px] font-normal text-red-500/60">
          {i18nService.t('subagentError') || 'Error'}
        </span>
      ) : (
        <span className="shrink-0 whitespace-nowrap text-[11px] font-normal text-foreground opacity-[0.28]">
          {duration}
        </span>
      )}
    </div>
  );
};

export default SubagentTaskRow;
