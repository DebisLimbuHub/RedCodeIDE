import { Outlet, NavLink } from "react-router-dom";
import { clsx } from "clsx";
import {
  Search,
  Zap,
  FileText,
  Target,
  Archive,
  Settings,
} from "lucide-react";

const navItems = [
  { path: "/recon", label: "Recon", icon: Search },
  { path: "/exploit", label: "Exploit", icon: Zap },
  { path: "/reporting", label: "Reporting", icon: FileText },
  { path: "/scope", label: "Scope", icon: Target },
  { path: "/evidence", label: "Evidence", icon: Archive },
  { path: "/settings", label: "Settings", icon: Settings },
];

export default function MainLayout() {
  return (
    <div className="flex h-full bg-surface-950 text-gray-100">
      {/* Sidebar */}
      <aside className="flex w-14 flex-col items-center gap-1 border-r border-surface-700 bg-surface-900 py-3">
        {/* Logo mark */}
        <div className="mb-4 flex h-8 w-8 items-center justify-center rounded bg-accent-red">
          <span className="text-xs font-bold text-white">RC</span>
        </div>

        {navItems.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            title={label}
            className={({ isActive }) =>
              clsx(
                "flex h-10 w-10 items-center justify-center rounded transition-colors",
                isActive
                  ? "bg-accent-red/20 text-accent-red"
                  : "text-gray-500 hover:bg-surface-700 hover:text-gray-200"
              )
            }
          >
            <Icon size={18} />
          </NavLink>
        ))}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
