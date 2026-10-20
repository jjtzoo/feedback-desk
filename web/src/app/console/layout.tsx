import { ConsoleShell } from "@/components/console/shell";
import { MeProvider } from "@/components/me";

export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return (
    <MeProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </MeProvider>
  );
}
