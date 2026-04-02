import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Button } from "./ui/Button";
import { toast } from "sonner";
import { Mail, CheckCircle2, XCircle, Clock } from "lucide-react";

interface InvitationListProps {
  userEmail?: string;
}

export function InvitationList({ userEmail }: InvitationListProps) {
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userEmail) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "invitations"),
      where("email", "==", userEmail),
      where("status", "==", "pending")
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      setInvites(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userEmail]);

  const handleAcceptInvite = async (inviteId: string) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ inviteId })
      });

      if (res.ok) {
        toast.success("Invitation accepted successfully");
        // Refresh page to update user profile/role
        window.location.reload();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to accept invitation");
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
      <div>
        <h2 className="text-2xl font-black tracking-tight text-zinc-900 uppercase">My Invitations</h2>
        <p className="text-sm text-zinc-500">Invitations to join accounts and manage resources.</p>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50 flex items-center gap-2">
          <Mail className="h-4 w-4 text-zinc-500" />
          <h3 className="font-bold text-zinc-900 uppercase text-xs tracking-widest">Pending Invitations ({invites.length})</h3>
        </div>
        <div className="divide-y divide-zinc-100">
          {invites.length === 0 ? (
            <div className="px-6 py-12 text-center text-zinc-400">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">You have no pending invitations.</p>
            </div>
          ) : (
            invites.map(invite => (
              <div key={invite.id} className="px-6 py-4 hover:bg-zinc-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-bold text-zinc-900">Invite to join Account: {invite.accountId.slice(0, 8)}...</p>
                      <p className="text-xs text-zinc-500">Role: <span className="font-bold uppercase">{invite.role}</span></p>
                      <p className="text-[10px] text-zinc-400 mt-1">Sent: {new Date(invite.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => handleAcceptInvite(invite.id)} className="gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Accept
                    </Button>
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
