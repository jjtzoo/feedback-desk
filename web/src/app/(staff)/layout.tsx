import { MeProvider } from "@/components/me";
import { StaffHeader } from "@/components/staff-header";

export default function StaffLayout({ children }: LayoutProps<"/">) {
  return (
    <MeProvider>
      {/* A page marked data-page="fill" (the chat) takes exactly the screen and scrolls inside itself. */}
      <div className="flex min-h-dvh flex-col has-data-[page=fill]:h-dvh">
        <StaffHeader />
        <main className="flex-1 has-data-[page=fill]:flex has-data-[page=fill]:min-h-0 has-data-[page=fill]:flex-col">{children}</main>
      </div>
    </MeProvider>
  );
}
