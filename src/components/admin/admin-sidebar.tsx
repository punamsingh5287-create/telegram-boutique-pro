import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  Tags,
  Megaphone,
  Truck,
  ScrollText,
  Settings,
  LogOut,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

type NavItem = { title: string; url: string; icon: any; disabled?: boolean };

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/admin", icon: LayoutDashboard }],
  },
  {
    label: "Sales",
    items: [
      { title: "Orders", url: "/admin/orders", icon: ShoppingCart },
      { title: "Deliveries", url: "/admin/deliveries", icon: Truck },
    ],
  },
  {
    label: "Catalog",
    items: [{ title: "Products", url: "/admin/products", icon: Package, disabled: true }],
  },
  {
    label: "Customers",
    items: [{ title: "Users", url: "/admin/users", icon: Users, disabled: true }],
  },
  {
    label: "Marketing",
    items: [
      { title: "Coupons", url: "/admin/coupons", icon: Tags, disabled: true },
      { title: "Broadcasts", url: "/admin/broadcasts", icon: Megaphone, disabled: true },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Audit log", url: "/admin/audit-log", icon: ScrollText },
      { title: "Settings", url: "/admin/settings", icon: Settings, disabled: true },
    ],
  },
];

export function AdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isActive = (url: string) =>
    url === "/admin" ? pathname === "/admin" : pathname === url || pathname.startsWith(url + "/");

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            M
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Mateo Store</div>
              <div className="truncate text-xs text-muted-foreground">Admin console</div>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = isActive(item.url);
                  const Icon = item.icon;
                  if (item.disabled) {
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          disabled
                          className="cursor-not-allowed opacity-50"
                          tooltip={collapsed ? `${item.title} (soon)` : undefined}
                        >
                          <Icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            soon
                          </span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={collapsed ? item.title : undefined}
                      >
                        <Link to={item.url}>
                          <Icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={signOut} tooltip={collapsed ? "Sign out" : undefined}>
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}