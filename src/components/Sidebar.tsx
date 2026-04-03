import { 
  LayoutDashboard, 
  Library, 
  ListMusic, 
  Radio, 
  Settings, 
  LogOut, 
  Share2, 
  UserPlus, 
  Cloud, 
  Calendar, 
  Megaphone,
  ShieldCheck,
  Mail,
  Users,
  User
} from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/Button";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  pendingSubmissions?: number;
  pendingInvites?: number;
  role?: string;
}

export function Sidebar({ 
  activeTab, 
  setActiveTab, 
  onLogout, 
  pendingSubmissions = 0,
  pendingInvites = 0,
  role
}: SidebarProps) {
  const menuItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "profile", label: "My Profile", icon: User, badge: pendingInvites },
    { id: "channels", label: "Channels", icon: Radio },
    { id: "embed", label: "Embed Options", icon: Share2 },
    { id: "ads", label: "Ad Settings", icon: Megaphone },    
    { id: "playlists", label: "Playlists", icon: ListMusic },
    { id: "media", label: "Media Library", icon: Library },
    { id: "submissions", label: "Artist Submissions", icon: UserPlus, badge: pendingSubmissions },
    { id: "epg", label: "EPG Viewer", icon: Calendar },
    { id: "cloudflare", label: "Cloudflare", icon: Cloud },    
    { id: "settings", label: "Settings", icon: Settings },
  ];

  const adminItems = [
    { id: "invites", label: "Invite Users", icon: Users, roles: ["admin", "master_admin"] },
    { id: "admin", label: "Master Admin", icon: ShieldCheck, roles: ["master_admin"] },
  ];

  const filteredAdminItems = adminItems.filter(item => item.roles.includes(role || "user"));

  return (
    <div className="flex h-screen w-64 flex-col border-r border-zinc-200 bg-white p-4">
      <div className="mb-8 px-2">
        <h1 className="text-xl font-black tracking-tight text-zinc-900 uppercase">FastFasts</h1>
        <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold mt-0.5">Fast Channel Platform</p>
        {role && (
          <div className="mt-2 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-600 uppercase tracking-wider">
            {role.replace("_", " ")}
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        <div className="space-y-1">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors relative",
                activeTab === item.id
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {item.badge && item.badge > 0 && (
                <span className="ml-auto bg-red-500 text-white rounded-full px-1.5 text-[10px] font-bold">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {filteredAdminItems.length > 0 && (
          <div className="mt-6 pt-6 border-t border-zinc-100">
            <p className="px-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Administration</p>
            <div className="space-y-1">
              {filteredAdminItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors relative",
                    activeTab === item.id
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </nav>

      <div className="mt-auto border-t border-zinc-100 pt-4">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-zinc-600 hover:text-red-600"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}
