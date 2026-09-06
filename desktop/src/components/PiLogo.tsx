import { IconPiMark } from "@/components/icons";

/**
 * App brand mark — Pi glyph with fill=currentColor.
 * Inherits text color from parent so dark/light themes invert automatically.
 */
export function PiLogo({ size = 22 }: { size?: number }) {
  return <IconPiMark size={size} className="pi-logo" title="Pi" />;
}
