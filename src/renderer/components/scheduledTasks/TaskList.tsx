import {
  ClockIcon,
  EllipsisVerticalIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import React from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import type { ScheduledTask } from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { selectTask, setViewMode } from '../../store/slices/scheduledTaskSlice';
import EditIcon from '../icons/EditIcon';
import TrashIcon from '../icons/TrashIcon';
import {
  formatNextRunRelative,
  formatScheduleLabel,
  getStatusLabelKey,
  getStatusTone,
} from './utils';

const listPageClass = 'px-6 py-5 sm:px-8 lg:px-10';
const listContentClass = 'mx-auto w-full max-w-[980px]';
const listGridClass = 'grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_112px_40px] items-center gap-3';
const menuWidthPx = 144;
const menuHeightEstimatePx = 156;
const menuEdgeGapPx = 8;
const menuTriggerGapPx = 4;
const menuItemClassName =
  'flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]';
const destructiveMenuItemClassName =
  'flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-[13px] text-red-500 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]';
const menuIconClassName = 'h-3.5 w-3.5';

interface MenuPosition {
  top: number;
  left: number;
}

interface TaskListItemProps {
  task: ScheduledTask;
  onRequestDelete: (taskId: string, taskName: string) => void;
}

const TaskListItem: React.FC<TaskListItemProps> = ({ task, onRequestDelete }) => {
  const dispatch = useDispatch();
  const [showMenu, setShowMenu] = React.useState(false);
  const [menuPosition, setMenuPosition] = React.useState<MenuPosition | null>(null);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const updateMenuPosition = React.useCallback(() => {
    if (!menuButtonRef.current) return;

    const rect = menuButtonRef.current.getBoundingClientRect();
    const maxLeft = window.innerWidth - menuWidthPx - menuEdgeGapPx;
    const left = Math.max(
      menuEdgeGapPx,
      Math.min(rect.right - menuWidthPx, maxLeft),
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    const hasMoreSpaceAbove = rect.top > spaceBelow;
    const openAbove = spaceBelow < menuHeightEstimatePx + menuTriggerGapPx && hasMoreSpaceAbove;
    const preferredTop = openAbove
      ? rect.top - menuHeightEstimatePx - menuTriggerGapPx
      : rect.bottom + menuTriggerGapPx;
    const maxTop = window.innerHeight - menuHeightEstimatePx - menuEdgeGapPx;

    setMenuPosition({
      top: Math.max(menuEdgeGapPx, Math.min(preferredTop, maxTop)),
      left,
    });
  }, []);

  React.useLayoutEffect(() => {
    if (showMenu) {
      updateMenuPosition();
    } else {
      setMenuPosition(null);
    }
  }, [showMenu, updateMenuPosition]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuButtonRef.current &&
        !menuButtonRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  React.useEffect(() => {
    if (!showMenu) return;

    const handleViewportChange = () => setShowMenu(false);
    window.addEventListener('resize', handleViewportChange);
    document.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      document.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [showMenu]);

  const statusLabel = i18nService.t(getStatusLabelKey(task.state.lastStatus));
  const statusTone = getStatusTone(task.state.lastStatus);

  return (
    <div
      className={`${listGridClass} rounded-md px-3 py-3 hover:bg-surface-raised/60 cursor-pointer transition-colors`}
      onClick={() => dispatch(selectTask(task.id))}
    >
      <div className="min-w-0">
        <div className={`text-sm truncate ${task.enabled ? 'text-foreground' : 'text-secondary'}`}>
          {task.name}
        </div>
        {task.description && (
          <div className="text-xs truncate text-secondary">{task.description}</div>
        )}
      </div>

      <div className="min-w-0">
        <div className="text-sm truncate text-secondary">{formatScheduleLabel(task.schedule)}</div>
        {task.enabled && task.state.nextRunAtMs !== null && (
          <div className="text-xs truncate text-secondary/60 mt-0.5">
            {formatNextRunRelative(task.state.nextRunAtMs)}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-medium ${statusTone}`}>{statusLabel}</span>
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            void scheduledTaskService.toggleTask(task.id, !task.enabled);
          }}
          className={`relative shrink-0 w-7 h-4 rounded-full transition-colors ${
            task.enabled ? 'bg-primary' : 'bg-gray-400 dark:bg-gray-600'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm ${
              task.enabled ? 'translate-x-3' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      <div className="flex justify-center">
        <div className="relative">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={event => {
              event.stopPropagation();
              setShowMenu(value => !value);
            }}
            className="p-1.5 rounded-md text-secondary hover:bg-surface-raised transition-colors"
          >
            <EllipsisVerticalIcon className="w-5 h-5" />
          </button>
          {showMenu && menuPosition && (
            createPortal(
              <div
                ref={menuRef}
                onClick={event => event.stopPropagation()}
                className="fixed w-32 rounded-lg shadow-lg bg-surface border border-border z-[9999] py-1"
                style={{ top: menuPosition.top, left: menuPosition.left }}
              >
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    setShowMenu(false);
                    void scheduledTaskService.runManually(task.id);
                  }}
                  disabled={Boolean(task.state.runningAtMs)}
                  className={`${menuItemClassName} disabled:opacity-50`}
                >
                  <PlayIcon className={menuIconClassName} />
                  {i18nService.t('scheduledTasksRun')}
                </button>
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    setShowMenu(false);
                    dispatch(selectTask(task.id));
                    dispatch(setViewMode('edit'));
                  }}
                  className={menuItemClassName}
                >
                  <EditIcon className={menuIconClassName} />
                  {i18nService.t('scheduledTasksEdit')}
                </button>
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    setShowMenu(false);
                    onRequestDelete(task.id, task.name);
                  }}
                  className={destructiveMenuItemClassName}
                >
                  <TrashIcon className={menuIconClassName} />
                  {i18nService.t('scheduledTasksDelete')}
                </button>
              </div>,
              document.body,
            )
          )}
        </div>
      </div>
    </div>
  );
};

interface TaskListProps {
  onRequestDelete: (taskId: string, taskName: string) => void;
}

const TaskList: React.FC<TaskListProps> = ({ onRequestDelete }) => {
  const tasks = useSelector((state: RootState) => state.scheduledTask.tasks);
  const loading = useSelector((state: RootState) => state.scheduledTask.loading);

  if (loading) {
    return (
      <div className={listPageClass}>
        <div className={`${listContentClass} flex items-center justify-center py-16`}>
          <div className="text-secondary">{i18nService.t('loading')}</div>
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className={listPageClass}>
        <div className={`${listContentClass} flex flex-col items-center justify-center rounded-lg border border-border px-6 py-16`}>
          <ClockIcon className="h-12 w-12 text-secondary/40 mb-4" />
          <p className="text-sm font-medium text-secondary mb-1">
            {i18nService.t('scheduledTasksEmptyState')}
          </p>
          <p className="text-xs text-secondary/70 text-center">
            {i18nService.t('scheduledTasksEmptyHint')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={listPageClass}>
      <div className={`${listContentClass} overflow-hidden rounded-lg border border-border-subtle bg-surface`}>
        <div className={`${listGridClass} bg-surface/30 px-5 py-2.5`}>
          <div className="text-xs font-medium text-secondary">
            {i18nService.t('scheduledTasksListColTitle')}
          </div>
          <div className="text-xs font-medium text-secondary">
            {i18nService.t('scheduledTasksListColSchedule')}
          </div>
          <div className="text-xs font-medium text-secondary">
            {i18nService.t('scheduledTasksListColStatus')}
          </div>
          <div className="text-xs font-medium text-secondary text-center">
            {i18nService.t('scheduledTasksListColMore')}
          </div>
        </div>
        <div className="p-2">
          {tasks.map(task => (
            <TaskListItem key={task.id} task={task} onRequestDelete={onRequestDelete} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default TaskList;
