yar"use client";

import React, { ReactNode } from "react";
import { useTheme } from "next-themes";

interface DashboardLayoutProps {
  children: ReactNode;
  onLogout: () => void;
  onToggleTheme: () => void;
  theme?: string;
}

const DashboardLayout = ({ children, onLogout, onToggleTheme, theme }: DashboardLayoutProps) => {
  return (
    <div className="min-h-screen bg-base-200">
      {/* Header */}
      <header className="navbar bg-base-100 border-b border-base-300 px-4">
        <div className="navbar-start">
          <a href="/" className="btn btn-ghost text-xl font-bold">
            🥷 Shogun Relay
          </a>
        </div>

        <div className="navbar-center hidden lg:flex">
          <nav className="menu menu-horizontal px-1">
            <li><a href="/dashboard" className="btn btn-ghost">Dashboard</a></li>
            <li><a href="/relay-protocol" className="btn btn-ghost">Relay Protocol</a></li>
          </nav>
        </div>

        <div className="navbar-end">
          <div className="flex items-center gap-4">
            {/* Theme Toggle */}
            <button
              onClick={onToggleTheme}
              className="btn btn-ghost btn-circle"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              )}
            </button>

            {/* User Menu */}
            <div className="dropdown dropdown-end">
              <div tabIndex={0} role="button" className="btn btn-ghost btn-circle avatar">
                <div className="w-8 rounded-full bg-base-300 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                </div>
              </div>
              <ul tabIndex={0} className="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52 border border-base-300">
                <li><a href="/dashboard/profile">Profile</a></li>
                <li><a href="/dashboard/settings">Settings</a></li>
                <li className="divider my-1"></li>
                <li>
                  <button onClick={onLogout} className="text-error">
                    Logout
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="footer footer-center p-4 bg-base-100 text-base-content border-t border-base-300">
        <aside>
          <p>© 2024 Shogun Relay</p>
        </aside>
      </footer>
    </div>
  );
};

export default DashboardLayout; 