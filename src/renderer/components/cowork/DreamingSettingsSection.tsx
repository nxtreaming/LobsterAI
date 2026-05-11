import React, { useCallback,useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { DreamDiaryData, DreamingEntry,DreamingStatusData } from '../../types/cowork';

interface DreamingSettingsSectionProps {
  dreamingEnabled: boolean;
  dreamingFrequency: string;
  dreamingModel: string;
  dreamingTimezone: string;
  onDreamingEnabledChange: (value: boolean) => void;
  onDreamingFrequencyChange: (value: string) => void;
  onDreamingModelChange: (value: string) => void;
  onDreamingTimezoneChange: (value: string) => void;
}

const FREQUENCY_PRESETS = [
  { value: '0 3 * * *', labelKey: 'coworkMemoryDreamingFreqNightly3am' },
  { value: '0 0 * * *', labelKey: 'coworkMemoryDreamingFreqMidnight' },
  { value: '0 0,12 * * *', labelKey: 'coworkMemoryDreamingFreqTwiceDaily' },
  { value: '0 */6 * * *', labelKey: 'coworkMemoryDreamingFreqEvery6h' },
  { value: '0 3 * * 0', labelKey: 'coworkMemoryDreamingFreqWeekly' },
] as const;

const CUSTOM_VALUE = '__custom__';

// ── Diary parser (mirrors OpenClaw's parseDiaryEntries) ──────────────

type DiaryEntry = {
  date: string;
  body: string;
};

const DIARY_START_RE = /<!--\s*openclaw:dreaming:diary:start\s*-->/;
const DIARY_END_RE = /<!--\s*openclaw:dreaming:diary:end\s*-->/;

function parseDiaryEntries(raw: string): DiaryEntry[] {
  let content = raw;
  const startMatch = DIARY_START_RE.exec(raw);
  const endMatch = DIARY_END_RE.exec(raw);
  if (startMatch && endMatch && endMatch.index > startMatch.index) {
    content = raw.slice(startMatch.index + startMatch[0].length, endMatch.index);
  }
  const entries: DiaryEntry[] = [];
  const blocks = content.split(/\n---\n/).filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    let date = '';
    const bodyLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!date && trimmed.startsWith('*') && trimmed.endsWith('*') && trimmed.length > 2) {
        date = trimmed.slice(1, -1);
        continue;
      }
      if (trimmed.startsWith('#') || trimmed.startsWith('<!--')) continue;
      if (trimmed.length > 0) bodyLines.push(trimmed);
    }
    if (bodyLines.length > 0) {
      entries.push({ date, body: bodyLines.join('\n') });
    }
  }
  return entries;
}

function flattenDiaryBody(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        line !== 'What Happened' &&
        line !== 'Reflections' &&
        line !== 'Candidates' &&
        line !== 'Possible Lasting Updates',
    )
    .map((line) => line.replace(/\s*\[memory\/[^\]]+\]/g, ''))
    .map((line) =>
      line
        .replace(/^(?:\d+\.\s+|-\s+(?:\[[^\]]+\]\s+)?(?:[a-z_]+:\s+)?)/i, '')
        .replace(/^(?:likely_durable|likely_situational|unclear):\s+/i, '')
        .trim(),
    )
    .filter((line) => line.length > 0);
}

function formatDiaryChipLabel(date: string): string {
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return date;
  const value = new Date(parsed);
  return `${value.getMonth() + 1}/${value.getDate()}`;
}

