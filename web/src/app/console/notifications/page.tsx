import { NotificationHistory } from "@/components/notification-history";

/** The console's copy of the notifications page (brief §4.6, D108). */
export default function ConsoleNotificationsPage() {
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-extrabold">Notifications</h1>
        <p className="text-sm text-muted-foreground">The last 90 days, including what you cleared from the bell.</p>
      </div>
      <NotificationHistory />
    </div>
  );
}
