import TopNav from "./topnav";
import Sidebar from "./sidebar";
import PageTransition from "./page-transition";
import CommandPalette from "./command-palette";
import FinanceBuddy from "./finance-buddy";

/* The responsive application shell: glass top bar, persistent sidebar (drawer
   on narrow screens), ⌘K palette, and the page-transition content column.
   Pure chrome — no data access and no dashboard calculations live here. */
export default function AppShell({ userName, canBuddy = false, hiddenNav = [], children }) {
  return (
    <>
      <TopNav userName={userName} />
      <CommandPalette />
      <div style={{ display: "flex", alignItems: "stretch", minHeight: "calc(100vh - 57px)" }}>
        <Sidebar hiddenNav={hiddenNav} />
        <main style={{ flex: 1, minWidth: 0 }}>
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      {canBuddy && <FinanceBuddy />}
    </>
  );
}
