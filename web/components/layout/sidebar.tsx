"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  FolderKanban,
  Database,
  Server,
  RotateCcw,
  Bell,
  Settings,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: FolderKanban },
  { href: "/repositories", label: "Repositories", icon: Database },
  { href: "/agents", label: "Agents", icon: Server },
  { href: "/restore", label: "Restore", icon: RotateCcw },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();

  return (
    <aside className="flex w-60 flex-col border-r bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Database className="h-5 w-5 text-primary" />
        <span className="font-semibold">BCK Manager</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent",
              pathname === item.href
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t p-3">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="ghost" className="w-full justify-start gap-3 px-3">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs">
                  {user?.username?.charAt(0).toUpperCase() ?? "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">{user?.username ?? "User"}</p>
                <p className="text-xs text-muted-foreground">{user?.role ?? ""}</p>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
