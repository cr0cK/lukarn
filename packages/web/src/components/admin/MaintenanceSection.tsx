import type { AdminStatus } from '@lukarn/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { api, errorText } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { formatBytes } from '../../lib/format';
import { Button, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

/** "Maintenance" section: cache usage and purge. */
export function MaintenanceSection({
  status,
  notify,
}: {
  status: AdminStatus;
  notify: Notify;
}): ReactElement {
  const queryClient = useQueryClient();

  const clearCache = useMutation({
    mutationFn: api.clearCache,
    onSuccess: () => {
      notify({ tone: 'ok', text: 'Cache cleared. Thumbnails will be regenerated on demand.' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
    },
    onError: (error) => notify({ tone: 'error', text: errorText(error, 'Cannot clear cache.') }),
  });

  return (
    <Section title="Maintenance">
      <div className={`${ROW_CLASS} px-4 py-4 xl:items-center`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-200">
            Cache: {formatBytes(status.cache.bytes)} of {formatBytes(status.cache.maxBytes)}
          </p>
          <p className="text-xs text-ink-400">
            {status.cache.entryCount.toLocaleString('en-GB')} thumbnails generated
          </p>
        </div>

        <div className={ROW_ACTIONS_CLASS}>
          <Button
            variant="danger"
            onClick={() => clearCache.mutate()}
            disabled={clearCache.isPending}
          >
            Clear cache
          </Button>
        </div>
      </div>
    </Section>
  );
}
