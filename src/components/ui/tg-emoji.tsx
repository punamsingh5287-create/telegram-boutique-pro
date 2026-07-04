import { cn } from "@/lib/utils";

/**
 * TgEmoji — renders emoji with a Telegram Premium–style presentation:
 * Noto Color Emoji font, subtle glow, optional gentle pop animation.
 * This is a web simulation; true Telegram Premium animated emojis only
 * render inside Telegram Premium clients via custom_emoji entities.
 */
export function TgEmoji({
  children,
  variant = "royal",
  animated = false,
  className,
  ariaLabel,
}: {
  children: string;
  variant?: "royal" | "gold";
  animated?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <span
      role="img"
      aria-label={ariaLabel ?? children}
      className={cn(
        variant === "gold" ? "tg-emoji-gold" : "tg-emoji",
        animated && "tg-emoji-animated",
        className,
      )}
    >
      {children}
    </span>
  );
}