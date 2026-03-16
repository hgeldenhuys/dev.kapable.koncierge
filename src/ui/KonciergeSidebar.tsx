import React, { useState, type FC, type ReactNode } from "react";
import { KonciergePanel, type KonciergePanelProps } from "./KonciergePanel";
import { KonciergeToggle } from "./KonciergeToggle";

export interface KonciergeSidebarProps
  extends Omit<KonciergePanelProps, "collapsed" | "className"> {
  /** The main page content (children render in the main area) */
  children: ReactNode;
  /** Width of the panel when open (default: 360px) */
  panelWidth?: number;
  /** Start open or closed (default: false / closed) */
  defaultOpen?: boolean;
}

/**
 * Dashboard layout wrapper that adds a collapsible Koncierge sidebar.
 *
 * Usage in _dashboard.tsx:
 *   <KonciergeSidebar endpoint="/bff/koncierge/message" currentRoute={pathname}>
 *     <Outlet />
 *   </KonciergeSidebar>
 */
export const KonciergeSidebar: FC<KonciergeSidebarProps> = ({
  children,
  panelWidth = 360,
  defaultOpen = false,
  ...panelProps
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      className="koncierge-layout"
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      {/* Main content area */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          transition: "margin-right 0.3s ease",
          marginRight: isOpen ? `${panelWidth}px` : 0,
        }}
      >
        {children}
      </div>

      {/* Toggle button — always visible */}
      <div
        style={{
          position: "fixed",
          bottom: "20px",
          right: isOpen ? `${panelWidth + 16}px` : "20px",
          zIndex: 50,
          transition: "right 0.3s ease",
        }}
      >
        <KonciergeToggle
          isOpen={isOpen}
          onToggle={() => setIsOpen((prev) => !prev)}
        />
      </div>

      {/* Panel — slides in from right */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: `${panelWidth}px`,
          height: "100vh",
          transform: isOpen ? "translateX(0)" : `translateX(${panelWidth}px)`,
          transition: "transform 0.3s ease",
          zIndex: 40,
          boxShadow: isOpen
            ? "-4px 0 16px rgba(0, 0, 0, 0.08)"
            : "none",
        }}
      >
        <KonciergePanel
          {...panelProps}
          collapsed={!isOpen}
        />
      </div>
    </div>
  );
};

export default KonciergeSidebar;
