import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mirror",
  description: "Follow verified lead traders on Flare with encrypted signals.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="shell">
            <Nav />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
