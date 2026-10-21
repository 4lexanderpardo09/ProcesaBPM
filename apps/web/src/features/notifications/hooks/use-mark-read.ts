import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/shared/session';
import { markAllNotificationsRead, markNotificationRead, notificationQueryKeys } from '../api/notifications-api';

/** Marking one or all as read; then the count and every list are read again. */
export function useMarkRead() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all });
  return {
    one: useMutation({ mutationFn: (notificationId: string) => markNotificationRead(client, notificationId), onSettled: refresh }),
    all: useMutation({ mutationFn: () => markAllNotificationsRead(client), onSettled: refresh }),
  };
}
