import React, { type FC } from "react";

export interface KonciergeToggleProps {
  /** Whether the panel is currently open */
  isOpen: boolean;
  /** Toggle handler */
  onToggle: () => void;
  /** Optional className */
  className?: string;
}

/**
 * Floating toggle button that opens/closes the Koncierge chat panel.
 * Designed to sit in the console sidebar or as a fixed button.
 */
export const KonciergeToggle: FC<KonciergeToggleProps> = ({
  isOpen,
  onToggle,
  className,
}) => {
  return (
    <button
      onClick={onToggle}
      className={`koncierge-toggle ${className || ""}`}
      aria-label={isOpen ? "Close Koncierge" : "Open Koncierge"}
      title={isOpen ? "Close Koncierge" : "Open Koncierge"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "40px",
        height: "40px",
        borderRadius: "10px",
        border: "1px solid hsl(var(--border, 220 13% 91%))",
        backgroundColor: isOpen
          ? "hsl(var(--primary, 222.2 47.4% 11.2%))"
          : "hsl(var(--background, 0 0% 100%))",
        color: isOpen
          ? "hsl(var(--primary-foreground, 210 40% 98%))"
          : "hsl(var(--foreground, 222.2 84% 4.9%))",
        cursor: "pointer",
        transition: "all 0.2s ease",
        fontSize: "18px",
        padding: 0,
      }}
    >
      {isOpen ? "✕" : "🔔"}
    </button>
  );
};

export default KonciergeToggle;
