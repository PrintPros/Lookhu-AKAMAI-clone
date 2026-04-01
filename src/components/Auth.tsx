import React, { useState, useEffect } from "react";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/Card";
import { Input } from "./ui/Input";
import { Radio, Lock, LogIn, AlertCircle, Mail, UserPlus, Chrome } from "lucide-react";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile
} from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";

interface AuthProps {
  onSuccess: () => void;
}

export function Auth({ onSuccess }: AuthProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Sync user to Firestore
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: new Date().toISOString(),
          role: user.email === "lookhumaster@gmail.com" ? "admin" : "user"
        });
      }
      onSuccess();
    } catch (err: any) {
      console.error("Google Auth error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isSignUp) {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(result.user, { displayName });
        
        // Create user doc
        await setDoc(doc(db, "users", result.user.uid), {
          uid: result.user.uid,
          email: result.user.email,
          displayName: displayName,
          createdAt: new Date().toISOString(),
          role: email === "lookhumaster@gmail.com" ? "admin" : "user"
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      onSuccess();
    } catch (err: any) {
      console.error("Email Auth error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="bg-zinc-900 p-3 rounded-2xl shadow-lg">
              <Radio className="h-10 w-10 text-white" />
            </div>
          </div>
          <div className="space-y-1">
            <h1 className="text-4xl font-bold tracking-tighter text-zinc-900">RAG.org</h1>
            <p className="text-zinc-500 font-medium">Fast Channel Playout Platform</p>
          </div>
        </div>

        <Card className="shadow-2xl border-zinc-200">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl">{isSignUp ? "Create Account" : "Welcome Back"}</CardTitle>
            <CardDescription>
              {isSignUp ? "Join the playout platform today" : "Sign in to manage your channels"}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <Button 
              variant="outline" 
              className="w-full h-12 gap-2 border-zinc-200 hover:bg-zinc-50"
              onClick={handleGoogleSignIn}
              disabled={loading}
            >
              <Chrome className="h-5 w-5" />
              Continue with Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-zinc-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-zinc-500">Or continue with email</span>
              </div>
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-4">
              {isSignUp && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700">Display Name</label>
                  <Input 
                    placeholder="John Doe" 
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Email Address</label>
                <Input 
                  type="email" 
                  placeholder="name@example.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700">Password</label>
                <Input 
                  type="password" 
                  placeholder="••••••••" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              
              {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 p-3 rounded-lg flex items-center gap-2 text-sm font-medium">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              <Button className="w-full h-12 text-base font-semibold shadow-md" type="submit" disabled={loading}>
                {loading ? "Processing..." : (
                  <>{isSignUp ? <UserPlus className="mr-2 h-5 w-5" /> : <LogIn className="mr-2 h-5 w-5" />} {isSignUp ? "Sign Up" : "Sign In"}</>
                )}
              </Button>
            </form>

            <div className="text-center">
              <button 
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-sm text-zinc-600 hover:text-zinc-900 font-medium"
              >
                {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up"}
              </button>
            </div>
          </CardContent>
        </Card>
        
        <p className="text-center text-xs text-zinc-400">
          &copy; 2026 RAG.org • Secure Playout Infrastructure
        </p>
      </div>
    </div>
  );
}
