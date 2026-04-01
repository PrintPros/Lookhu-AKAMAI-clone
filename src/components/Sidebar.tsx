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
  Megaphone 
} from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/Button";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  pendingSubmissions?: number;
}

export function Sidebar({ activeTab, setActiveTab, onLogout, pendingSubmissions = 0 }: SidebarProps) {
  const menuItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "channels", label: "Channels", icon: Radio },
    { id: "media", label: "Media Library", icon: Library },
    { id: "playlists", label: "Playlists", icon: ListMusic },
    { id: "submissions", label: "Artist Submissions", icon: UserPlus, badge: pendingSubmissions },
    { id: "epg", label: "EPG Viewer", icon: Calendar },
    { id: "cloudflare", label: "Cloudflare", icon: Cloud },
    { id: "ads", label: "Ad Settings", icon: Megaphone },
    { id: "embed", label: "Embed Options", icon: Share2 },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex h-screen w-64 flex-col border-r border-zinc-200 bg-white p-4">
      <div className="mb-8 px-2">
        <h1 className="text-xl font-black tracking-tight text-zinc-900">RAG.ORG</h1>
        <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold mt-0.5">Fast Channel Platform</p>
      </div>

      <nav className="flex-1 space-y-1">
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
