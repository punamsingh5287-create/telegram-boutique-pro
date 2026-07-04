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
  Bot,
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
import { TgEmoji } from "@/components/ui/tg-emoji";

type NavItem = { title: string; url: string; icon: any; emoji: string; disabled?: boolean };

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "✨ Overview",
    items: [{ title: "Dashboard", url: "/admin", icon: LayoutDashboard, emoji: "📊" }],
  },
  {
    label: "💰 Sales",
    items: [
      { title: "Orders", url: "/admin/orders", icon: ShoppingCart, emoji: "🛒" },
      { title: "Deliveries", url: "/admin/deliveries", icon: Truck, emoji: "🚚" },
    ],
  },
  {
    label: "📦 Catalog",
    items: [{ title: "Products", url: "/admin/products", icon: Package, emoji: "💎" }],
  },
  {
    label: "👥 Customers",
    items: [{ title: "Users", url: "/admin/users", icon: Users, emoji: "👤" }],
  },
  {
    label: "📣 Marketing",
    items: [
      { title: "Coupons", url: "/admin/coupons", icon: Tags, emoji: "🎟️" },
      { title: "Broadcasts", url: "/admin/broadcasts", icon: Megaphone, emoji: "📢" },
    ],
  },
  {
    label: "⚙️ System",
    items: [
      { title: "Bot content", url: "/admin/bot", icon: Bot, emoji: "🤖" },
      { title: "Audit log", url: "/admin/audit-log", icon: ScrollText, emoji: "📜" },
      { title: "Settings", url: "/admin/settings", icon: Settings, emoji: "⚙️" },
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
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-amber-400 text-white text-base shadow-lg shadow-fuchsia-500/40">
            <TgEmoji animated>💎</TgEmoji>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Mateo Store</div>
              <div className="truncate text-xs text-muted-foreground">
                <TgEmoji variant="gold">✨</TgEmoji> Premium admin
              </div>
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
                          tooltip={collapsed ? `${item.emoji} ${item.title} (soon)` : undefined}
                        >
                          <Icon className="h-4 w-4" />
                          <span><TgEmoji>{item.emoji}</TgEmoji> {item.title}</span>
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
                        tooltip={collapsed ? `${item.emoji} ${item.title}` : undefined}
                      >
                        <Link to={item.url}>
                          <Icon className="h-4 w-4" />
                          <span><TgEmoji>{item.emoji}</TgEmoji> {item.title}</span>
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
            <SidebarMenuButton onClick={signOut} tooltip={collapsed ? "🚪 Sign out" : undefined}>
              <LogOut className="h-4 w-4" />
              <span><TgEmoji>🚪</TgEmoji> Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}