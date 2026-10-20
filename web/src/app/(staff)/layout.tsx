import { MeProvider } from "@/components/me";
import { StaffFooter, StaffHeader } from "@/components/staff-header";

export default function StaffLayout({ children }: LayoutProps<"/">) {
  return (
    <MeProvider>
      <div className="flex min-h-dvh flex-col">
        <StaffHeader />
        <main className="flex-1">{children}</main>
        <StaffFooter />
      </div>
    </MeProvider>
  );
}
