import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Users, LayoutDashboard, Settings, Bot, Menu, Bell, Search, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { logout } from "@/lib/auth-api";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Close mobile menu on navigation
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  async function handleLogout() {
    await logout();
    window.location.reload();
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-sidebar h-full">
        <div className="p-4 sm:p-6 flex items-center gap-3">
          <div className="bg-primary/10 text-primary p-2 rounded-md">
            <Bot size={24} />
          </div>
          <div>
            <h2 className="font-mono font-bold tracking-tight text-sidebar-foreground">JÚLIA</h2>
            <p className="text-xs text-sidebar-foreground/60 uppercase tracking-wider font-semibold">Command Center</p>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} data-testid={`nav-${item.label.toLowerCase()}`}>
                <div
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <item.icon size={18} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border mt-auto">
          <div className="flex items-center gap-3 px-2 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md cursor-pointer transition-colors" data-testid="nav-logout" onClick={handleLogout}>
            <LogOut size={18} />
            Sair
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        <header className="h-14 sm:h-16 border-b border-border bg-background flex items-center justify-between px-4 sm:px-6 shrink-0 z-10">
          <div className="flex items-center gap-4">
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" data-testid="btn-mobile-menu">
                  <Menu size={20} />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <div className="p-6 flex items-center gap-3 border-b border-border mb-4">
                  <div className="bg-primary/10 text-primary p-2 rounded-md">
                    <Bot size={24} />
                  </div>
                  <div>
                    <h2 className="font-mono font-bold tracking-tight">JÚLIA</h2>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Command Center</p>
                  </div>
                </div>
                <nav className="px-4 space-y-1">
                  {navItems.map((item) => {
                    const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                    return (
                      <Link key={item.href} href={item.href} data-testid={`mobile-nav-${item.label.toLowerCase()}`}>
                        <div
                          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "text-foreground/70 hover:bg-accent hover:text-accent-foreground"
                          }`}
                        >
                          <item.icon size={18} />
                          {item.label}
                        </div>
                      </Link>
                    );
                  })}
                </nav>
              </SheetContent>
            </Sheet>

            <div className="hidden sm:flex items-center bg-accent text-accent-foreground px-3 rounded-md focus-within:ring-1 ring-ring transition-shadow w-64 md:w-80 h-9">
              <Search size={16} className="text-muted-foreground mr-2 shrink-0" />
              <input 
                type="text" 
                placeholder="Search leads, phones..." 
                className="bg-transparent border-none outline-none text-sm w-full h-full placeholder:text-muted-foreground"
                data-testid="input-global-search"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="relative text-muted-foreground" data-testid="btn-notifications">
              <Bell size={20} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-destructive rounded-full border-2 border-background"></span>
            </Button>
            <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
              <Avatar className="w-8 h-8 rounded-md border border-border">
                <AvatarFallback className="text-xs rounded-md bg-primary/10 text-primary font-mono">OP</AvatarFallback>
              </Avatar>
              <div className="hidden lg:block text-sm">
                <p className="font-medium leading-none">Operator</p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 overflow-auto bg-muted/30">
          <div className="p-4 sm:p-6 h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
