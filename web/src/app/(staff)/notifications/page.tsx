import { NotificationHistory } from "@/components/notification-history";

/** Every notification of the last 90 days, for when the bell has been cleared (brief §4.6, D108). */
export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold">Notifications</h1>
      <p className="mt-1 mb-8 text-muted-foreground">The last 90 days, including what you cleared from the bell.</p>
      <NotificationHistory />
    </div>
  );
}
