"use client";

import Link from "next/link";
import { useAccount, useConnect, useDisconnect } from "wagmi";

const links = [
  { href: "/", label: "Discover" },
  { href: "/lead/onboard", label: "Lead" },
  { href: "/follower/onboard", label: "Follow" },
  { href: "/follower/xrpl", label: "XRPL" },
  { href: "/signal", label: "Signal" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/withdraw", label: "Withdraw" },
];

export function Nav() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <header className="nav">
      <Link href="/" className="nav-brand">
        Mirror
      </Link>
      <nav className="nav-links">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="nav-wallet">
        {isConnected && address ? (
          <>
            <span className="addr">
              {address.slice(0, 6)}…{address.slice(-4)}
            </span>
            <button type="button" className="btn ghost" onClick={() => disconnect()}>
              Disconnect
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={isPending}
            onClick={() => connect({ connector: connectors[0] })}
          >
            {isPending ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>
    </header>
  );
}
