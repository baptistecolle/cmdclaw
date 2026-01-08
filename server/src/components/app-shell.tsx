'use client';

import { type ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ShieldCheck, UploadCloud, Users } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/animate-ui/components/radix/sidebar';
import { authClient } from '@/lib/auth-client';

type AppShellProps = {
  children: ReactNode;
};

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>['data'];

const navItems = [
  { label: 'Accounts', href: '/accounts', icon: Users },
  { label: 'Upload', href: '/upload', icon: UploadCloud },
  { label: 'Admin', href: '/admin', icon: ShieldCheck },
];

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionData>(null);

  useEffect(() => {
    let mounted = true;

    authClient
      .getSession()
      .then((res) => {
        if (!mounted) return;
        const hasSession = res?.data?.session && res?.data?.user;
        setSession(hasSession ? res.data : null);
      })
      .catch(() => {
        if (mounted) setSession(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleSignOut = async () => {
    const { error } = await authClient.signOut();
    if (!error) {
      setSession(null);
      router.push('/login');
    }
  };

  const displayName = session?.user?.name ?? session?.user?.email ?? 'Signed in user';
  const avatarInitial = displayName.charAt(0).toUpperCase();

  const isAuthRoute = pathname === '/login';

  if (isAuthRoute) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
  }

  return (
    <SidebarProvider className="bg-background text-foreground">
      <Sidebar collapsible="icon" className="border-r">
        <SidebarHeader>
          <Link
            href="/"
            className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label="Go to dashboard"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              VP
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold leading-none">ViralPilot</p>
              <p className="text-xs text-muted-foreground">Navigate</p>
            </div>
          </Link>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Menu</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
                      tooltip={item.label}
                    >
                      <Link href={item.href} className="flex items-center gap-2">
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              {session?.user ? (
                <SidebarMenuButton
                  type="button"
                  size="lg"
                  tooltip="Sign out"
                  onClick={handleSignOut}
                  className="justify-between group-data-[collapsible=icon]:justify-center"
                >
                  <div className="flex size-10 items-center justify-center rounded-full bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8">
                    {avatarInitial}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col items-end text-right group-data-[collapsible=icon]:hidden">
                    <span className="text-sm font-medium leading-tight">
                      {displayName}
                    </span>
                    <span className="text-xs text-muted-foreground">Sign out</span>
                  </div>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton asChild size="lg" tooltip="Log in">
                  <Link
                    href="/login"
                    className="flex w-full items-center justify-between group-data-[collapsible=icon]:justify-center"
                  >
                    <div className="flex size-10 items-center justify-center rounded-full bg-sidebar-accent/40 text-sm font-semibold text-sidebar-foreground group-data-[collapsible=icon]:size-8">
                      ?
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col items-end text-right group-data-[collapsible=icon]:hidden">
                      <span className="text-sm font-medium leading-tight">
                        Log in
                      </span>
                      <span className="text-xs text-muted-foreground">Access your account</span>
                    </div>
                  </Link>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur md:h-16">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <div className="text-sm font-medium text-muted-foreground">
            Quick access
          </div>
        </header>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
