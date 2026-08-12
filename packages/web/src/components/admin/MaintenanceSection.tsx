import type { AdminStatus } from '@lukarn/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { api, errorText } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { formatBytes } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Button, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

/** "Maintenance" section: cache usage and purge. */
export function MaintenanceSection({
  status,
  notify,
}: {
  status: AdminStatus;
  notify: Notify;
}): ReactElement {
  const t = useT();
  const queryClient = useQueryClient();

  const clearCache = useMutation({
    mutationFn: api.clearCache,
    onSuccess: () => {
      notify({ tone: 'ok', text: t('maintenance.cleared') });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
    },
    onError: (error) =>
      notify({ tone: 'error', text: errorText(error, t('maintenance.clearFailed')) }),
  });

  return (
    <Section title={t('maintenance.title')}>
      <div className={`${ROW_CLASS} px-4 py-4 xl:items-center`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-200">
            {t(
              'maintenance.cache',
              formatBytes(status.cache.bytes, t),
              formatBytes(status.cache.maxBytes, t),
            )}
          </p>
          <p className="text-xs text-ink-400">
            {t('maintenance.entries', status.cache.entryCount)}
          </p>
        </div>

        <div className={ROW_ACTIONS_CLASS}>
          <Button
            variant="danger"
            onClick={() => clearCache.mutate()}
            disabled={clearCache.isPending}
          >
            {t('maintenance.clear')}
          </Button>
        </div>
      </div>
    </Section>
  );
}
