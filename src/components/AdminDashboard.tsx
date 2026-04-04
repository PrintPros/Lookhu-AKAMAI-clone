import React, { useState, useEffect } from "react";
import { auth } from "../firebase";
import { Button } from "./ui/Button";
import { toast } from "sonner";
import { Users, Building2, Plus, Shield } from "lucide-react";

export function AdminDashboard() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ name: "", ownerId: "" });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const [accountsRes, usersRes] = await Promise.all([
        fetch("/api/admin/accounts", {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch("/api/admin/users", {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      if (accountsRes.ok && usersRes.ok) {
        const accountsData = await accountsRes.json();
        const usersData = await usersRes.json();
        console.log("Fetched users:", usersData);
        setAccounts(accountsData);
        setUsers(usersData);
      } else {
        const accountsError = await accountsRes.text();
        const usersError = await usersRes.text();
        console.error("Failed to fetch admin data:", accountsRes.status, accountsError, usersRes.status, usersError);
        toast.error(`Failed to fetch admin data: ${accountsRes.status} / ${usersRes.status}`);
      }
    } catch (err) {
      toast.error("Failed to fetch admin data");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/admin/users/update-role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ userId, role: newRole })
      });

      if (res.ok) {
        toast.success("Role updated successfully");
        fetchData();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to update role");
      }
    } catch (err) {
      toast.error("An error occurred");
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(newAccount)
      });

      if (res.ok) {
        toast.success("Account created successfully");
        setShowCreateAccount(false);
        setNewAccount({ name: "", ownerId: "" });
        fetchData();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to create account");
      }
    } catch (err) {
      toast.error("An error occurred");
    }
  };

  if (loading) return <div className="animate-pulse space-y-4">
    <div className="h-8 bg-zinc-200 rounded w-1/4"></div>
    <div className="h-64 bg-zinc-100 rounded"></div>
  </div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-zinc-900 uppercase">Master Admin Dashboard</h2>
          <p className="text-sm text-zinc-500">Manage all sub-accounts and platform users.</p>
        </div>
        <Button onClick={() => setShowCreateAccount(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Create Account
        </Button>
      </div>

      {showCreateAccount && (
        <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm space-y-4">
          <h3 className="font-bold text-zinc-900">New Sub-Account</h3>
          <form onSubmit={handleCreateAccount} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Account Name</label>
              <input
                required
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                value={newAccount.name}
                onChange={e => setNewAccount({ ...newAccount, name: e.target.value })}
                placeholder="e.g. Acme Studio"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase">Owner UID</label>
              <input
                required
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                value={newAccount.ownerId}
                onChange={e => setNewAccount({ ...newAccount, ownerId: e.target.value })}
                placeholder="UID of the account admin"
              />
            </div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowCreateAccount(false)}>Cancel</Button>
              <Button type="submit">Create Account</Button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Accounts List */}
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-zinc-500" />
            <h3 className="font-bold text-zinc-900 uppercase text-xs tracking-widest">Sub-Accounts ({accounts.length})</h3>
          </div>
          <div className="divide-y divide-zinc-100 max-h-[400px] overflow-y-auto">
            {accounts.map(account => (
              <div key={account.id} className="px-6 py-4 hover:bg-zinc-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-zinc-900">{account.name}</p>
                    <p className="text-xs text-zinc-500">ID: {account.id}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-zinc-600">{account.members?.length || 0} Members</p>
                    <p className="text-[10px] text-zinc-400">Created: {new Date(account.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Users List */}
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50 flex items-center gap-2">
            <Users className="h-4 w-4 text-zinc-500" />
            <h3 className="font-bold text-zinc-900 uppercase text-xs tracking-widest">Platform Users ({users.length})</h3>
          </div>
          <div className="divide-y divide-zinc-100 max-h-[400px] overflow-y-auto">
            {users.map(u => (
              <div key={u.id} className="px-6 py-4 hover:bg-zinc-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {u.photoURL ? (
                      <img src={u.photoURL} className="h-8 w-8 rounded-full border border-zinc-200" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400">
                        <Users className="h-4 w-4" />
                      </div>
                    )}
                    <div>
                      <p className="font-bold text-zinc-900 text-sm">{u.displayName || "Anonymous"}</p>
                      <p className="text-xs text-zinc-500">{u.email}</p>
                      <p className="text-[10px] text-zinc-400 font-mono">UID: {u.id}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <select
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-zinc-100 text-zinc-600 cursor-pointer focus:ring-2 focus:ring-zinc-900"
                      value={u.role || "user"}
                      onChange={(e) => handleUpdateRole(u.id, e.target.value)}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                      <option value="master_admin">Master Admin</option>
                    </select>
                    {u.accountId && <p className="text-[10px] text-zinc-400">Account: {u.accountId.slice(0, 8)}...</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}
