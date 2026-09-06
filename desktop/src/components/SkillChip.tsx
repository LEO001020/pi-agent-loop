/**
 * Unified skill tag: icon + name.
 * Used in composer (contenteditable=false chips) and user message history.
 */

import { IconSkills } from "@/components/icons";
import { cn } from "@/lib/utils";

export function SkillChip({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const iconSize = size === "sm" ? 12 : 14;
  return (
    <span
      className={cn(
        "skill-chip",
        size === "sm" && "skill-chip--sm",
        className,
      )}
      data-skill={name}
      contentEditable={false}
      suppressContentEditableWarning
    >
      <IconSkills size={iconSize} className="skill-chip__icon" />
      <span className="skill-chip__name">{name}</span>
    </span>
  );
}
