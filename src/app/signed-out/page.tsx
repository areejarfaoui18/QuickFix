"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthDialog } from "@/components/auth-dialog";

export default function SignedOutPage() {
  const router = useRouter();
  const [showLogin, setShowLogin] = useState(false);

  return (
    <main className="signed-out-page">
      <Link className="brand signed-out-brand" href="/" aria-label="QuickFix, accueil">
        <span className="brand-mark">q<span>.</span></span><span>quickfix</span>
      </Link>
      <section className="signed-out-content" aria-labelledby="signed-out-title">
        <span className="signed-out-symbol" aria-hidden="true">✓</span>
        <p className="eyebrow">VOTRE ESPACE QUICKFIX</p>
        <h1 id="signed-out-title">Vous êtes déconnecté</h1>
        <p>Votre session a bien été fermée.</p>
        <div className="signed-out-actions">
          <button className="primary-button" onClick={() => setShowLogin(true)}>Se reconnecter</button>
          <Link className="signed-out-link" href="/">Continuer en tant que visiteur</Link>
        </div>
      </section>
      {showLogin && <AuthDialog initialMode="login" onClose={() => setShowLogin(false)} onSuccess={() => { setShowLogin(false); router.replace("/"); }} />}
    </main>
  );
}