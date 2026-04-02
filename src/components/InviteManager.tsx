import React, { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Button } from "./ui/Button";
import { toast } from "sonner";
import { Mail, Send, CheckCircle2, Clock } from "lucide-react";

interface InviteManagerProps {
  accountId?: string;
}

export function InviteManager({ accountId }: InviteManagerProps) {
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newInvite, setNewInvite] = useState({ email: "", role: "user" });

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "invitations"),
      where("accountId", "==", accountId)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      setInvites(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });

    return () => unsubscribe();
  }, [accountId]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/invites/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ ...newInvite, accountId })
      });

      if (res.ok) {
        toast.success("Invitation sent successfully");
        setNewInvite({ email: "", role: "user" });
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to send invitation");
      }
    } catch (err) {
      toast.error("An error occurred");
    }
  };

  if (!accountId) {
    return (
      <div className="bg-zinc-50 p-12 rounded-2xl border-2 border-dashed border-zinc-200 text-center">
        <Mail className="h-12 w-12 text-zinc-300 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-zinc-900">No Account Assigned</h3>
        <p className="text-zinc-500 max-w-md mx-auto mt-2">
          You are not currently assigned to any account. Please contact a master admin to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-zinc-900 uppercase">Invite Users</h2>
        <p className="text-sm text-zinc-500">Invite people to join your account and manage resources.</p>
      </div>

      <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm space-y-4">
        <h3 className="font-bold text-zinc-900">Send New Invite</h3>
        <form onSubmit={handleSendInvite} className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase">Email Address</label>
            <input
              required
              type="email"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              value={newInvite.email}
              onChange={e => setNewInvite({ ...newInvite, email: e.target.value })}
              placeholder="user@example.com"
            />
          </div>
          <div className="w-full md:w-48 space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase">Role</label>
            <select
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              value={newInvite.role}
              onChange={e => setNewInvite({ ...newInvite, role: e.target.value })}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button type="submit" className="gap-2 w-full md:w-auto">
              <Send className="h-4 w-4" />
              Send Invite
            </Button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50">
          <h3 className="font-bold text-zinc-900 uppercase text-xs tracking-widest">Sent Invitations ({invites.length})</h3>
        </div>
        <div className="divide-y divide-zinc-100">
          {invites.length === 0 ? (
            <div className="px-6 py-12 text-center text-zinc-400">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No invitations sent yet.</p>
            </div>
          ) : (
            invites.map(invite => (
              <div key={invite.id} className="px-6 py-4 hover:bg-zinc-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-bold text-zinc-900 text-sm">{invite.email}</p>
                      <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Role: {invite.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                        invite.status === "accepted" ? "bg-green-100 text-green-700" : 
                        invite.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600"
                      )}>
                        {invite.status}
                      </span>
                      <p className="text-[10px] text-zinc-400 mt-1">Sent: {new Date(invite.createdAt).toLocaleDateString()}</p>
                    </div>
                    {invite.status === "accepted" && (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}