function formatPhaseNextRun(nextRunAtMs?: number): string {
  if (!nextRunAtMs) return '—';
  const d = new Date(nextRunAtMs);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatCompactDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRange(path: string, startLine: number, endLine: number): string {
  return startLine === endLine ? `${path}:${startLine}` : `${path}:${startLine}-${endLine}`;
}

function describeEntryOrigin(entry: DreamingEntry): string {
  const hasGrounded = entry.groundedCount > 0;
  const hasLive = entry.recallCount > 0 || entry.dailyCount > 0;
  if (hasGrounded && hasLive) return i18nService.t('coworkDreamingAdvancedOriginMixed');
  if (hasGrounded) return i18nService.t('coworkDreamingAdvancedOriginDailyLog');
  return i18nService.t('coworkDreamingAdvancedOriginLive');
}

// ── Sub-components ───────────────────────────────────────────────────

type DreamingContentTab = 'scene' | 'diary' | 'advanced';
type AdvancedSort = 'recent' | 'signals';

function SceneTab({ status }: { status: DreamingStatusData }) {
  const phases = status.phases;
  const phaseEntries: { key: 'light' | 'deep' | 'rem'; labelKey: string }[] = [
    { key: 'light', labelKey: 'coworkDreamingPhaseLight' },
    { key: 'deep', labelKey: 'coworkDreamingPhaseDeep' },
    { key: 'rem', labelKey: 'coworkDreamingPhaseRem' },
  ];

  return (
    <div className="space-y-4">
      {/* Status indicator */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-raised">
        <div className={`w-2 h-2 rounded-full ${status.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
        <span className="text-sm font-medium text-foreground">
          {status.enabled ? i18nService.t('coworkDreamingStatusActive') : i18nService.t('coworkDreamingStatusIdle')}
        </span>
        <span className="text-xs text-secondary ml-auto">
          {status.promotedToday} {i18nService.t('coworkDreamingPromoted')}
          {status.timezone ? ` · ${status.timezone}` : ''}
        </span>
      </div>

      {/* Sleep phases */}
      {phases && (
        <div className="space-y-2">
          {phaseEntries.map(({ key, labelKey }) => {
            const phase = phases[key];
            const enabled = phase?.enabled === true;
            const nextRun = formatPhaseNextRun(phase?.nextRunAtMs);
            return (
              <div key={key} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                <div className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="font-medium text-foreground w-12">{i18nService.t(labelKey)}</span>
                <span className="text-secondary">
                  {enabled ? nextRun : i18nService.t('coworkDreamingPhaseOff')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DiaryTab({ diary, loading, onRefresh }: {
  diary: DreamDiaryData | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [page, setPage] = useState(0);

  const entries = useMemo(() => {
    if (!diary?.content) return [];
    return parseDiaryEntries(diary.content);
  }, [diary?.content]);

  const reversed = useMemo(() => [...entries].reverse(), [entries]);

  useEffect(() => { setPage(0); }, [diary?.content]);

  if (loading && !diary) {
    return <div className="px-3 py-6 text-xs text-secondary text-center">{i18nService.t('loading')}</div>;
  }

  if (!diary?.content || entries.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-center space-y-2">
        <div className="text-sm text-secondary">{i18nService.t('coworkDreamingDiaryEmpty')}</div>
        <div className="text-xs text-secondary">{i18nService.t('coworkDreamingDiaryEmptyHint')}</div>
      </div>
    );
  }

  const currentPage = Math.max(0, Math.min(page, reversed.length - 1));
  const entry = reversed[currentPage];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-secondary">{i18nService.t('coworkDreamingDiaryHint')}</p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-xs text-primary hover:underline disabled:opacity-50"
        >
          {loading ? i18nService.t('coworkDreamingDiaryRefreshing') : i18nService.t('coworkDreamingDiaryRefresh')}
        </button>
      </div>

      {/* Date chips */}
      <div className="flex flex-wrap gap-1">
        {reversed.map((e, idx) => (
          <button
            type="button"
            key={idx}
            onClick={() => setPage(idx)}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              idx === currentPage
                ? 'bg-primary text-white'
                : 'bg-surface-raised text-secondary hover:text-foreground'
            }`}
          >
            {formatDiaryChipLabel(e.date)}
          </button>
        ))}
      </div>

      {/* Entry content */}
      {entry && (
        <div className="rounded-lg border border-border px-4 py-3 space-y-2">
          {entry.date && (
            <div className="text-xs font-medium text-secondary">{entry.date}</div>
          )}
          <div className="space-y-1.5">
            {flattenDiaryBody(entry.body).map((para, i) => (
              <p key={i} className="text-xs text-foreground leading-relaxed">{para}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AdvancedEntryList({ title, description, emptyText, entries, badge }: {
  title: string;
  description: string;
  emptyText: string;
  entries: DreamingEntry[];
  badge?: (entry: DreamingEntry) => string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-foreground">{title}</div>
          <div className="text-xs text-secondary">{description}</div>
        </div>
        <span className="text-xs text-secondary bg-surface-raised px-1.5 py-0.5 rounded">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="px-3 py-3 text-xs text-secondary">{emptyText}</div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border">
          {entries.map((entry) => (
            <div key={entry.key} className="px-3 py-2 text-xs space-y-1">
              {badge && (
                <span className="inline-block px-1.5 py-0.5 rounded bg-surface-raised text-secondary text-[10px]">
                  {badge(entry)}
                </span>
              )}
              <div className="text-foreground">{entry.snippet}</div>
              <div className="text-secondary font-mono text-[10px]">
                {formatRange(entry.path, entry.startLine, entry.endLine)}
              </div>
              <div className="text-secondary text-[10px]">
                {[
                  entry.totalSignalCount > 0 ? `${entry.totalSignalCount} signals` : '',
                  entry.recallCount > 0 ? `${entry.recallCount} recall` : '',
                  entry.dailyCount > 0 ? `${entry.dailyCount} daily` : '',
                  entry.groundedCount > 0 ? `${entry.groundedCount} grounded` : '',
                  entry.promotedAt ? `promoted ${formatCompactDateTime(entry.promotedAt)}` : '',
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdvancedTab({ status }: { status: DreamingStatusData }) {
  const [sort, setSort] = useState<AdvancedSort>('recent');

  const groundedEntries = useMemo(
    () => status.shortTermEntries.filter((e) => e.groundedCount > 0),
    [status.shortTermEntries],
  );

  const waitingEntries = useMemo(() => {
    const sorted = [...status.shortTermEntries];
    if (sort === 'signals') {
      sorted.sort((a, b) => {
        if (b.totalSignalCount !== a.totalSignalCount) return b.totalSignalCount - a.totalSignalCount;
        if (b.phaseHitCount !== a.phaseHitCount) return b.phaseHitCount - a.phaseHitCount;
        return 0;
      });
    } else {
      sorted.sort((a, b) => {
        const aMs = a.lastRecalledAt ? Date.parse(a.lastRecalledAt) : -Infinity;
        const bMs = b.lastRecalledAt ? Date.parse(b.lastRecalledAt) : -Infinity;
        if (bMs !== aMs) return bMs - aMs;
        return b.totalSignalCount - a.totalSignalCount;
      });
    }
    return sorted;
  }, [status.shortTermEntries, sort]);

  const summary = [
    `${groundedEntries.length} ${i18nService.t('coworkDreamingAdvancedSummaryFromDailyLog')}`,
    `${status.shortTermCount} ${i18nService.t('coworkDreamingAdvancedSummaryWaiting')}`,
    `${status.promotedToday} ${i18nService.t('coworkDreamingAdvancedSummaryPromotedToday')}`,
  ].join(' · ');

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-secondary">{i18nService.t('coworkDreamingAdvancedHint')}</p>
        <div className="text-xs text-secondary mt-1">{summary}</div>
      </div>

      <AdvancedEntryList
        title={i18nService.t('coworkDreamingAdvancedGroundedTitle')}
        description={i18nService.t('coworkDreamingAdvancedGroundedDesc')}
        emptyText={i18nService.t('coworkDreamingAdvancedGroundedEmpty')}
        entries={groundedEntries}
        badge={() => i18nService.t('coworkDreamingAdvancedOriginDailyLog')}
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-foreground">{i18nService.t('coworkDreamingAdvancedWaitingTitle')}</div>
            <div className="text-xs text-secondary">{i18nService.t('coworkDreamingAdvancedWaitingDesc')}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSort('recent')}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                sort === 'recent' ? 'bg-primary text-white' : 'bg-surface-raised text-secondary hover:text-foreground'
              }`}
            >
              {i18nService.t('coworkDreamingAdvancedSortRecent')}
            </button>
            <button
              type="button"
              onClick={() => setSort('signals')}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                sort === 'signals' ? 'bg-primary text-white' : 'bg-surface-raised text-secondary hover:text-foreground'
              }`}
            >
              {i18nService.t('coworkDreamingAdvancedSortSignals')}
            </button>
          </div>
        </div>
        {waitingEntries.length === 0 ? (
          <div className="px-3 py-3 text-xs text-secondary">{i18nService.t('coworkDreamingAdvancedWaitingEmpty')}</div>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border">
            {waitingEntries.map((entry) => (
              <div key={entry.key} className="px-3 py-2 text-xs space-y-1">
                <span className="inline-block px-1.5 py-0.5 rounded bg-surface-raised text-secondary text-[10px]">
                  {describeEntryOrigin(entry)}
                </span>
                <div className="text-foreground">{entry.snippet}</div>
                <div className="text-secondary font-mono text-[10px]">
                  {formatRange(entry.path, entry.startLine, entry.endLine)}
                </div>
                <div className="text-secondary text-[10px]">
                  {[
                    entry.totalSignalCount > 0 ? `${entry.totalSignalCount} signals` : '',
                    entry.recallCount > 0 ? `${entry.recallCount} recall` : '',
                    entry.dailyCount > 0 ? `${entry.dailyCount} daily` : '',
                    entry.groundedCount > 0 ? `${entry.groundedCount} grounded` : '',
                    entry.phaseHitCount > 0 ? `${entry.phaseHitCount} phase hit` : '',
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AdvancedEntryList
        title={i18nService.t('coworkDreamingAdvancedPromotedTitle')}
        description={i18nService.t('coworkDreamingAdvancedPromotedDesc')}
        emptyText={i18nService.t('coworkDreamingAdvancedPromotedEmpty')}
        entries={status.promotedEntries}
        badge={(entry) => describeEntryOrigin(entry)}
      />
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

const DreamingSettingsSection: React.FC<DreamingSettingsSectionProps> = ({
  dreamingEnabled,
  dreamingFrequency,
  dreamingModel,
  dreamingTimezone,
  onDreamingEnabledChange,
  onDreamingFrequencyChange,
  onDreamingModelChange,
  onDreamingTimezoneChange,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [contentTab, setContentTab] = useState<DreamingContentTab>('scene');

  // Dreaming content data
  const [dreamingStatus, setDreamingStatus] = useState<DreamingStatusData | null>(null);
  const [dreamDiary, setDreamDiary] = useState<DreamDiaryData | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [diaryLoading, setDiaryLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isPreset = useMemo(
    () => FREQUENCY_PRESETS.some((p) => p.value === dreamingFrequency),
    [dreamingFrequency],
  );

  const [customMode, setCustomMode] = useState(!isPreset);

  const localTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  const handleSelectChange = (val: string) => {
    if (val === CUSTOM_VALUE) {
      setCustomMode(true);
    } else {
      setCustomMode(false);
      onDreamingFrequencyChange(val);
    }
  };

  const fetchDreamingStatus = useCallback(async () => {
    setStatusLoading(true);
    setLoadError(null);
    try {
      const result = await (window as any).electron.cowork.getDreamingStatus();
      if (result?.success && result.data) {
        setDreamingStatus(result.data);
      } else if (result?.error) {
        setLoadError(result.error);
      }
    } catch {
      setLoadError(i18nService.t('coworkDreamingLoadError'));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const fetchDreamDiary = useCallback(async () => {
    setDiaryLoading(true);
    try {
      const result = await (window as any).electron.cowork.getDreamDiary();
      if (result?.success && result.data) {
        setDreamDiary(result.data);
      }
    } catch {
      // silently fail diary load
    } finally {
      setDiaryLoading(false);
    }
  }, []);

  // Auto-load data when enabled
  useEffect(() => {
    if (dreamingEnabled) {
      void fetchDreamingStatus();
      void fetchDreamDiary();
    }
  }, [dreamingEnabled, fetchDreamingStatus, fetchDreamDiary]);

  const contentTabs = [
    { key: 'scene' as const, labelKey: 'coworkDreamingSubTabScene' },
    { key: 'diary' as const, labelKey: 'coworkDreamingSubTabDiary' },
    { key: 'advanced' as const, labelKey: 'coworkDreamingSubTabAdvanced' },
  ];

  return (
    <div className="space-y-3">
      {/* ── Settings form ── */}
      <div className="space-y-3 rounded-xl border px-4 py-4 border-border">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">
              {i18nService.t('coworkMemoryDreamingEnabled')}
            </div>
            <div className="text-xs text-secondary">
              {i18nService.t('coworkMemoryDreamingEnabledHint')}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={dreamingEnabled}
            onClick={() => onDreamingEnabledChange(!dreamingEnabled)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
              dreamingEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                dreamingEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {dreamingEnabled && (
          <div className="space-y-3 pt-2">
            {/* Frequency selector */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                {i18nService.t('coworkMemoryDreamingFrequency')}
              </label>
              <select
                value={customMode ? CUSTOM_VALUE : dreamingFrequency}
                onChange={(e) => handleSelectChange(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm border-border bg-surface"
              >
                {FREQUENCY_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {i18nService.t(preset.labelKey)}
                  </option>
                ))}
                <option value={CUSTOM_VALUE}>
                  {i18nService.t('coworkMemoryDreamingFreqCustom')}
                </option>
              </select>
              <div className="text-xs text-secondary mt-1">
                {i18nService.t('coworkMemoryDreamingFrequencyHint')}
              </div>
            </div>

            {/* Custom cron input */}
            {customMode && (
              <div>
                <input
                  type="text"
                  value={dreamingFrequency}
                  onChange={(e) => onDreamingFrequencyChange(e.target.value)}
                  placeholder={i18nService.t('coworkMemoryDreamingFreqCustomPlaceholder')}
                  className="w-full rounded-lg border px-3 py-2 text-sm border-border bg-surface font-mono"
                />
              </div>
            )}

            {/* Timezone */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                {i18nService.t('coworkMemoryDreamingTimezone')}
              </label>
              <input
                type="text"
                value={dreamingTimezone}
                onChange={(e) => onDreamingTimezoneChange(e.target.value)}
                placeholder={localTimezone}
                className="w-full rounded-lg border px-3 py-2 text-sm border-border bg-surface font-mono"
              />
              <div className="text-xs text-secondary mt-1">
                {i18nService.t('coworkMemoryDreamingTimezoneHint')}
              </div>
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="text-xs text-primary hover:underline"
            >
              {showAdvanced
                ? i18nService.t('coworkMemoryAdvancedHide')
                : i18nService.t('coworkMemoryAdvancedShow')}
            </button>

            {showAdvanced && (
              <div className="space-y-3">
                {/* Dream Diary model override */}
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    {i18nService.t('coworkMemoryDreamingModel')}
                  </label>
                  <input
                    type="text"
                    value={dreamingModel}
                    onChange={(e) => onDreamingModelChange(e.target.value)}
                    placeholder="claude-sonnet-4-20250514"
                    className="w-full rounded-lg border px-3 py-2 text-sm border-border bg-surface font-mono"
                  />
                  <div className="text-xs text-secondary mt-1">
                    {i18nService.t('coworkMemoryDreamingModelHint')}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Content display ── */}
      {dreamingEnabled && (
        <div className="rounded-xl border px-4 py-4 border-border space-y-3">
          <div className="text-sm font-medium text-foreground">
            {i18nService.t('coworkDreamingContentTitle')}
          </div>

          {/* Sub-tab bar */}
          <div className="flex gap-1 border-b border-border">
            {contentTabs.map((tab) => (
              <button
                type="button"
                key={tab.key}
                onClick={() => setContentTab(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors rounded-t-lg ${
                  contentTab === tab.key
                    ? 'bg-primary-muted text-primary border-b-2 border-primary'
                    : 'text-secondary hover:text-foreground hover:bg-surface-raised'
                }`}
              >
                {i18nService.t(tab.labelKey)}
              </button>
            ))}
          </div>

          {/* Error state */}
          {loadError && (
            <div className="px-3 py-2 text-xs text-red-500">{loadError}</div>
          )}

          {/* Loading state */}
          {statusLoading && !dreamingStatus && !loadError && (
            <div className="px-3 py-6 text-xs text-secondary text-center">{i18nService.t('loading')}</div>
          )}

          {/* Content */}
          {!loadError && (contentTab === 'scene' || contentTab === 'advanced') && dreamingStatus && (
            contentTab === 'scene'
              ? <SceneTab status={dreamingStatus} />
              : <AdvancedTab status={dreamingStatus} />
          )}
          {!loadError && contentTab === 'diary' && (
            <DiaryTab diary={dreamDiary} loading={diaryLoading} onRefresh={fetchDreamDiary} />
          )}
        </div>
      )}
    </div>
  );
};

export default DreamingSettingsSection;
